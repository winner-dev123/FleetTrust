import {
  auditEvents,
  branches,
  eq,
  PLAN_CATALOG,
  planAssignments,
  platformStaff,
  users,
} from "@fleettrust/db";
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  type EntitlementsResponse,
  type MyOrganization,
  type PlanAssignmentDto,
  type PlanDto,
  type QuotaOverrideDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EntitlementsService, subjectOfUser } from "../src/modules/entitlements/index.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

/** A clock tests can move forward (grace periods, daily resets). */
const clock = {
  offsetMs: 0,
  now: () => new Date(Date.now() + clock.offsetMs),
  advanceDays(days: number) {
    clock.offsetMs += days * 24 * 60 * 60 * 1000;
  },
};

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({ clock });
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;

function person(uid: string) {
  const email = `${uid}@example.test`;
  const auth = () => ({ Authorization: `Bearer ${t.auth.issue(uid, { email })}` });
  return {
    uid,
    email,
    get: (path: string) => request(t.server).get(path).set(auth()),
    post: (path: string, body?: object) =>
      request(t.server)
        .post(path)
        .set(auth())
        .send(body ?? {}),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth()).send(body),
    del: (path: string) => request(t.server).delete(path).set(auth()),
  };
}
type Person = ReturnType<typeof person>;

async function userIdOf(p: Person): Promise<string> {
  const me = await p.get("/v1/me").expect(200);
  return (me.body as { id: string }).id;
}

async function makeOperator(uid: string): Promise<Person> {
  const operator = person(uid);
  const id = await userIdOf(operator);
  await t.db.db.insert(platformStaff).values({ userId: id, role: "billing_operator" });
  return operator;
}

async function createOrg(owner: Person, kind: "provider" | "fleet"): Promise<string> {
  const response = await owner.post("/v1/orgs", { kind, name: `${owner.uid} org` }).expect(201);
  return (response.body as MyOrganization).organization.id;
}

async function versionId(operator: Person, code: string): Promise<string> {
  const catalog = (await operator.get("/v1/admin/billing/plans").expect(200)).body as PlanDto[];
  const plan = catalog.find((p) => p.code === code);
  const published = plan?.versions.find((v) => v.status === "published");
  if (!published) throw new Error(`no published version of ${code}`);
  return published.id;
}

function meter(response: EntitlementsResponse, key: string) {
  const entry = response.entitlements.find((e) => e.key === key);
  if (!entry) throw new Error(`no meter for ${key}`);
  return entry;
}

let operator: Person;

beforeAll(async () => {
  operator = await makeOperator("billing-operator");
});

describe("catalog", () => {
  it("every seeded limit is a known capability that applies to the plan's audience", () => {
    for (const plan of PLAN_CATALOG) {
      const subject = plan.audience === "user" ? "user" : "organization";
      for (const key of Object.keys(plan.limits)) {
        expect(CAPABILITY_KEYS, `${plan.code}: ${key}`).toContain(key);
        expect(
          (CAPABILITIES[key as keyof typeof CAPABILITIES].subjects as readonly string[]).includes(
            subject,
          ),
          `${plan.code}: ${key} applies to ${subject}`,
        ).toBe(true);
      }
    }
  });

  it("has no emergency capability: emergency can't be quota-gated (ADR-0010, FR-04)", () => {
    expect(CAPABILITY_KEYS.filter((key) => /emergenc|incident|trusted|sos/i.test(key))).toEqual([]);
    const service = t.app.get(EntitlementsService);
    return expect(
      t.db.db.transaction((tx) =>
        service.consume(
          tx,
          {
            type: "user",
            id: "0190f4a6-1c2b-7d3e-8f40-123456789abc",
            audience: "user",
            timeZone: "UTC",
          },
          "emergency.daily" as never,
        ),
      ),
    ).rejects.toThrow(/not a daily quota/);
  });
});

describe("defaults and usage meters", () => {
  it("a new user is on the default personal plan", async () => {
    const someone = person("ent-default-user");
    const response = await someone.get("/v1/me/entitlements").expect(200);
    const body = response.body as EntitlementsResponse;
    expect(body.plan).toMatchObject({
      code: "personal-free",
      source: "default",
      activatedAt: null,
    });
    expect(body.timeZone).toBe("UTC");
    expect(meter(body, "friend_requests.daily")).toMatchObject({
      limit: 20,
      used: 0,
      source: "plan",
    });
    expect(body.entitlements.map((e) => e.key)).not.toContain("staff.seats");
  });

  it("an organization sees its plan, limits and live usage", async () => {
    const owner = person("ent-org-owner");
    const orgId = await createOrg(owner, "provider");
    await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Main" }).expect(201);
    const body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(body.plan.code).toBe("provider-free");
    expect(meter(body, "branches.max")).toMatchObject({ limit: 3, used: 1, overLimit: false });
    expect(meter(body, "staff.seats")).toMatchObject({ limit: 5, used: 1 });
    expect(body.entitlements.map((e) => e.key)).not.toContain("friend_requests.daily");

    // Another tenant can't read them.
    await person("ent-org-outsider").get(`/v1/orgs/${orgId}/entitlements`).expect(404);
  });
});

describe("capacity limits", () => {
  it("blocks the branch above the plan limit", async () => {
    const owner = person("cap-branches");
    const orgId = await createOrg(owner, "provider");
    for (const name of ["One", "Two", "Three"]) {
      await owner.post(`/v1/orgs/${orgId}/branches`, { name }).expect(201);
    }
    const blocked = await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Four" }).expect(403);
    expect(blocked.body).toMatchObject({
      reason: "quota_exceeded",
      key: "branches.max",
      limit: 3,
      used: 3,
    });
  });

  it("parallel branch creation never exceeds the limit", async () => {
    const owner = person("cap-race");
    const orgId = await createOrg(owner, "fleet");
    const responses = await Promise.all(
      Array.from({ length: 8 }, (_, i) =>
        owner.post(`/v1/orgs/${orgId}/branches`, { name: `Depot ${String(i)}` }),
      ),
    );
    expect(responses.filter((r) => r.status === 201)).toHaveLength(3);
    expect(responses.filter((r) => r.status === 403)).toHaveLength(5);
    const rows = await t.db.db.select().from(branches).where(eq(branches.organizationId, orgId));
    expect(rows).toHaveLength(3);
  });

  it("seats count members plus pending invitations", async () => {
    const owner = person("cap-seats");
    const orgId = await createOrg(owner, "provider"); // 5 seats, owner holds 1
    for (let i = 0; i < 4; i++) {
      await owner
        .post(`/v1/orgs/${orgId}/invitations`, {
          email: `seat${String(i)}@example.test`,
          role: "staff",
        })
        .expect(201);
    }
    const blocked = await owner
      .post(`/v1/orgs/${orgId}/invitations`, { email: "seat-extra@example.test", role: "staff" })
      .expect(403);
    expect(reason(blocked.body)).toBe("quota_exceeded");
    // Re-inviting someone already pending replaces their invitation, so it still fits.
    await owner
      .post(`/v1/orgs/${orgId}/invitations`, { email: "seat0@example.test", role: "manager" })
      .expect(201);
  });
});

describe("billing operators", () => {
  it("the staff API is invisible to everyone else", async () => {
    const owner = person("not-staff");
    await owner.get("/v1/admin/billing/plans").expect(404);
    await owner.post("/v1/admin/billing/assignments", {}).expect(404);
  });

  it("assigns a plan after external confirmation, superseding the previous one, with an audit trail", async () => {
    const owner = person("assign-owner");
    const orgId = await createOrg(owner, "provider");
    const pro = await versionId(operator, "provider-pro");

    const first = (
      await operator
        .post("/v1/admin/billing/assignments", {
          subject: { type: "organization", id: orgId },
          planVersionId: pro,
          externalReference: "Bank transfer 2026-11-19 #A1",
          invoiceNumber: "INV-1001",
        })
        .expect(201)
    ).body as PlanAssignmentDto;
    expect(first).toMatchObject({ planCode: "provider-pro", graceDays: 14, endedAt: null });

    const body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(body.plan).toMatchObject({ code: "provider-pro", source: "assignment" });
    expect(meter(body, "branches.max").limit).toBe(20);

    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: orgId },
        planVersionId: pro,
        externalReference: "Renewal #A2",
      })
      .expect(201);
    const [old] = await t.db.db
      .select()
      .from(planAssignments)
      .where(eq(planAssignments.id, first.id));
    expect(old?.endReason).toBe("superseded");

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, orgId));
    const assigned = audit.filter((e) => e.action === "plan.assigned");
    expect(assigned).toHaveLength(2);
    expect(assigned[0]).toMatchObject({ actorType: "admin" });
    expect(JSON.stringify(assigned)).not.toMatch(/paid|payment/i);
  });

  it("refuses a plan for the wrong audience", async () => {
    const owner = person("audience-owner");
    const orgId = await createOrg(owner, "provider");
    const response = await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: orgId },
        planVersionId: await versionId(operator, "fleet-pro"),
        externalReference: "x",
      })
      .expect(400);
    expect(reason(response.body)).toBe("plan_audience_mismatch");
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: "0190f4a6-1c2b-7d3e-8f40-123456789abc" },
        planVersionId: await versionId(operator, "provider-pro"),
        externalReference: "x",
      })
      .expect(404);
  });

  it("overrides replace a limit until revoked, and are audited", async () => {
    const owner = person("override-owner");
    const orgId = await createOrg(owner, "provider");
    const created = (
      await operator
        .post("/v1/admin/billing/overrides", {
          subject: { type: "organization", id: orgId },
          key: "branches.max",
          limit: null,
          reason: "Pilot customer, unlimited branches until launch",
        })
        .expect(201)
    ).body as QuotaOverrideDto;
    let body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(meter(body, "branches.max")).toMatchObject({ limit: null, source: "override" });

    await operator.del(`/v1/admin/billing/overrides/${created.id}`).expect(204);
    await operator.del(`/v1/admin/billing/overrides/${created.id}`).expect(404);
    body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(meter(body, "branches.max")).toMatchObject({ limit: 3, source: "plan" });

    const notApplicable = await operator
      .post("/v1/admin/billing/overrides", {
        subject: { type: "organization", id: orgId },
        key: "friend_requests.daily",
        limit: 5,
        reason: "Not a thing for organizations",
      })
      .expect(400);
    expect(reason(notApplicable.body)).toBe("capability_not_applicable");

    const actions = (
      await t.db.db.select().from(auditEvents).where(eq(auditEvents.organizationId, orgId))
    ).map((e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining(["entitlement.override_set", "entitlement.override_revoked"]),
    );
  });

  it("shows an account's history", async () => {
    const owner = person("history-owner");
    const orgId = await createOrg(owner, "fleet");
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: orgId },
        planVersionId: await versionId(operator, "fleet-pro"),
        externalReference: "Invoice 77",
      })
      .expect(201);
    const account = await operator.get(`/v1/admin/billing/organizations/${orgId}`).expect(200);
    expect(account.body).toMatchObject({
      entitlements: { plan: { code: "fleet-pro" } },
      assignments: [{ externalReference: "Invoice 77" }],
      overrides: [],
    });
    await operator.get(`/v1/admin/billing/vehicles/${orgId}`).expect(404);
  });
});

describe("downgrades are safe", () => {
  it("keeps everything, honours the grace period, then blocks creation above the new limit", async () => {
    const owner = person("downgrade-owner");
    const orgId = await createOrg(owner, "provider");
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: orgId },
        planVersionId: await versionId(operator, "provider-pro"),
        externalReference: "Q4 invoice",
        // If this assignment ends (renewal lapses, downgrade), its limits linger for 7 days.
        graceDays: 7,
      })
      .expect(201);
    for (let i = 1; i <= 6; i++) {
      await owner.post(`/v1/orgs/${orgId}/branches`, { name: `Site ${String(i)}` }).expect(201);
    }

    // Downgrade to the free plan (3 branches). Pro's 7-day grace period starts now.
    await operator
      .post("/v1/admin/billing/assignments", {
        subject: { type: "organization", id: orgId },
        planVersionId: await versionId(operator, "provider-free"),
        externalReference: "Customer chose not to renew",
      })
      .expect(201);

    let body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(body.plan.code).toBe("provider-free");
    expect(meter(body, "branches.max")).toMatchObject({
      limit: 20,
      source: "grace",
      overLimit: false,
    });
    expect(meter(body, "branches.max").graceUntil).not.toBeNull();
    await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Site 7" }).expect(201);

    try {
      clock.advanceDays(8);
      body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
        .body as EntitlementsResponse;
      expect(meter(body, "branches.max")).toMatchObject({
        limit: 3,
        used: 7,
        source: "plan",
        overLimit: true,
      });
      const blocked = await owner
        .post(`/v1/orgs/${orgId}/branches`, { name: "Site 8" })
        .expect(403);
      expect(reason(blocked.body)).toBe("quota_exceeded");

      // Nothing was deleted, and existing data stays usable.
      const list = (await owner.get(`/v1/orgs/${orgId}/branches`).expect(200)).body as unknown[];
      expect(list).toHaveLength(7);
      const first = (list[0] as { id: string }).id;
      await owner
        .patch(`/v1/orgs/${orgId}/branches/${first}`, { name: "Renamed site" })
        .expect(200);
      await owner.del(`/v1/orgs/${orgId}/branches/${first}`).expect(204);
    } finally {
      clock.offsetMs = 0;
    }
  });

  it("ending an assignment falls back to the default plan after grace; ending twice is 409", async () => {
    const owner = person("cancel-owner");
    const orgId = await createOrg(owner, "fleet");
    const assignment = (
      await operator
        .post("/v1/admin/billing/assignments", {
          subject: { type: "organization", id: orgId },
          planVersionId: await versionId(operator, "fleet-pro"),
          externalReference: "Trial",
          graceDays: 0,
        })
        .expect(201)
    ).body as PlanAssignmentDto;
    await operator
      .post(`/v1/admin/billing/assignments/${assignment.id}/end`, {})
      .set("X-Confirm-Action", "plan.end_assignment")
      .expect(204);
    const again = await operator
      .post(`/v1/admin/billing/assignments/${assignment.id}/end`, {})
      .set("X-Confirm-Action", "plan.end_assignment")
      .expect(409);
    expect(reason(again.body)).toBe("assignment_already_ended");
    const body = (await owner.get(`/v1/orgs/${orgId}/entitlements`).expect(200))
      .body as EntitlementsResponse;
    expect(body.plan).toMatchObject({ code: "fleet-free", source: "default" });
  });

  it("an accepted invitation can't push members above the limit after a downgrade", async () => {
    const owner = person("seat-downgrade-owner");
    const orgId = await createOrg(owner, "provider");
    await operator
      .post("/v1/admin/billing/overrides", {
        subject: { type: "organization", id: orgId },
        key: "staff.seats",
        limit: 3,
        reason: "Simulated downgrade to 3 seats",
      })
      .expect(201);
    const tokens: string[] = [];
    for (const name of ["a", "b"]) {
      const created = await owner
        .post(`/v1/orgs/${orgId}/invitations`, {
          email: `seat-${name}@example.test`,
          role: "staff",
        })
        .expect(201);
      tokens.push((created.body as { token: string }).token);
    }
    // Shrink to 2 seats: owner + one member.
    await operator
      .post("/v1/admin/billing/overrides", {
        subject: { type: "organization", id: orgId },
        key: "staff.seats",
        limit: 2,
        reason: "Simulated further downgrade",
      })
      .expect(201);
    await person("seat-a").post("/v1/invitations/accept", { token: tokens[0] }).expect(200);
    const refused = await person("seat-b")
      .post("/v1/invitations/accept", { token: tokens[1] })
      .expect(403);
    expect(reason(refused.body)).toBe("quota_exceeded");
  });
});

describe("daily quotas", () => {
  it("consume atomically under concurrency and reset at local midnight", async () => {
    const someone = person("daily-user");
    const userId = await userIdOf(someone);
    await someone.patch("/v1/me", { timeZone: "Pacific/Auckland" }).expect(200);
    const [user] = await t.db.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error("user missing");
    const subject = subjectOfUser(user);
    const service = t.app.get(EntitlementsService);

    const attempt = () =>
      t.db.db
        .transaction((tx) => service.consume(tx, subject, "friend_requests.daily"))
        .then(
          () => true,
          (error: unknown) => {
            expect((error as { response?: { reason?: string } }).response?.reason).toBe(
              "quota_exceeded",
            );
            return false;
          },
        );
    const results = await Promise.all(Array.from({ length: 30 }, attempt));
    expect(results.filter(Boolean)).toHaveLength(20); // personal-free: 20 per day

    const meters = (await someone.get("/v1/me/entitlements").expect(200))
      .body as EntitlementsResponse;
    expect(meters.timeZone).toBe("Pacific/Auckland");
    expect(meter(meters, "friend_requests.daily")).toMatchObject({ used: 20, limit: 20 });

    try {
      clock.advanceDays(1);
      expect(await attempt()).toBe(true);
    } finally {
      clock.offsetMs = 0;
    }
  });

  it("retries with the same idempotency key are counted once", async () => {
    const someone = person("idem-user");
    const userId = await userIdOf(someone);
    const [user] = await t.db.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw new Error("user missing");
    const service = t.app.get(EntitlementsService);
    for (let i = 0; i < 5; i++) {
      await t.db.db.transaction((tx) =>
        service.consume(tx, subjectOfUser(user), "articles.daily", { idempotencyKey: "draft-42" }),
      );
    }
    const meters = (await someone.get("/v1/me/entitlements").expect(200))
      .body as EntitlementsResponse;
    expect(meter(meters, "articles.daily").used).toBe(1);
  });

  it("rejects unknown time zones", async () => {
    const someone = person("tz-user");
    await someone.patch("/v1/me", { timeZone: "Mars/Olympus_Mons" }).expect(400);
    const orgId = await createOrg(someone, "fleet");
    await someone.patch(`/v1/orgs/${orgId}`, { timeZone: "Not/AZone" }).expect(400);
    const updated = await someone
      .patch(`/v1/orgs/${orgId}`, { timeZone: "Africa/Johannesburg" })
      .expect(200);
    expect((updated.body as MyOrganization).organization.timeZone).toBe("Africa/Johannesburg");
  });
});

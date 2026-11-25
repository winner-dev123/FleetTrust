import { articles, auditEvents, eq, PLATFORM_ROLES, platformStaff } from "@fleettrust/db";
import {
  type AdminMe,
  type AuditPage,
  type FeatureSettingDto,
  type MyOrganization,
  type PlatformStaffMemberDto,
  type PublicConfig,
  type ServiceCategoryDto,
  STAFF_ROLES,
  type StaffRole,
  type SupportAccountDto,
  type SupportCaseDto,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { EMAIL_SENDER, type RecordingEmailSender } from "../src/platform/email/index.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;
let email: RecordingEmailSender;

beforeAll(async () => {
  // Production behaviour: staff routes need a second factor on the current sign-in.
  t = await createTestApp({ env: { ADMIN_MFA: "required" } });
  email = t.app.get<RecordingEmailSender>(EMAIL_SENDER);
});

afterAll(async () => {
  await t.close();
});

const reason = (body: unknown) => (body as { reason?: string }).reason;
const MINUTE = 60_000;

interface SignIn {
  /** TOTP second factor on this sign-in (default true). */
  mfa?: boolean;
  signedInMinutesAgo?: number;
}

function client(uid: string, address: string, signIn: SignIn = {}) {
  const auth = {
    Authorization: `Bearer ${t.auth.issue(uid, {
      email: address,
      secondFactor: signIn.mfa === false ? undefined : "totp",
      authTime: new Date(Date.now() - (signIn.signedInMinutesAgo ?? 0) * MINUTE),
    })}`,
  };
  return {
    get: (path: string) => request(t.server).get(path).set(auth),
    post: (path: string, body: object = {}, confirm?: string) => {
      const req = request(t.server).post(path).set(auth);
      return (confirm ? req.set("X-Confirm-Action", confirm) : req).send(body);
    },
    put: (path: string, body: object = {}) => request(t.server).put(path).set(auth).send(body),
    patch: (path: string, body: object) => request(t.server).patch(path).set(auth).send(body),
    del: (path: string) => request(t.server).delete(path).set(auth),
  };
}

interface Person {
  uid: string;
  id: string;
  email: string;
  as: (signIn?: SignIn) => ReturnType<typeof client>;
}

async function person(uid: string, roles: StaffRole[] = []): Promise<Person> {
  const address = `${uid}@example.test`;
  const me = (await client(uid, address).patch("/v1/me", { displayName: uid }).expect(200))
    .body as { id: string };
  for (const role of roles) await t.db.db.insert(platformStaff).values({ userId: me.id, role });
  return { uid, id: me.id, email: address, as: (signIn) => client(uid, address, signIn) };
}

async function auditActions(targetId: string): Promise<string[]> {
  return (await t.db.db.select().from(auditEvents).where(eq(auditEvents.targetId, targetId))).map(
    (row) => row.action,
  );
}

describe("roles", () => {
  it("staff roles match between the shared types and the database", () => {
    expect([...PLATFORM_ROLES].sort()).toEqual([...STAFF_ROLES].sort());
  });
});

describe("admin MFA", () => {
  it("refuses staff routes without a second factor, and says why", async () => {
    const reviewer = await person("mfa-reviewer", ["verification_reviewer"]);
    const noMfa = reviewer.as({ mfa: false });
    for (const path of [
      "/v1/admin/verification/cases",
      "/v1/trust-safety/dashboard",
      "/v1/admin/audit",
    ]) {
      const res = await noMfa.get(path).expect(403);
      expect(reason(res.body)).toBe("mfa_required");
    }
    await reviewer.as().get("/v1/admin/verification/cases").expect(200);
  });

  it("lets the console ask for enrolment: /v1/admin/me works without MFA and reports it", async () => {
    const operator = await person("mfa-operator", ["billing_operator"]);
    const me = (await operator.as({ mfa: false }).get("/v1/admin/me").expect(200)).body as AdminMe;
    expect(me).toMatchObject({
      roles: ["billing_operator"],
      mfa: { required: true, satisfied: false },
    });
    const withMfa = (await operator.as().get("/v1/admin/me").expect(200)).body as AdminMe;
    expect(withMfa.mfa.satisfied).toBe(true);
  });

  it("keeps the staff surface hidden from everyone else (404, even with MFA)", async () => {
    const member = await person("mfa-member");
    for (const path of [
      "/v1/admin/me",
      "/v1/admin/staff",
      "/v1/admin/audit",
      "/v1/admin/support/cases",
    ]) {
      await member.as().get(path).expect(404);
    }
  });
});

describe("least privilege", () => {
  const routes: Record<string, string> = {
    verification: "/v1/admin/verification/cases",
    billing: "/v1/admin/billing/plans",
    moderation: "/v1/moderation/queue",
    staff: "/v1/admin/staff",
    features: "/v1/admin/features",
    support: "/v1/admin/support/cases",
  };
  const allowed: Record<StaffRole, string[]> = {
    super_admin: ["staff", "features"],
    verification_reviewer: ["verification"],
    billing_operator: ["billing"],
    trust_safety_moderator: ["moderation"],
    support_agent: ["support"],
  };

  it.each(STAFF_ROLES)("%s reaches only its own sections", async (role) => {
    const staff = await person(`lp-${role}`, [role]);
    for (const [section, path] of Object.entries(routes)) {
      const expected = allowed[role].includes(section) ? 200 : 404;
      const res = await staff.as().get(path);
      expect({ role, section, status: res.status }).toEqual({ role, section, status: expected });
    }
  });
});

describe("staff management (super admins)", () => {
  it("grants and revokes roles only with a recent sign-in and an explicit confirmation", async () => {
    const admin = await person("sm-admin", ["super_admin"]);
    const newcomer = await person("sm-new");

    const missing = await admin
      .as()
      .post("/v1/admin/staff/grant", { email: newcomer.email, role: "support_agent" });
    expect(missing.status).toBe(428);
    expect(reason(missing.body)).toBe("confirmation_required");

    const stale = await admin
      .as({ signedInMinutesAgo: 30 })
      .post(
        "/v1/admin/staff/grant",
        { email: newcomer.email, role: "support_agent" },
        "staff.grant",
      );
    expect(stale.status).toBe(401);
    expect(reason(stale.body)).toBe("reauthentication_required");

    const wrongAction = await admin
      .as()
      .post(
        "/v1/admin/staff/grant",
        { email: newcomer.email, role: "support_agent" },
        "staff.revoke",
      );
    expect(wrongAction.status).toBe(428);

    const granted = (
      await admin
        .as()
        .post(
          "/v1/admin/staff/grant",
          { email: newcomer.email, role: "support_agent" },
          "staff.grant",
        )
        .expect(200)
    ).body as PlatformStaffMemberDto[];
    expect(granted.find((s) => s.userId === newcomer.id)?.roles.map((r) => r.role)).toEqual([
      "support_agent",
    ]);
    await newcomer.as().get("/v1/admin/support/cases").expect(200);

    await admin
      .as()
      .post(
        "/v1/admin/staff/revoke",
        { userId: newcomer.id, role: "support_agent" },
        "staff.revoke",
      )
      .expect(200);
    await newcomer.as().get("/v1/admin/support/cases").expect(404);
    expect(await auditActions(newcomer.id)).toEqual(
      expect.arrayContaining(["staff.role_granted", "staff.role_revoked"]),
    );
  });

  it("never lets anyone change their own roles", async () => {
    const admin = await person("sm-self", ["super_admin"]);
    const res = await admin
      .as()
      .post(
        "/v1/admin/staff/grant",
        { email: admin.email, role: "billing_operator" },
        "staff.grant",
      );
    expect(res.status).toBe(403);
    expect(reason(res.body)).toBe("own_roles");
    const revoke = await admin
      .as()
      .post("/v1/admin/staff/revoke", { userId: admin.id, role: "super_admin" }, "staff.revoke");
    expect(reason(revoke.body)).toBe("own_roles");
  });

  it("answers 404 for an unknown account", async () => {
    const admin = await person("sm-unknown", ["super_admin"]);
    await admin
      .as()
      .post(
        "/v1/admin/staff/grant",
        { email: "nobody@example.test", role: "support_agent" },
        "staff.grant",
      )
      .expect(404);
  });
});

describe("irreversible actions in other modules", () => {
  it("need the confirmation header (badge revoke, document purge, ending a plan)", async () => {
    const reviewer = await person("irr-reviewer", ["verification_reviewer"]);
    const operator = await person("irr-operator", ["billing_operator"]);
    const id = "0190d000-0000-7000-8000-000000000001";
    for (const [who, path] of [
      [reviewer, `/v1/admin/verification/badges/${id}/revoke`],
      [reviewer, "/v1/admin/verification/purge"],
      [operator, `/v1/admin/billing/assignments/${id}/end`],
    ] as const) {
      const res = await who.as().post(path, { reason: "Licence reported suspended" });
      expect({ path, status: res.status, reason: reason(res.body) }).toEqual({
        path,
        status: 428,
        reason: "confirmation_required",
      });
    }
    // With confirmation the request reaches the service (here: nothing to purge).
    expect(
      (
        await reviewer
          .as()
          .post("/v1/admin/verification/purge", {}, "verification.purge")
          .expect(200)
      ).body,
    ).toEqual({ purged: 0 });
  });
});

describe("feature settings", () => {
  it("lists every setting with its default, validates changes and audits them", async () => {
    const admin = await person("fs-admin", ["super_admin"]);
    const list = (await admin.as().get("/v1/admin/features").expect(200))
      .body as FeatureSettingDto[];
    expect(list.map((s) => s.key).sort()).toEqual(
      ["community.auto_hide_reporters", "signups.paused", "site.notice"].sort(),
    );
    await admin
      .as()
      .put("/v1/admin/features/community.auto_hide_reporters", { value: 1 })
      .expect(400);
    await admin.as().put("/v1/admin/features/payments.enabled", { value: true }).expect(404);

    const notice = "Planned maintenance on Sunday 02:00–03:00 UTC.";
    const saved = (
      await admin.as().put("/v1/admin/features/site.notice", { value: notice }).expect(200)
    ).body as FeatureSettingDto;
    expect(saved).toMatchObject({ value: notice, updatedBy: admin.email });
    expect(
      ((await request(t.server).get("/v1/config").expect(200)).body as PublicConfig).siteNotice,
    ).toBe(notice);
    expect(await auditActions("site.notice")).toEqual(["feature.setting_changed"]);
    await admin.as().put("/v1/admin/features/site.notice", { value: null }).expect(200);
  });

  it("pausing sign-ups stops new accounts but not existing ones", async () => {
    const admin = await person("fs-pause", ["super_admin"]);
    const existing = await person("fs-existing");
    await admin.as().put("/v1/admin/features/signups.paused", { value: true }).expect(200);
    try {
      const res = await client("fs-brand-new", "fs-brand-new@example.test").get("/v1/me");
      expect(res.status).toBe(403);
      expect(reason(res.body)).toBe("signups_paused");
      await existing.as().get("/v1/me").expect(200);
    } finally {
      await admin.as().put("/v1/admin/features/signups.paused", { value: false }).expect(200);
    }
    await client("fs-brand-new", "fs-brand-new@example.test").get("/v1/me").expect(200);
  });

  it("the pilot allowlist admits only listed, verified emails to new accounts", async () => {
    const admin = await person("fs-pilot", ["super_admin"]);
    const existing = await person("fs-pilot-existing");
    const bad = await admin
      .as()
      .put("/v1/admin/features/signups.pilot_allowlist", { value: "pilot.test" })
      .expect(400);
    expect(JSON.stringify(bad.body)).toContain("email address");
    const saved = (
      await admin
        .as()
        .put("/v1/admin/features/signups.pilot_allowlist", {
          value: "@pilot.test\nJane@Invited.test",
        })
        .expect(200)
    ).body as FeatureSettingDto;
    expect(saved.editor).toMatchObject({ maxLength: 4_000 });
    try {
      const refused = await client("fs-outsider", "outsider@elsewhere.test").get("/v1/me");
      expect(refused.status).toBe(403);
      expect(reason(refused.body)).toBe("pilot_invite_only");
      // An unverified claim to a listed address doesn't get in either.
      const unverified = await request(t.server)
        .get("/v1/me")
        .set(
          "Authorization",
          `Bearer ${t.auth.issue("fs-unverified", { email: "x@pilot.test", emailVerified: false })}`,
        );
      expect(reason(unverified.body)).toBe("pilot_invite_only");
      await client("fs-domain", "driver@pilot.test").get("/v1/me").expect(200);
      await client("fs-jane", "jane@invited.test").get("/v1/me").expect(200);
      // People who already have an account keep signing in.
      await existing.as().get("/v1/me").expect(200);
    } finally {
      await admin
        .as()
        .put("/v1/admin/features/signups.pilot_allowlist", { value: null })
        .expect(200);
    }
    await client("fs-outsider", "outsider@elsewhere.test").get("/v1/me").expect(200);
    expect(await auditActions("signups.pilot_allowlist")).toEqual([
      "feature.setting_changed",
      "feature.setting_changed",
    ]);
  });

  it("the auto-hide threshold changes how many reports take content down", async () => {
    const admin = await person("fs-hide", ["super_admin"]);
    const author = await person("fs-author");
    const [article] = await t.db.db
      .insert(articles)
      .values({
        authorUserId: author.id,
        slug: "fs-hide-article",
        status: "published",
        title: "Tyre pressure before long trips",
        body: { type: "doc", content: [] },
        bodyText: "Check pressures cold.",
        category: "maintenance",
        publishedAt: new Date(),
      })
      .returning();
    if (!article) throw new Error("no article");
    await admin
      .as()
      .put("/v1/admin/features/community.auto_hide_reporters", { value: 2 })
      .expect(200);
    try {
      for (const uid of ["fs-rep-1", "fs-rep-2"]) {
        const reporter = await person(uid);
        await reporter
          .as()
          .post("/v1/reports", { targetType: "article", targetId: article.id, reason: "spam" })
          .expect(201);
      }
      const [after] = await t.db.db.select().from(articles).where(eq(articles.id, article.id));
      expect(after?.status).toBe("pending_moderation");
    } finally {
      await admin
        .as()
        .put("/v1/admin/features/community.auto_hide_reporters", { value: 3 })
        .expect(200);
    }
  });
});

describe("service categories", () => {
  it("closing a category stops new offerings there; order and descriptions are public", async () => {
    const admin = await person("tx-admin", ["super_admin"]);
    const owner = await person("tx-owner");
    const org = (
      await owner.as().post("/v1/orgs", { kind: "provider", name: "Taxonomy Tow Ltd" }).expect(201)
    ).body as MyOrganization;
    const base = `/v1/orgs/${org.organization.id}/provider-profile`;
    await owner
      .as()
      .post(`/v1/orgs/${org.organization.id}/branches`, { name: "Depot" })
      .expect(201);
    const offering = (category: string) => ({
      category,
      name: "Tow within 50 km",
      vehicleTypes: ["car"],
      price: { type: "quote_required" },
    });

    await admin
      .as()
      .put("/v1/admin/taxonomy/towing", {
        acceptingNewOfferings: false,
        sortOrder: 0,
        description: "Recovery and towing for cars and trucks.",
      })
      .expect(200);
    try {
      const closed = await owner.as().post(`${base}/offerings`, offering("towing")).expect(409);
      expect(reason(closed.body)).toBe("category_closed");
      await owner.as().post(`${base}/offerings`, offering("workshop")).expect(201);

      const publicList = (await request(t.server).get("/v1/taxonomy").expect(200))
        .body as ServiceCategoryDto[];
      expect(publicList[0]).toMatchObject({
        category: "towing",
        acceptingNewOfferings: false,
        description: "Recovery and towing for cars and trucks.",
      });
      expect(publicList).toHaveLength(7);
      await admin.as().put("/v1/admin/taxonomy/flying_cars", { sortOrder: 1 }).expect(404);
      await admin.as().put("/v1/admin/taxonomy/towing", {}).expect(400);
    } finally {
      await admin
        .as()
        .put("/v1/admin/taxonomy/towing", { acceptingNewOfferings: true, sortOrder: 20 })
        .expect(200);
    }
    expect(await auditActions("towing")).toContain("taxonomy.category_updated");
  });
});

describe("audit search", () => {
  it("limits each role to its own area; super admins see everything; searches are audited", async () => {
    const admin = await person("au-admin", ["super_admin"]);
    const operator = await person("au-operator", ["billing_operator"]);
    // One event in each area.
    await admin.as().put("/v1/admin/features/site.notice", { value: "Audit test" }).expect(200);
    await operator
      .as()
      .post(
        `/v1/admin/billing/assignments/0190d000-0000-7000-8000-0000000000aa/end`,
        {},
        "plan.end_assignment",
      )
      .expect(404);

    const operatorView = (await operator.as().get("/v1/admin/audit?limit=100").expect(200))
      .body as AuditPage;
    expect(operatorView.scope).toEqual(["entitlement.", "plan."]);
    expect(
      operatorView.items.every(
        (e) => e.action.startsWith("plan.") || e.action.startsWith("entitlement."),
      ),
    ).toBe(true);
    const outside = (await operator.as().get("/v1/admin/audit?action=feature.").expect(200))
      .body as AuditPage;
    expect(outside.items).toEqual([]);

    const adminView = (
      await admin
        .as()
        .get(`/v1/admin/audit?action=feature.setting_changed&actorEmail=${admin.email}`)
        .expect(200)
    ).body as AuditPage;
    expect(adminView.scope).toBe("all");
    expect(adminView.items[0]).toMatchObject({
      action: "feature.setting_changed",
      targetId: "site.notice",
      actor: { id: admin.id, email: admin.email },
    });

    const searches = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.action, "admin.audit_searched"));
    expect(searches.some((s) => s.actorId === operator.id)).toBe(true);
    await admin.as().put("/v1/admin/features/site.notice", { value: null }).expect(200);
  });

  it("pages newest first with a cursor and rejects a forged cursor", async () => {
    const admin = await person("au-pages", ["super_admin"]);
    const first = (await admin.as().get("/v1/admin/audit?limit=2").expect(200)).body as AuditPage;
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();
    const second = (
      await admin
        .as()
        .get(`/v1/admin/audit?limit=2&cursor=${first.nextCursor ?? ""}`)
        .expect(200)
    ).body as AuditPage;
    const [a, b] = first.items;
    const [c] = second.items;
    expect(new Date(b?.occurredAt ?? 0) >= new Date(c?.occurredAt ?? 0)).toBe(true);
    expect([a?.id, b?.id]).not.toContain(c?.id);
    await admin.as().get("/v1/admin/audit?cursor=bm90LWEtY3Vyc29y").expect(400);
  });
});

describe("support", () => {
  it("looks up metadata only, acts only through an open case, and never reveals the sign-in link", async () => {
    const agent = await person("sp-agent", ["support_agent"]);
    const member = await person("sp-member");

    const account = (
      await agent.as().get(`/v1/admin/support/accounts?email=${member.email}`).expect(200)
    ).body as SupportAccountDto;
    expect(account).toMatchObject({
      userId: member.id,
      email: member.email,
      status: "active",
      openCases: 0,
    });
    expect(Object.keys(account).sort()).toEqual(
      [
        "activeSanctions",
        "createdAt",
        "displayName",
        "email",
        "emailVerified",
        "lastSeenAt",
        "lastSignInProvider",
        "openCases",
        "organizations",
        "status",
        "userId",
      ].sort(),
    );
    expect(await auditActions(member.id)).toContain("support.account_viewed");

    const opened = (
      await agent
        .as()
        .post("/v1/admin/support/cases", {
          userId: member.id,
          reason: "Lost phone, wants other devices signed out",
        })
        .expect(201)
    ).body as SupportCaseDto;

    const unconfirmed = await agent
      .as()
      .post(`/v1/admin/support/cases/${opened.id}/revoke-sessions`);
    expect(unconfirmed.status).toBe(428);
    await agent
      .as()
      .post(`/v1/admin/support/cases/${opened.id}/revoke-sessions`, {}, "support.revoke_sessions")
      .expect(200);
    expect(t.auth.revokeCalls).toContain(member.uid);

    const sent = email.sent.length;
    const afterLink = (
      await agent.as().post(`/v1/admin/support/cases/${opened.id}/send-sign-in-link`).expect(200)
    ).body as SupportCaseDto;
    expect(JSON.stringify(afterLink)).not.toMatch(/oobCode/);
    const mails = email.sent.slice(sent);
    expect(mails.map((m) => m.to)).toEqual([member.email]);
    expect(mails[0]?.text).toMatch(/oobCode=fake-/);
    expect(afterLink.actions.map((a) => a.action)).toEqual([
      "support.case_opened",
      "support.sessions_revoked",
      "support.sign_in_link_sent",
    ]);

    await agent
      .as()
      .post(`/v1/admin/support/cases/${opened.id}/close`, {
        resolution: "Signed out everywhere; link sent.",
      })
      .expect(200);
    const closed = await agent.as().post(`/v1/admin/support/cases/${opened.id}/send-sign-in-link`);
    expect(closed.status).toBe(409);
    expect(reason(closed.body)).toBe("case_closed");
    await agent
      .as()
      .post(`/v1/admin/support/cases/${opened.id}/close`, { resolution: "Again" })
      .expect(409);
  });

  it("requires a reason and a real account to open a case", async () => {
    const agent = await person("sp-agent-2", ["support_agent"]);
    await agent
      .as()
      .post("/v1/admin/support/cases", {
        userId: "0190d000-0000-7000-8000-0000000000bb",
        reason: "Help please",
      })
      .expect(404);
    const member = await person("sp-member-2");
    await agent
      .as()
      .post("/v1/admin/support/cases", { userId: member.id, reason: "x" })
      .expect(400);
    await agent
      .as()
      .get("/v1/admin/support/accounts?email=a@example.test&userId=" + member.id)
      .expect(400);
  });
});

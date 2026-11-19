import { expectTenantIsolation } from "@fleettrust/db/testing";
import { auditEvents, eq, invitations, memberships, organizations } from "@fleettrust/db";
import {
  type BranchDto,
  createdInvitationSchema,
  type MemberDto,
  myOrganizationSchema,
  type MyOrganization,
  ROLES,
  ROLES_BY_KIND,
} from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createTestApp, type TestApp } from "./support/test-app.js";

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp();
});

afterAll(async () => {
  await t.close();
});

function defined<T>(value: T | undefined): T {
  if (value === undefined) throw new Error("expected a value");
  return value;
}

const reason = (body: unknown) => (body as { reason?: string }).reason;

/** A signed-in person: fresh tokens per call, like a real client. */
function person(uid: string, options: { emailVerified?: boolean } = {}) {
  const email = `${uid}@example.test`;
  const auth = () => ({
    Authorization: `Bearer ${t.auth.issue(uid, { email, emailVerified: options.emailVerified ?? true })}`,
  });
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

async function createOrg(
  owner: Person,
  kind: "provider" | "fleet",
  name = `${owner.uid} ${kind}`,
): Promise<MyOrganization> {
  const response = await owner.post("/v1/orgs", { kind, name }).expect(201);
  return myOrganizationSchema.parse(response.body);
}

function invite(
  inviter: Person,
  orgId: string,
  body: { email: string; role: string; branchId?: string | null },
) {
  return inviter.post(`/v1/orgs/${orgId}/invitations`, body);
}

/** Invites `member` with `role` and accepts as them. */
async function join(
  inviter: Person,
  orgId: string,
  member: Person,
  role: string,
  branchId: string | null = null,
): Promise<MyOrganization> {
  const created = await invite(inviter, orgId, { email: member.email, role, branchId }).expect(201);
  const { token } = createdInvitationSchema.parse(created.body);
  const accepted = await member.post("/v1/invitations/accept", { token }).expect(200);
  return myOrganizationSchema.parse(accepted.body);
}

describe("organizations", () => {
  it("creating an organization makes the caller its owner, and audits it", async () => {
    const owner = person("org-creator");
    const org = await createOrg(owner, "provider", "Rapid Repairs");
    expect(org).toMatchObject({
      organization: { kind: "provider", name: "Rapid Repairs", status: "active" },
      role: "owner",
      branchId: null,
    });
    expect(org.permissions).toContain("owners.manage");

    const list = await owner.get("/v1/orgs").expect(200);
    expect((list.body as MyOrganization[]).map((o) => o.organization.id)).toEqual([
      org.organization.id,
    ]);

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.organizationId, org.organization.id));
    expect(audit.map((event) => event.action)).toEqual(["org.created"]);
  });

  it("validates input", async () => {
    const owner = person("org-validate");
    const bad = await owner.post("/v1/orgs", { kind: "broker", name: "X" }).expect(400);
    expect((bad.body as { error: string }).error).toBe("validation_failed");
    await owner.post("/v1/orgs", { kind: "fleet", name: "Ok name", extra: 1 }).expect(400);
  });

  it("owners and admins can rename; others can't", async () => {
    const owner = person("rename-owner");
    const driver = person("rename-driver");
    const org = await createOrg(owner, "fleet");
    const id = org.organization.id;
    await join(owner, id, driver, "driver");

    const renamed = await owner.patch(`/v1/orgs/${id}`, { name: "Renamed Fleet" }).expect(200);
    expect((renamed.body as MyOrganization).organization.name).toBe("Renamed Fleet");
    const denied = await driver.patch(`/v1/orgs/${id}`, { name: "Hijacked" }).expect(403);
    expect(reason(denied.body)).toBe("insufficient_permission");
    await driver.get(`/v1/orgs/${id}`).expect(200);
  });

  it("a suspended organization refuses its members", async () => {
    const owner = person("suspended-owner");
    const org = await createOrg(owner, "fleet");
    await t.db.db
      .update(organizations)
      .set({ status: "suspended" })
      .where(eq(organizations.id, org.organization.id));
    const response = await owner.get(`/v1/orgs/${org.organization.id}`).expect(403);
    expect(reason(response.body)).toBe("organization_suspended");
  });
});

describe("cross-tenant access is forbidden", () => {
  let alice: Person;
  let bob: Person;
  let orgA: string;
  let orgB: string;
  let branchA: BranchDto;
  let invitationA: string;
  let membershipA: string;

  beforeAll(async () => {
    alice = person("tenant-alice");
    bob = person("tenant-bob");
    orgA = (await createOrg(alice, "provider", "Alice Garage")).organization.id;
    orgB = (await createOrg(bob, "provider", "Bob Garage")).organization.id;
    branchA = (await alice.post(`/v1/orgs/${orgA}/branches`, { name: "North" }).expect(201))
      .body as BranchDto;
    const created = await invite(alice, orgA, {
      email: "someone@example.test",
      role: "staff",
    }).expect(201);
    invitationA = createdInvitationSchema.parse(created.body).invitation.id;
    membershipA = defined(
      ((await alice.get(`/v1/orgs/${orgA}/members`).expect(200)).body as MemberDto[])[0],
    ).membershipId;
  });

  it("every route under another organization answers 404, never 403", async () => {
    const attempts = [
      bob.get(`/v1/orgs/${orgA}`),
      bob.patch(`/v1/orgs/${orgA}`, { name: "Taken over" }),
      bob.get(`/v1/orgs/${orgA}/branches`),
      bob.post(`/v1/orgs/${orgA}/branches`, { name: "Sneaky" }),
      bob.patch(`/v1/orgs/${orgA}/branches/${branchA.id}`, { name: "Sneaky" }),
      bob.del(`/v1/orgs/${orgA}/branches/${branchA.id}`),
      bob.get(`/v1/orgs/${orgA}/members`),
      bob.patch(`/v1/orgs/${orgA}/members/${membershipA}`, { role: "staff" }),
      bob.del(`/v1/orgs/${orgA}/members/${membershipA}`),
      bob.get(`/v1/orgs/${orgA}/invitations`),
      bob.post(`/v1/orgs/${orgA}/invitations`, { email: "x@example.test", role: "staff" }),
      bob.del(`/v1/orgs/${orgA}/invitations/${invitationA}`),
    ];
    const statuses = (await Promise.all(attempts)).map((response) => response.status);
    expect(statuses).toEqual(attempts.map(() => 404));
  });

  it("A's resources can't be reached through B's organization either", async () => {
    // Bob is an owner of B, so the guard passes; the resource lookups must still be tenant-scoped.
    await bob.patch(`/v1/orgs/${orgB}/branches/${branchA.id}`, { name: "Sneaky" }).expect(404);
    await bob.del(`/v1/orgs/${orgB}/branches/${branchA.id}`).expect(404);
    await bob.patch(`/v1/orgs/${orgB}/members/${membershipA}`, { role: "staff" }).expect(404);
    await bob.del(`/v1/orgs/${orgB}/members/${membershipA}`).expect(404);
    await bob.del(`/v1/orgs/${orgB}/invitations/${invitationA}`).expect(404);
    const scoped = await invite(bob, orgB, {
      email: "y@example.test",
      role: "staff",
      branchId: branchA.id,
    }).expect(400);
    expect(reason(scoped.body)).toBe("branch_not_found");

    // Nothing of A's changed.
    const branches = (await alice.get(`/v1/orgs/${orgA}/branches`).expect(200)).body as BranchDto[];
    expect(branches.map((b) => b.name)).toEqual(["North"]);
    const members = (await alice.get(`/v1/orgs/${orgA}/members`).expect(200)).body as MemberDto[];
    expect(members.map((m) => m.role)).toEqual(["owner"]);
    const open = await alice.get(`/v1/orgs/${orgA}/invitations`).expect(200);
    expect(open.body).toHaveLength(1);
  });

  it("malformed and unknown organization IDs are 404", async () => {
    await alice.get("/v1/orgs/not-a-uuid").expect(404);
    await alice.get("/v1/orgs/0190f4a6-1c2b-7d3e-8f40-123456789abc").expect(404);
    await alice.patch(`/v1/orgs/${orgA}/branches/not-a-uuid`, { name: "Valid" }).expect(404);
  });

  it("branches pass the shared tenant-isolation harness over HTTP", async () => {
    const ownerOf = new Map([
      [orgA, alice],
      [orgB, bob],
    ]);
    const as = (tenant: { organizationId: string }) => defined(ownerOf.get(tenant.organizationId));
    let n = 0;
    const violations = await expectTenantIsolation<BranchDto>(
      {
        resource: "branches (HTTP)",
        create: async (tenant) =>
          (
            await as(tenant)
              .post(`/v1/orgs/${tenant.organizationId}/branches`, { name: `Iso ${String(++n)}` })
              .expect(201)
          ).body as BranchDto,
        list: async (tenant) =>
          (await as(tenant).get(`/v1/orgs/${tenant.organizationId}/branches`).expect(200))
            .body as BranchDto[],
        getById: async (tenant, id) =>
          (
            (await as(tenant).get(`/v1/orgs/${tenant.organizationId}/branches`).expect(200))
              .body as BranchDto[]
          ).find((b) => b.id === id),
        update: async (tenant, id) =>
          (
            await as(tenant).patch(`/v1/orgs/${tenant.organizationId}/branches/${id}`, {
              name: `Moved ${String(++n)}`,
            })
          ).status === 200
            ? 1
            : 0,
        remove: async (tenant, id) =>
          (await as(tenant).del(`/v1/orgs/${tenant.organizationId}/branches/${id}`)).status === 204
            ? 1
            : 0,
      },
      [orgA, orgB],
    );
    expect(violations).toEqual([]);
  });
});

describe("invitations", () => {
  let owner: Person;
  let orgId: string;

  beforeAll(async () => {
    owner = person("inv-owner");
    orgId = (await createOrg(owner, "fleet", "Invite Fleet")).organization.id;
  });

  it("returns a one-time token once, stores only its hash, and accepts with the matching verified email", async () => {
    const driver = person("inv-driver");
    const created = await invite(owner, orgId, { email: driver.email, role: "driver" }).expect(201);
    const body = createdInvitationSchema.parse(created.body);
    expect(body.token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(body.acceptPath).toBe(`/invitations/accept#token=${body.token}`);

    const [row] = await t.db.db
      .select()
      .from(invitations)
      .where(eq(invitations.id, body.invitation.id));
    expect(row?.tokenHash).not.toContain(body.token);
    expect(row?.tokenHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify((await owner.get(`/v1/orgs/${orgId}/invitations`)).body)).not.toContain(
      body.token,
    );

    const accepted = await driver.post("/v1/invitations/accept", { token: body.token }).expect(200);
    expect(myOrganizationSchema.parse(accepted.body)).toMatchObject({
      role: "driver",
      organization: { id: orgId },
    });

    const reused = await driver.post("/v1/invitations/accept", { token: body.token }).expect(410);
    expect(reason(reused.body)).toBe("invitation_used");

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, body.invitation.id));
    expect(audit.map((event) => event.action).sort()).toEqual([
      "invitation.accepted",
      "invitation.created",
    ]);
    expect(JSON.stringify(audit)).not.toContain(body.token);
  });

  it("expired invitations can't be accepted", async () => {
    const late = person("inv-late");
    const created = await invite(owner, orgId, { email: late.email, role: "driver" }).expect(201);
    const { token, invitation } = createdInvitationSchema.parse(created.body);
    await t.db.db
      .update(invitations)
      .set({ expiresAt: new Date(Date.now() - 1000) })
      .where(eq(invitations.id, invitation.id));
    const response = await late.post("/v1/invitations/accept", { token }).expect(410);
    expect(reason(response.body)).toBe("invitation_expired");
    expect(await membershipsOf(late)).toHaveLength(0);
  });

  it("revoked invitations can't be accepted, and revoking twice is 404", async () => {
    const revokedPerson = person("inv-revoked");
    const created = await invite(owner, orgId, {
      email: revokedPerson.email,
      role: "driver",
    }).expect(201);
    const { token, invitation } = createdInvitationSchema.parse(created.body);
    await owner.del(`/v1/orgs/${orgId}/invitations/${invitation.id}`).expect(204);
    await owner.del(`/v1/orgs/${orgId}/invitations/${invitation.id}`).expect(404);
    const response = await revokedPerson.post("/v1/invitations/accept", { token }).expect(410);
    expect(reason(response.body)).toBe("invitation_revoked");
  });

  it("re-inviting supersedes the previous invitation", async () => {
    const again = person("inv-again");
    const first = createdInvitationSchema.parse(
      (await invite(owner, orgId, { email: again.email, role: "driver" }).expect(201)).body,
    );
    const second = createdInvitationSchema.parse(
      (await invite(owner, orgId, { email: again.email, role: "manager" }).expect(201)).body,
    );
    const stale = await again.post("/v1/invitations/accept", { token: first.token }).expect(410);
    expect(reason(stale.body)).toBe("invitation_revoked");
    const accepted = await again
      .post("/v1/invitations/accept", { token: second.token })
      .expect(200);
    expect((accepted.body as MyOrganization).role).toBe("manager");
  });

  it("only the invited, verified email can accept", async () => {
    const intended = person("inv-intended");
    const other = person("inv-other");
    const unverified = person("inv-intended", { emailVerified: false });
    const { token } = createdInvitationSchema.parse(
      (await invite(owner, orgId, { email: intended.email, role: "driver" }).expect(201)).body,
    );
    expect(reason((await other.post("/v1/invitations/accept", { token })).body)).toBe(
      "invitation_email_mismatch",
    );
    const response = await unverified.post("/v1/invitations/accept", { token }).expect(403);
    expect(reason(response.body)).toBe("email_not_verified");
    await intended.post("/v1/invitations/accept", { token }).expect(200);
  });

  it("unknown and malformed tokens", async () => {
    const someone = person("inv-guess");
    const unknown = await someone
      .post("/v1/invitations/accept", { token: "A".repeat(43) })
      .expect(404);
    expect(reason(unknown.body)).toBe("invitation_not_found");
    await someone.post("/v1/invitations/accept", { token: "short" }).expect(400);
  });

  it("refuses roles the organization kind can't grant, and existing members", async () => {
    const bad = await invite(owner, orgId, { email: "staff@example.test", role: "staff" }).expect(
      400,
    );
    expect(reason(bad.body)).toBe("role_not_allowed");
    const member = await invite(owner, orgId, {
      email: "inv-driver@example.test",
      role: "driver",
    }).expect(409);
    expect(reason(member.body)).toBe("already_member");
  });
});

async function membershipsOf(p: Person) {
  const response = await p.get("/v1/orgs").expect(200);
  return response.body as MyOrganization[];
}

describe("roles", () => {
  it("only owners can grant, change or remove the owner role", async () => {
    const owner = person("role-owner");
    const admin = person("role-admin");
    const orgId = (await createOrg(owner, "provider")).organization.id;
    const adminMembership = await join(owner, orgId, admin, "admin");

    const ownerInvite = await invite(admin, orgId, {
      email: "new-owner@example.test",
      role: "owner",
    }).expect(403);
    expect(reason(ownerInvite.body)).toBe("owner_role_required");

    const members = (await admin.get(`/v1/orgs/${orgId}/members`).expect(200)).body as MemberDto[];
    const ownerMembership = defined(members.find((m) => m.role === "owner")).membershipId;
    const demote = await admin
      .patch(`/v1/orgs/${orgId}/members/${ownerMembership}`, { role: "staff" })
      .expect(403);
    expect(reason(demote.body)).toBe("owner_role_required");
    const remove = await admin.del(`/v1/orgs/${orgId}/members/${ownerMembership}`).expect(403);
    expect(reason(remove.body)).toBe("owner_role_required");
    const promoteSelf = await admin
      .patch(`/v1/orgs/${orgId}/members/${adminMembership.membershipId}`, { role: "owner" })
      .expect(403);
    expect(reason(promoteSelf.body)).toBe("owner_role_required");

    // The owner can promote the admin; then there are two owners and one may step down.
    await owner
      .patch(`/v1/orgs/${orgId}/members/${adminMembership.membershipId}`, { role: "owner" })
      .expect(200);
    await owner
      .patch(`/v1/orgs/${orgId}/members/${ownerMembership}`, { role: "admin" })
      .expect(200);
  });

  it("the last owner can't be demoted or leave", async () => {
    const owner = person("last-owner");
    const orgId = (await createOrg(owner, "fleet")).organization.id;
    const [me] = (await owner.get(`/v1/orgs/${orgId}/members`).expect(200)).body as MemberDto[];
    const demote = await owner
      .patch(`/v1/orgs/${orgId}/members/${defined(me).membershipId}`, { role: "admin" })
      .expect(409);
    expect(reason(demote.body)).toBe("last_owner");
    const leave = await owner
      .del(`/v1/orgs/${orgId}/members/${defined(me).membershipId}`)
      .expect(409);
    expect(reason(leave.body)).toBe("last_owner");
  });

  it("concurrent owner demotions leave at least one owner", async () => {
    const a = person("race-owner-a");
    const b = person("race-owner-b");
    const orgId = (await createOrg(a, "fleet")).organization.id;
    const bMembership = await join(a, orgId, b, "owner");
    const members = (await a.get(`/v1/orgs/${orgId}/members`).expect(200)).body as MemberDto[];
    const aMembership = defined(
      members.find((m) => m.membershipId !== bMembership.membershipId),
    ).membershipId;

    const results = await Promise.all([
      a.patch(`/v1/orgs/${orgId}/members/${bMembership.membershipId}`, { role: "admin" }),
      b.patch(`/v1/orgs/${orgId}/members/${aMembership}`, { role: "admin" }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    const owners = await t.db.db
      .select()
      .from(memberships)
      .where(eq(memberships.organizationId, orgId));
    expect(owners.filter((m) => m.role === "owner").length).toBeGreaterThanOrEqual(1);
  });

  it("any member can leave; non-managers can't remove others", async () => {
    const owner = person("leave-owner");
    const driver = person("leave-driver");
    const driver2 = person("leave-driver2");
    const orgId = (await createOrg(owner, "fleet")).organization.id;
    const d1 = await join(owner, orgId, driver, "driver");
    const d2 = await join(owner, orgId, driver2, "driver");

    const denied = await driver.del(`/v1/orgs/${orgId}/members/${d2.membershipId}`).expect(403);
    expect(reason(denied.body)).toBe("insufficient_permission");
    await driver.del(`/v1/orgs/${orgId}/members/${d1.membershipId}`).expect(204);
    await driver.get(`/v1/orgs/${orgId}`).expect(404);

    const audit = await t.db.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.targetId, d1.membershipId));
    expect(audit.map((event) => event.action)).toEqual(["member.left"]);
  });

  it("drivers can't read the member list", async () => {
    const owner = person("perm-owner");
    const driver = person("perm-driver");
    const orgId = (await createOrg(owner, "fleet")).organization.id;
    await join(owner, orgId, driver, "driver");
    const response = await driver.get(`/v1/orgs/${orgId}/members`).expect(403);
    expect(reason(response.body)).toBe("insufficient_permission");
    await driver.get(`/v1/orgs/${orgId}/invitations`).expect(403);
  });

  it("the database agrees with ROLES_BY_KIND", async () => {
    const owner = person("roles-db");
    const provider = (await createOrg(owner, "provider")).organization.id;
    const fleet = (await createOrg(owner, "fleet")).organization.id;
    const [creator] = await t.db.db
      .select({ createdBy: organizations.createdBy })
      .from(organizations)
      .where(eq(organizations.id, provider));
    for (const [kind, orgId] of [
      ["provider", provider],
      ["fleet", fleet],
    ] as const) {
      for (const role of ROLES) {
        const allowed = ROLES_BY_KIND[kind].includes(role);
        const attempt = t.db.client.query(
          `INSERT INTO invitations (organization_id, organization_kind, email, role, token_hash, invited_by, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, now() + interval '1 day')`,
          [
            orgId,
            kind,
            `${kind}-${role}@example.test`,
            role,
            `h-${kind}-${role}`,
            creator?.createdBy,
          ],
        );
        if (allowed) await expect(attempt).resolves.toBeDefined();
        else await expect(attempt).rejects.toThrow(/invitations_role_valid_for_kind/);
      }
    }
  });
});

describe("branches", () => {
  it("branch-scoped members see only their branch and its people", async () => {
    const owner = person("scope-owner");
    const northManager = person("scope-north-manager");
    const northStaff = person("scope-north-staff");
    const southStaff = person("scope-south-staff");
    const orgId = (await createOrg(owner, "provider")).organization.id;
    const north = (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "North" }).expect(201))
      .body as BranchDto;
    const south = (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "South" }).expect(201))
      .body as BranchDto;
    await join(owner, orgId, northManager, "manager", north.id);
    await join(owner, orgId, northStaff, "staff", north.id);
    await join(owner, orgId, southStaff, "staff", south.id);

    const visible = (await northStaff.get(`/v1/orgs/${orgId}/branches`).expect(200))
      .body as BranchDto[];
    expect(visible.map((b) => b.name)).toEqual(["North"]);
    const ownerView = (await owner.get(`/v1/orgs/${orgId}/branches`).expect(200))
      .body as BranchDto[];
    expect(ownerView.map((b) => b.name)).toEqual(["North", "South"]);

    const team = (await northManager.get(`/v1/orgs/${orgId}/members`).expect(200))
      .body as MemberDto[];
    expect(team.map((m) => m.email).sort()).toEqual([northManager.email, northStaff.email].sort());
  });

  it("names are unique per organization; branches in use can't be deleted", async () => {
    const owner = person("branch-owner");
    const staff = person("branch-staff");
    const orgId = (await createOrg(owner, "provider")).organization.id;
    const branch = (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Depot" }).expect(201))
      .body as BranchDto;
    const dup = await owner.post(`/v1/orgs/${orgId}/branches`, { name: "DEPOT" }).expect(409);
    expect(reason(dup.body)).toBe("branch_name_taken");

    const member = await join(owner, orgId, staff, "staff", branch.id);
    const inUse = await owner.del(`/v1/orgs/${orgId}/branches/${branch.id}`).expect(409);
    expect(reason(inUse.body)).toBe("branch_in_use");

    // Widening the member's scope frees the branch (accepted invitations don't hold it).
    await owner
      .patch(`/v1/orgs/${orgId}/members/${member.membershipId}`, { branchId: null })
      .expect(200);
    await owner.del(`/v1/orgs/${orgId}/branches/${branch.id}`).expect(204);
  });

  it("changing to a role that can't be branch-scoped drops the scope", async () => {
    const owner = person("rescope-owner");
    const staff = person("rescope-staff");
    const orgId = (await createOrg(owner, "provider")).organization.id;
    const branch = (await owner.post(`/v1/orgs/${orgId}/branches`, { name: "Yard" }).expect(201))
      .body as BranchDto;
    const member = await join(owner, orgId, staff, "staff", branch.id);
    const promoted = await owner
      .patch(`/v1/orgs/${orgId}/members/${member.membershipId}`, { role: "admin" })
      .expect(200);
    expect(promoted.body).toMatchObject({ role: "admin", branchId: null });
    const bad = await owner
      .patch(`/v1/orgs/${orgId}/members/${member.membershipId}`, { branchId: branch.id })
      .expect(400);
    expect(reason(bad.body)).toBe("role_not_allowed");
  });
});

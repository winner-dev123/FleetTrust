import { and, eq } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { branches, invitations, memberships, organizations, users } from "../src/schema/index.js";
import { tenantFilter } from "../src/tenancy.js";
import {
  createTestDatabase,
  expectTenantIsolation,
  type TestDatabase,
} from "../src/testing/index.js";

let t: TestDatabase;
let userId: string;

beforeAll(async () => {
  t = await createTestDatabase();
  const [user] = await t.db.insert(users).values({ firebaseUid: "uid-org-owner" }).returning();
  userId = user?.id ?? "";
});

afterAll(async () => {
  await t.close();
});

async function dbError(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    const cause = (error as { cause?: unknown }).cause;
    return cause instanceof Error ? cause.message : (error as Error).message;
  }
  throw new Error("expected the database to reject the statement");
}

async function createOrg(kind: "provider" | "fleet", name = `Org ${kind}`) {
  const [org] = await t.db
    .insert(organizations)
    .values({ kind, name, createdBy: userId })
    .returning();
  if (!org) throw new Error("no org");
  return org;
}

async function createUser(uid: string) {
  const [user] = await t.db.insert(users).values({ firebaseUid: uid }).returning();
  if (!user) throw new Error("no user");
  return user;
}

const inAWeek = () => new Date(Date.now() + 7 * 24 * 3600 * 1000);

describe("organizations", () => {
  it("only allows known kinds, statuses and sensible names", async () => {
    expect(
      await dbError(
        t.client.query(
          "INSERT INTO organizations (kind, name, created_by) VALUES ('broker', 'Bad kind', $1)",
          [userId],
        ),
      ),
    ).toMatch(/organizations_kind_valid/);
    expect(await dbError(createOrg("fleet", "x"))).toMatch(/organizations_name_length/);
  });
});

describe("memberships", () => {
  it("rejects roles the organization kind can't grant", async () => {
    const provider = await createOrg("provider");
    const fleet = await createOrg("fleet");
    const user = await createUser("uid-role-check");
    expect(
      await dbError(
        t.db.insert(memberships).values({
          organizationId: provider.id,
          organizationKind: "provider",
          userId: user.id,
          role: "driver",
        }),
      ),
    ).toMatch(/memberships_role_valid_for_kind/);
    expect(
      await dbError(
        t.db.insert(memberships).values({
          organizationId: fleet.id,
          organizationKind: "fleet",
          userId: user.id,
          role: "staff",
        }),
      ),
    ).toMatch(/memberships_role_valid_for_kind/);
  });

  it("cannot lie about the organization's kind", async () => {
    const provider = await createOrg("provider");
    const user = await createUser("uid-kind-lie");
    // Claiming the provider is a fleet would let it grant "driver"; the composite FK refuses.
    expect(
      await dbError(
        t.db.insert(memberships).values({
          organizationId: provider.id,
          organizationKind: "fleet",
          userId: user.id,
          role: "driver",
        }),
      ),
    ).toMatch(/memberships_organization_fk/);
  });

  it("one membership per user per organization", async () => {
    const org = await createOrg("fleet");
    const user = await createUser("uid-dup-member");
    const row = { organizationId: org.id, organizationKind: "fleet" as const, userId: user.id };
    await t.db.insert(memberships).values({ ...row, role: "driver" });
    expect(await dbError(t.db.insert(memberships).values({ ...row, role: "admin" }))).toMatch(
      /memberships_org_user_key/,
    );
  });

  it("branch scope must be a branch of the same organization, and only for scopable roles", async () => {
    const orgA = await createOrg("provider", "Org A");
    const orgB = await createOrg("provider", "Org B");
    const [branchB] = await t.db
      .insert(branches)
      .values({ organizationId: orgB.id, name: "B north" })
      .returning();
    const [branchA] = await t.db
      .insert(branches)
      .values({ organizationId: orgA.id, name: "A north" })
      .returning();
    const user = await createUser("uid-branch-scope");
    const base = {
      organizationId: orgA.id,
      organizationKind: "provider" as const,
      userId: user.id,
    };

    expect(
      await dbError(
        t.db.insert(memberships).values({ ...base, role: "staff", branchId: branchB?.id }),
      ),
    ).toMatch(/memberships_branch_same_org_fk/);
    expect(
      await dbError(
        t.db.insert(memberships).values({ ...base, role: "admin", branchId: branchA?.id }),
      ),
    ).toMatch(/memberships_branch_scope_role/);
    await t.db.insert(memberships).values({ ...base, role: "staff", branchId: branchA?.id });
  });
});

describe("branches", () => {
  it("names are unique per organization, ignoring case", async () => {
    const orgA = await createOrg("provider");
    const orgB = await createOrg("provider");
    await t.db.insert(branches).values({ organizationId: orgA.id, name: "Downtown" });
    await t.db.insert(branches).values({ organizationId: orgB.id, name: "Downtown" });
    expect(
      await dbError(t.db.insert(branches).values({ organizationId: orgA.id, name: "DOWNTOWN" })),
    ).toMatch(/branches_org_name_key/);
  });

  it("are isolated between tenants", async () => {
    const orgA = await createOrg("provider");
    const orgB = await createOrg("provider");
    let n = 0;
    const violations = await expectTenantIsolation(
      {
        resource: "branches",
        create: async (tenant) => {
          const [row] = await t.db
            .insert(branches)
            .values({ organizationId: tenant.organizationId, name: `Branch ${String(++n)}` })
            .returning();
          if (!row) throw new Error("no branch");
          return row;
        },
        list: (tenant) => t.db.select().from(branches).where(tenantFilter(branches, tenant)),
        getById: async (tenant, id) =>
          (
            await t.db
              .select()
              .from(branches)
              .where(and(tenantFilter(branches, tenant), eq(branches.id, id)))
          )[0],
        update: async (tenant, id) =>
          (
            await t.db
              .update(branches)
              .set({ name: "Renamed" })
              .where(and(tenantFilter(branches, tenant), eq(branches.id, id)))
              .returning()
          ).length,
        remove: async (tenant, id) =>
          (
            await t.db
              .delete(branches)
              .where(and(tenantFilter(branches, tenant), eq(branches.id, id)))
              .returning()
          ).length,
      },
      [orgA.id, orgB.id],
    );
    expect(violations).toEqual([]);
  });
});

describe("invitations", () => {
  async function invite(orgId: string, email: string, tokenHash: string) {
    return t.db
      .insert(invitations)
      .values({
        organizationId: orgId,
        organizationKind: "fleet",
        email,
        role: "driver",
        tokenHash,
        invitedBy: userId,
        expiresAt: inAWeek(),
      })
      .returning();
  }

  it("allows one open invitation per email per organization", async () => {
    const org = await createOrg("fleet");
    const [first] = await invite(org.id, "driver@example.com", "hash-1");
    expect(await dbError(invite(org.id, "driver@example.com", "hash-2"))).toMatch(
      /invitations_open_per_email_key/,
    );
    // Revoking the first frees the slot for a new one.
    await t.db
      .update(invitations)
      .set({ revokedAt: new Date(), revokedBy: userId })
      .where(eq(invitations.id, first?.id ?? ""));
    await invite(org.id, "driver@example.com", "hash-2");
  });

  it("token hashes are unique, emails lower-case, and an invitation has one outcome", async () => {
    const org = await createOrg("fleet");
    await invite(org.id, "a@example.com", "hash-unique");
    expect(await dbError(invite(org.id, "b@example.com", "hash-unique"))).toMatch(
      /invitations_token_hash_key/,
    );
    expect(await dbError(invite(org.id, "Mixed@Example.com", "hash-mixed"))).toMatch(
      /invitations_email_lowercase/,
    );
    const [row] = await invite(org.id, "c@example.com", "hash-c");
    expect(
      await dbError(
        t.db
          .update(invitations)
          .set({
            acceptedAt: new Date(),
            acceptedBy: userId,
            revokedAt: new Date(),
            revokedBy: userId,
          })
          .where(eq(invitations.id, row?.id ?? "")),
      ),
    ).toMatch(/invitations_single_outcome/);
    expect(
      await dbError(
        t.db
          .update(invitations)
          .set({ acceptedAt: new Date() })
          .where(eq(invitations.id, row?.id ?? "")),
      ),
    ).toMatch(/invitations_accepted_consistent/);
  });
});

describe("tenant isolation (repository level)", () => {
  it("memberships", async () => {
    const orgA = await createOrg("fleet");
    const orgB = await createOrg("fleet");
    let n = 0;
    const violations = await expectTenantIsolation(
      {
        resource: "memberships",
        create: async (tenant) => {
          const user = await createUser(`uid-iso-member-${String(++n)}`);
          const [row] = await t.db
            .insert(memberships)
            .values({
              organizationId: tenant.organizationId,
              organizationKind: "fleet",
              userId: user.id,
              role: "driver",
            })
            .returning();
          if (!row) throw new Error("no membership");
          return row;
        },
        list: (tenant) => t.db.select().from(memberships).where(tenantFilter(memberships, tenant)),
        getById: async (tenant, id) =>
          (
            await t.db
              .select()
              .from(memberships)
              .where(and(tenantFilter(memberships, tenant), eq(memberships.id, id)))
          )[0],
        update: async (tenant, id) =>
          (
            await t.db
              .update(memberships)
              .set({ role: "manager" })
              .where(and(tenantFilter(memberships, tenant), eq(memberships.id, id)))
              .returning()
          ).length,
        remove: async (tenant, id) =>
          (
            await t.db
              .delete(memberships)
              .where(and(tenantFilter(memberships, tenant), eq(memberships.id, id)))
              .returning()
          ).length,
      },
      [orgA.id, orgB.id],
    );
    expect(violations).toEqual([]);
  });

  it("invitations", async () => {
    const orgA = await createOrg("fleet");
    const orgB = await createOrg("fleet");
    let n = 0;
    const violations = await expectTenantIsolation(
      {
        resource: "invitations",
        create: async (tenant) => {
          const [row] = await t.db
            .insert(invitations)
            .values({
              organizationId: tenant.organizationId,
              organizationKind: "fleet",
              email: `iso-${String(++n)}@example.com`,
              role: "driver",
              tokenHash: `iso-hash-${String(n)}`,
              invitedBy: userId,
              expiresAt: inAWeek(),
            })
            .returning();
          if (!row) throw new Error("no invitation");
          return row;
        },
        list: (tenant) => t.db.select().from(invitations).where(tenantFilter(invitations, tenant)),
        getById: async (tenant, id) =>
          (
            await t.db
              .select()
              .from(invitations)
              .where(and(tenantFilter(invitations, tenant), eq(invitations.id, id)))
          )[0],
        update: async (tenant, id) =>
          (
            await t.db
              .update(invitations)
              .set({ revokedAt: new Date(), revokedBy: userId })
              .where(and(tenantFilter(invitations, tenant), eq(invitations.id, id)))
              .returning()
          ).length,
      },
      [orgA.id, orgB.id],
    );
    expect(violations).toEqual([]);
  });
});

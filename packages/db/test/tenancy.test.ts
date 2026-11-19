import { and, eq } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  assertSameTenant,
  type TenantContext,
  tenantContext,
  tenantFilter,
  TenantMismatchError,
} from "../src/tenancy.js";
import {
  createTestDatabase,
  expectTenantIsolation,
  type TestDatabase,
} from "../src/testing/index.js";

/** Test-only org-scoped table standing in for real resources (vehicles, requests, …). */
const notes = pgTable("test_notes", {
  id: uuid("id").primaryKey().defaultRandom(),
  organizationId: uuid("organization_id").notNull(),
  body: text("body").notNull(),
});

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.client.exec(`
    CREATE TABLE test_notes (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id uuid NOT NULL,
      body text NOT NULL
    );
    CREATE INDEX test_notes_org_idx ON test_notes (organization_id);
  `);
});

afterAll(async () => {
  await t.close();
});

/** A correctly scoped repository: every query goes through tenantFilter(). */
const scopedRepo = {
  resource: "test_notes (scoped)",
  async create(tenant: TenantContext) {
    const [row] = await t.db
      .insert(notes)
      .values({ organizationId: tenant.organizationId, body: "x" })
      .returning();
    if (!row) throw new Error("insert failed");
    return row;
  },
  list: (tenant: TenantContext) => t.db.select().from(notes).where(tenantFilter(notes, tenant)),
  async getById(tenant: TenantContext, id: string) {
    const [row] = await t.db
      .select()
      .from(notes)
      .where(and(eq(notes.id, id), tenantFilter(notes, tenant)));
    return row;
  },
  async update(tenant: TenantContext, id: string) {
    const rows = await t.db
      .update(notes)
      .set({ body: "changed" })
      .where(and(eq(notes.id, id), tenantFilter(notes, tenant)))
      .returning();
    return rows.length;
  },
  async remove(tenant: TenantContext, id: string) {
    const rows = await t.db
      .delete(notes)
      .where(and(eq(notes.id, id), tenantFilter(notes, tenant)))
      .returning();
    return rows.length;
  },
};

describe("expectTenantIsolation", () => {
  it("passes for a repository that scopes every query", async () => {
    expect(await expectTenantIsolation(scopedRepo)).toEqual([]);
  });

  it("detects a repository that forgets the tenant filter (proves the harness catches leaks)", async () => {
    const leaky = {
      ...scopedRepo,
      resource: "test_notes (leaky)",
      list: () => t.db.select().from(notes),
      async getById(_tenant: TenantContext, id: string) {
        const [row] = await t.db.select().from(notes).where(eq(notes.id, id));
        return row;
      },
      async update(_tenant: TenantContext, id: string) {
        return (await t.db.update(notes).set({ body: "pwned" }).where(eq(notes.id, id)).returning())
          .length;
      },
    };
    const violations = await expectTenantIsolation(leaky);
    expect(violations).toEqual([
      "test_notes (leaky): tenant B can list tenant A's row",
      "test_notes (leaky): tenant B can read tenant A's row by ID",
      "test_notes (leaky): tenant B can update tenant A's row",
    ]);
  });
});

describe("tenancy helpers", () => {
  const a = tenantContext("00000000-0000-7000-8000-00000000000a");
  const b = tenantContext("00000000-0000-7000-8000-00000000000b");

  it("only accepts UUID organization ids", () => {
    expect(() => tenantContext("1 OR 1=1")).toThrow(TypeError);
    expect(() => tenantContext("")).toThrow(TypeError);
  });

  it("assertSameTenant passes own rows and blocks others without leaking ids", () => {
    const row = { id: "n1", organizationId: a.organizationId };
    expect(assertSameTenant(row, a)).toBe(row);
    const error = (() => {
      try {
        assertSameTenant(row, b);
        return null;
      } catch (caught) {
        return caught as Error;
      }
    })();
    expect(error).toBeInstanceOf(TenantMismatchError);
    expect(error?.message).not.toContain(a.organizationId);
    expect(error?.message).not.toContain(b.organizationId);
  });
});

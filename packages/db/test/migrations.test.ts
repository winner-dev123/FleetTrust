import { migrate } from "drizzle-orm/pglite/migrator";
import { drizzle } from "drizzle-orm/pglite";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { migrationsFolder } from "../src/database.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

let t: TestDatabase;

beforeAll(async () => {
  // Fresh, empty database: prove the full migration chain applies from zero.
  t = await createTestDatabase({ migrate: false });
  await migrate(drizzle(t.client), { migrationsFolder });
});

afterAll(async () => {
  await t.close();
});

const journal = JSON.parse(
  readFileSync(path.join(migrationsFolder, "meta", "_journal.json"), "utf8"),
) as { entries: { tag: string }[] };

describe("migrations on a fresh database", () => {
  it("applies every migration in the journal exactly once", async () => {
    const { rows } = await t.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(rows[0]?.count).toBe(journal.entries.length);
    expect(journal.entries.map((entry) => entry.tag)).toEqual([
      "0000_extensions_and_functions",
      "0001_foundation_tables",
      "0002_triggers",
      "0003_users",
      "0004_users_triggers",
      "0005_organizations",
      "0006_organizations_triggers",
      "0007_plans_and_entitlements",
      "0008_plans_triggers",
      "0009_verification",
      "0010_verification_triggers",
      "0011_provider_profiles",
      "0012_provider_profiles_triggers",
      "0013_catalog_and_hours",
      "0014_catalog_triggers",
    ]);
  });

  it("is a no-op when run again", async () => {
    await migrate(drizzle(t.client), { migrationsFolder });
    const { rows } = await t.client.query<{ count: number }>(
      "SELECT count(*)::int AS count FROM drizzle.__drizzle_migrations",
    );
    expect(rows[0]?.count).toBe(journal.entries.length);
  });

  it("installs PostGIS", async () => {
    const { rows } = await t.client.query<{ extname: string }>(
      "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
    );
    expect(rows).toHaveLength(1);
  });

  it("creates the foundation tables", async () => {
    const { rows } = await t.client.query<{ table_name: string }>(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE' AND table_name <> 'spatial_ref_sys'
       ORDER BY table_name`,
    );
    expect(rows.map((row) => row.table_name)).toEqual([
      "audit_events",
      "branch_hours_exceptions",
      "branch_opening_hours",
      "branches",
      "currencies",
      "document_access_grants",
      "invitations",
      "memberships",
      "organizations",
      "outbox_events",
      "plan_assignments",
      "plan_version_limits",
      "plan_versions",
      "plans",
      "platform_staff",
      "provider_media",
      "provider_offering_branches",
      "provider_offerings",
      "provider_profiles",
      "quota_consumptions",
      "quota_counters",
      "quota_overrides",
      "users",
      "verification_appeals",
      "verification_badges",
      "verification_cases",
      "verification_documents",
    ]);
  });

  it("every migration file is listed in the journal (no orphaned SQL)", async () => {
    const { readdirSync } = await import("node:fs");
    const files = readdirSync(migrationsFolder).filter((file) => file.endsWith(".sql"));
    expect(files.map((file) => file.replace(/\.sql$/, ""))).toEqual(
      journal.entries.map((entry) => entry.tag),
    );
  });
});

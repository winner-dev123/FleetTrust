import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";

import type { Database } from "../database.js";
import * as schema from "../schema/index.js";

import { loadTemplate } from "./template.js";

export { expectTenantIsolation, type TenantIsolationCase } from "./tenant-isolation.js";
export { ensureTestDatabaseTemplate } from "./template.js";

export interface TestDatabase {
  db: Database;
  /** Underlying PGlite instance, for raw SQL in tests. */
  client: PGlite;
  close(): Promise<void>;
}

/**
 * In-process PostgreSQL + PostGIS (PGlite, WebAssembly) with all migrations applied.
 * No Docker needed. Each call returns a fresh, isolated database; create one per test file.
 *
 * PGlite embeds a newer Postgres major than Cloud SQL (see docs/development/database.md):
 * don't rely on features missing from Postgres 17. `pnpm test:db` runs the same suites
 * against the real local Postgres container.
 */
export async function createTestDatabase(
  options: { migrate?: boolean } = {},
): Promise<TestDatabase> {
  // Migrated databases start from a cached, already-migrated snapshot (see template.ts).
  // migrate: false gives a truly empty database, for testing the migrations themselves.
  const client =
    (options.migrate ?? true)
      ? await PGlite.create({
          extensions: { postgis, btree_gist },
          loadDataDir: await loadTemplate(),
        })
      : await PGlite.create({ extensions: { postgis, btree_gist } });
  const db = drizzle(client, { schema }) as unknown as Database;
  return { db, client, close: () => client.close() };
}

import { PGlite } from "@electric-sql/pglite";
import { postgis } from "@electric-sql/pglite-postgis";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";

import { type Database, migrationsFolder } from "../database.js";
import * as schema from "../schema/index.js";

export { expectTenantIsolation, type TenantIsolationCase } from "./tenant-isolation.js";

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
  const client = await PGlite.create({ extensions: { postgis } });
  const db = drizzle(client, { schema }) as unknown as Database;
  if (options.migrate ?? true) {
    await migrate(drizzle(client), { migrationsFolder });
  }
  return { db, client, close: () => client.close() };
}

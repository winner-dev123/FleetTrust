import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle, runMigrations } from "../src/database.js";
import { consumeDailyQuota, dailyUsage } from "../src/quotas.js";
import { runSeed } from "../src/seed/index.js";
import { uuidv7 } from "uuidv7";

/**
 * Runs against the real PostgreSQL 17 + PostGIS container (Cloud SQL's major version).
 * Skipped unless DATABASE_URL_TEST is set; run with `pnpm test:db` after `pnpm infra:up`.
 * PGlite-based suites cover the same behaviour without Docker.
 */
const url = process.env["DATABASE_URL_TEST"];

// CI sets REQUIRE_PG_TESTS=1 so a missing database fails the job instead of silently skipping.
if (process.env["REQUIRE_PG_TESTS"] === "1" && !url) {
  throw new Error("REQUIRE_PG_TESTS=1 but DATABASE_URL_TEST is not set");
}

describe.skipIf(!url)("real PostgreSQL (DATABASE_URL_TEST)", () => {
  let handle: DatabaseHandle;
  /** Typed raw queries (Database.execute is driver-agnostic and returns untyped rows). */
  let raw: pg.Client;

  beforeAll(async () => {
    await runMigrations(url ?? "");
    handle = createDatabase({ url: url ?? "", maxConnections: 2 });
    raw = new pg.Client({ connectionString: url });
    await raw.connect();
  });

  afterAll(async () => {
    await raw.end();
    await handle.close();
  });

  it("runs Postgres 17 with PostGIS", async () => {
    const result = await raw.query<{ server_version_num: string; postgis: string }>(
      "SELECT current_setting('server_version_num') AS server_version_num, postgis_lib_version() AS postgis",
    );
    const row = result.rows[0];
    expect(Number(row?.server_version_num)).toBeGreaterThanOrEqual(170_000);
    expect(row?.postgis).toMatch(/^3\./);
  });

  it("migrations are idempotent and seed is repeatable", async () => {
    await runMigrations(url ?? "");
    const first = await runSeed(handle.db);
    const second = await runSeed(handle.db);
    expect(second).toEqual(first);
  });

  it("answers a geodesic radius query", async () => {
    const result = await raw.query<{ near: boolean }>(
      `SELECT ST_DWithin('SRID=4326;POINT(18.4241 -33.9249)'::geography,
                         'SRID=4326;POINT(18.4300 -33.9300)'::geography, 1000) AS near`,
    );
    expect(result.rows[0]?.near).toBe(true);
  });

  it("quota consumption is atomic across 10 real connections (SRS AB-18)", async () => {
    const pool = createDatabase({ url: url ?? "", maxConnections: 10 });
    try {
      const subject = { type: "user" as const, id: uuidv7() };
      const day = "2026-11-19";
      const results = await Promise.all(
        Array.from({ length: 40 }, () =>
          pool.db.transaction((tx) =>
            consumeDailyQuota(tx, {
              subject,
              key: "friend_requests.daily",
              periodStart: day,
              limit: 7,
            }),
          ),
        ),
      );
      expect(results.filter((result) => result.allowed)).toHaveLength(7);
      expect((await dailyUsage(pool.db, subject, day)).get("friend_requests.daily")).toBe(7);

      const retries = await Promise.all(
        Array.from({ length: 20 }, () =>
          pool.db.transaction((tx) =>
            consumeDailyQuota(tx, {
              subject,
              key: "articles.daily",
              periodStart: day,
              limit: 100,
              idempotencyKey: "same-request",
            }),
          ),
        ),
      );
      expect(retries.every((result) => result.allowed)).toBe(true);
      expect((await dailyUsage(pool.db, subject, day)).get("articles.daily")).toBe(1);
    } finally {
      await pool.close();
    }
  });
});

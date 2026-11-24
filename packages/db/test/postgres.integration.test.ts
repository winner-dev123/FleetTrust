import { sql } from "drizzle-orm";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { createDatabase, type DatabaseHandle, runMigrations } from "../src/database.js";
import { consumeDailyQuota, dailyUsage } from "../src/quotas.js";
import { buildSearchQuery, queryRows, searchProviders } from "../src/search.js";
import { runSeed } from "../src/seed/index.js";
import { uuidv7 } from "uuidv7";
import { bookingFixture, pgCode } from "./support/appointment-fixtures.js";
import { publishProvider } from "./support/search-fixtures.js";

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

  it("concurrent bookings of the same staff time: exactly one wins (ADR-0027)", async () => {
    const pool = createDatabase({ url: url ?? "", maxConnections: 10 });
    try {
      const f = await bookingFixture(handle.db);
      const results = await Promise.allSettled(
        Array.from({ length: 10 }, (_, i) =>
          pool.db.transaction(async (tx) => {
            await tx.execute(sql`SELECT pg_sleep(0.01 * ${i % 3})`);
            await f.bookWith(tx, f.staffA, "2027-06-01T09:00:00Z", "2027-06-01T10:00:00Z");
          }),
        ),
      );
      expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      // Losers are refused by the exclusion constraint (23P01). Without the API's per-staff lock,
      // Postgres may instead abort one of two simultaneous inserts as a deadlock (40P01), a
      // documented behaviour of exclusion constraints. Either way nothing overlapping is written.
      expect(
        results.every(
          (r) => r.status === "fulfilled" || ["23P01", "40P01"].includes(pgCode(r.reason) ?? ""),
        ),
      ).toBe(true);
      const { rows } = await raw.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM appointments WHERE staff_user_id = $1 AND status = 'booked'",
        [f.staffA],
      );
      expect(rows[0]?.n).toBe(1);
    } finally {
      await pool.close();
    }
  });

  it("search uses the GiST index with real planner statistics (no hints) and returns results", async () => {
    const { organizationId } = await publishProvider(handle.db, {
      name: "PG17 Search",
      branches: [{ at: { lng: 18.4241, lat: -33.9249 } }],
    });
    // Thousands of rows spread over a continent, so a 10 km search is highly selective.
    await raw.query(
      `INSERT INTO branches (organization_id, name)
       SELECT $1, 'plan-' || g FROM generate_series(1, 4000) AS g`,
      [organizationId],
    );
    await raw.query(
      `INSERT INTO provider_search_entries (branch_id, organization_id, slug, trading_name,
         branch_name, categories, vehicle_types, location, approx_location, search_document,
         published_at)
       SELECT b.id, b.organization_id, 'pg17-plan', 'Plan', b.name, '{workshop}', '{car}',
              p.g, p.g, to_tsvector('simple', 'plan'), now()
       FROM branches b
       CROSS JOIN LATERAL (
         -- Referencing b makes random() run per row instead of once.
         SELECT ST_SetSRID(ST_MakePoint(random() * 40 + 10 + (b.id IS NULL)::int,
                                        random() * 40 - 40), 4326)::geography AS g
       ) p
       WHERE b.organization_id = $1 AND b.name LIKE 'plan-%'`,
      [organizationId],
    );
    await raw.query("ANALYZE provider_search_entries");
    const params = {
      at: new Date(),
      precise: true,
      area: {
        kind: "near" as const,
        point: { lng: 18.4241, lat: -33.9249 },
        radiusMeters: 10_000,
        coversLocationOnly: false,
      },
      limit: 20,
    };
    const plan = await queryRows<{ "QUERY PLAN": string }>(
      handle.db,
      sql`EXPLAIN ${buildSearchQuery(params)}`,
    );
    expect(plan.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(
      /provider_search_entries_location_gist/,
    );
    const rows = await searchProviders(handle.db, params);
    expect(rows.map((r) => r.tradingName)).toContain("PG17 Search");
  });
});

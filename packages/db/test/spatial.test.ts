import { asc, sql } from "drizzle-orm";
import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { geographyPoint } from "../src/schema/columns.js";
import { distanceMeters, geographyOf, withinBoundingBox, withinMeters } from "../src/spatial.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";

/** Test-only table: real spatial tables (providers, branches) arrive in Prompts 10-12. */
const places = pgTable("test_places", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  location: geographyPoint("location").notNull(),
});

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
  await t.client.exec(`
    CREATE TABLE test_places (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      name text NOT NULL,
      location geography(Point, 4326) NOT NULL
    );
    CREATE INDEX test_places_location_gist ON test_places USING gist (location);
  `);
  await t.db.insert(places).values([
    { name: "Cape Town CBD", location: { lng: 18.4241, lat: -33.9249 } },
    { name: "V&A Waterfront", location: { lng: 18.4197, lat: -33.9036 } },
    { name: "Stellenbosch", location: { lng: 18.8602, lat: -33.9321 } },
    { name: "Johannesburg", location: { lng: 28.0473, lat: -26.2041 } },
  ]);
});

afterAll(async () => {
  await t.close();
});

const cbd = { lng: 18.4241, lat: -33.9249 };

describe("geography point column", () => {
  it("round-trips longitude/latitude without loss", async () => {
    const rows = await t.db.select().from(places).orderBy(asc(places.name));
    expect(rows.find((row) => row.name === "Stellenbosch")?.location).toEqual({
      lng: 18.8602,
      lat: -33.9321,
    });
  });

  it("rejects out-of-range coordinates before they reach the database", async () => {
    await expect(
      t.db.insert(places).values({ name: "bad", location: { lng: 200, lat: 0 } }),
    ).rejects.toThrow(/Longitude/);
    expect(() => geographyOf({ lng: 0, lat: -91 })).toThrow(/Latitude/);
  });
});

describe("spatial queries", () => {
  it("measures geodesic distance on the WGS 84 spheroid", async () => {
    // Reference values: 1° of latitude at the equator = 110,574.4 m; 1° of longitude = 111,319.5 m.
    const [row] = await t.client
      .query<{ lat: number; lng: number }>(
        `
      SELECT ST_Distance('SRID=4326;POINT(0 0)'::geography, 'SRID=4326;POINT(0 1)'::geography) AS lat,
             ST_Distance('SRID=4326;POINT(0 0)'::geography, 'SRID=4326;POINT(1 0)'::geography) AS lng
    `,
      )
      .then((result) => result.rows);
    expect(row?.lat).toBeCloseTo(110_574.4, 0);
    expect(row?.lng).toBeCloseTo(111_319.5, 0);
  });

  it("finds places within a radius, nearest first", async () => {
    const rows = await t.db
      .select({ name: places.name, meters: distanceMeters(places.location, cbd) })
      .from(places)
      .where(withinMeters(places.location, cbd, 50_000))
      .orderBy(distanceMeters(places.location, cbd));

    expect(rows.map((row) => row.name)).toEqual([
      "Cape Town CBD",
      "V&A Waterfront",
      "Stellenbosch",
    ]);
    expect(rows[0]?.meters).toBe(0);
    // CBD → V&A Waterfront is roughly 2.4 km; CBD → Stellenbosch roughly 40 km.
    expect(rows[1]?.meters).toBeGreaterThan(2_000);
    expect(rows[1]?.meters).toBeLessThan(3_000);
    expect(rows[2]?.meters).toBeGreaterThan(38_000);
    expect(rows[2]?.meters).toBeLessThan(43_000);
  });

  it("radius boundaries are inclusive and exact to the metre", async () => {
    const [waterfront] = await t.db
      .select({ meters: distanceMeters(places.location, cbd) })
      .from(places)
      .where(sql`${places.name} = 'V&A Waterfront'`);
    const exact = waterfront?.meters ?? 0;
    const inside = await t.db
      .select()
      .from(places)
      .where(withinMeters(places.location, cbd, exact + 0.5));
    const outside = await t.db
      .select()
      .from(places)
      .where(withinMeters(places.location, cbd, exact - 0.5));
    expect(inside.map((row) => row.name)).toContain("V&A Waterfront");
    expect(outside.map((row) => row.name)).not.toContain("V&A Waterfront");
  });

  it("filters by map viewport (bounding box)", async () => {
    const rows = await t.db
      .select({ name: places.name })
      .from(places)
      .where(
        withinBoundingBox(places.location, { west: 18.3, south: -34.0, east: 18.5, north: -33.8 }),
      );
    expect(rows.map((row) => row.name).sort()).toEqual(["Cape Town CBD", "V&A Waterfront"]);
  });

  it("rejects invalid radii and viewports", () => {
    expect(() => withinMeters(places.location, cbd, -1)).toThrow(RangeError);
    expect(() =>
      withinBoundingBox(places.location, { west: 170, south: -10, east: -170, north: 10 }),
    ).toThrow(/antimeridian/);
  });

  it("radius search can use the GiST index", async () => {
    // Tiny tables make the planner prefer a sequential scan; disable it to prove the index is usable.
    await t.client.exec("SET enable_seqscan = off");
    const query = t.db
      .select()
      .from(places)
      .where(withinMeters(places.location, cbd, 5_000))
      .toSQL();
    const { rows } = await t.client.query<{ "QUERY PLAN": string }>(
      `EXPLAIN ${query.sql}`,
      query.params,
    );
    await t.client.exec("RESET enable_seqscan");
    expect(rows.map((row) => row["QUERY PLAN"]).join("\n")).toMatch(/test_places_location_gist/);
  });
});

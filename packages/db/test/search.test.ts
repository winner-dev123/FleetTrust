import { type HoursException, openingStatus, type WeeklyHours } from "@fleettrust/types";
import { eq, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  branches,
  branchHoursExceptions,
  branchOpeningHours,
  providerProfiles,
  providerSearchEntries,
} from "../src/schema/index.js";
import {
  buildSearchQuery,
  queryRows,
  type ProviderSearchParams,
  refreshProviderSearch,
  searchProviders,
  searchTerms,
  thinLine,
} from "../src/search.js";
import { createTestDatabase, type TestDatabase } from "../src/testing/index.js";
import { grantBadge, project, publishProvider, suspend } from "./support/search-fixtures.js";

let t: TestDatabase;

beforeAll(async () => {
  t = await createTestDatabase();
});

afterAll(async () => {
  await t.close();
});

const AT = new Date("2026-11-20T10:00:00Z");

/** Each test uses its own area so fixtures don't interfere. */
function near(
  point: { lng: number; lat: number },
  radiusKm: number,
  extra: Partial<ProviderSearchParams> = {},
): ProviderSearchParams {
  return {
    at: AT,
    precise: true,
    area: { kind: "near", point, radiusMeters: radiusKm * 1000, coversLocationOnly: false },
    limit: 50,
    ...extra,
  };
}

describe("geospatial accuracy", () => {
  it("radius boundaries are exact on the spheroid (9.99 km in, 10.01 km out)", async () => {
    const origin = { lng: 25.0, lat: -30.0 };
    const inside = await project(t.db, origin, 9_990, 37);
    const outside = await project(t.db, origin, 10_010, 211);
    await publishProvider(t.db, { name: "Inside", branches: [{ at: inside }] });
    await publishProvider(t.db, { name: "Outside", branches: [{ at: outside }] });

    const rows = await searchProviders(t.db, near(origin, 10));
    expect(rows.map((r) => r.tradingName)).toEqual(["Inside"]);
    expect(rows[0]?.distanceMeters).toBe(9_990);
  });

  it("reports geodesic distances that agree with an independent haversine estimate", async () => {
    const london = { lng: -0.1276, lat: 51.5072 };
    const paris = { lng: 2.3522, lat: 48.8566 };
    await publishProvider(t.db, { name: "Paris Depot", branches: [{ at: paris }] });
    const [row] = await searchProviders(t.db, near(london, 400, { text: "paris depot" }));
    const toRad = (d: number) => (d * Math.PI) / 180;
    const h =
      Math.sin(toRad(paris.lat - london.lat) / 2) ** 2 +
      Math.cos(toRad(london.lat)) *
        Math.cos(toRad(paris.lat)) *
        Math.sin(toRad(paris.lng - london.lng) / 2) ** 2;
    const haversine = 2 * 6_371_008.8 * Math.asin(Math.sqrt(h));
    // The spheroid and sphere differ by well under 0.5% at this latitude.
    expect(Math.abs((row?.distanceMeters ?? 0) - haversine) / haversine).toBeLessThan(0.005);
    expect(row?.distanceMeters).toBeGreaterThan(340_000);
    expect(row?.distanceMeters).toBeLessThan(346_000);
  });

  it("finds neighbours across the antimeridian, in radius and viewport searches", async () => {
    const east = { lng: 179.95, lat: -16.5 };
    await publishProvider(t.db, {
      name: "West of the line",
      branches: [{ at: { lng: -179.95, lat: -16.5 } }],
    });
    await publishProvider(t.db, { name: "East of the line", branches: [{ at: east }] });
    await publishProvider(t.db, {
      name: "Far away",
      branches: [{ at: { lng: 178.0, lat: -16.5 } }],
    });

    const radius = await searchProviders(t.db, near(east, 15));
    expect(radius.map((r) => r.tradingName).sort()).toEqual([
      "East of the line",
      "West of the line",
    ]);
    expect(radius.find((r) => r.tradingName === "West of the line")?.distanceMeters).toBeLessThan(
      11_000,
    );

    const viewport = await searchProviders(t.db, {
      ...near(east, 1),
      area: {
        kind: "bbox",
        box: { west: 179.5, south: -17, east: -179.5, north: -16 },
        origin: east,
      },
    });
    expect(viewport.map((r) => r.tradingName).sort()).toEqual([
      "East of the line",
      "West of the line",
    ]);
  });

  it("viewport searches include points on the edges and exclude points just outside", async () => {
    await publishProvider(t.db, {
      name: "On the edge",
      branches: [{ at: { lng: 30.5, lat: -20.0 } }],
    });
    await publishProvider(t.db, {
      name: "Just outside",
      branches: [{ at: { lng: 30.5001, lat: -20.0 } }],
    });
    const rows = await searchProviders(t.db, {
      ...near({ lng: 30.25, lat: -20.0 }, 1),
      area: {
        kind: "bbox",
        box: { west: 30.0, south: -20.5, east: 30.5, north: -19.5 },
        origin: { lng: 30.25, lat: -20.0 },
      },
    });
    expect(rows.map((r) => r.tradingName)).toEqual(["On the edge"]);
  });

  it("service-radius coverage: providers that travel to the searcher", async () => {
    const searcher = { lng: 26.0, lat: -29.0 };
    const far = await project(t.db, searcher, 80_000, 90);
    await publishProvider(t.db, {
      name: "Travels 100 km",
      categories: ["towing"],
      branches: [{ at: far, serviceRadiusKm: 100 }],
    });
    await publishProvider(t.db, {
      name: "Travels 50 km",
      categories: ["towing"],
      branches: [{ at: far, serviceRadiusKm: 50 }],
    });
    // Neither is within 25 km, but one covers the searcher.
    expect(await searchProviders(t.db, near(searcher, 25))).toEqual([]);
    const covering = await searchProviders(t.db, {
      ...near(searcher, 25),
      area: { kind: "near", point: searcher, radiusMeters: 25_000, coversLocationOnly: true },
    });
    expect(covering.map((r) => [r.tradingName, r.coversLocation])).toEqual([
      ["Travels 100 km", true],
    ]);
  });
});

describe("privacy: visitors only ever see the rounded location", () => {
  it("returns and ranks by the ~1 km rounded point, even at the radius boundary", async () => {
    // Exactly 0.0449° east of the origin is about 4.99 km; rounded to 0.04° it's about 4.45 km.
    const origin = { lng: 10.0, lat: 0.0 };
    const { branchIds } = await publishProvider(t.db, {
      name: "Rounded",
      branches: [{ at: { lng: 10.0449, lat: 0.0 } }],
    });
    const precise = await searchProviders(t.db, near(origin, 4.7));
    expect(precise).toEqual([]);
    const visitor = await searchProviders(t.db, near(origin, 4.7, { precise: false }));
    expect(visitor).toHaveLength(1);
    expect(visitor[0]).toMatchObject({ branchId: branchIds[0], lng: 10.04, lat: 0 });
    expect(visitor[0]?.distanceMeters).toBeCloseTo(4_453, -1);
    // Signed in: exact.
    const signedIn = await searchProviders(t.db, near(origin, 6));
    expect(signedIn[0]).toMatchObject({ lng: 10.0449, lat: 0 });
  });

  it("the projection holds published data only: drafts, hidden and suspended providers never appear", async () => {
    const spot = { lng: 31.0, lat: -25.0 };
    const live = await publishProvider(t.db, { name: "Live", branches: [{ at: spot }] });
    const hidden = await publishProvider(t.db, { name: "Hidden", branches: [{ at: spot }] });
    const suspended = await publishProvider(t.db, { name: "Suspended", branches: [{ at: spot }] });

    await t.db
      .update(providerProfiles)
      .set({ status: "hidden" })
      .where(eq(providerProfiles.organizationId, hidden.organizationId));
    await refreshProviderSearch(t.db, hidden.organizationId);
    await suspend(t.db, suspended.organizationId);

    const rows = await searchProviders(t.db, near(spot, 1));
    expect(rows.map((r) => r.tradingName)).toEqual(["Live"]);

    // Editing the draft columns changes nothing until the snapshot is republished.
    await t.db
      .update(providerProfiles)
      .set({ tradingName: "Renamed draft" })
      .where(eq(providerProfiles.organizationId, live.organizationId));
    await refreshProviderSearch(t.db, live.organizationId);
    expect((await searchProviders(t.db, near(spot, 1)))[0]?.tradingName).toBe("Live");

    // Deleting a branch removes its search row.
    const branchId = live.branchIds[0] ?? "";
    await t.db.delete(branches).where(eq(branches.id, branchId));
    expect(
      await t.db
        .select()
        .from(providerSearchEntries)
        .where(eq(providerSearchEntries.branchId, branchId)),
    ).toEqual([]);
  });
});

describe("filters and relevance", () => {
  const spot = { lng: 20.0, lat: -32.0 };

  beforeAll(async () => {
    const verified = await publishProvider(t.db, {
      name: "Karoo Diesel",
      categories: ["fuel_station"],
      vehicleTypes: ["heavy_truck", "car"],
      offerings: ["Diesel", "AdBlue"],
      branches: [{ at: spot }],
    });
    await grantBadge(t.db, verified.organizationId, "business");
    const expired = await publishProvider(t.db, {
      name: "Karoo Brakes",
      categories: ["workshop"],
      vehicleTypes: ["heavy_truck"],
      offerings: ["Brake inspection"],
      branches: [{ at: { lng: 20.01, lat: -32.0 } }],
    });
    await grantBadge(t.db, expired.organizationId, "business", new Date("2026-11-19T00:00:00Z"));
    await publishProvider(t.db, {
      name: "Karoo Cars",
      categories: ["workshop"],
      vehicleTypes: ["car"],
      description: "We also check brakes",
      branches: [{ at: { lng: 20.02, lat: -32.0 } }],
    });
  });

  const names = (rows: { tradingName: string }[]) => rows.map((r) => r.tradingName);

  it("filters by category (any of) and vehicle support", async () => {
    expect(
      names(await searchProviders(t.db, near(spot, 5, { categories: ["fuel_station"] }))),
    ).toEqual(["Karoo Diesel"]);
    expect(
      names(
        await searchProviders(t.db, near(spot, 5, { categories: ["fuel_station", "workshop"] })),
      ).sort(),
    ).toEqual(["Karoo Brakes", "Karoo Cars", "Karoo Diesel"]);
    expect(
      names(await searchProviders(t.db, near(spot, 5, { vehicleType: "car" }))).sort(),
    ).toEqual(["Karoo Cars", "Karoo Diesel"]);
  });

  it("filters by current verification (expired badges don't count)", async () => {
    expect(
      names(await searchProviders(t.db, near(spot, 5, { verification: ["business"] }))),
    ).toEqual(["Karoo Diesel"]);
    expect(
      await searchProviders(t.db, near(spot, 5, { verification: ["business", "location"] })),
    ).toEqual([]);
  });

  it("matches text by prefix and ranks name/offering matches above description matches", async () => {
    const rows = await searchProviders(t.db, near(spot, 5, { text: "brak" }));
    expect(names(rows)).toEqual(["Karoo Brakes", "Karoo Cars"]);
    expect(rows[0]?.textScore).toBeGreaterThan(rows[1]?.textScore ?? 1);
    expect(searchTerms("  Brake;  DROP TABLE x -- ")).toEqual(["brake", "drop", "table", "x"]);
    // Operators can't be injected into the tsquery.
    expect(await searchProviders(t.db, near(spot, 5, { text: "!&|:*()" }))).toHaveLength(3);
  });

  it("ranks nearer first when nothing else differs, deterministically", async () => {
    const rows = await searchProviders(t.db, near(spot, 5));
    expect(names(rows)).toEqual(["Karoo Diesel", "Karoo Brakes", "Karoo Cars"]);
    const again = await searchProviders(t.db, near(spot, 5));
    expect(again).toEqual(rows);
  });
});

describe("pagination", () => {
  it("keyset pages cover every result exactly once, in ranking order", async () => {
    const centre = { lng: 15.0, lat: -22.0 };
    for (let i = 0; i < 23; i++) {
      // Pairs at the same spot exercise the tie-breakers (distance, then branch id).
      const at = await project(t.db, centre, 200 + Math.floor(i / 2) * 150, (i * 47) % 360);
      await publishProvider(t.db, { name: `Pager ${String(i)}`, branches: [{ at }] });
    }
    const all = await searchProviders(t.db, near(centre, 10, { limit: 100 }));
    expect(all).toHaveLength(23);

    const seen: string[] = [];
    let after: ProviderSearchParams["after"];
    for (let page = 0; page < 10; page++) {
      const rows = await searchProviders(t.db, near(centre, 10, { limit: 10, after }));
      seen.push(...rows.map((r) => r.branchId));
      const last = rows.at(-1);
      if (rows.length < 10 || !last) break;
      after = { score: last.score, distanceMeters: last.distanceMeters, branchId: last.branchId };
    }
    expect(seen).toEqual(all.map((r) => r.branchId));
    expect(new Set(seen).size).toBe(23);
  });
});

describe("open now", () => {
  const weekly: WeeklyHours = {
    mon: [
      { opens: "08:00", closes: "12:00" },
      { opens: "13:00", closes: "17:30" },
    ],
    tue: [{ opens: "08:00", closes: "17:30" }],
    wed: [{ opens: "08:00", closes: "17:30" }],
    thu: [{ opens: "08:00", closes: "17:30" }],
    fri: [
      { opens: "08:00", closes: "17:30" },
      { opens: "22:00", closes: "06:00" },
    ],
    sat: [
      { opens: "00:00", closes: "02:00" },
      { opens: "09:00", closes: "13:00" },
    ],
  };
  // Week of the 2026 UK spring DST change (Sunday 29 March).
  const exceptions: HoursException[] = [
    { date: "2026-03-28", closed: true, label: "Closed Saturday", intervals: [] },
    {
      date: "2026-03-30",
      closed: false,
      label: "Short Monday",
      intervals: [{ opens: "10:00", closes: "14:00" }],
    },
    {
      date: "2026-03-31",
      closed: false,
      label: "Late Tuesday",
      intervals: [{ opens: "20:00", closes: "03:00" }],
    },
  ];
  const toMinutes = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

  it.each(["Europe/London", "Pacific/Auckland", "America/New_York", "Asia/Kolkata"])(
    "SQL branch_is_open() agrees with openingStatus() every 15 minutes for a DST week (%s)",
    async (timeZone) => {
      const { branchIds } = await publishProvider(t.db, {
        name: `Hours ${timeZone}`,
        branches: [{ at: { lng: 5, lat: 5 }, timeZone }],
      });
      const branchId = branchIds[0] ?? "";
      const organizationId =
        (await t.db.select().from(branches).where(eq(branches.id, branchId)))[0]?.organizationId ??
        "";
      const days = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
      const rows = days.flatMap((day, i) =>
        (weekly[day] ?? []).map((iv) => {
          const opens = toMinutes(iv.opens);
          const close = toMinutes(iv.closes);
          return {
            organizationId,
            branchId,
            weekday: i + 1,
            opensMinute: opens,
            closesMinute: close <= opens ? close + 1440 : close,
          };
        }),
      );
      await t.db.insert(branchOpeningHours).values(rows);
      await t.db
        .insert(branchHoursExceptions)
        .values(exceptions.map((e) => ({ organizationId, branchId, ...e })));
      await t.db
        .update(branches)
        .set({ hoursUpdatedAt: new Date() })
        .where(eq(branches.id, branchId));

      const samples = await queryRows<{ at: string | Date; open: boolean }>(
        t.db,
        sql`
        SELECT at, branch_is_open(${branchId}::uuid, ${timeZone}, at) AS open
        FROM generate_series('2026-03-25T00:00:00Z'::timestamptz, '2026-04-02T00:00:00Z'::timestamptz, interval '15 minutes') AS at
      `,
      );
      expect(samples.length).toBeGreaterThan(700);
      const mismatches = samples.filter(
        (r) => openingStatus({ weekly, exceptions, timeZone }, new Date(r.at)).isOpen !== r.open,
      );
      expect(mismatches.map((m) => new Date(m.at).toISOString())).toEqual([]);
      // Sanity: the schedule is open some of the time and closed some of the time.
      expect(samples.some((r) => r.open)).toBe(true);
      expect(samples.some((r) => !r.open)).toBe(true);
    },
  );

  it("branches that never saved hours are not open (unknown), and the filter excludes them", async () => {
    const spot = { lng: 6.5, lat: 6.5 };
    await publishProvider(t.db, { name: "No hours", branches: [{ at: spot }] });
    expect(await searchProviders(t.db, near(spot, 1, { openNow: true }))).toEqual([]);
    expect((await searchProviders(t.db, near(spot, 1)))[0]?.openNow).toBe(false);
  });
});

describe("query plans", () => {
  async function plan(params: ProviderSearchParams): Promise<string> {
    await t.db.execute(sql`SET enable_seqscan = off`);
    try {
      const rows = await queryRows<{ "QUERY PLAN": string }>(
        t.db,
        sql`EXPLAIN ${buildSearchQuery(params)}`,
      );
      return rows.map((r) => r["QUERY PLAN"]).join("\n");
    } finally {
      await t.db.execute(sql`RESET enable_seqscan`);
    }
  }

  it("radius searches use the GiST index for their precision", async () => {
    expect(await plan(near({ lng: 1, lat: 1 }, 10))).toMatch(
      /provider_search_entries_location_gist/,
    );
    expect(await plan(near({ lng: 1, lat: 1 }, 10, { precise: false }))).toMatch(
      /provider_search_entries_approx_gist/,
    );
  });

  it("viewport searches use the geometry GiST index", async () => {
    const bbox = {
      kind: "bbox" as const,
      box: { west: 0, south: 0, east: 1, north: 1 },
      origin: { lng: 0.5, lat: 0.5 },
    };
    expect(await plan({ ...near({ lng: 1, lat: 1 }, 1), area: bbox })).toMatch(
      /provider_search_entries_location_geom_gist/,
    );
    expect(await plan({ ...near({ lng: 1, lat: 1 }, 1), precise: false, area: bbox })).toMatch(
      /provider_search_entries_approx_geom_gist/,
    );
  });
});

describe("route corridor", () => {
  // A route heading due east along latitude -27.5, about 100 km long.
  const start = { lng: 23.0, lat: -27.5 };
  const corridor = (
    width: number,
    extra: Partial<ProviderSearchParams> = {},
  ): ProviderSearchParams => ({
    at: AT,
    precise: true,
    area: { kind: "corridor", line: [start, { lng: 24.0, lat: -27.5 }], widthMeters: width },
    limit: 50,
    ...extra,
  });

  beforeAll(async () => {
    // Follow the route's own geodesic (its initial azimuth), then step off it at right angles.
    const [heading] = await queryRows<{ deg: number }>(
      t.db,
      sql`SELECT degrees(ST_Azimuth('SRID=4326;POINT(23 -27.5)'::geography,
                                    'SRID=4326;POINT(24 -27.5)'::geography)) AS deg`,
    );
    const azimuth = Number(heading?.deg);
    const along = async (km: number, offsetKm: number, side: 0 | 180) => {
      const onRoute = await project(
        t.db,
        start,
        Math.abs(km) * 1000,
        km < 0 ? azimuth + 180 : azimuth,
      );
      return offsetKm === 0
        ? onRoute
        : project(t.db, onRoute, offsetKm * 1000, azimuth - 90 + side);
    };
    await publishProvider(t.db, {
      name: "Corridor 80km",
      branches: [{ at: await along(80, 1, 0) }],
    });
    await publishProvider(t.db, {
      name: "Corridor 10km",
      branches: [{ at: await along(10, 4.9, 180) }],
    });
    await publishProvider(t.db, {
      name: "Corridor 50km",
      branches: [{ at: await along(50, 0, 0) }],
    });
    await publishProvider(t.db, {
      name: "Corridor too far",
      branches: [{ at: await along(40, 5.1, 0) }],
    });
    await publishProvider(t.db, {
      name: "Corridor before start",
      branches: [{ at: await along(-8, 0, 0) }],
    });
  });

  it("finds branches within the corridor width, in order along the route", async () => {
    const rows = await searchProviders(t.db, corridor(5_000));
    expect(rows.map((r) => r.tradingName)).toEqual([
      "Corridor 10km",
      "Corridor 50km",
      "Corridor 80km",
    ]);
    expect(rows.map((r) => Math.round((r.routeFraction ?? 0) * 10) / 10)).toEqual([0.1, 0.5, 0.8]);
    // Distances are measured from the route line, not from the start.
    expect(rows[0]?.distanceMeters).toBeGreaterThan(4_800);
    expect(rows[0]?.distanceMeters).toBeLessThan(5_000);
    expect(rows[1]?.distanceMeters).toBeLessThan(50);
  });

  it("applies the same filters as point search", async () => {
    expect(await searchProviders(t.db, corridor(5_000, { text: "80km" }))).toHaveLength(1);
    expect(await searchProviders(t.db, corridor(5_000, { categories: ["towing"] }))).toEqual([]);
  });

  it("thins long routes evenly, keeping both ends", () => {
    const long = Array.from({ length: 10_001 }, (_, i) => ({ lng: i / 10_000, lat: 0 }));
    const thin = thinLine(long, 2_000);
    expect(thin).toHaveLength(2_000);
    expect(thin[0]).toEqual(long[0]);
    expect(thin.at(-1)).toEqual(long.at(-1));
  });

  it("uses the GiST index", async () => {
    await t.db.execute(sql`SET enable_seqscan = off`);
    try {
      const rows = await queryRows<{ "QUERY PLAN": string }>(
        t.db,
        sql`EXPLAIN ${buildSearchQuery(corridor(5_000))}`,
      );
      expect(rows.map((r) => r["QUERY PLAN"]).join("\n")).toMatch(
        /provider_search_entries_location_gist/,
      );
    } finally {
      await t.db.execute(sql`RESET enable_seqscan`);
    }
  });
});

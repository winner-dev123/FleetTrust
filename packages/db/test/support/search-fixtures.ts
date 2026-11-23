import { eq, sql } from "drizzle-orm";
import { uuidv7 } from "uuidv7";

import type { Executor } from "../../src/database.js";
import type { LngLat } from "../../src/schema/columns.js";
import {
  branches,
  organizations,
  providerProfiles,
  users,
  verificationBadges,
  verificationCases,
} from "../../src/schema/index.js";
import { queryRows, refreshProviderSearch } from "../../src/search.js";

export interface FixtureBranch {
  name?: string;
  at: LngLat;
  serviceRadiusKm?: number | null;
  timeZone?: string;
}

export interface FixtureProvider {
  name: string;
  categories?: string[];
  vehicleTypes?: string[];
  description?: string;
  offerings?: string[];
  branches: FixtureBranch[];
}

let ownerId: string | undefined;

async function owner(db: Executor): Promise<string> {
  if (ownerId) return ownerId;
  const [row] = await db
    .insert(users)
    .values({ firebaseUid: `search-fixture-${uuidv7()}` })
    .returning();
  if (!row) throw new Error("no user");
  ownerId = row.id;
  return row.id;
}

/** Inserts an organization, its branches and a published snapshot, then refreshes search. */
export async function publishProvider(db: Executor, spec: FixtureProvider) {
  const createdBy = await owner(db);
  const [org] = await db
    .insert(organizations)
    .values({ kind: "provider", name: spec.name, createdBy })
    .returning();
  if (!org) throw new Error("no org");
  const branchRows = [];
  for (const [i, b] of spec.branches.entries()) {
    const [row] = await db
      .insert(branches)
      .values({
        organizationId: org.id,
        name: b.name ?? `${spec.name} branch ${String(i + 1)}`,
        locality: "Testville",
        countryCode: "ZA",
        location: b.at,
        serviceRadiusKm: b.serviceRadiusKm ?? null,
        timeZone: b.timeZone ?? "UTC",
      })
      .returning();
    if (!row) throw new Error("no branch");
    branchRows.push(row);
  }
  const slug = `${spec.name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${uuidv7().slice(-6)}`;
  const snapshot = {
    organizationId: org.id,
    slug,
    tradingName: spec.name,
    legalName: `${spec.name} Ltd`,
    description: spec.description ?? null,
    categories: spec.categories ?? ["workshop"],
    categoryDetails: {},
    vehicleTypes: spec.vehicleTypes ?? ["heavy_truck"],
    contact: { phone: null, email: null, website: null },
    branches: branchRows.map((b) => ({
      id: b.id,
      name: b.name,
      addressLine1: "1 Test Road",
      addressLine2: null,
      locality: b.locality,
      region: null,
      postalCode: null,
      countryCode: b.countryCode,
      location: b.location,
      serviceRadiusKm: b.serviceRadiusKm,
      phone: null,
    })),
    mediaIds: [],
    offerings: (spec.offerings ?? []).map((name) => ({ id: uuidv7(), name })),
  };
  await db.insert(providerProfiles).values({
    organizationId: org.id,
    slug,
    status: "published",
    publishedSnapshot: snapshot,
    publishedAt: new Date("2026-11-01T00:00:00Z"),
  });
  await refreshProviderSearch(db, org.id);
  return { organizationId: org.id, slug, branchIds: branchRows.map((b) => b.id) };
}

/** Grants an organization badge directly (reviewer workflow is tested in the API). */
export async function grantBadge(
  db: Executor,
  organizationId: string,
  badgeType: "business" | "location",
  expiresAt = new Date("2027-11-01T00:00:00Z"),
) {
  const reviewer = await owner(db);
  const decidedAt = new Date("2026-10-01T00:00:00Z");
  const [kase] = await db
    .insert(verificationCases)
    .values({
      subjectType: "organization",
      organizationId,
      badgeType,
      status: "approved",
      openedBy: reviewer,
      submittedAt: decidedAt,
      decidedAt,
      decidedBy: reviewer,
    })
    .returning();
  if (!kase) throw new Error("no case");
  await db.insert(verificationBadges).values({
    subjectType: "organization",
    organizationId,
    badgeType,
    caseId: kase.id,
    grantedBy: reviewer,
    grantedAt: decidedAt,
    expiresAt,
  });
}

/** A point `meters` away from `from` on `bearingDeg`, computed by PostGIS on the spheroid. */
export async function project(
  db: Executor,
  from: LngLat,
  meters: number,
  bearingDeg: number,
): Promise<LngLat> {
  const rows = await queryRows<{ lng: unknown; lat: unknown }>(
    db,
    sql`
    SELECT ST_X(p::geometry) AS lng, ST_Y(p::geometry) AS lat FROM (
      SELECT ST_Project(ST_SetSRID(ST_MakePoint(${from.lng}::float8, ${from.lat}::float8), 4326)::geography,
                        ${meters}::float8, radians(${bearingDeg}::float8)) AS p) q`,
  );
  const row = rows[0];
  if (!row) throw new Error("no projection");
  return { lng: Number(row.lng), lat: Number(row.lat) };
}

export async function suspend(db: Executor, organizationId: string) {
  await db
    .update(organizations)
    .set({ status: "suspended" })
    .where(eq(organizations.id, organizationId));
}

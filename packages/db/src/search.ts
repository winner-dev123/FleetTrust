import { type SQL, sql } from "drizzle-orm";

import type { Executor } from "./database.js";
import { assertLngLat, type LngLat } from "./schema/columns.js";

/**
 * Provider search over the published-snapshot projection (ADR-0019).
 *
 * Ranking uses relevance signals only (SRS FR-06, ADR-0009): text match, distance, service-radius
 * coverage and open now. It takes no plan, tier or payment input. Verification and vehicle
 * support are filters the user chooses. Visitors are served from the rounded location only.
 */

export interface BoundingBox {
  west: number;
  south: number;
  east: number;
  north: number;
}

export type SearchArea =
  | {
      kind: "near";
      point: LngLat;
      radiusMeters: number;
      /** Only branches whose service radius reaches the point (mobile mechanics, towing). */
      coversLocationOnly: boolean;
    }
  | { kind: "bbox"; box: BoundingBox; origin: LngLat }
  | {
      /** Branches within `widthMeters` of a route line, returned in order along the route. */
      kind: "corridor";
      line: readonly LngLat[];
      widthMeters: number;
    };

/** Most vertices sent to PostGIS for a corridor; longer routes are thinned evenly. */
export const MAX_CORRIDOR_VERTICES = 2_000;

export interface SearchCursor {
  score: string;
  distanceMeters: number;
  branchId: string;
}

export interface ProviderSearchParams {
  at: Date;
  /** Visitors (not signed in) never see or rank by exact locations (OQ-11). */
  precise: boolean;
  area: SearchArea;
  categories?: readonly string[];
  vehicleType?: string;
  /** Organization badge types the provider must currently hold (all of them). */
  verification?: readonly string[];
  openNow?: boolean;
  text?: string;
  after?: SearchCursor;
  limit: number;
}

export interface ProviderSearchRow {
  branchId: string;
  organizationId: string;
  slug: string;
  tradingName: string;
  branchName: string;
  locality: string | null;
  countryCode: string | null;
  categories: string[];
  vehicleTypes: string[];
  lng: number;
  lat: number;
  serviceRadiusKm: number | null;
  distanceMeters: number;
  coversLocation: boolean;
  openNow: boolean;
  textScore: number;
  /** Fixed-precision decimal string, stable for keyset pagination. */
  score: string;
  /** Corridor searches: position along the route, 0 (start) to 1 (end). Otherwise null. */
  routeFraction: number | null;
}

/** Ranking weights (sum 1). Documented in docs/architecture/search.md. */
export const RANKING_WEIGHTS = {
  text: 0.35,
  distance: 0.35,
  coverage: 0.15,
  openNow: 0.15,
} as const;

/** Distance at which the distance signal halves. */
export const DISTANCE_HALF_KM = 10;

/** Largest service radius a branch can have (branches_service_radius_range). */
const MAX_SERVICE_RADIUS_METERS = 500_000;

/** Letters and digits only, up to five terms, each prefix-matched: "brak tru" → brak:* & tru:*. */
export function searchTerms(text: string | undefined): string[] {
  if (!text) return [];
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 5);
}

function point(p: LngLat): SQL {
  assertLngLat(p);
  return sql`ST_SetSRID(ST_MakePoint(${p.lng}::float8, ${p.lat}::float8), 4326)::geography`;
}

/** Evenly thins a polyline to at most `max` vertices, always keeping both ends. */
export function thinLine(line: readonly LngLat[], max = MAX_CORRIDOR_VERTICES): LngLat[] {
  if (line.length <= max) return [...line];
  const step = (line.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => line[Math.round(i * step)]).filter(
    (p): p is LngLat => p !== undefined,
  );
}

/** A route line as a geography, sent as one WKT parameter (coordinates validated first). */
function lineString(line: readonly LngLat[]): SQL {
  if (line.length < 2) throw new RangeError("A corridor needs at least two points");
  const wkt = thinLine(line)
    .map((p) => {
      assertLngLat(p);
      return `${p.lng.toFixed(6)} ${p.lat.toFixed(6)}`;
    })
    .join(",");
  return sql`ST_GeogFromText(${`SRID=4326;LINESTRING(${wkt})`})`;
}

function envelope(box: BoundingBox, column: SQL): SQL {
  const one = (west: number, east: number) =>
    sql`(${column})::geometry && ST_MakeEnvelope(${west}::float8, ${box.south}::float8, ${east}::float8, ${box.north}::float8, 4326)`;
  // A viewport crossing the antimeridian is two envelopes.
  return box.west <= box.east
    ? one(box.west, box.east)
    : sql`(${one(box.west, 180)} OR ${one(-180, box.east)})`;
}

/** The search statement (exported so tests can EXPLAIN exactly what runs). */
export function buildSearchQuery(params: ProviderSearchParams): SQL {
  const location = params.precise ? sql.raw("e.location") : sql.raw("e.approx_location");
  const area = params.area;
  // What distance and coverage are measured against: the point, the map centre, or the route.
  const target =
    area.kind === "near"
      ? point(area.point)
      : area.kind === "bbox"
        ? point(area.origin)
        : lineString(area.line);
  const at = params.at.toISOString();
  const terms = searchTerms(params.text);
  const tsquery = terms.length
    ? sql`to_tsquery('simple', ${terms.map((t) => `${t}:*`).join(" & ")})`
    : null;

  const where: SQL[] = [sql`o.status = 'active'`];
  if (area.kind === "near") {
    const { radiusMeters, coversLocationOnly } = area;
    where.push(
      coversLocationOnly
        ? sql`ST_DWithin(${location}, ${target}, ${MAX_SERVICE_RADIUS_METERS}::float8)
              AND e.service_radius_km IS NOT NULL
              AND ST_DWithin(${location}, ${target}, e.service_radius_km * 1000)`
        : sql`ST_DWithin(${location}, ${target}, ${radiusMeters}::float8)`,
    );
  } else if (area.kind === "bbox") {
    where.push(envelope(area.box, location));
  } else {
    where.push(sql`ST_DWithin(${location}, ${target}, ${area.widthMeters}::float8)`);
  }
  if (params.categories?.length) {
    where.push(
      sql`e.categories && ${sql`ARRAY[${sql.join(
        params.categories.map((c) => sql`${c}`),
        sql`, `,
      )}]::text[]`}`,
    );
  }
  if (params.vehicleType) {
    where.push(sql`e.vehicle_types @> ARRAY[${params.vehicleType}]::text[]`);
  }
  for (const badgeType of params.verification ?? []) {
    where.push(sql`EXISTS (
      SELECT 1 FROM verification_badges vb
      WHERE vb.organization_id = e.organization_id AND vb.badge_type = ${badgeType}
        AND vb.ended_at IS NULL AND vb.expires_at > ${at}::timestamptz)`);
  }
  if (tsquery) where.push(sql`e.search_document @@ ${tsquery}`);

  const textScore = tsquery ? sql`least(ts_rank(e.search_document, ${tsquery}) * 10, 1)` : sql`0`;
  const base = sql`
    SELECT
      e.branch_id, e.organization_id, e.slug, e.trading_name, e.branch_name, e.locality,
      e.country_code, e.categories, e.vehicle_types, e.service_radius_km,
      ST_X((${location})::geometry) AS lng, ST_Y((${location})::geometry) AS lat,
      round(ST_Distance(${location}, ${target}))::int AS distance_m,
      (e.service_radius_km IS NOT NULL
        AND ST_DWithin(${location}, ${target}, e.service_radius_km * 1000)) AS covers,
      ${
        area.kind === "corridor"
          ? sql`ST_LineLocatePoint((${target})::geometry, (${location})::geometry)`
          : sql`NULL`
      }::float8 AS route_fraction,
      branch_is_open(e.branch_id, coalesce(b.time_zone, o.timezone), ${at}::timestamptz) AS open_now,
      ${textScore}::float8 AS text_score
    FROM provider_search_entries e
    JOIN organizations o ON o.id = e.organization_id
    JOIN branches b ON b.id = e.branch_id AND b.organization_id = e.organization_id
    WHERE ${sql.join(where, sql` AND `)}`;

  const w = Object.fromEntries(
    Object.entries(RANKING_WEIGHTS).map(([k, v]) => [k, sql.raw(v.toFixed(2))]),
  ) as Record<keyof typeof RANKING_WEIGHTS, SQL>;
  const halfDistance = sql.raw((DISTANCE_HALF_KM * 1000).toFixed(1));
  const outer: SQL[] = [];
  if (params.openNow) outer.push(sql`open_now`);
  if (params.after && area.kind !== "corridor") {
    const { score, distanceMeters, branchId } = params.after;
    outer.push(sql`(score < ${score}::numeric
      OR (score = ${score}::numeric AND distance_m > ${distanceMeters})
      OR (score = ${score}::numeric AND distance_m = ${distanceMeters} AND branch_id > ${branchId}::uuid))`);
  }
  const query = sql`
    WITH base AS (${base}),
    scored AS (
      SELECT base.*, round((
        ${w.text} * text_score
        + ${w.distance} * (1.0 / (1.0 + distance_m / ${halfDistance}))
        + ${w.coverage} * (CASE WHEN covers THEN 1 ELSE 0 END)
        + ${w.openNow} * (CASE WHEN open_now THEN 1 ELSE 0 END)
      )::numeric, 6) AS score
      FROM base
    )
    SELECT * FROM scored
    ${outer.length ? sql`WHERE ${sql.join(outer, sql` AND `)}` : sql``}
    ORDER BY ${
      area.kind === "corridor"
        ? sql`route_fraction ASC, distance_m ASC, branch_id ASC`
        : sql`score DESC, distance_m ASC, branch_id ASC`
    }
    LIMIT ${params.limit}::int`;
  return query;
}

export async function searchProviders(
  executor: Executor,
  params: ProviderSearchParams,
): Promise<ProviderSearchRow[]> {
  const query = buildSearchQuery(params);
  const rows = await queryRows<Record<string, unknown>>(executor, query);
  return rows.map((r) => ({
    branchId: String(r["branch_id"]),
    organizationId: String(r["organization_id"]),
    slug: String(r["slug"]),
    tradingName: String(r["trading_name"]),
    branchName: String(r["branch_name"]),
    locality: (r["locality"] as string | null) ?? null,
    countryCode: (r["country_code"] as string | null) ?? null,
    categories: r["categories"] as string[],
    vehicleTypes: r["vehicle_types"] as string[],
    lng: Number(r["lng"]),
    lat: Number(r["lat"]),
    serviceRadiusKm: r["service_radius_km"] === null ? null : Number(r["service_radius_km"]),
    distanceMeters: Number(r["distance_m"]),
    coversLocation: r["covers"] === true,
    openNow: r["open_now"] === true,
    textScore: Number(r["text_score"]),
    score: normalizeDecimal(String(r["score"])),
    routeFraction: r["route_fraction"] === null ? null : Number(r["route_fraction"]),
  }));
}

/** `0.350000` → `0.35` (drivers pad numerics to their scale). */
function normalizeDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") || "0" : value;
}

/** Rebuilds an organization's search rows from its published snapshot (or removes them). */
export async function refreshProviderSearch(
  executor: Executor,
  organizationId: string,
): Promise<void> {
  await executor.execute(sql`SELECT refresh_provider_search(${organizationId}::uuid)`);
}

/** Rows of a raw SQL statement (node-postgres and PGlite both return `{ rows }`). */
export async function queryRows<T>(executor: Executor, query: SQL): Promise<T[]> {
  const result: unknown = await executor.execute(query);
  return (result as { rows: T[] }).rows;
}

import { type AnyColumn, type SQL, sql } from "drizzle-orm";

import { assertLngLat, type LngLat } from "./schema/columns.js";

/** A WGS 84 point as a PostGIS geography value. */
export function geographyOf(point: LngLat): SQL {
  assertLngLat(point);
  return sql`ST_SetSRID(ST_MakePoint(${point.lng}, ${point.lat}), 4326)::geography`;
}

/** Index-assisted radius filter (uses a GiST index on the geography column). */
export function withinMeters(column: AnyColumn, point: LngLat, meters: number): SQL<boolean> {
  if (!Number.isFinite(meters) || meters < 0) {
    throw new RangeError(`Radius must be a non-negative number of metres, got ${String(meters)}`);
  }
  return sql<boolean>`ST_DWithin(${column}, ${geographyOf(point)}, ${meters})`;
}

/** Spheroid distance in metres, for ordering and display. */
export function distanceMeters(column: AnyColumn, point: LngLat): SQL<number> {
  return sql<number>`ST_Distance(${column}, ${geographyOf(point)})`.mapWith(Number);
}

/** Rows whose point lies inside a map viewport (west/south/east/north in degrees). */
export function withinBoundingBox(
  column: AnyColumn,
  box: { west: number; south: number; east: number; north: number },
): SQL<boolean> {
  assertLngLat({ lng: box.west, lat: box.south });
  assertLngLat({ lng: box.east, lat: box.north });
  if (box.south > box.north) throw new RangeError("Bounding box south must be <= north");
  if (box.west > box.east) {
    // A viewport crossing the antimeridian needs splitting into two envelopes; not needed yet.
    throw new RangeError(
      "Bounding boxes crossing the antimeridian (west > east) are not supported",
    );
  }
  return sql<boolean>`${column} && ST_MakeEnvelope(${box.west}, ${box.south}, ${box.east}, ${box.north}, 4326)::geography`;
}

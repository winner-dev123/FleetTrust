import { sql } from "drizzle-orm";
import { customType, timestamp, uuid } from "drizzle-orm/pg-core";
import { parseEWKB } from "drizzle-orm/pg-core/columns/postgis_extension/utils";
import { uuidv7 } from "uuidv7";

/**
 * Primary key: UUID. The application generates time-ordered UUIDv7 values (better B-tree
 * locality than v4). `gen_random_uuid()` is only a fallback for rows inserted by raw SQL.
 * Postgres 17's lack of a built-in uuidv7() is why the app generates them (docs/architecture/data-conventions.md).
 */
export const id = () =>
  uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`)
    .$defaultFn(() => uuidv7());

/** `created_at` / `updated_at`, both timestamptz. `updated_at` is maintained by the set_updated_at() trigger. */
export const timestamps = () => ({
  createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
});

/** Soft-delete marker. Only for entities with a documented retention reason (see data conventions). */
export const deletedAt = () => timestamp("deleted_at", { withTimezone: true, mode: "date" });

/** WGS 84 longitude/latitude in degrees. */
export interface LngLat {
  lng: number;
  lat: number;
}

/**
 * PostGIS `geography(Point, 4326)`: distances and radii in metres on the spheroid.
 * Drizzle ships `geometry` only, so this is a small custom type.
 */
export const geographyPoint = customType<{ data: LngLat; driverData: string }>({
  dataType() {
    return "geography(Point, 4326)";
  },
  toDriver(value) {
    assertLngLat(value);
    return sql`ST_SetSRID(ST_MakePoint(${value.lng}, ${value.lat}), 4326)::geography`;
  },
  fromDriver(value) {
    const [lng, lat] = parseEWKB(value);
    return { lng, lat };
  },
});

/** Rejects coordinates outside WGS 84 ranges, and the common lat/lng swap where it's detectable. */
export function assertLngLat(value: LngLat): void {
  const { lng, lat } = value;
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    throw new RangeError(`Longitude must be between -180 and 180, got ${String(lng)}`);
  }
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new RangeError(`Latitude must be between -90 and 90, got ${String(lat)}`);
  }
}

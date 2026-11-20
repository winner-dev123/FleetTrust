import { sql } from "drizzle-orm";
import {
  customType,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

import { geographyPoint } from "./columns.js";
import { branches } from "./organizations.js";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

/**
 * Search projection (Prompt 12, ADR-0019): one row per published branch, derived only from the
 * published snapshot by `refresh_provider_search(org)`, so drafts can never be searched.
 * Rebuilt on publish and unpublish; rows cascade with their branch. Live signals (open now,
 * verification, organization status) are joined at query time.
 */
export const providerSearchEntries = pgTable(
  "provider_search_entries",
  {
    branchId: uuid("branch_id").primaryKey(),
    organizationId: uuid("organization_id").notNull(),
    slug: text("slug").notNull(),
    tradingName: text("trading_name").notNull(),
    branchName: text("branch_name").notNull(),
    locality: text("locality"),
    countryCode: text("country_code"),
    categories: text("categories").array().notNull(),
    vehicleTypes: text("vehicle_types").array().notNull(),
    /** Exact point: signed-in searches. */
    location: geographyPoint("location").notNull(),
    /** Rounded to 0.01° (about 1 km): every visitor computation uses only this (OQ-11). */
    approxLocation: geographyPoint("approx_location").notNull(),
    serviceRadiusKm: smallint("service_radius_km"),
    /** `simple` configuration: no language-specific stemming (jurisdiction-agnostic). */
    searchDocument: tsvector("search_document").notNull(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }).notNull(),
  },
  (t) => [
    foreignKey({
      name: "provider_search_entries_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    index("provider_search_entries_org_idx").on(t.organizationId),
    // Radius searches (geography) and viewport searches (geometry box) for both precisions.
    index("provider_search_entries_location_gist").using("gist", t.location),
    index("provider_search_entries_approx_gist").using("gist", t.approxLocation),
    index("provider_search_entries_location_geom_gist").using(
      "gist",
      sql`(${t.location}::geometry)`,
    ),
    index("provider_search_entries_approx_geom_gist").using(
      "gist",
      sql`(${t.approxLocation}::geometry)`,
    ),
    index("provider_search_entries_categories_gin").using("gin", t.categories),
    index("provider_search_entries_vehicle_types_gin").using("gin", t.vehicleTypes),
    index("provider_search_entries_document_gin").using("gin", t.searchDocument),
  ],
);

export type ProviderSearchEntry = typeof providerSearchEntries.$inferSelect;

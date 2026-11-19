import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/**
 * Provider profiles (SRS J4, F-030..F-032). One per provider organization. The draft columns
 * are edited freely (save and resume); publishing validates them and freezes a snapshot,
 * which is all the public ever sees.
 */
export const providerProfiles = pgTable(
  "provider_profiles",
  {
    organizationId: uuid("organization_id").primaryKey(),
    /** Always 'provider': carried into the composite FK so fleets can't have a profile. */
    organizationKind: text("organization_kind", { enum: ["provider"] })
      .notNull()
      .default("provider"),
    /** Public URL handle, e.g. `rapid-repairs-cape-town`. */
    slug: text("slug"),
    legalName: text("legal_name"),
    tradingName: text("trading_name"),
    description: text("description"),
    categories: text("categories")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    vehicleTypes: text("vehicle_types")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    /** Category-dependent fields, keyed by category (validated by the API). */
    categoryDetails: jsonb("category_details")
      .$type<Record<string, Record<string, unknown>>>()
      .notNull()
      .default({}),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    website: text("website"),
    status: text("status", { enum: ["draft", "published", "hidden"] })
      .notNull()
      .default("draft"),
    /** The public profile, frozen at publication. */
    publishedSnapshot: jsonb("published_snapshot").$type<Record<string, unknown>>(),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    publishedBy: uuid("published_by").references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "provider_profiles_organization_fk",
      columns: [t.organizationId, t.organizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    uniqueIndex("provider_profiles_slug_key").on(t.slug),
    check("provider_profiles_kind", sql`${t.organizationKind} = 'provider'`),
    check(
      "provider_profiles_slug_format",
      sql`${t.slug} IS NULL OR ${t.slug} ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'`,
    ),
    check("provider_profiles_status_valid", sql`${t.status} IN ('draft', 'published', 'hidden')`),
    check(
      "provider_profiles_published_consistent",
      sql`${t.status} <> 'published' OR (${t.publishedSnapshot} IS NOT NULL AND ${t.publishedAt} IS NOT NULL AND ${t.slug} IS NOT NULL)`,
    ),
    check(
      "provider_profiles_text_lengths",
      sql`(${t.legalName} IS NULL OR char_length(${t.legalName}) <= 200) AND
          (${t.tradingName} IS NULL OR char_length(${t.tradingName}) <= 120) AND
          (${t.description} IS NULL OR char_length(${t.description}) <= 2000)`,
    ),
  ],
);

export const MEDIA_KINDS = ["logo", "cover", "gallery"] as const;

/** Public images for a provider profile, after scanning and metadata stripping. */
export const providerMedia = pgTable(
  "provider_media",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: MEDIA_KINDS }).notNull(),
    status: text("status", { enum: ["pending_upload", "available", "rejected", "removed"] })
      .notNull()
      .default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    size: integer("size"),
    altText: text("alt_text"),
    sortOrder: smallint("sort_order").notNull().default(0),
    rejectionReason: text("rejection_reason"),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("provider_media_org_idx").on(t.organizationId, t.kind, t.sortOrder),
    check("provider_media_kind_valid", sql`${t.kind} IN ('logo', 'cover', 'gallery')`),
    check(
      "provider_media_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected', 'removed')`,
    ),
    check(
      "provider_media_size_range",
      sql`${t.declaredSize} BETWEEN 1 AND 5242880 AND (${t.size} IS NULL OR ${t.size} BETWEEN 1 AND 5242880)`,
    ),
    check(
      "provider_media_available_complete",
      sql`${t.status} <> 'available' OR (${t.storageKey} IS NOT NULL AND ${t.availableAt} IS NOT NULL)`,
    ),
    check(
      "provider_media_alt_length",
      sql`${t.altText} IS NULL OR char_length(${t.altText}) <= 200`,
    ),
  ],
);

export type ProviderProfile = typeof providerProfiles.$inferSelect;
export type ProviderMedia = typeof providerMedia.$inferSelect;

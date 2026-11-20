import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  foreignKey,
  index,
  jsonb,
  numeric,
  pgTable,
  primaryKey,
  smallint,
  text,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { currencies } from "./currencies.js";
import { branches } from "./organizations.js";
import { providerProfiles } from "./provider-profiles.js";

const CATEGORY_LIST = sql.raw(
  "'workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic'",
);

/**
 * Service offerings with indicative prices (SRS F-033, F-034). Part of the provider's draft:
 * the public sees them only through the published snapshot. Amounts are exact decimals in the
 * offering's currency; they are guidance, never a payable amount (no checkout, FR-07).
 */
export const providerOfferings = pgTable(
  "provider_offerings",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "restrict" }),
    category: text("category").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    /** Vehicle compatibility. */
    vehicleTypes: text("vehicle_types").array().notNull(),
    serviceLocation: text("service_location", { enum: ["at_premises", "at_customer"] })
      .notNull()
      .default("at_premises"),
    priceType: text("price_type", { enum: ["fixed", "from", "range", "quote_required"] }).notNull(),
    currency: char("currency", { length: 3 }).references(() => currencies.code, {
      onDelete: "restrict",
    }),
    /** fixed/from: the amount; range: the minimum. */
    priceAmount: numeric("price_amount", { precision: 14, scale: 4 }),
    priceMax: numeric("price_max", { precision: 14, scale: 4 }),
    priceUnit: text("price_unit"),
    sortOrder: smallint("sort_order").notNull().default(0),
    ...timestamps(),
  },
  (t) => [
    index("provider_offerings_org_idx").on(t.organizationId, t.sortOrder),
    unique("provider_offerings_id_organization_key").on(t.id, t.organizationId),
    check("provider_offerings_category_valid", sql`${t.category} IN (${CATEGORY_LIST})`),
    check("provider_offerings_name_length", sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    check(
      "provider_offerings_description_length",
      sql`${t.description} IS NULL OR char_length(${t.description}) <= 1000`,
    ),
    check("provider_offerings_vehicle_types", sql`cardinality(${t.vehicleTypes}) >= 1`),
    check(
      "provider_offerings_service_location_valid",
      sql`${t.serviceLocation} IN ('at_premises', 'at_customer')`,
    ),
    check(
      "provider_offerings_price_unit_valid",
      sql`${t.priceUnit} IS NULL OR ${t.priceUnit} IN ('job', 'hour', 'day', 'night', 'km', 'litre', 'kwh', 'item', 'tyre', 'vehicle')`,
    ),
    // Each price type has exactly its own fields.
    check(
      "provider_offerings_price_shape",
      sql`(${t.priceType} IN ('fixed', 'from') AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'range' AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} > ${t.priceAmount} AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'quote_required' AND ${t.currency} IS NULL AND ${t.priceAmount} IS NULL AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NULL)`,
    ),
    check("provider_offerings_sort_order_range", sql`${t.sortOrder} BETWEEN 0 AND 999`),
  ],
);

/** Branches an offering is limited to. No rows = every branch. Same-tenant by composite FKs. */
export const providerOfferingBranches = pgTable(
  "provider_offering_branches",
  {
    offeringId: uuid("offering_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.offeringId, t.branchId] }),
    foreignKey({
      name: "provider_offering_branches_offering_fk",
      columns: [t.offeringId, t.organizationId],
      foreignColumns: [providerOfferings.id, providerOfferings.organizationId],
    }).onDelete("cascade"),
    foreignKey({
      name: "provider_offering_branches_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    index("provider_offering_branches_org_idx").on(t.organizationId, t.branchId),
    index("provider_offering_branches_branch_idx").on(t.branchId),
  ],
);

/**
 * Weekly opening hours (SRS F-035), in minutes after local midnight in the branch's timezone.
 * `closes_minute` above 1440 runs into the next day (22:00–06:00 = 1320–1800). Live data:
 * public views read it directly so changes and closures show at once.
 */
export const branchOpeningHours = pgTable(
  "branch_opening_hours",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint("weekday").notNull(),
    opensMinute: smallint("opens_minute").notNull(),
    closesMinute: smallint("closes_minute").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "branch_opening_hours_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    index("branch_opening_hours_org_idx").on(t.organizationId, t.branchId),
    index("branch_opening_hours_branch_idx").on(t.branchId, t.weekday),
    check("branch_opening_hours_weekday_range", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("branch_opening_hours_opens_range", sql`${t.opensMinute} BETWEEN 0 AND 1439`),
    check(
      "branch_opening_hours_closes_range",
      sql`${t.closesMinute} > ${t.opensMinute} AND ${t.closesMinute} - ${t.opensMinute} <= 1440`,
    ),
  ],
);

/** Holidays and special days. Replaces that local date's weekly hours. */
export const branchHoursExceptions = pgTable(
  "branch_hours_exceptions",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    /** Local calendar date in the branch's timezone. */
    date: date("date", { mode: "string" }).notNull(),
    closed: boolean("closed").notNull(),
    /** `[{ opens: "10:00", closes: "14:00" }]` when open with special hours. */
    intervals: jsonb("intervals")
      .$type<{ opens: string; closes: string }[]>()
      .notNull()
      .default([]),
    label: text("label"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "branch_hours_exceptions_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    index("branch_hours_exceptions_org_idx").on(t.organizationId, t.branchId),
    uniqueIndex("branch_hours_exceptions_branch_date_key").on(t.branchId, t.date),
    check(
      "branch_hours_exceptions_shape",
      sql`(${t.closed} AND jsonb_array_length(${t.intervals}) = 0) OR (NOT ${t.closed} AND jsonb_array_length(${t.intervals}) BETWEEN 1 AND 4)`,
    ),
    check(
      "branch_hours_exceptions_label_length",
      sql`${t.label} IS NULL OR char_length(${t.label}) <= 80`,
    ),
  ],
);

export type ProviderOffering = typeof providerOfferings.$inferSelect;
export type BranchOpeningHours = typeof branchOpeningHours.$inferSelect;
export type BranchHoursException = typeof branchHoursExceptions.$inferSelect;

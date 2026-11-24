import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  foreignKey,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { currencies } from "./currencies.js";
import { branches, organizations } from "./organizations.js";
import { providerProfiles } from "./provider-profiles.js";
import { serviceRequestRecipients, serviceRequests } from "./requests.js";
import { users } from "./users.js";

export const PART_CATEGORY_VALUES = [
  "engine",
  "brakes",
  "suspension_steering",
  "electrical",
  "filters",
  "tyres_wheels",
  "body",
  "transmission",
  "cooling",
  "exhaust",
  "lighting",
  "fluids",
  "accessories",
  "other",
] as const;
export const PART_CONDITION_VALUES = ["new", "used", "refurbished"] as const;
export const STOCK_STATUS_VALUES = ["in_stock", "low_stock", "out_of_stock", "on_order"] as const;
export const PART_AVAILABILITY_VALUES = ["available", "not_available", "can_order"] as const;
export const PART_INQUIRY_STATUS_VALUES = ["open", "answered", "closed"] as const;
export const REFERRAL_RELATIONSHIP_VALUES = [
  "none",
  "partner",
  "same_owner",
  "referral_fee",
] as const;
export const REFERRAL_STATUS_VALUES = [
  "pending_consent",
  "consented",
  "declined",
  "withdrawn",
] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Parts listings (F-140, ADR-0028): live data, not part of the published snapshot, because
 * stock must be current. `stock_confirmed_at` is set by the server on every stock update; the
 * API labels stock by its age. Prices are indicative only (no checkout, FR-07).
 */
export const parts = pgTable(
  "parts",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "restrict" }),
    /** Where the stock is held; null = the whole organization. */
    branchId: uuid("branch_id"),
    name: text("name").notNull(),
    brand: text("brand"),
    partNumber: text("part_number"),
    /** Upper-case letters and digits only: what part number searches compare. */
    partNumberNormalized: text("part_number_normalized"),
    category: text("category", { enum: PART_CATEGORY_VALUES }).notNull(),
    condition: text("condition", { enum: PART_CONDITION_VALUES }).notNull(),
    description: text("description"),
    priceType: text("price_type", { enum: ["fixed", "from", "range", "quote_required"] }).notNull(),
    currency: char("currency", { length: 3 }).references(() => currencies.code, {
      onDelete: "restrict",
    }),
    priceAmount: numeric("price_amount", { precision: 14, scale: 4 }),
    priceMax: numeric("price_max", { precision: 14, scale: 4 }),
    priceUnit: text("price_unit"),
    stockStatus: text("stock_status", { enum: STOCK_STATUS_VALUES }).notNull(),
    stockQuantity: integer("stock_quantity"),
    stockConfirmedAt: timestamp("stock_confirmed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    stockConfirmedBy: uuid("stock_confirmed_by").references(() => users.id, {
      onDelete: "set null",
    }),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    // Stock at a branch goes with the branch.
    foreignKey({
      name: "parts_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    unique("parts_id_organization_key").on(t.id, t.organizationId),
    index("parts_org_idx").on(t.organizationId, t.status, t.updatedAt.desc()),
    index("parts_part_number_idx").on(t.partNumberNormalized),
    index("parts_category_idx").on(t.category, t.stockConfirmedAt.desc()),
    check("parts_category_valid", sql`${t.category} IN (${list(PART_CATEGORY_VALUES)})`),
    check("parts_condition_valid", sql`${t.condition} IN (${list(PART_CONDITION_VALUES)})`),
    check("parts_stock_status_valid", sql`${t.stockStatus} IN (${list(STOCK_STATUS_VALUES)})`),
    check("parts_status_valid", sql`${t.status} IN ('active', 'archived')`),
    check("parts_name_length", sql`char_length(${t.name}) BETWEEN 2 AND 120`),
    check("parts_brand_length", sql`${t.brand} IS NULL OR char_length(${t.brand}) <= 60`),
    check(
      "parts_part_number_shape",
      sql`(${t.partNumber} IS NULL AND ${t.partNumberNormalized} IS NULL)
       OR (${t.partNumber} IS NOT NULL AND ${t.partNumberNormalized} IS NOT NULL AND char_length(${t.partNumber}) BETWEEN 2 AND 40 AND ${t.partNumberNormalized} ~ '^[A-Z0-9]+$')`,
    ),
    check(
      "parts_description_length",
      sql`${t.description} IS NULL OR char_length(${t.description}) <= 1000`,
    ),
    check(
      "parts_stock_quantity",
      sql`${t.stockQuantity} IS NULL OR (${t.stockQuantity} >= 0 AND ${t.stockStatus} IN ('in_stock', 'low_stock'))`,
    ),
    check(
      "parts_price_unit_valid",
      sql`${t.priceUnit} IS NULL OR ${t.priceUnit} IN ('job', 'hour', 'day', 'night', 'km', 'litre', 'kwh', 'item', 'tyre', 'vehicle')`,
    ),
    check(
      "parts_price_shape",
      sql`(${t.priceType} IN ('fixed', 'from') AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'range' AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} > ${t.priceAmount} AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'quote_required' AND ${t.currency} IS NULL AND ${t.priceAmount} IS NULL AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NULL)`,
    ),
  ],
);

/** Compatible vehicle ranges of a part. No rows = no compatibility data. */
export const partCompatibility = pgTable(
  "part_compatibility",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    partId: uuid("part_id").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    make: text("make"),
    model: text("model"),
    yearFrom: smallint("year_from"),
    yearTo: smallint("year_to"),
  },
  (t) => [
    foreignKey({
      name: "part_compatibility_part_fk",
      columns: [t.partId, t.organizationId],
      foreignColumns: [parts.id, parts.organizationId],
    }).onDelete("cascade"),
    index("part_compatibility_org_idx").on(t.organizationId, t.partId),
    index("part_compatibility_part_idx").on(t.partId),
    index("part_compatibility_vehicle_idx").on(t.vehicleType, sql`lower(${t.make})`),
    check("part_compatibility_model_needs_make", sql`${t.model} IS NULL OR ${t.make} IS NOT NULL`),
    check(
      "part_compatibility_years",
      sql`(${t.yearFrom} IS NULL OR ${t.yearFrom} BETWEEN 1900 AND 2100)
       AND (${t.yearTo} IS NULL OR ${t.yearTo} BETWEEN 1900 AND 2100)
       AND (${t.yearFrom} IS NULL OR ${t.yearTo} IS NULL OR ${t.yearFrom} <= ${t.yearTo})`,
    ),
  ],
);

/**
 * Availability inquiries (F-141): "do you have this part?" from a person or a fleet. No price,
 * hold or payment columns exist: an answer is information only. The part's name and number are
 * copied so the inquiry still reads correctly if the listing changes or is deleted.
 */
export const partInquiries = pgTable(
  "part_inquiries",
  {
    id: id(),
    /** The provider asked. */
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "restrict" }),
    partId: uuid("part_id").references(() => parts.id, { onDelete: "set null" }),
    /** The part's branch when asked (branch-scoped staff see their branch's inquiries). */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    requesterUserId: uuid("requester_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    requesterOrganizationId: uuid("requester_organization_id"),
    requesterOrganizationKind: text("requester_organization_kind", { enum: ["fleet"] }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    partName: text("part_name").notNull(),
    partNumber: text("part_number"),
    quantity: smallint("quantity").notNull().default(1),
    message: text("message"),
    vehicleType: text("vehicle_type"),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleYear: smallint("vehicle_year"),
    status: text("status", { enum: PART_INQUIRY_STATUS_VALUES }).notNull().default("open"),
    availability: text("availability", { enum: PART_AVAILABILITY_VALUES }),
    quantityAvailable: integer("quantity_available"),
    etaDays: smallint("eta_days"),
    answerMessage: text("answer_message"),
    answeredAt: timestamp("answered_at", { withTimezone: true, mode: "date" }),
    answeredBy: uuid("answered_by").references(() => users.id, { onDelete: "set null" }),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "part_inquiries_requester_org_fk",
      columns: [t.requesterOrganizationId, t.requesterOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    index("part_inquiries_org_idx").on(t.organizationId, t.createdAt.desc()),
    index("part_inquiries_requester_user_idx").on(t.requesterUserId, t.createdAt.desc()),
    index("part_inquiries_requester_org_idx").on(t.requesterOrganizationId, t.createdAt.desc()),
    index("part_inquiries_part_idx").on(t.partId),
    // One open question per person per part.
    uniqueIndex("part_inquiries_one_open")
      .on(t.partId, t.createdBy)
      .where(sql`${t.status} = 'open'`),
    check(
      "part_inquiries_requester",
      sql`(${t.requesterUserId} IS NOT NULL AND ${t.requesterOrganizationId} IS NULL AND ${t.requesterOrganizationKind} IS NULL)
       OR (${t.requesterUserId} IS NULL AND ${t.requesterOrganizationId} IS NOT NULL AND ${t.requesterOrganizationKind} = 'fleet')`,
    ),
    check("part_inquiries_status_valid", sql`${t.status} IN (${list(PART_INQUIRY_STATUS_VALUES)})`),
    check("part_inquiries_quantity", sql`${t.quantity} BETWEEN 1 AND 999`),
    check(
      "part_inquiries_message_length",
      sql`${t.message} IS NULL OR char_length(${t.message}) <= 1000`,
    ),
    check(
      "part_inquiries_answer_shape",
      sql`(${t.availability} IS NULL AND ${t.answeredAt} IS NULL AND ${t.answerMessage} IS NULL AND ${t.quantityAvailable} IS NULL AND ${t.etaDays} IS NULL)
       OR (${t.availability} IN (${list(PART_AVAILABILITY_VALUES)}) AND ${t.answeredAt} IS NOT NULL
           AND (${t.etaDays} IS NULL OR (${t.availability} = 'can_order' AND ${t.etaDays} BETWEEN 1 AND 90))
           AND (${t.quantityAvailable} IS NULL OR (${t.availability} = 'available' AND ${t.quantityAvailable} > 0))
           AND (${t.answerMessage} IS NULL OR char_length(${t.answerMessage}) <= 1000))`,
    ),
    check(
      "part_inquiries_answered_consistent",
      sql`${t.status} <> 'answered' OR ${t.answeredAt} IS NOT NULL`,
    ),
  ],
);

/**
 * Provider-to-provider referrals (F-142, AB-17, ADR-0028). The referring provider's inquiry
 * (`from_recipient_id`) suggests another provider for the same request. The receiver gets an
 * inquiry (`recipient_id`) only after the customer consents. The disclosure the customer saw
 * (message and relationship) can't change after creation, and decisions can't be undone:
 * a trigger enforces both (migration 0034).
 */
export const providerReferrals = pgTable(
  "provider_referrals",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    fromOrganizationId: uuid("from_organization_id").notNull(),
    fromRecipientId: uuid("from_recipient_id").notNull(),
    toOrganizationId: uuid("to_organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "restrict" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    message: text("message").notNull(),
    relationship: text("relationship", { enum: REFERRAL_RELATIONSHIP_VALUES }).notNull(),
    relationshipDetails: text("relationship_details"),
    status: text("status", { enum: REFERRAL_STATUS_VALUES }).notNull().default("pending_consent"),
    sharePhotos: boolean("share_photos").notNull().default(false),
    shareOutcome: boolean("share_outcome").notNull().default(false),
    /** The exact text the customer agreed to, and its version. */
    consentText: text("consent_text"),
    consentVersion: smallint("consent_version"),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    /** The receiver's inquiry, created on consent. */
    recipientId: uuid("recipient_id").references(() => serviceRequestRecipients.id, {
      onDelete: "set null",
    }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "provider_referrals_from_recipient_fk",
      columns: [t.fromRecipientId, t.fromOrganizationId],
      foreignColumns: [serviceRequestRecipients.id, serviceRequestRecipients.organizationId],
    }).onDelete("cascade"),
    index("provider_referrals_from_idx").on(t.fromOrganizationId, t.createdAt.desc()),
    index("provider_referrals_to_idx").on(t.toOrganizationId, t.createdAt.desc()),
    index("provider_referrals_request_idx").on(t.requestId),
    index("provider_referrals_from_recipient_idx").on(t.fromRecipientId),
    uniqueIndex("provider_referrals_recipient_key").on(t.recipientId),
    // One open referral to the same provider per request.
    uniqueIndex("provider_referrals_open_key")
      .on(t.requestId, t.toOrganizationId)
      .where(sql`${t.status} IN ('pending_consent', 'consented')`),
    check("provider_referrals_status_valid", sql`${t.status} IN (${list(REFERRAL_STATUS_VALUES)})`),
    check(
      "provider_referrals_relationship_valid",
      sql`${t.relationship} IN (${list(REFERRAL_RELATIONSHIP_VALUES)})`,
    ),
    check("provider_referrals_not_self", sql`${t.fromOrganizationId} <> ${t.toOrganizationId}`),
    check("provider_referrals_message_length", sql`char_length(${t.message}) BETWEEN 10 AND 1000`),
    // A relationship other than "none" must be described (AB-17: no undisclosed kickbacks).
    check(
      "provider_referrals_disclosure",
      sql`(${t.relationship} = 'none' AND ${t.relationshipDetails} IS NULL)
       OR (${t.relationship} <> 'none' AND ${t.relationshipDetails} IS NOT NULL AND char_length(${t.relationshipDetails}) BETWEEN 3 AND 300)`,
    ),
    check(
      "provider_referrals_decision_shape",
      sql`(${t.status} = 'pending_consent' AND ${t.decidedAt} IS NULL AND ${t.consentText} IS NULL AND ${t.recipientId} IS NULL)
       OR (${t.status} = 'consented' AND ${t.decidedAt} IS NOT NULL AND ${t.consentText} IS NOT NULL AND ${t.consentVersion} IS NOT NULL)
       OR (${t.status} IN ('declined', 'withdrawn') AND ${t.decidedAt} IS NOT NULL AND ${t.consentText} IS NULL AND ${t.recipientId} IS NULL)`,
    ),
  ],
);

export type Part = typeof parts.$inferSelect;
export type PartCompatibility = typeof partCompatibility.$inferSelect;
export type PartInquiry = typeof partInquiries.$inferSelect;
export type ProviderReferral = typeof providerReferrals.$inferSelect;

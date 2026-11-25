import { sql } from "drizzle-orm";
import {
  char,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { geographyPoint, id, timestamps } from "./columns.js";
import { currencies } from "./currencies.js";
import { branches, organizations } from "./organizations.js";
import { providerProfiles } from "./provider-profiles.js";
import { users } from "./users.js";
import { vehicles } from "./vehicles.js";

const CATEGORY_LIST = sql.raw(
  "'workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic'",
);

/**
 * Service requests (SRS J2, F-050..F-052, ADR-0021). Raised by an individual (requester_user_id)
 * or by a fleet (requester_organization_id, kind 'fleet'); `created_by` is always the person.
 * No money columns exist beyond the informational quote price.
 */
export const serviceRequests = pgTable(
  "service_requests",
  {
    id: id(),
    requesterUserId: uuid("requester_user_id").references(() => users.id, { onDelete: "restrict" }),
    requesterOrganizationId: uuid("requester_organization_id"),
    /** Always 'fleet' when set: carried into the composite FK so providers can't raise requests. */
    requesterOrganizationKind: text("requester_organization_kind", { enum: ["fleet"] }),
    fleetBranchId: uuid("fleet_branch_id"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Client-generated retry key, unique per requester. */
    clientRequestId: uuid("client_request_id").notNull(),
    category: text("category").notNull(),
    vehicleType: text("vehicle_type").notNull(),
    vehicleMake: text("vehicle_make"),
    vehicleModel: text("vehicle_model"),
    vehicleYear: smallint("vehicle_year"),
    vehicleRegistration: text("vehicle_registration"),
    /** Linked vehicle (Prompt 19); the snapshot columns keep what was sent. */
    vehicleId: uuid("vehicle_id").references(() => vehicles.id, { onDelete: "set null" }),
    location: geographyPoint("location").notNull(),
    locationNote: text("location_note"),
    description: text("description").notNull(),
    urgency: text("urgency", { enum: ["routine", "soon", "urgent"] }).notNull(),
    neededBy: timestamp("needed_by", { withTimezone: true, mode: "date" }),
    status: text("status", { enum: ["open", "accepted", "completed", "cancelled"] })
      .notNull()
      .default("open"),
    acceptedQuoteId: uuid("accepted_quote_id"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "service_requests_requester_org_fk",
      columns: [t.requesterOrganizationId, t.requesterOrganizationKind],
      foreignColumns: [organizations.id, organizations.kind],
    }).onDelete("restrict"),
    foreignKey({
      name: "service_requests_fleet_branch_fk",
      columns: [t.fleetBranchId, t.requesterOrganizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("set null"),
    index("service_requests_user_idx").on(t.requesterUserId, t.createdAt.desc()),
    index("service_requests_organization_idx").on(t.requesterOrganizationId, t.createdAt.desc()),
    uniqueIndex("service_requests_user_client_key")
      .on(t.requesterUserId, t.clientRequestId)
      .where(sql`${t.requesterOrganizationId} IS NULL`),
    uniqueIndex("service_requests_org_client_key")
      .on(t.requesterOrganizationId, t.clientRequestId)
      .where(sql`${t.requesterOrganizationId} IS NOT NULL`),
    check(
      "service_requests_requester",
      sql`(${t.requesterUserId} IS NOT NULL AND ${t.requesterOrganizationId} IS NULL AND ${t.requesterOrganizationKind} IS NULL AND ${t.fleetBranchId} IS NULL)
       OR (${t.requesterUserId} IS NULL AND ${t.requesterOrganizationId} IS NOT NULL AND ${t.requesterOrganizationKind} = 'fleet')`,
    ),
    check("service_requests_category_valid", sql`${t.category} IN (${CATEGORY_LIST})`),
    check(
      "service_requests_status_valid",
      sql`${t.status} IN ('open', 'accepted', 'completed', 'cancelled')`,
    ),
    check("service_requests_urgency_valid", sql`${t.urgency} IN ('routine', 'soon', 'urgent')`),
    check(
      "service_requests_description_length",
      sql`char_length(${t.description}) BETWEEN 10 AND 2000`,
    ),
    check(
      "service_requests_accepted_consistent",
      sql`(${t.status} IN ('accepted', 'completed')) = (${t.acceptedQuoteId} IS NOT NULL)`,
    ),
  ],
);

/**
 * A provider a request was sent to. Its ID is the anchor for the request's conversation thread
 * (messaging, Prompt 17).
 */
export const serviceRequestRecipients = pgTable(
  "service_request_recipients",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => providerProfiles.organizationId, { onDelete: "restrict" }),
    /** The provider branch it was routed to (nearest published branch); null = whole org. */
    branchId: uuid("branch_id"),
    status: text("status", {
      enum: ["pending", "viewed", "quoted", "declined", "accepted", "not_selected", "cancelled"],
    })
      .notNull()
      .default("pending"),
    distanceMeters: integer("distance_meters"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "service_request_recipients_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("set null"),
    unique("service_request_recipients_request_org_key").on(t.requestId, t.organizationId),
    unique("service_request_recipients_id_org_key").on(t.id, t.organizationId),
    index("service_request_recipients_org_idx").on(t.organizationId, t.createdAt.desc()),
    check(
      "service_request_recipients_status_valid",
      sql`${t.status} IN ('pending', 'viewed', 'quoted', 'declined', 'accepted', 'not_selected', 'cancelled')`,
    ),
  ],
);

/** Informational quotes. Revising creates a new row and supersedes the previous one. */
export const serviceQuotes = pgTable(
  "service_quotes",
  {
    id: id(),
    recipientId: uuid("recipient_id").notNull(),
    organizationId: uuid("organization_id").notNull(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    priceType: text("price_type", { enum: ["fixed", "from", "range", "quote_required"] }).notNull(),
    currency: char("currency", { length: 3 }).references(() => currencies.code, {
      onDelete: "restrict",
    }),
    priceAmount: numeric("price_amount", { precision: 14, scale: 4 }),
    priceMax: numeric("price_max", { precision: 14, scale: 4 }),
    priceUnit: text("price_unit"),
    message: text("message"),
    availableFrom: timestamp("available_from", { withTimezone: true, mode: "date" }),
    validUntil: timestamp("valid_until", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status", {
      enum: ["active", "superseded", "withdrawn", "accepted", "not_selected"],
    })
      .notNull()
      .default("active"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "service_quotes_recipient_fk",
      columns: [t.recipientId, t.organizationId],
      foreignColumns: [serviceRequestRecipients.id, serviceRequestRecipients.organizationId],
    }).onDelete("cascade"),
    index("service_quotes_org_idx").on(t.organizationId),
    index("service_quotes_request_idx").on(t.requestId, t.createdAt),
    index("service_quotes_recipient_idx").on(t.recipientId, t.createdAt),
    // At most one live quote per provider per request.
    uniqueIndex("service_quotes_one_active")
      .on(t.recipientId)
      .where(sql`${t.status} IN ('active', 'accepted')`),
    check(
      "service_quotes_status_valid",
      sql`${t.status} IN ('active', 'superseded', 'withdrawn', 'accepted', 'not_selected')`,
    ),
    check(
      "service_quotes_price_shape",
      sql`(${t.priceType} IN ('fixed', 'from') AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'range' AND ${t.currency} IS NOT NULL AND ${t.priceAmount} > 0 AND ${t.priceMax} > ${t.priceAmount} AND ${t.priceUnit} IS NOT NULL)
       OR (${t.priceType} = 'quote_required' AND ${t.currency} IS NULL AND ${t.priceAmount} IS NULL AND ${t.priceMax} IS NULL AND ${t.priceUnit} IS NULL)`,
    ),
    check(
      "service_quotes_message_length",
      sql`${t.message} IS NULL OR char_length(${t.message}) <= 2000`,
    ),
  ],
);

/**
 * Private photos (request photos and evidence). Stored in the sensitive bucket after scanning
 * and metadata stripping; served only to the requester side and the request's recipients.
 */
export const serviceRequestAttachments = pgTable(
  "service_request_attachments",
  {
    id: id(),
    /** Null until the photo is attached to a request (uploaded before the request exists). */
    requestId: uuid("request_id").references(() => serviceRequests.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** The provider organization when a provider uploaded it (evidence); null for the requester. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    status: text("status", { enum: ["pending_upload", "available", "rejected"] })
      .notNull()
      .default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    rejectionReason: text("rejection_reason"),
    /** Envelope encryption (Prompt 27): per-file data key, wrapped by Cloud KMS when deployed. */
    wrappedKey: text("wrapped_key"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    keyId: text("key_id"),
    ...timestamps(),
  },
  (t) => [
    index("service_request_attachments_request_idx").on(t.requestId),
    index("service_request_attachments_org_idx").on(t.organizationId),
    index("service_request_attachments_uploader_idx").on(t.uploadedBy, t.createdAt),
    check(
      "service_request_attachments_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected')`,
    ),
    check("service_request_attachments_size", sql`${t.declaredSize} BETWEEN 1 AND 8388608`),
  ],
);

/**
 * Append-only history (status changes, quotes, evidence). The database refuses UPDATE and
 * DELETE (trigger), except the cascade when a whole request is purged.
 */
export const serviceRequestEvents = pgTable(
  "service_request_events",
  {
    id: id(),
    requestId: uuid("request_id")
      .notNull()
      .references(() => serviceRequests.id, { onDelete: "cascade" }),
    type: text("type").notNull(),
    actorSide: text("actor_side", { enum: ["requester", "provider", "system"] }).notNull(),
    actorUserId: uuid("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    /** The provider the event concerns; null = visible to every recipient. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    note: text("note"),
    attachmentIds: uuid("attachment_ids")
      .array()
      .notNull()
      .default(sql`'{}'::uuid[]`),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("service_request_events_request_idx").on(t.requestId, t.createdAt),
    index("service_request_events_org_idx").on(t.organizationId),
    check(
      "service_request_events_actor_valid",
      sql`${t.actorSide} IN ('requester', 'provider', 'system')`,
    ),
    check(
      "service_request_events_note_length",
      sql`${t.note} IS NULL OR char_length(${t.note}) <= 2000`,
    ),
  ],
);

export type ServiceRequest = typeof serviceRequests.$inferSelect;
export type ServiceRequestRecipient = typeof serviceRequestRecipients.$inferSelect;
export type ServiceQuote = typeof serviceQuotes.$inferSelect;
export type ServiceRequestAttachment = typeof serviceRequestAttachments.$inferSelect;
export type ServiceRequestEvent = typeof serviceRequestEvents.$inferSelect;

import { sql } from "drizzle-orm";
import {
  boolean,
  char,
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { branches, organizations } from "./organizations.js";
import { users } from "./users.js";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const SERVICE_RECORD_SOURCE_VALUES = [
  "owner",
  "fleet",
  "driver",
  "provider",
  "document",
] as const;
export const SERVICE_RECORD_CATEGORY_VALUES = [
  "service",
  "repair",
  "tyres",
  "inspection",
  "towing",
  "parts",
  "fuel",
  "other",
] as const;
export const SCHEDULE_KIND_VALUES = [
  "service",
  "inspection",
  "tyres",
  "licence_renewal",
  "other",
] as const;
export const VEHICLE_DOCUMENT_KIND_VALUES = [
  "registration",
  "insurance",
  "roadworthy",
  "permit",
  "invoice",
  "manual",
  "other",
] as const;

/**
 * Vehicles (F-070, ADR-0026), owned by a person or a fleet organization. Branch-scoped fleet
 * managers see their branch's vehicles; drivers see the vehicles assigned to them.
 */
export const vehicles = pgTable(
  "vehicles",
  {
    id: id(),
    ownerUserId: uuid("owner_user_id").references(() => users.id, { onDelete: "cascade" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    nickname: text("nickname"),
    vehicleType: text("vehicle_type").notNull(),
    make: text("make"),
    model: text("model"),
    year: smallint("year"),
    registration: text("registration"),
    vin: char("vin", { length: 17 }),
    odometerKm: integer("odometer_km"),
    odometerUpdatedAt: timestamp("odometer_updated_at", { withTimezone: true, mode: "date" }),
    status: text("status", { enum: ["active", "archived"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("vehicles_org_idx").on(t.organizationId, t.branchId),
    index("vehicles_owner_idx").on(t.ownerUserId),
    uniqueIndex("vehicles_org_registration_key")
      .on(t.organizationId, t.registration)
      .where(
        sql`${t.status} = 'active' AND ${t.registration} IS NOT NULL AND ${t.organizationId} IS NOT NULL`,
      ),
    uniqueIndex("vehicles_user_registration_key")
      .on(t.ownerUserId, t.registration)
      .where(
        sql`${t.status} = 'active' AND ${t.registration} IS NOT NULL AND ${t.ownerUserId} IS NOT NULL`,
      ),
    check("vehicles_one_owner", sql`(${t.ownerUserId} IS NULL) <> (${t.organizationId} IS NULL)`),
    check(
      "vehicles_branch_needs_org",
      sql`${t.branchId} IS NULL OR ${t.organizationId} IS NOT NULL`,
    ),
    check("vehicles_status_valid", sql`${t.status} IN ('active', 'archived')`),
    check("vehicles_odometer_non_negative", sql`${t.odometerKm} IS NULL OR ${t.odometerKm} >= 0`),
  ],
);

/** Driver assignment (F-071). At most one current driver per vehicle. */
export const vehicleAssignments = pgTable(
  "vehicle_assignments",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    assignedBy: uuid("assigned_by").references(() => users.id, { onDelete: "set null" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("vehicle_assignments_current_key")
      .on(t.vehicleId)
      .where(sql`${t.endsAt} IS NULL`),
    index("vehicle_assignments_user_idx")
      .on(t.userId)
      .where(sql`${t.endsAt} IS NULL`),
  ],
);

/**
 * Service history (F-072). The source is set by the API from who entered it. There is no
 * "verified" column: records are never labelled verified (SRS J5).
 */
export const serviceRecords = pgTable(
  "service_records",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    performedOn: date("performed_on", { mode: "string" }).notNull(),
    odometerKm: integer("odometer_km"),
    category: text("category", { enum: SERVICE_RECORD_CATEGORY_VALUES }).notNull(),
    title: text("title").notNull(),
    description: text("description"),
    /** As entered by the person or provider: not a verified payment. */
    costAmount: numeric("cost_amount", { precision: 14, scale: 2 }),
    costCurrency: char("cost_currency", { length: 3 }),
    source: text("source", { enum: SERVICE_RECORD_SOURCE_VALUES }).notNull(),
    providerOrganizationId: uuid("provider_organization_id").references(() => organizations.id, {
      onDelete: "set null",
    }),
    providerName: text("provider_name"),
    enteredBy: uuid("entered_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    scheduleId: uuid("schedule_id"),
    documentId: uuid("document_id"),
    serviceRequestId: uuid("service_request_id"),
    ...timestamps(),
  },
  (t) => [
    index("service_records_vehicle_idx").on(t.vehicleId, t.performedOn.desc()),
    index("service_records_provider_idx").on(t.providerOrganizationId),
    check(
      "service_records_source_valid",
      sql`${t.source} IN (${list(SERVICE_RECORD_SOURCE_VALUES)})`,
    ),
    check(
      "service_records_category_valid",
      sql`${t.category} IN (${list(SERVICE_RECORD_CATEGORY_VALUES)})`,
    ),
    check(
      "service_records_cost_pair",
      sql`(${t.costAmount} IS NULL) = (${t.costCurrency} IS NULL)`,
    ),
    check(
      "service_records_provider_source",
      sql`${t.source} <> 'provider' OR ${t.providerOrganizationId} IS NOT NULL`,
    ),
  ],
);

/** Distance- and/or time-based maintenance (F-073). */
export const maintenanceSchedules = pgTable(
  "maintenance_schedules",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    kind: text("kind", { enum: SCHEDULE_KIND_VALUES }).notNull(),
    intervalKm: integer("interval_km"),
    intervalDays: integer("interval_days"),
    lastDoneKm: integer("last_done_km"),
    lastDoneOn: date("last_done_on", { mode: "string" }),
    remindBeforeKm: integer("remind_before_km").notNull().default(1_000),
    remindBeforeDays: integer("remind_before_days").notNull().default(14),
    /** The status last reminded about, so each change is reminded once (overdue: weekly). */
    remindedStatus: text("reminded_status", { enum: ["due_soon", "overdue"] }),
    remindedAt: timestamp("reminded_at", { withTimezone: true, mode: "date" }),
    active: boolean("active").notNull().default(true),
    createdBy: uuid("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    index("maintenance_schedules_vehicle_idx").on(t.vehicleId),
    check("maintenance_schedules_kind_valid", sql`${t.kind} IN (${list(SCHEDULE_KIND_VALUES)})`),
    check(
      "maintenance_schedules_interval",
      sql`${t.intervalKm} IS NOT NULL OR ${t.intervalDays} IS NOT NULL`,
    ),
  ],
);

/** Private document vault (F-074): scanned, envelope-encrypted, in the sensitive bucket. */
export const vehicleDocuments = pgTable(
  "vehicle_documents",
  {
    id: id(),
    vehicleId: uuid("vehicle_id")
      .notNull()
      .references(() => vehicles.id, { onDelete: "cascade" }),
    kind: text("kind", { enum: VEHICLE_DOCUMENT_KIND_VALUES }).notNull(),
    title: text("title").notNull(),
    expiresOn: date("expires_on", { mode: "string" }),
    driverVisible: boolean("driver_visible").notNull().default(false),
    status: text("status", { enum: ["pending_upload", "available", "rejected"] })
      .notNull()
      .default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    size: integer("size"),
    sha256: text("sha256"),
    wrappedKey: text("wrapped_key"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    keyId: text("key_id"),
    rejectionReason: text("rejection_reason"),
    /** Expiry reminder already sent for this expiry date. */
    expiryRemindedFor: date("expiry_reminded_for", { mode: "string" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    index("vehicle_documents_vehicle_idx").on(t.vehicleId),
    index("vehicle_documents_expiry_idx")
      .on(t.expiresOn)
      .where(sql`${t.status} = 'available'`),
    check(
      "vehicle_documents_kind_valid",
      sql`${t.kind} IN (${list(VEHICLE_DOCUMENT_KIND_VALUES)})`,
    ),
    check(
      "vehicle_documents_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected')`,
    ),
    check(
      "vehicle_documents_encrypted_when_available",
      sql`${t.status} <> 'available' OR (${t.storageKey} IS NOT NULL AND ${t.wrappedKey} IS NOT NULL AND ${t.iv} IS NOT NULL AND ${t.authTag} IS NOT NULL)`,
    ),
  ],
);

/**
 * Controlled sharing (F-074): a link that expires, has a view limit and can be revoked. Only a
 * hash of the token is stored.
 */
export const vehicleDocumentShares = pgTable(
  "vehicle_document_shares",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => vehicleDocuments.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    label: text("label").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    maxViews: smallint("max_views").notNull(),
    views: smallint("views").notNull().default(0),
    revokedAt: timestamp("revoked_at", { withTimezone: true, mode: "date" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("vehicle_document_shares_token_key").on(t.tokenHash),
    index("vehicle_document_shares_document_idx").on(t.documentId),
    check("vehicle_document_shares_views", sql`${t.views} >= 0 AND ${t.views} <= ${t.maxViews}`),
  ],
);

export type Vehicle = typeof vehicles.$inferSelect;
export type ServiceRecord = typeof serviceRecords.$inferSelect;
export type MaintenanceSchedule = typeof maintenanceSchedules.$inferSelect;
export type VehicleDocument = typeof vehicleDocuments.$inferSelect;
export type VehicleDocumentShare = typeof vehicleDocumentShares.$inferSelect;

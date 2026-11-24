import { z } from "zod";

import { safeText } from "./articles.js";
import { PROFILE_IMAGE_TYPES, vehicleTypeSchema } from "./providers.js";

/**
 * Vehicles, drivers, service history, maintenance and the document vault (SRS J5, F-070..F-074,
 * ADR-0026). Service records carry their source and are never labelled verified.
 */

/** Shown with every service history. */
export const SERVICE_RECORD_NOTICE =
  "Service records are entered by owners, fleets, drivers and providers. FleetTrust doesn't verify them.";

/** Where a service record came from; set by the API, never by the client. */
export const SERVICE_RECORD_SOURCES = ["owner", "fleet", "driver", "provider", "document"] as const;
export type ServiceRecordSource = (typeof SERVICE_RECORD_SOURCES)[number];
export const SERVICE_RECORD_SOURCE_LABELS: Record<ServiceRecordSource, string> = {
  owner: "Entered by owner",
  fleet: "Entered by fleet",
  driver: "Entered by driver",
  provider: "Entered by provider",
  document: "From document",
};

export const SERVICE_RECORD_CATEGORIES = [
  "service",
  "repair",
  "tyres",
  "inspection",
  "towing",
  "parts",
  "fuel",
  "other",
] as const;
export const SCHEDULE_KINDS = [
  "service",
  "inspection",
  "tyres",
  "licence_renewal",
  "other",
] as const;
export const VEHICLE_DOCUMENT_KINDS = [
  "registration",
  "insurance",
  "roadworthy",
  "permit",
  "invoice",
  "manual",
  "other",
] as const;
export const VEHICLE_DOCUMENT_TYPES = [...PROFILE_IMAGE_TYPES, "application/pdf"] as const;
export const MAX_VEHICLE_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_SHARE_DAYS = 7;
export const MAX_SHARE_VIEWS = 20;
/** Documents expiring within this many days trigger a reminder. */
export const DOCUMENT_EXPIRY_NOTICE_DAYS = 30;

const registration = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9 -]{2,15}$/, "Letters, digits, spaces and hyphens");
const vin = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-HJ-NPR-Z0-9]{17}$/, "17 characters (no I, O or Q)");
const localDate = z.iso.date();
const amount = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,2})?$/, "An amount such as 450 or 450.50");
const currency = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. ZAR");

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const createVehicleSchema = z
  .object({
    nickname: safeText(60).nullable().default(null),
    vehicleType: vehicleTypeSchema,
    make: safeText(60).nullable().default(null),
    model: safeText(60).nullable().default(null),
    year: z.number().int().min(1900).max(2100).nullable().default(null),
    registration: registration.nullable().default(null),
    vin: vin.nullable().default(null),
    odometerKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
    /** Fleet vehicles: the branch it belongs to (branch-scoped managers see their branch). */
    branchId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateVehicle = z.input<typeof createVehicleSchema>;

export const updateVehicleSchema = z
  .object({
    nickname: safeText(60).nullable().optional(),
    make: safeText(60).nullable().optional(),
    model: safeText(60).nullable().optional(),
    year: z.number().int().min(1900).max(2100).nullable().optional(),
    registration: registration.nullable().optional(),
    vin: vin.nullable().optional(),
    branchId: z.uuid().nullable().optional(),
    /** Corrections by owners and managers; drivers report readings instead. */
    odometerKm: z.number().int().min(0).max(5_000_000).optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const odometerReadingSchema = z
  .object({ odometerKm: z.number().int().min(0).max(5_000_000) })
  .strict();

export const assignDriverSchema = z.object({ userId: z.uuid() }).strict();

/** Strict: `source`, `verified` and similar fields are refused. */
export const createServiceRecordSchema = z
  .object({
    performedOn: localDate,
    odometerKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
    category: z.enum(SERVICE_RECORD_CATEGORIES),
    title: safeText(120, { min: 1 }).pipe(z.string().trim().min(1)),
    description: safeText(2_000, { multiline: true }).nullable().default(null),
    /** What was paid, as entered (never a verified payment). */
    cost: z.object({ amount, currency }).strict().nullable().default(null),
    providerName: safeText(120).nullable().default(null),
    /** Marks a maintenance schedule as done. */
    scheduleId: z.uuid().nullable().default(null),
    /** The record was taken from this vault document (source "from document"). */
    fromDocumentId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateServiceRecord = z.input<typeof createServiceRecordSchema>;

/** A provider's record for the vehicle on an accepted service request. */
export const providerServiceRecordSchema = z
  .object({
    performedOn: localDate,
    odometerKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
    category: z.enum(SERVICE_RECORD_CATEGORIES),
    title: safeText(120, { min: 1 }).pipe(z.string().trim().min(1)),
    description: safeText(2_000, { multiline: true }).nullable().default(null),
    cost: z.object({ amount, currency }).strict().nullable().default(null),
  })
  .strict();

export const scheduleSchema = z
  .object({
    title: safeText(120, { min: 1 }).pipe(z.string().trim().min(1)),
    kind: z.enum(SCHEDULE_KINDS),
    intervalKm: z.number().int().min(100).max(1_000_000).nullable().default(null),
    intervalDays: z.number().int().min(1).max(3_650).nullable().default(null),
    lastDoneKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
    lastDoneOn: localDate.nullable().default(null),
    remindBeforeKm: z.number().int().min(0).max(100_000).default(1_000),
    remindBeforeDays: z.number().int().min(0).max(365).default(14),
  })
  .strict()
  .refine(
    (s) => s.intervalKm !== null || s.intervalDays !== null,
    "Set a distance or a time interval",
  );
export type ScheduleInput = z.input<typeof scheduleSchema>;

export const completeScheduleSchema = z
  .object({
    doneOn: localDate,
    odometerKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
  })
  .strict();

export const createVehicleDocumentSchema = z
  .object({
    kind: z.enum(VEHICLE_DOCUMENT_KINDS),
    title: safeText(120, { min: 1 }).pipe(z.string().trim().min(1)),
    expiresOn: localDate.nullable().default(null),
    /** Visible to the vehicle's assigned driver (e.g. registration, insurance). */
    driverVisible: z.boolean().default(false),
    contentType: z.enum(VEHICLE_DOCUMENT_TYPES),
    size: z.number().int().min(1).max(MAX_VEHICLE_DOCUMENT_BYTES),
  })
  .strict();

export const updateVehicleDocumentSchema = z
  .object({
    title: safeText(120, { min: 1 }).pipe(z.string().trim().min(1)).optional(),
    expiresOn: localDate.nullable().optional(),
    driverVisible: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const createDocumentShareSchema = z
  .object({
    /** Who it's for, e.g. "Insurance broker" (shown in the audit and share list). */
    label: safeText(80, { min: 1 }).pipe(z.string().trim().min(1)),
    expiresInHours: z
      .number()
      .int()
      .min(1)
      .max(MAX_SHARE_DAYS * 24)
      .default(48),
    maxViews: z.number().int().min(1).max(MAX_SHARE_VIEWS).default(5),
  })
  .strict();

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const vehicleSchema = z.object({
  id: z.uuid(),
  owner: z.object({
    kind: z.enum(["user", "organization"]),
    userId: z.uuid().nullable(),
    organizationId: z.uuid().nullable(),
  }),
  branchId: z.uuid().nullable(),
  nickname: z.string().nullable(),
  vehicleType: vehicleTypeSchema,
  make: z.string().nullable(),
  model: z.string().nullable(),
  year: z.number().int().nullable(),
  registration: z.string().nullable(),
  vin: z.string().nullable(),
  odometerKm: z.number().int().nullable(),
  odometerUpdatedAt: z.iso.datetime().nullable(),
  status: z.enum(["active", "archived"]),
  /** Your access: owner (personal), manager (fleet) or driver (assigned). */
  access: z.enum(["owner", "manager", "driver"]),
  driver: z
    .object({ userId: z.uuid(), displayName: z.string(), since: z.iso.datetime() })
    .nullable(),
  maintenance: z.object({ dueSoon: z.number().int(), overdue: z.number().int() }),
  createdAt: z.iso.datetime(),
});
export type VehicleDto = z.infer<typeof vehicleSchema>;

export const serviceRecordSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  performedOn: z.iso.date(),
  odometerKm: z.number().int().nullable(),
  category: z.enum(SERVICE_RECORD_CATEGORIES),
  title: z.string(),
  description: z.string().nullable(),
  /** As entered; not a verified payment. */
  cost: z.object({ amount: z.string(), currency: z.string() }).nullable(),
  source: z.enum(SERVICE_RECORD_SOURCES),
  /** e.g. "Entered by provider · Acme Garage". Never "verified". */
  sourceLabel: z.string(),
  provider: z.object({ organizationId: z.uuid().nullable(), name: z.string() }).nullable(),
  enteredBy: z.object({ displayName: z.string() }),
  scheduleId: z.uuid().nullable(),
  documentId: z.uuid().nullable(),
  serviceRequestId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type ServiceRecordDto = z.infer<typeof serviceRecordSchema>;

export const serviceHistorySchema = z.object({
  items: z.array(serviceRecordSchema),
  notice: z.literal(SERVICE_RECORD_NOTICE),
});
export type ServiceHistory = z.infer<typeof serviceHistorySchema>;

export const maintenanceScheduleSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  title: z.string(),
  kind: z.enum(SCHEDULE_KINDS),
  intervalKm: z.number().int().nullable(),
  intervalDays: z.number().int().nullable(),
  lastDoneKm: z.number().int().nullable(),
  lastDoneOn: z.iso.date().nullable(),
  nextDueKm: z.number().int().nullable(),
  nextDueOn: z.iso.date().nullable(),
  remindBeforeKm: z.number().int(),
  remindBeforeDays: z.number().int(),
  status: z.enum(["ok", "due_soon", "overdue", "unknown"]),
});
export type MaintenanceScheduleDto = z.infer<typeof maintenanceScheduleSchema>;

export const vehicleDocumentSchema = z.object({
  id: z.uuid(),
  vehicleId: z.uuid(),
  kind: z.enum(VEHICLE_DOCUMENT_KINDS),
  title: z.string(),
  expiresOn: z.iso.date().nullable(),
  expiring: z.boolean(),
  driverVisible: z.boolean(),
  status: z.enum(["pending_upload", "available", "rejected"]),
  contentType: z.string().nullable(),
  size: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type VehicleDocumentDto = z.infer<typeof vehicleDocumentSchema>;

export const documentShareSchema = z.object({
  id: z.uuid(),
  documentId: z.uuid(),
  label: z.string(),
  expiresAt: z.iso.datetime(),
  maxViews: z.number().int(),
  views: z.number().int(),
  revoked: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type DocumentShareDto = z.infer<typeof documentShareSchema>;

export const createdDocumentShareSchema = documentShareSchema.extend({
  /** Shown once. Anyone with it can open the document until it expires or is revoked. */
  token: z.string(),
  path: z.string(),
});
export type CreatedDocumentShare = z.infer<typeof createdDocumentShareSchema>;

export const vehicleErrorReasonSchema = z.enum([
  "not_a_fleet",
  "invalid_branch",
  "not_a_member",
  "odometer_decreased",
  "vehicle_archived",
  "no_vehicle_linked",
  "not_allowed",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
  "document_not_ready",
  "duplicate_registration",
]);
export type VehicleErrorReason = z.infer<typeof vehicleErrorReasonSchema>;

import { z } from "zod";

import { safeText } from "./articles.js";
import { localDateSchema } from "./opening-hours.js";
import { providerCategorySchema } from "./providers.js";

/**
 * Fleet operations (SRS J5, F-150..F-152, ADR-0029): maintenance and incident dashboards,
 * preferred provider lists and spending records entered by the fleet's own people. FleetTrust
 * never sees a payment: spending is what someone typed in, and is always labelled so.
 */

/** Shown with every spending record and total. */
export const SPENDING_DISCLAIMER =
  "Entered by your team. These are records, not verified payments: FleetTrust doesn't process or check payments.";

// --- Incidents --------------------------------------------------------------------------------

/**
 * Operational incidents a fleet records about its vehicles. Separate from personal emergency
 * alerts (Prompt 18), which belong to the person and never appear on a fleet dashboard.
 */
export const FLEET_INCIDENT_KINDS = [
  "breakdown",
  "accident",
  "damage",
  "theft",
  "traffic_fine",
  "other",
] as const;
export const FLEET_INCIDENT_SEVERITIES = ["low", "medium", "high"] as const;
export const FLEET_INCIDENT_STATUSES = ["open", "resolved"] as const;

export const createFleetIncidentSchema = z
  .object({
    vehicleId: z.uuid(),
    kind: z.enum(FLEET_INCIDENT_KINDS),
    severity: z.enum(FLEET_INCIDENT_SEVERITIES).default("medium"),
    occurredAt: z.iso.datetime({ offset: true }),
    location: safeText(200).nullable().default(null),
    description: safeText(2000, { min: 5, multiline: true }),
  })
  .strict();
export type CreateFleetIncident = z.input<typeof createFleetIncidentSchema>;

export const updateFleetIncidentSchema = z
  .object({
    severity: z.enum(FLEET_INCIDENT_SEVERITIES).optional(),
    status: z.enum(FLEET_INCIDENT_STATUSES).optional(),
    resolutionNote: safeText(1000, { multiline: true }).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const fleetIncidentQuerySchema = z
  .object({
    status: z.enum(FLEET_INCIDENT_STATUSES).optional(),
    vehicleId: z.uuid().optional(),
  })
  .strict();

export const fleetIncidentSchema = z.object({
  id: z.uuid(),
  vehicle: z.object({ id: z.uuid(), name: z.string() }),
  branchId: z.uuid().nullable(),
  kind: z.enum(FLEET_INCIDENT_KINDS),
  severity: z.enum(FLEET_INCIDENT_SEVERITIES),
  occurredAt: z.iso.datetime(),
  location: z.string().nullable(),
  description: z.string(),
  status: z.enum(FLEET_INCIDENT_STATUSES),
  resolutionNote: z.string().nullable(),
  resolvedAt: z.iso.datetime().nullable(),
  reportedBy: z.object({ userId: z.uuid(), name: z.string() }),
  createdAt: z.iso.datetime(),
});
export type FleetIncidentDto = z.infer<typeof fleetIncidentSchema>;

// --- Spending records -------------------------------------------------------------------------

export const EXPENSE_CATEGORIES = [
  "fuel",
  "maintenance",
  "tyres",
  "parts",
  "tolls",
  "parking",
  "insurance",
  "licensing",
  "fines",
  "cleaning",
  "other",
] as const;
export type ExpenseCategory = (typeof EXPENSE_CATEGORIES)[number];

const moneySchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,11})(?:\.\d{1,2})?$/, "An amount such as 450 or 450.50")
  .refine((value) => Number(value) > 0, "Must be more than zero");

export const expenseRequestSchema = z
  .object({
    /** Null: an organization-level cost (insurance, licensing); managers only. */
    vehicleId: z.uuid().nullable().default(null),
    category: z.enum(EXPENSE_CATEGORIES),
    amount: moneySchema,
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. ZAR"),
    spentOn: localDateSchema,
    vendor: safeText(120).nullable().default(null),
    description: safeText(500, { multiline: true }).nullable().default(null),
    odometerKm: z.number().int().min(0).max(5_000_000).nullable().default(null),
    /** Fuel only. */
    litres: z
      .string()
      .regex(/^\d{1,5}(?:\.\d{1,2})?$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine((v) => v.litres === null || v.category === "fuel", {
    path: ["litres"],
    message: "Only fuel records carry litres",
  });
export type ExpenseRequest = z.input<typeof expenseRequestSchema>;

export const expenseQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    vehicleId: z.uuid().optional(),
    category: z.enum(EXPENSE_CATEGORIES).optional(),
  })
  .strict();

export const expenseSchema = z.object({
  id: z.uuid(),
  vehicle: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  branchId: z.uuid().nullable(),
  category: z.enum(EXPENSE_CATEGORIES),
  amount: z.string(),
  currency: z.string(),
  spentOn: z.string(),
  vendor: z.string().nullable(),
  description: z.string().nullable(),
  odometerKm: z.number().int().nullable(),
  litres: z.string().nullable(),
  enteredBy: z.object({ userId: z.uuid(), name: z.string() }),
  /** Always false: FleetTrust never verifies a payment. */
  verified: z.literal(false),
  source: z.literal("entered_by_user"),
  createdAt: z.iso.datetime(),
  disclaimer: z.literal(SPENDING_DISCLAIMER),
});
export type ExpenseDto = z.infer<typeof expenseSchema>;

// --- Preferred providers ----------------------------------------------------------------------

export const preferredProviderRequestSchema = z
  .object({
    providerSlug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/),
    /** Null: preferred for the whole fleet; otherwise for one branch. */
    branchId: z.uuid().nullable().default(null),
    /** Empty: preferred for anything they offer. */
    categories: z.array(providerCategorySchema).max(7).default([]),
    note: safeText(500, { multiline: true }).nullable().default(null),
  })
  .strict();
export type PreferredProviderRequest = z.input<typeof preferredProviderRequestSchema>;

export const updatePreferredProviderSchema = z
  .object({
    categories: z.array(providerCategorySchema).max(7).optional(),
    note: safeText(500, { multiline: true }).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const preferredProviderSchema = z.object({
  id: z.uuid(),
  provider: z.object({
    organizationId: z.uuid(),
    slug: z.string().nullable(),
    name: z.string(),
    categories: z.array(z.string()),
    /** False when the provider is no longer published or active: kept, but can't receive requests. */
    available: z.boolean(),
  }),
  branchId: z.uuid().nullable(),
  categories: z.array(providerCategorySchema),
  note: z.string().nullable(),
  addedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type PreferredProviderDto = z.infer<typeof preferredProviderSchema>;

/** A provider's own view: how many fleets prefer it (never which ones). */
export const preferredByCountSchema = z.object({ fleets: z.number().int() });

// --- Dashboard --------------------------------------------------------------------------------

export const dashboardQuerySchema = z
  .object({
    branchId: z.uuid().optional(),
    /** Spending and incident window. */
    days: z.coerce.number().int().min(7).max(366).default(30),
  })
  .strict();

const spendLine = z.object({
  currency: z.string(),
  total: z.string(),
  byCategory: z.array(z.object({ category: z.string(), total: z.string() })),
  /** Expenses entered directly, and costs typed into service records. */
  bySource: z.object({ expenses: z.string(), serviceRecords: z.string() }),
});

export const fleetDashboardSchema = z.object({
  window: z.object({ days: z.number().int(), from: z.string(), to: z.string() }),
  branchId: z.uuid().nullable(),
  vehicles: z.object({ active: z.number().int(), withDriver: z.number().int() }),
  maintenance: z.object({
    overdue: z.number().int(),
    dueSoon: z.number().int(),
    ok: z.number().int(),
    unknown: z.number().int(),
    /** Most urgent first (overdue, then due soon), at most 20. */
    items: z.array(
      z.object({
        scheduleId: z.uuid(),
        vehicle: z.object({ id: z.uuid(), name: z.string() }),
        title: z.string(),
        status: z.enum(["overdue", "due_soon"]),
        nextDueOn: z.string().nullable(),
        nextDueKm: z.number().int().nullable(),
      }),
    ),
  }),
  documents: z.object({ expiringWithin30Days: z.number().int(), expired: z.number().int() }),
  incidents: z.object({
    open: z.number().int(),
    inWindow: z.number().int(),
    byKind: z.array(z.object({ kind: z.enum(FLEET_INCIDENT_KINDS), count: z.number().int() })),
    highSeverityOpen: z.number().int(),
  }),
  serviceRequests: z.object({ open: z.number().int(), accepted: z.number().int() }),
  /** One line per currency; amounts are never converted or summed across currencies. */
  spending: z.object({
    lines: z.array(spendLine),
    verified: z.literal(false),
    disclaimer: z.literal(SPENDING_DISCLAIMER),
  }),
});
export type FleetDashboardDto = z.infer<typeof fleetDashboardSchema>;

export const fleetErrorReasonSchema = z.enum([
  "not_a_fleet",
  "not_a_provider",
  "invalid_branch",
  "not_allowed",
  "vehicle_archived",
  "unknown_currency",
  "provider_not_found",
  "already_preferred",
  "invalid_range",
]);
export type FleetErrorReason = z.infer<typeof fleetErrorReasonSchema>;

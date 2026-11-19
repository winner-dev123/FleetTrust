import { z } from "zod";

/**
 * Capabilities a plan can limit (SRS F-012). Plans buy **capacity only** (ADR-0009).
 * There is deliberately no emergency capability: emergency features never consult
 * entitlements (ADR-0010, FR-04).
 *
 * - `daily`: counted per local day (00:00 in the subject's timezone, OQ-08), consumed atomically.
 * - `capacity`: counted from live data (members, branches); blocks creation above the limit.
 */
export const CAPABILITIES = {
  "friend_requests.daily": { kind: "daily", subjects: ["user"], label: "Friend requests per day" },
  "service_requests.daily": {
    kind: "daily",
    subjects: ["user", "organization"],
    label: "Service requests per day",
  },
  "articles.daily": {
    kind: "daily",
    subjects: ["user", "organization"],
    label: "Articles per day",
  },
  "groups.daily": {
    kind: "daily",
    subjects: ["user", "organization"],
    label: "New groups per day",
  },
  "staff.seats": { kind: "capacity", subjects: ["organization"], label: "Staff seats" },
  "branches.max": { kind: "capacity", subjects: ["organization"], label: "Branches" },
} as const satisfies Record<
  string,
  {
    kind: "daily" | "capacity";
    subjects: readonly ("user" | "organization")[];
    label: string;
  }
>;

export type CapabilityKey = keyof typeof CAPABILITIES;
export const CAPABILITY_KEYS = Object.keys(CAPABILITIES) as CapabilityKey[];
export const capabilityKeySchema = z.enum(CAPABILITY_KEYS as [CapabilityKey, ...CapabilityKey[]]);

export const subjectTypeSchema = z.enum(["user", "organization"]);
export type SubjectType = z.infer<typeof subjectTypeSchema>;

export const timeZoneSchema = z
  .string()
  .min(1)
  .max(64)
  .refine((value) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: value });
      return true;
    } catch {
      return false;
    }
  }, "Unknown time zone (use an IANA name such as Europe/Berlin)");

/** One meter on the usage screen. `limit: null` = unlimited. */
export const entitlementSchema = z.object({
  key: capabilityKeySchema,
  kind: z.enum(["daily", "capacity"]),
  limit: z.number().int().nonnegative().nullable(),
  used: z.number().int().nonnegative(),
  /** Where the limit comes from: the plan, a downgrade grace period, or a staff override. */
  source: z.enum(["plan", "grace", "override"]),
  /** When a grace-period limit stops applying. */
  graceUntil: z.iso.datetime().nullable(),
  /** Usage above the limit after a downgrade: existing data is kept, creation is blocked. */
  overLimit: z.boolean(),
});
export type Entitlement = z.infer<typeof entitlementSchema>;

export const entitlementsResponseSchema = z.object({
  subject: z.object({ type: subjectTypeSchema, id: z.uuid() }),
  plan: z.object({
    code: z.string(),
    name: z.string(),
    version: z.number().int(),
    /** "default" = no assignment, the audience's default plan applies. */
    source: z.enum(["assignment", "default"]),
    /** Shown as "Activated by FleetTrust staff on <date>" (never "paid", ADR-0008). */
    activatedAt: z.iso.datetime().nullable(),
    endsAt: z.iso.datetime().nullable(),
  }),
  timeZone: z.string(),
  /** Local day the daily counters belong to (YYYY-MM-DD). */
  period: z.string(),
  entitlements: z.array(entitlementSchema),
});
export type EntitlementsResponse = z.infer<typeof entitlementsResponseSchema>;

export const entitlementErrorReasonSchema = z.enum([
  "quota_exceeded",
  "plan_audience_mismatch",
  "plan_version_not_assignable",
  "capability_not_applicable",
  "assignment_already_ended",
]);
export type EntitlementErrorReason = z.infer<typeof entitlementErrorReasonSchema>;

// --- Billing operator (staff) API -----------------------------------------------------------

const subjectSchema = z.object({ type: subjectTypeSchema, id: z.uuid() }).strict();

export const assignPlanRequestSchema = z
  .object({
    subject: subjectSchema,
    planVersionId: z.uuid(),
    externalReference: z.string().trim().min(1).max(200),
    invoiceNumber: z.string().trim().min(1).max(100).nullable().default(null),
    note: z.string().trim().max(1000).nullable().default(null),
    graceDays: z.number().int().min(0).max(90).default(14),
    endsAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export type AssignPlanRequest = z.input<typeof assignPlanRequestSchema>;

export const endAssignmentRequestSchema = z
  .object({ note: z.string().trim().max(1000).nullable().default(null) })
  .strict();

export const setOverrideRequestSchema = z
  .object({
    subject: subjectSchema,
    key: capabilityKeySchema,
    /** null = unlimited. */
    limit: z.number().int().min(0).max(1_000_000).nullable(),
    reason: z.string().trim().min(3).max(500),
    expiresAt: z.iso.datetime().nullable().default(null),
  })
  .strict();
export type SetOverrideRequest = z.input<typeof setOverrideRequestSchema>;

export const planVersionSchema = z.object({
  id: z.uuid(),
  version: z.number().int(),
  status: z.enum(["draft", "published", "retired"]),
  price: z
    .object({
      amountMinor: z.number().int(),
      currency: z.string(),
      period: z.enum(["month", "year"]),
    })
    .nullable(),
  limits: z.record(z.string(), z.number().int().nullable()),
  publishedAt: z.iso.datetime().nullable(),
});

export const planSchema = z.object({
  id: z.uuid(),
  code: z.string(),
  audience: z.enum(["user", "provider", "fleet"]),
  name: z.string(),
  isDefault: z.boolean(),
  versions: z.array(planVersionSchema),
});
export type PlanDto = z.infer<typeof planSchema>;

export const planAssignmentSchema = z.object({
  id: z.uuid(),
  subject: z.object({ type: subjectTypeSchema, id: z.uuid() }),
  planCode: z.string(),
  planVersion: z.number().int(),
  planVersionId: z.uuid(),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime().nullable(),
  graceDays: z.number().int(),
  externalReference: z.string(),
  invoiceNumber: z.string().nullable(),
  note: z.string().nullable(),
  assignedBy: z.uuid(),
  endedAt: z.iso.datetime().nullable(),
  endReason: z.enum(["superseded", "cancelled"]).nullable(),
});
export type PlanAssignmentDto = z.infer<typeof planAssignmentSchema>;

export const quotaOverrideSchema = z.object({
  id: z.uuid(),
  subject: z.object({ type: subjectTypeSchema, id: z.uuid() }),
  key: z.string(),
  limit: z.number().int().nullable(),
  reason: z.string(),
  expiresAt: z.iso.datetime().nullable(),
  createdBy: z.uuid(),
  createdAt: z.iso.datetime(),
  revokedAt: z.iso.datetime().nullable(),
});
export type QuotaOverrideDto = z.infer<typeof quotaOverrideSchema>;

/** Staff view of one subject: what applies now, plus the full history. */
export const billingAccountSchema = z.object({
  entitlements: entitlementsResponseSchema,
  assignments: z.array(planAssignmentSchema),
  overrides: z.array(quotaOverrideSchema),
});
export type BillingAccount = z.infer<typeof billingAccountSchema>;

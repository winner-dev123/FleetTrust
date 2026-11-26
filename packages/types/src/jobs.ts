import { z } from "zod";

import { safeText } from "./articles.js";

/**
 * Job board (SRS F-153, F-154, AB-14, ADR-0029). Fleets post jobs; people apply. A listing goes
 * live straight away only when the employer holds an active business verification badge and the
 * text shows no scam signs; everything else waits for a moderator. Listings can be reported.
 */

export const JOB_ROLES = ["driver", "mechanic", "dispatcher", "fleet_manager", "other"] as const;
export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary"] as const;
export const SALARY_PERIODS = ["hour", "day", "week", "month", "year"] as const;
export const JOB_STATUSES = [
  "draft",
  "pending_moderation",
  "published",
  "rejected",
  "hidden",
  "closed",
] as const;
export type JobStatus = (typeof JOB_STATUSES)[number];
export const APPLICATION_STATUSES = [
  "submitted",
  "shortlisted",
  "rejected",
  "hired",
  "withdrawn",
] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** Listings close at most this many days after publishing. */
export const MAX_JOB_OPEN_DAYS = 90;

/** Shown with every listing and on the application form (AB-14). */
export const JOB_SCAM_WARNING =
  "Real employers never ask you to pay to apply, for training, uniforms or a medical. Don't send money or ID documents before an interview, and report listings that ask for a fee.";

/** Shown next to an employer that has no active business verification. */
export const UNVERIFIED_EMPLOYER_NOTICE =
  "This employer hasn't verified their business with FleetTrust yet. Take extra care.";

const FEE_WORDS =
  /\b(?:(?:application|registration|training|processing|uniform|medical|admin|placement|recruitment)\s+fees?|pay\s+(?:a\s+|an\s+|the\s+)?(?:fee|deposit)|deposit|upfront\s+payment|western\s*union|moneygram|bitcoin|crypto|usdt|gift\s*cards?)\b/iu;

/** Scam signs in a listing (fees, deposits, untraceable payment): such listings are pre-moderated. */
export function jobWarnings(text: string): "asks_for_payment"[] {
  return FEE_WORDS.test(text) ? ["asks_for_payment"] : [];
}

const salarySchema = z
  .object({
    currency: z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. ZAR"),
    min: z.string().regex(/^[1-9]\d{0,9}(?:\.\d{1,2})?$/),
    max: z
      .string()
      .regex(/^[1-9]\d{0,9}(?:\.\d{1,2})?$/)
      .nullable()
      .default(null),
    period: z.enum(SALARY_PERIODS),
  })
  .strict()
  .refine((s) => s.max === null || Number(s.max) >= Number(s.min), {
    path: ["max"],
    error: "Must not be less than the minimum",
  });

export const jobRequestSchema = z
  .object({
    title: safeText(120, { min: 5 }),
    description: safeText(5000, { min: 50, multiline: true }),
    role: z.enum(JOB_ROLES),
    employmentType: z.enum(EMPLOYMENT_TYPES),
    /** Licence classes as written locally, e.g. "C1", "EC". */
    licenceClasses: z
      .array(safeText(10, { min: 1 }))
      .max(10)
      .default([]),
    locality: safeText(80, { min: 2 }),
    countryCode: z.string().regex(/^[A-Z]{2}$/, "ISO 3166 code, e.g. ZA"),
    branchId: z.uuid().nullable().default(null),
    /** What the employer advertises; not a contract and not a payment. */
    salary: salarySchema.nullable().default(null),
    closesOn: z.iso.date(),
  })
  .strict();
export type JobRequest = z.input<typeof jobRequestSchema>;

export const jobListQuerySchema = z.object({ status: z.enum(JOB_STATUSES).optional() }).strict();

export const publicJobQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    role: z.enum(JOB_ROLES).optional(),
    employmentType: z.enum(EMPLOYMENT_TYPES).optional(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    /** Only employers with an active business badge. */
    verifiedOnly: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(1000).default(0),
  })
  .strict();

const employerSchema = z.object({
  organizationId: z.uuid(),
  name: z.string(),
  /** An active business verification badge (Prompt 09). */
  verified: z.boolean(),
});

const jobCore = {
  id: z.uuid(),
  title: z.string(),
  description: z.string(),
  role: z.enum(JOB_ROLES),
  employmentType: z.enum(EMPLOYMENT_TYPES),
  licenceClasses: z.array(z.string()),
  locality: z.string(),
  countryCode: z.string(),
  salary: z
    .object({
      currency: z.string(),
      min: z.string(),
      max: z.string().nullable(),
      period: z.enum(SALARY_PERIODS),
      label: z.string(),
    })
    .nullable(),
  closesOn: z.string(),
  publishedAt: z.iso.datetime().nullable(),
  employer: employerSchema,
  scamWarning: z.literal(JOB_SCAM_WARNING),
  employerNotice: z.string().nullable(),
};

export const publicJobSchema = z.object(jobCore);
export type PublicJob = z.infer<typeof publicJobSchema>;

export const publicJobListSchema = z.object({
  items: z.array(publicJobSchema),
  nextOffset: z.number().int().nullable(),
});

/** The employer's view. */
export const jobSchema = z.object({
  ...jobCore,
  status: z.enum(JOB_STATUSES),
  branchId: z.uuid().nullable(),
  /** Why it's waiting or was sent back. */
  moderationNote: z.string().nullable(),
  warnings: z.array(z.literal("asks_for_payment")),
  applications: z.object({ total: z.number().int(), submitted: z.number().int() }),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type JobDto = z.infer<typeof jobSchema>;

export const applyRequestSchema = z
  .object({
    message: safeText(3000, { min: 20, multiline: true }),
    /** Contact details you choose to share with this employer. At least one. */
    phone: z
      .string()
      .trim()
      .regex(/^\+?[0-9 ()-]{6,20}$/)
      .nullable()
      .default(null),
    email: z.email().max(254).nullable().default(null),
  })
  .strict()
  .refine((v) => v.phone !== null || v.email !== null, {
    path: ["phone"],
    error: "Share a phone number or an email address",
  });
export type ApplyRequest = z.input<typeof applyRequestSchema>;

export const applicationStatusRequestSchema = z
  .object({ status: z.enum(["submitted", "shortlisted", "rejected", "hired"]) })
  .strict();

export const applicationSchema = z.object({
  id: z.uuid(),
  jobId: z.uuid(),
  job: z.object({ title: z.string(), employer: employerSchema, status: z.enum(JOB_STATUSES) }),
  applicant: z.object({ userId: z.uuid(), name: z.string() }),
  message: z.string(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  status: z.enum(APPLICATION_STATUSES),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
export type ApplicationDto = z.infer<typeof applicationSchema>;

export const jobErrorReasonSchema = z.enum([
  "not_a_fleet",
  "invalid_branch",
  "invalid_transition",
  "invalid_close_date",
  "unknown_currency",
  "job_not_open",
  "own_job",
  "already_applied",
]);
export type JobErrorReason = z.infer<typeof jobErrorReasonSchema>;

const PERIOD_TEXT: Record<(typeof SALARY_PERIODS)[number], string> = {
  hour: "per hour",
  day: "per day",
  week: "per week",
  month: "per month",
  year: "per year",
};

/** "ZAR 18000–22000 per month (advertised)". */
export function salaryLabel(s: {
  currency: string;
  min: string;
  max: string | null;
  period: (typeof SALARY_PERIODS)[number];
}): string {
  const range = s.max === null || s.max === s.min ? s.min : `${s.min}–${s.max}`;
  return `${s.currency} ${range} ${PERIOD_TEXT[s.period]} (advertised)`;
}

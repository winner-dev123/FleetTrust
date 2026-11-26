import { z } from "zod";

import { localDateSchema, weeklyHoursSchema } from "./opening-hours.js";
import { boundedText, providerCategorySchema, vehicleTypeSchema } from "./providers.js";
import { REQUEST_URGENCIES } from "./requests.js";

/**
 * Provider CRM and appointments (SRS F-130..F-132, ADR-0027): the inquiry pipeline, internal
 * notes and tasks, quote overview, staff availability, appointment booking and analytics.
 * Appointment times are stored in UTC and entered and shown in the branch's local time.
 */

/** Pipeline stages, derived from the inquiry and request status (never stored). */
export const PIPELINE_STAGES = ["new", "open", "quoted", "won", "completed", "lost"] as const;
export type PipelineStage = (typeof PIPELINE_STAGES)[number];

export const INQUIRY_PRIORITIES = ["low", "normal", "high"] as const;
export type InquiryPriority = (typeof INQUIRY_PRIORITIES)[number];

/** How soon a provider should first reply (a quote or a decline), by request urgency. */
export const RESPONSE_TARGET_HOURS: Readonly<Record<(typeof REQUEST_URGENCIES)[number], number>> = {
  urgent: 2,
  soon: 8,
  routine: 24,
};

export const APPOINTMENT_STATUSES = ["booked", "completed", "cancelled", "no_show"] as const;
export type AppointmentStatus = (typeof APPOINTMENT_STATUSES)[number];

/** Slots start on these boundaries of local time. Durations are multiples of it. */
export const SLOT_STEP_MINUTES = 15;
export const MIN_APPOINTMENT_MINUTES = 15;
export const MAX_APPOINTMENT_MINUTES = 8 * 60;
export const MAX_BOOKING_DAYS_AHEAD = 365;
export const MAX_TIME_OFF_DAYS = 90;

/** Public response status needs this many inquiries in the window before it shows a time. */
export const RESPONSE_STATUS_MIN_INQUIRIES = 5;
export const RESPONSE_STATUS_WINDOW_DAYS = 90;
export const RESPONSE_STATUS_NOTE =
  "Based on how quickly this provider replied to inquiries on FleetTrust in the last 90 days. Past response times may change.";

const clockTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/, "24-hour time, e.g. 09:30");

/** A local start time in the branch's timezone. */
export const localStartSchema = z.object({ date: localDateSchema, time: clockTime }).strict();

const duration = z
  .number()
  .int()
  .min(MIN_APPOINTMENT_MINUTES)
  .max(MAX_APPOINTMENT_MINUTES)
  .refine((m) => m % SLOT_STEP_MINUTES === 0, `Use multiples of ${SLOT_STEP_MINUTES} minutes`);

// --- Pipeline -------------------------------------------------------------------------------

export const pipelineQuerySchema = z
  .object({
    stage: z.enum(PIPELINE_STAGES).optional(),
    /** `me`, `unassigned`, or a user ID. */
    assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
    priority: z.enum(INQUIRY_PRIORITIES).optional(),
  })
  .strict();

export const updateInquiryCrmSchema = z
  .object({
    assigneeUserId: z.uuid().nullable().optional(),
    priority: z.enum(INQUIRY_PRIORITIES).optional(),
  })
  .strict()
  .refine((v) => v.assigneeUserId !== undefined || v.priority !== undefined, "Nothing to change");

export const inquiryNoteRequestSchema = z
  .object({ body: boundedText(2000).min(1, "Write a note") })
  .strict();

const person = z.object({ userId: z.uuid(), displayName: z.string().nullable() });

export const responseInfoSchema = z.object({
  /** `awaiting`: no quote or decline yet; `closed`: the request ended before a reply. */
  state: z.enum(["awaiting", "responded", "closed"]),
  dueAt: z.iso.datetime(),
  overdue: z.boolean(),
  firstResponseAt: z.iso.datetime().nullable(),
});

export const pipelineItemSchema = z.object({
  recipientId: z.uuid(),
  requestId: z.uuid(),
  branchId: z.uuid().nullable(),
  stage: z.enum(PIPELINE_STAGES),
  category: providerCategorySchema,
  vehicleType: vehicleTypeSchema,
  urgency: z.enum(REQUEST_URGENCIES),
  summary: z.string(),
  createdAt: z.iso.datetime(),
  assignee: person.nullable(),
  priority: z.enum(INQUIRY_PRIORITIES),
  response: responseInfoSchema,
  openTasks: z.number().int(),
  nextAppointmentAt: z.iso.datetime().nullable(),
  latestQuote: z
    .object({
      id: z.uuid(),
      status: z.string(),
      priceLabel: z.string(),
      validUntil: z.iso.datetime(),
    })
    .nullable(),
});
export type PipelineItemDto = z.infer<typeof pipelineItemSchema>;

export const pipelineSchema = z.object({
  /** Counts per stage across the whole pipeline you can see (filters don't apply). */
  stages: z.record(z.enum(PIPELINE_STAGES), z.number().int()),
  items: z.array(pipelineItemSchema),
});
export type PipelineDto = z.infer<typeof pipelineSchema>;

export const inquiryNoteSchema = z.object({
  id: z.uuid(),
  author: person,
  body: z.string(),
  createdAt: z.iso.datetime(),
});
export type InquiryNoteDto = z.infer<typeof inquiryNoteSchema>;

export const crmInquirySchema = z.object({
  item: pipelineItemSchema,
  notes: z.array(inquiryNoteSchema),
});
export type CrmInquiryDto = z.infer<typeof crmInquirySchema>;

// --- Quotes ---------------------------------------------------------------------------------

export const quoteListQuerySchema = z
  .object({
    status: z.enum(["active", "accepted", "expired", "withdrawn", "not_selected"]).optional(),
    expiringWithinDays: z.coerce.number().int().min(1).max(30).optional(),
  })
  .strict();

export const crmQuoteSchema = z.object({
  id: z.uuid(),
  recipientId: z.uuid(),
  requestId: z.uuid(),
  branchId: z.uuid().nullable(),
  category: providerCategorySchema,
  summary: z.string(),
  priceLabel: z.string(),
  status: z.enum(["active", "superseded", "withdrawn", "accepted", "not_selected", "expired"]),
  validUntil: z.iso.datetime(),
  expiringSoon: z.boolean(),
  createdBy: person,
  createdAt: z.iso.datetime(),
});
export type CrmQuoteDto = z.infer<typeof crmQuoteSchema>;

// --- Tasks ----------------------------------------------------------------------------------

export const createTaskSchema = z
  .object({
    title: boundedText(200).min(2, "Give the task a title"),
    dueAt: z.iso.datetime({ offset: true }).nullable().default(null),
    /** Defaults to you. Staff can only assign tasks to themselves. */
    assigneeUserId: z.uuid().nullable().optional(),
    recipientId: z.uuid().nullable().default(null),
    appointmentId: z.uuid().nullable().default(null),
  })
  .strict();

export const updateTaskSchema = z
  .object({
    title: boundedText(200).min(2).optional(),
    dueAt: z.iso.datetime({ offset: true }).nullable().optional(),
    assigneeUserId: z.uuid().nullable().optional(),
    done: z.boolean().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const taskQuerySchema = z
  .object({
    assignee: z.union([z.literal("me"), z.literal("unassigned"), z.uuid()]).optional(),
    status: z.enum(["open", "done"]).optional(),
    recipientId: z.uuid().optional(),
  })
  .strict();

export const crmTaskSchema = z.object({
  id: z.uuid(),
  title: z.string(),
  status: z.enum(["open", "done"]),
  dueAt: z.iso.datetime().nullable(),
  overdue: z.boolean(),
  branchId: z.uuid().nullable(),
  recipientId: z.uuid().nullable(),
  appointmentId: z.uuid().nullable(),
  assignee: person.nullable(),
  createdBy: z.uuid(),
  completedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type CrmTaskDto = z.infer<typeof crmTaskSchema>;

// --- Staff availability ---------------------------------------------------------------------

/** A staff member's weekly working hours at one branch, in the branch's local time. */
export const staffAvailabilityRequestSchema = z
  .object({ branchId: z.uuid(), weekly: weeklyHoursSchema })
  .strict();

export const timeOffRequestSchema = z
  .object({
    startsAt: z.iso.datetime({ offset: true }),
    endsAt: z.iso.datetime({ offset: true }),
    reason: boundedText(200).nullable().default(null),
  })
  .strict()
  .refine((v) => Date.parse(v.endsAt) > Date.parse(v.startsAt), {
    error: "The end must be after the start",
    path: ["endsAt"],
  })
  .refine((v) => Date.parse(v.endsAt) - Date.parse(v.startsAt) <= MAX_TIME_OFF_DAYS * 86_400_000, {
    error: `At most ${MAX_TIME_OFF_DAYS} days at a time`,
    path: ["endsAt"],
  });

export const staffMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string().nullable(),
  role: z.string(),
  /** Null = works across the organization. */
  branchScope: z.uuid().nullable(),
  availability: z.array(
    z.object({
      branchId: z.uuid(),
      weekly: z.record(z.string(), z.array(z.object({ opens: z.string(), closes: z.string() }))),
    }),
  ),
  timeOff: z.array(
    z.object({
      id: z.uuid(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      reason: z.string().nullable(),
    }),
  ),
});
export type StaffMemberDto = z.infer<typeof staffMemberSchema>;

// --- Slots and appointments -----------------------------------------------------------------

export const slotQuerySchema = z
  .object({
    branchId: z.uuid(),
    date: localDateSchema,
    durationMinutes: z.coerce.number().pipe(duration),
    staffUserId: z.uuid().optional(),
  })
  .strict();

export const slotsSchema = z.object({
  branchId: z.uuid(),
  date: z.string(),
  timeZone: z.string(),
  durationMinutes: z.number().int(),
  slots: z.array(
    z.object({
      /** Local `HH:MM` in the branch's timezone. */
      start: z.string(),
      startsAt: z.iso.datetime(),
      endsAt: z.iso.datetime(),
      staffUserIds: z.array(z.uuid()),
    }),
  ),
});
export type SlotsDto = z.infer<typeof slotsSchema>;

export const createAppointmentSchema = z
  .object({
    branchId: z.uuid(),
    staffUserId: z.uuid(),
    start: localStartSchema,
    durationMinutes: duration,
    title: boundedText(120).min(2, "Give the appointment a title"),
    /** An inquiry whose quote the customer accepted: the customer sees the appointment. */
    recipientId: z.uuid().nullable().default(null),
    /** For walk-ins and phone bookings without an inquiry. Provider-only. */
    customerName: boundedText(120).nullable().default(null),
    /** Internal, never shown to the customer. */
    notes: boundedText(2000).nullable().default(null),
  })
  .strict();

export const updateAppointmentSchema = z
  .object({
    start: localStartSchema.optional(),
    durationMinutes: duration.optional(),
    staffUserId: z.uuid().optional(),
    title: boundedText(120).min(2).optional(),
    notes: boundedText(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const appointmentStatusRequestSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("completed") }).strict(),
  z.object({ status: z.literal("no_show") }).strict(),
  z
    .object({
      status: z.literal("cancelled"),
      reason: boundedText(500).min(3, "Give a short reason"),
    })
    .strict(),
]);

export const appointmentQuerySchema = z
  .object({
    from: localDateSchema.optional(),
    to: localDateSchema.optional(),
    staffUserId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    status: z.enum(APPOINTMENT_STATUSES).optional(),
  })
  .strict();

const localWindow = z.object({
  date: z.string(),
  /** Local `HH:MM`. */
  start: z.string(),
  end: z.string(),
});

export const appointmentSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  branchName: z.string(),
  staff: person,
  recipientId: z.uuid().nullable(),
  requestId: z.uuid().nullable(),
  title: z.string(),
  customerName: z.string().nullable(),
  notes: z.string().nullable(),
  status: z.enum(APPOINTMENT_STATUSES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  durationMinutes: z.number().int(),
  timeZone: z.string(),
  local: localWindow,
  cancelReason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type AppointmentDto = z.infer<typeof appointmentSchema>;

/** What the customer sees: no staff identity, no internal notes. */
export const customerAppointmentSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  providerOrganizationId: z.uuid(),
  providerName: z.string(),
  branchName: z.string(),
  title: z.string(),
  status: z.enum(APPOINTMENT_STATUSES),
  startsAt: z.iso.datetime(),
  endsAt: z.iso.datetime(),
  timeZone: z.string(),
  local: localWindow,
});
export type CustomerAppointmentDto = z.infer<typeof customerAppointmentSchema>;

// --- Analytics and response status ----------------------------------------------------------

export const RESPONSE_LEVELS = [
  "within_hour",
  "within_hours",
  "within_day",
  "slower",
  "not_enough_data",
] as const;

export const RESPONSE_LEVEL_LABELS: Readonly<Record<(typeof RESPONSE_LEVELS)[number], string>> = {
  within_hour: "Usually responds within an hour",
  within_hours: "Usually responds within a few hours",
  within_day: "Usually responds within a day",
  slower: "Usually takes more than a day to respond",
  not_enough_data: "Not enough inquiries yet to show a response time",
};

/** Bucket a median first-response time (minutes) into a public level. */
export function responseLevel(
  medianMinutes: number | null,
  received: number,
): (typeof RESPONSE_LEVELS)[number] {
  if (received < RESPONSE_STATUS_MIN_INQUIRIES || medianMinutes === null) return "not_enough_data";
  if (medianMinutes <= 60) return "within_hour";
  if (medianMinutes <= 6 * 60) return "within_hours";
  if (medianMinutes <= 24 * 60) return "within_day";
  return "slower";
}

export const responseStatusSchema = z.object({
  level: z.enum(RESPONSE_LEVELS),
  label: z.string(),
  /** Share of inquiries answered with a quote or a decline; null until there's enough data. */
  responseRate: z.number().nullable(),
  basedOnInquiries: z.number().int(),
  windowDays: z.literal(RESPONSE_STATUS_WINDOW_DAYS),
  note: z.literal(RESPONSE_STATUS_NOTE),
});
export type ResponseStatusDto = z.infer<typeof responseStatusSchema>;

export const analyticsQuerySchema = z
  .object({
    days: z.coerce.number().int().min(7).max(365).default(30),
    branchId: z.uuid().optional(),
  })
  .strict();

export const providerAnalyticsSchema = z.object({
  periodDays: z.number().int(),
  since: z.iso.datetime(),
  branchId: z.uuid().nullable(),
  inquiries: z.object({
    received: z.number().int(),
    responded: z.number().int(),
    responseRate: z.number().nullable(),
    medianFirstResponseMinutes: z.number().nullable(),
    respondedWithinTarget: z.number().int(),
  }),
  quotes: z.object({
    sent: z.number().int(),
    won: z.number().int(),
    lost: z.number().int(),
    winRate: z.number().nullable(),
  }),
  appointments: z.object({
    booked: z.number().int(),
    completed: z.number().int(),
    noShow: z.number().int(),
    cancelled: z.number().int(),
    upcoming: z.number().int(),
  }),
  pipeline: z.record(z.enum(PIPELINE_STAGES), z.number().int()),
  responseStatus: responseStatusSchema,
});
export type ProviderAnalyticsDto = z.infer<typeof providerAnalyticsSchema>;

export const crmErrorReasonSchema = z.enum([
  "not_a_provider",
  "invalid_assignee",
  "invalid_branch",
  "invalid_link",
  "inquiry_not_bookable",
  "slot_unavailable",
  "outside_availability",
  "invalid_local_time",
  "in_the_past",
  "too_far_ahead",
  "invalid_transition",
  "not_started",
  "not_allowed",
  "not_author",
  "conflicts_with_appointments",
  "invalid_range",
]);
export type CrmErrorReason = z.infer<typeof crmErrorReasonSchema>;

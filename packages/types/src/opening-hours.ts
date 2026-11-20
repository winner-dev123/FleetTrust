import { z } from "zod";

import { timeZoneSchema } from "./entitlements.js";
import { boundedText } from "./providers.js";

/**
 * Opening hours (SRS F-035). Times are local wall-clock times in the branch's IANA timezone.
 * An interval whose `closes` is at or before `opens` runs past midnight into the next day
 * (e.g. 22:00–06:00). `00:00`–`24:00` is open all day.
 */
export const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"] as const;
export type Weekday = (typeof WEEKDAYS)[number];

export const MAX_INTERVALS_PER_DAY = 4;
/** How far ahead holiday exceptions may be entered, in days. */
export const MAX_EXCEPTION_DAYS_AHEAD = 730;

const clockTime = z
  .string()
  .regex(/^(?:[01]\d|2[0-3]):[0-5]\d$|^24:00$/, "24-hour time, e.g. 08:30 (24:00 for midnight)");

export const hoursIntervalSchema = z
  .object({ opens: clockTime, closes: clockTime })
  .strict()
  .refine((i) => i.opens !== "24:00", { message: "Opening time can't be 24:00", path: ["opens"] })
  .refine((i) => i.opens !== i.closes, {
    message: "Opening and closing times are the same (use 00:00–24:00 for all day)",
    path: ["closes"],
  });
export type HoursInterval = z.infer<typeof hoursIntervalSchema>;

/** Minutes after the day's midnight; overnight intervals end after 1440. */
export function intervalMinutes(interval: HoursInterval): { start: number; end: number } {
  const toMinutes = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const start = toMinutes(interval.opens);
  const close = toMinutes(interval.closes);
  return { start, end: close <= start ? close + 1440 : close };
}

const dayIntervalsSchema = z
  .array(hoursIntervalSchema)
  .max(MAX_INTERVALS_PER_DAY)
  .superRefine((intervals, ctx) => {
    const sorted = intervals.map(intervalMinutes).sort((a, b) => a.start - b.start);
    for (let i = 1; i < sorted.length; i++) {
      const previous = sorted[i - 1];
      const current = sorted[i];
      if (previous && current && current.start < previous.end) {
        ctx.addIssue({ code: "custom", message: "Opening times overlap" });
        return;
      }
    }
  });

/** A week of hours. A missing or empty day is closed. */
export const weeklyHoursSchema = z
  .object(Object.fromEntries(WEEKDAYS.map((d) => [d, dayIntervalsSchema.optional()])))
  .strict() as unknown as z.ZodType<Partial<Record<Weekday, HoursInterval[]>>>;
export type WeeklyHours = Partial<Record<Weekday, HoursInterval[]>>;

export const DATE_PATTERN = /^\d{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12]\d|3[01])$/;
export const localDateSchema = z
  .string()
  .regex(DATE_PATTERN, "Date as YYYY-MM-DD")
  .refine((d) => {
    const parsed = new Date(`${d}T00:00:00Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(d);
  }, "Not a calendar date");

/** PUT the whole week. `timeZone: null` uses the organization's timezone. */
export const branchHoursRequestSchema = z
  .object({ timeZone: timeZoneSchema.nullable(), weekly: weeklyHoursSchema })
  .strict();
export type BranchHoursRequest = z.infer<typeof branchHoursRequestSchema>;

/** A holiday or special day: closed, or open with different hours. Replaces the weekly hours. */
export const hoursExceptionRequestSchema = z.discriminatedUnion("closed", [
  z.object({ closed: z.literal(true), label: boundedText(80).nullable().default(null) }).strict(),
  z
    .object({
      closed: z.literal(false),
      label: boundedText(80).nullable().default(null),
      intervals: dayIntervalsSchema.min(1, "Add the special opening times"),
    })
    .strict(),
]);
export type HoursExceptionRequest = z.input<typeof hoursExceptionRequestSchema>;

export interface HoursException {
  date: string;
  closed: boolean;
  label: string | null;
  intervals: HoursInterval[];
}

export const hoursExceptionSchema = z.object({
  date: z.string(),
  closed: z.boolean(),
  label: z.string().nullable(),
  intervals: z.array(z.object({ opens: z.string(), closes: z.string() })),
});

export const openingStatusSchema = z.object({
  /** False when the branch hasn't published hours: "Hours not provided", never "Closed". */
  known: z.boolean(),
  isOpen: z.boolean(),
  /** Local wall-clock time the status was computed for, `YYYY-MM-DDTHH:MM`. */
  localTime: z.string(),
  /** Local time it closes; null when open around the clock or closed. */
  closesAt: z.string().nullable(),
  /** Next local opening time within a week; null when open or nothing is scheduled. */
  opensAt: z.string().nullable(),
  /** Label of today's exception ("Christmas Day"), if one applies. */
  exception: z.string().nullable(),
});
export type OpeningStatus = z.infer<typeof openingStatusSchema>;

export const branchHoursSchema = z.object({
  branchId: z.uuid(),
  timeZone: z.string(),
  /** Whether the timezone is set on the branch or inherited from the organization. */
  timeZoneSource: z.enum(["branch", "organization"]),
  /** Null until the provider saves hours. */
  weekly: z
    .record(z.string(), z.array(z.object({ opens: z.string(), closes: z.string() })))
    .nullable(),
  /** Today and later, in the branch's local calendar. */
  exceptions: z.array(hoursExceptionSchema),
  status: openingStatusSchema,
});
export type BranchHoursDto = z.infer<typeof branchHoursSchema>;

// --- Local time ------------------------------------------------------------------------------

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let f = formatters.get(timeZone);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
    formatters.set(timeZone, f);
  }
  return f;
}

/** The wall-clock date and minute-of-day at `at` in `timeZone` (DST-aware via Intl). */
export function localClock(at: Date, timeZone: string): { date: string; minute: number } {
  const parts = formatter(timeZone).formatToParts(at);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? "";
  const hour = Number(part("hour")) % 24;
  return {
    date: `${part("year")}-${part("month")}-${part("day")}`,
    minute: hour * 60 + Number(part("minute")),
  };
}

/** Calendar arithmetic on `YYYY-MM-DD` (no timezone involved). */
export function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function weekdayOf(date: string): Weekday {
  // getUTCDay: 0 = Sunday.
  const index = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return WEEKDAYS[index] ?? "mon";
}

function stamp(baseDate: string, minute: number): string {
  const days = Math.floor(minute / 1440);
  const m = minute - days * 1440;
  const hh = String(Math.floor(m / 60)).padStart(2, "0");
  const mm = String(m % 60).padStart(2, "0");
  return `${addDays(baseDate, days)}T${hh}:${mm}`;
}

/**
 * Whether a branch is open at `at`, and when that changes. A date's exception replaces that
 * date's weekly hours; an overnight interval from the previous day still counts after midnight.
 * Contiguous intervals (22:00–24:00 then 00:00–06:00) are merged, so `closesAt` is the real
 * closing time. Pass `weekly: null` when the provider hasn't set hours.
 */
export function openingStatus(
  schedule: {
    weekly: WeeklyHours | null;
    exceptions: readonly HoursException[];
    timeZone: string;
  },
  at: Date,
): OpeningStatus {
  const now = localClock(at, schedule.timeZone);
  const localTime = stamp(now.date, now.minute);
  const today = schedule.exceptions.find((e) => e.date === now.date) ?? null;
  if (schedule.weekly === null) {
    return {
      known: false,
      isOpen: false,
      localTime,
      closesAt: null,
      opensAt: null,
      exception: today?.label ?? null,
    };
  }
  const weekly = schedule.weekly;
  const byDate = new Map(schedule.exceptions.map((e) => [e.date, e]));
  const intervalsOn = (date: string): HoursInterval[] => {
    const exception = byDate.get(date);
    if (exception) return exception.closed ? [] : exception.intervals;
    return weekly[weekdayOf(date)] ?? [];
  };

  // Timeline in minutes relative to today's midnight, from yesterday to a week ahead.
  const FIRST = -1;
  const LAST = 7;
  const ranges: { start: number; end: number }[] = [];
  for (let day = FIRST; day <= LAST; day++) {
    for (const interval of intervalsOn(addDays(now.date, day))) {
      const { start, end } = intervalMinutes(interval);
      ranges.push({ start: start + day * 1440, end: end + day * 1440 });
    }
  }
  ranges.sort((a, b) => a.start - b.start);
  const merged: { start: number; end: number }[] = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  const horizon = (LAST + 1) * 1440;
  const current = merged.find((r) => r.start <= now.minute && now.minute < r.end);
  const next = merged.find((r) => r.start > now.minute && r.start < horizon);
  return {
    known: true,
    isOpen: current !== undefined,
    localTime,
    closesAt: current && current.end < horizon ? stamp(now.date, current.end) : null,
    opensAt: current ? null : next ? stamp(now.date, next.start) : null,
    exception: today?.label ?? null,
  };
}

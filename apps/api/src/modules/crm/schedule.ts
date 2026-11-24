import {
  addDays,
  weekdayOf,
  WEEKDAYS,
  zonedBoundaryToUtc,
  zonedTimeToUtc,
} from "@fleettrust/types";

/**
 * Pure availability maths for appointments (ADR-0027). Everything is turned into UTC instant
 * ranges first, so daylight-saving changes are handled once, by the timezone conversion: a
 * local 09:00–17:00 day is eight real hours, or seven or nine when the clocks change inside it.
 */

/** Half-open `[start, end)` in epoch milliseconds. */
export interface Range {
  start: number;
  end: number;
}

/** Local minutes after midnight; `end` above 1440 runs into the next day. */
export interface MinuteInterval {
  start: number;
  end: number;
}

export function mergeRanges(ranges: readonly Range[]): Range[] {
  const sorted = ranges.filter((r) => r.end > r.start).sort((a, b) => a.start - b.start);
  const merged: Range[] = [];
  for (const range of sorted) {
    const last = merged.at(-1);
    if (last && range.start <= last.end) last.end = Math.max(last.end, range.end);
    else merged.push({ ...range });
  }
  return merged;
}

export function intersectRanges(a: readonly Range[], b: readonly Range[]): Range[] {
  const result: Range[] = [];
  for (const x of mergeRanges(a)) {
    for (const y of mergeRanges(b)) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) result.push({ start, end });
    }
  }
  return mergeRanges(result);
}

export function subtractRanges(from: readonly Range[], remove: readonly Range[]): Range[] {
  let current = mergeRanges(from);
  for (const cut of mergeRanges(remove)) {
    const next: Range[] = [];
    for (const r of current) {
      if (cut.end <= r.start || cut.start >= r.end) {
        next.push(r);
        continue;
      }
      if (cut.start > r.start) next.push({ start: r.start, end: cut.start });
      if (cut.end < r.end) next.push({ start: cut.end, end: r.end });
    }
    current = next;
  }
  return current;
}

export function containsRange(ranges: readonly Range[], target: Range): boolean {
  return ranges.some((r) => r.start <= target.start && target.end <= r.end);
}

export function overlapsAny(ranges: readonly Range[], target: Range): boolean {
  return ranges.some((r) => r.start < target.end && target.start < r.end);
}

/** ISO weekday 1..7 of a local date. */
export function isoWeekday(date: string): number {
  return WEEKDAYS.indexOf(weekdayOf(date)) + 1;
}

/**
 * UTC ranges for the local intervals of `date` and its neighbours (overnight spill both ways),
 * in `timeZone`. `intervalsOn` gives a local date's intervals in minutes.
 */
export function localWindows(
  date: string,
  timeZone: string,
  intervalsOn: (localDate: string) => readonly MinuteInterval[],
): Range[] {
  const ranges: Range[] = [];
  for (const offset of [-1, 0, 1]) {
    const day = addDays(date, offset);
    for (const interval of intervalsOn(day)) {
      ranges.push({
        start: zonedBoundaryToUtc(day, interval.start, timeZone).getTime(),
        end: zonedBoundaryToUtc(day, interval.end, timeZone).getTime(),
      });
    }
  }
  return mergeRanges(ranges);
}

/** The UTC span that can hold appointments starting on local `date` (with overnight margin). */
export function dateSpan(date: string, timeZone: string): Range {
  return {
    start: zonedBoundaryToUtc(addDays(date, -1), 0, timeZone).getTime(),
    end: zonedBoundaryToUtc(addDays(date, 2), 0, timeZone).getTime(),
  };
}

/**
 * Candidate start instants on local `date`, every `stepMinutes` of wall-clock time. Local times
 * skipped by a spring-forward change don't exist and are left out.
 */
export function slotStarts(
  date: string,
  timeZone: string,
  stepMinutes: number,
): { minute: number; at: Date }[] {
  const result: { minute: number; at: Date }[] = [];
  for (let minute = 0; minute < 1440; minute += stepMinutes) {
    const at = zonedTimeToUtc(date, minute, timeZone);
    if (at) result.push({ minute, at });
  }
  return result;
}

export function clock(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`;
}

import type { MaintenanceSchedule } from "@fleettrust/db";

import { addDays, daysBetween } from "./shared.js";

export type ScheduleStatus = "ok" | "due_soon" | "overdue" | "unknown";

/**
 * When a schedule is next due and how urgent it is. Distance and time both count: whichever is
 * closer decides. Without a baseline (never done, no reading) the status is "unknown".
 */
export function scheduleStatus(
  schedule: Pick<
    MaintenanceSchedule,
    | "intervalKm"
    | "intervalDays"
    | "lastDoneKm"
    | "lastDoneOn"
    | "remindBeforeKm"
    | "remindBeforeDays"
  >,
  odometerKm: number | null,
  today: string,
): { status: ScheduleStatus; nextDueKm: number | null; nextDueOn: string | null } {
  const nextDueKm =
    schedule.intervalKm !== null && schedule.lastDoneKm !== null
      ? schedule.lastDoneKm + schedule.intervalKm
      : null;
  const nextDueOn =
    schedule.intervalDays !== null && schedule.lastDoneOn !== null
      ? addDays(schedule.lastDoneOn, schedule.intervalDays)
      : null;
  const statuses: ScheduleStatus[] = [];
  if (nextDueKm !== null && odometerKm !== null) {
    if (odometerKm >= nextDueKm) statuses.push("overdue");
    else if (odometerKm >= nextDueKm - schedule.remindBeforeKm) statuses.push("due_soon");
    else statuses.push("ok");
  }
  if (nextDueOn !== null) {
    const days = daysBetween(today, nextDueOn);
    if (days < 0) statuses.push("overdue");
    else if (days <= schedule.remindBeforeDays) statuses.push("due_soon");
    else statuses.push("ok");
  }
  const status: ScheduleStatus = statuses.includes("overdue")
    ? "overdue"
    : statuses.includes("due_soon")
      ? "due_soon"
      : statuses.length > 0
        ? "ok"
        : "unknown";
  return { status, nextDueKm, nextDueOn };
}

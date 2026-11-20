import {
  and,
  asc,
  type Branch,
  branches,
  branchHoursExceptions,
  branchOpeningHours,
  type Database,
  eq,
  gte,
  inArray,
  lte,
  recordAuditEvent,
  type User,
} from "@fleettrust/db";
import {
  addDays,
  type BranchHoursDto,
  type BranchHoursRequest,
  type HoursException,
  type HoursInterval,
  hoursExceptionRequestSchema,
  intervalMinutes,
  localClock,
  MAX_EXCEPTION_DAYS_AHEAD,
  openingStatus,
  WEEKDAYS,
  type WeeklyHours,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { catalogError } from "./catalog.service.js";
import { assertProvider, notFound } from "./shared.js";

type ExceptionInput = z.output<typeof hoursExceptionRequestSchema>;

/** Days of exceptions shown publicly. */
const PUBLIC_EXCEPTION_DAYS = 60;

export interface BranchSchedule {
  timeZone: string;
  weekly: WeeklyHours | null;
  exceptions: HoursException[];
}

function clockOf(minute: number): string {
  const m = minute % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Stored minutes → `{ opens, closes }`; overnight closes wrap past midnight. */
function toInterval(opens: number, closes: number): HoursInterval {
  return { opens: clockOf(opens), closes: closes === 1440 ? "24:00" : clockOf(closes) };
}

/**
 * Opening hours and holiday exceptions (SRS F-035), in each branch's local time. Hours are
 * live: saving them changes the public profile at once, so closures never wait for a republish.
 */
@Injectable()
export class HoursService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async branch(access: TenantAccess, branchId: string): Promise<Branch> {
    const [row] = await this.db
      .select()
      .from(branches)
      .where(
        and(eq(branches.organizationId, access.tenant.organizationId), eq(branches.id, branchId)),
      );
    if (!row) throw notFound();
    return row;
  }

  /** Writers limited to a branch can only edit that branch; others look like they don't exist. */
  private assertWritable(access: TenantAccess, branchId: string): void {
    if (access.branchScope !== null && access.branchScope !== branchId) throw notFound();
  }

  /** Branch timezone, or the organization's. */
  private timeZoneOf(branch: Branch, organizationTimeZone: string) {
    return branch.timeZone
      ? { timeZone: branch.timeZone, source: "branch" as const }
      : { timeZone: organizationTimeZone, source: "organization" as const };
  }

  /** Live schedules for the given branches (public views and the wizard). */
  async schedules(
    organizationTimeZone: string,
    branchRows: readonly Branch[],
  ): Promise<Map<string, BranchSchedule>> {
    const ids = branchRows.map((b) => b.id);
    const result = new Map<string, BranchSchedule>();
    if (ids.length === 0) return result;
    // Wide enough for every timezone: from yesterday (overnight spill) to the public window.
    const today = this.clock.now().toISOString().slice(0, 10);
    const [weekly, exceptions] = await Promise.all([
      this.db
        .select()
        .from(branchOpeningHours)
        .where(inArray(branchOpeningHours.branchId, ids))
        .orderBy(asc(branchOpeningHours.weekday), asc(branchOpeningHours.opensMinute)),
      this.db
        .select()
        .from(branchHoursExceptions)
        .where(
          and(
            inArray(branchHoursExceptions.branchId, ids),
            gte(branchHoursExceptions.date, addDays(today, -2)),
            lte(branchHoursExceptions.date, addDays(today, PUBLIC_EXCEPTION_DAYS + 2)),
          ),
        )
        .orderBy(asc(branchHoursExceptions.date)),
    ]);
    for (const branch of branchRows) {
      const week: WeeklyHours = {};
      for (const row of weekly.filter((w) => w.branchId === branch.id)) {
        const day = WEEKDAYS[row.weekday - 1];
        if (day) (week[day] ??= []).push(toInterval(row.opensMinute, row.closesMinute));
      }
      result.set(branch.id, {
        timeZone: this.timeZoneOf(branch, organizationTimeZone).timeZone,
        weekly: branch.hoursUpdatedAt === null ? null : week,
        exceptions: exceptions
          .filter((e) => e.branchId === branch.id)
          .map((e) => ({
            date: e.date,
            closed: e.closed,
            label: e.label,
            intervals: e.intervals,
          })),
      });
    }
    return result;
  }

  /** The public `hours` block: status now, weekly hours, and exceptions from today on. */
  present(schedule: BranchSchedule) {
    const now = this.clock.now();
    const today = localClock(now, schedule.timeZone).date;
    const last = addDays(today, PUBLIC_EXCEPTION_DAYS);
    return {
      weekly: schedule.weekly,
      exceptions: schedule.exceptions.filter((e) => e.date >= today && e.date <= last),
      status: openingStatus(schedule, now),
    };
  }

  async get(access: TenantAccess, branchId: string): Promise<BranchHoursDto> {
    assertProvider(access);
    const branch = await this.branch(access, branchId);
    const schedule = (await this.schedules(access.organization.timezone, [branch])).get(branch.id);
    if (!schedule) throw notFound();
    const { exceptions, status } = this.present(schedule);
    return {
      branchId,
      timeZone: schedule.timeZone,
      timeZoneSource: this.timeZoneOf(branch, access.organization.timezone).source,
      weekly: schedule.weekly,
      exceptions,
      status,
    };
  }

  /** Replaces the whole week (and the branch timezone). */
  async put(
    access: TenantAccess,
    actor: User,
    branchId: string,
    input: BranchHoursRequest,
  ): Promise<BranchHoursDto> {
    assertProvider(access);
    this.assertWritable(access, branchId);
    const branch = await this.branch(access, branchId);
    const orgId = access.tenant.organizationId;
    const rows = WEEKDAYS.flatMap((day, index) =>
      (input.weekly[day] ?? []).map((interval) => {
        const { start, end } = intervalMinutes(interval);
        return {
          organizationId: orgId,
          branchId,
          weekday: index + 1,
          opensMinute: start,
          closesMinute: end,
        };
      }),
    );
    await this.db.transaction(async (tx) => {
      await tx.delete(branchOpeningHours).where(eq(branchOpeningHours.branchId, branch.id));
      if (rows.length > 0) await tx.insert(branchOpeningHours).values(rows);
      await tx
        .update(branches)
        .set({ timeZone: input.timeZone, hoursUpdatedAt: this.clock.now() })
        .where(and(eq(branches.id, branch.id), eq(branches.organizationId, orgId)));
      await this.audit(tx, actor, orgId, "branch.hours_saved", branchId, {
        timeZone: input.timeZone,
        intervals: rows.length,
      });
    });
    return this.get(access, branchId);
  }

  /** Adds or replaces the exception for one local date (today up to two years ahead). */
  async putException(
    access: TenantAccess,
    actor: User,
    branchId: string,
    date: string,
    input: ExceptionInput,
  ): Promise<BranchHoursDto> {
    assertProvider(access);
    this.assertWritable(access, branchId);
    const branch = await this.branch(access, branchId);
    const { timeZone } = this.timeZoneOf(branch, access.organization.timezone);
    const today = localClock(this.clock.now(), timeZone).date;
    if (date < today || date > addDays(today, MAX_EXCEPTION_DAYS_AHEAD)) {
      throw catalogError(400, "date_out_of_range");
    }
    const values = {
      closed: input.closed,
      label: input.label,
      intervals: input.closed ? [] : input.intervals,
    };
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      await tx
        .insert(branchHoursExceptions)
        .values({ organizationId: orgId, branchId, date, ...values })
        .onConflictDoUpdate({
          target: [branchHoursExceptions.branchId, branchHoursExceptions.date],
          set: values,
        });
      await this.audit(tx, actor, orgId, "branch.hours_exception_saved", branchId, {
        date,
        closed: input.closed,
      });
    });
    return this.get(access, branchId);
  }

  async removeException(
    access: TenantAccess,
    actor: User,
    branchId: string,
    date: string,
  ): Promise<void> {
    assertProvider(access);
    this.assertWritable(access, branchId);
    await this.branch(access, branchId);
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      const deleted = await tx
        .delete(branchHoursExceptions)
        .where(
          and(
            eq(branchHoursExceptions.organizationId, orgId),
            eq(branchHoursExceptions.branchId, branchId),
            eq(branchHoursExceptions.date, date),
          ),
        )
        .returning({ id: branchHoursExceptions.id });
      if (deleted.length === 0) throw notFound();
      await this.audit(tx, actor, orgId, "branch.hours_exception_removed", branchId, { date });
    });
  }

  private async audit(
    executor: Parameters<typeof recordAuditEvent>[0],
    actor: User,
    organizationId: string,
    action: string,
    branchId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId,
      action,
      targetType: "branch",
      targetId: branchId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }
}

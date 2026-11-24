import {
  and,
  type Appointment,
  appointments,
  asc,
  type Branch,
  branches,
  branchHoursExceptions,
  branchOpeningHours,
  type Database,
  enqueueOutboxEvent,
  eq,
  type Executor,
  gt,
  gte,
  inArray,
  isNull,
  lt,
  lte,
  memberships,
  ne,
  or,
  organizations,
  recordAuditEvent,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  staffAvailability,
  staffTimeOff,
  type User,
  users,
} from "@fleettrust/db";
import {
  addDays,
  type AppointmentDto,
  type appointmentQuerySchema,
  type appointmentStatusRequestSchema,
  type createAppointmentSchema,
  type CustomerAppointmentDto,
  intervalMinutes,
  localStamp,
  MAX_BOOKING_DAYS_AHEAD,
  SLOT_STEP_MINUTES,
  type SlotsDto,
  type slotQuerySchema,
  type StaffMemberDto,
  type staffAvailabilityRequestSchema,
  type timeOffRequestSchema,
  type updateAppointmentSchema,
  WEEKDAYS,
  zonedTimeToUtc,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import {
  containsRange,
  dateSpan,
  intersectRanges,
  isoWeekday,
  localWindows,
  type MinuteInterval,
  overlapsAny,
  type Range,
  slotStarts,
  subtractRanges,
} from "./schedule.js";
import {
  assertManager,
  assertProvider,
  canManage,
  crmError,
  eligibleMember,
  inScope,
  isExclusionViolation,
  notFound,
  recipientInScope,
  STAFF_ROLES,
} from "./shared.js";

type SlotQuery = z.output<typeof slotQuerySchema>;
type BookInput = z.output<typeof createAppointmentSchema>;
type UpdateInput = z.output<typeof updateAppointmentSchema>;
type StatusInput = z.output<typeof appointmentStatusRequestSchema>;
type ListQuery = z.output<typeof appointmentQuerySchema>;
type AvailabilityInput = z.output<typeof staffAvailabilityRequestSchema>;
type TimeOffInput = z.output<typeof timeOffRequestSchema>;

const MINUTE = 60_000;
const DAY_MS = 86_400_000;
/** Default calendar window: from yesterday to four weeks ahead. */
const DEFAULT_WINDOW_DAYS = 28;

/** Minute intervals by ISO weekday. */
type Week = Map<number, MinuteInterval[]>;

function weekOf(rows: readonly { weekday: number; opensMinute: number; closesMinute: number }[]) {
  const week: Week = new Map();
  for (const row of rows) {
    const list = week.get(row.weekday) ?? [];
    list.push({ start: row.opensMinute, end: row.closesMinute });
    week.set(row.weekday, list);
  }
  return week;
}

function clockOf(minute: number): string {
  const m = ((minute % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
}

/** Everything needed to decide when people at one branch can be booked on one local date. */
interface DayContext {
  branch: Branch;
  timeZone: string;
  date: string;
  span: Range;
  /** Branch opening hours on and around the date; null when the branch hasn't set hours. */
  branchOpen: Range[] | null;
  /** Local dates (around the date) the branch is closed for a holiday. */
  closed: Range[];
}

/**
 * Staff availability, time off, slots and appointments (F-131, ADR-0027).
 *
 * Bookable time for a staff member on a day = their weekly hours at the branch (or the branch's
 * opening hours when they have none), within the branch's opening hours when it has any, minus
 * holiday closures, time off and their booked appointments. Bookings take a per-staff advisory
 * lock and re-check inside the transaction; the database exclusion constraint is the final
 * guard, so two concurrent bookings of the same time can never both succeed.
 */
@Injectable()
export class AppointmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Lookups ---------------------------------------------------------------------------------

  private async branchOf(executor: Executor, access: TenantAccess, branchId: string) {
    const [row] = await executor
      .select({ branch: branches, orgTimeZone: organizations.timezone })
      .from(branches)
      .innerJoin(organizations, eq(organizations.id, branches.organizationId))
      .where(
        and(eq(branches.id, branchId), eq(branches.organizationId, access.tenant.organizationId)),
      );
    if (!row || !inScope(access, branchId)) throw crmError(400, "invalid_branch");
    return { branch: row.branch, timeZone: row.branch.timeZone ?? row.orgTimeZone };
  }

  private async dayContext(
    executor: Executor,
    branch: Branch,
    timeZone: string,
    date: string,
  ): Promise<DayContext> {
    const [hours, exceptions] = await Promise.all([
      executor.select().from(branchOpeningHours).where(eq(branchOpeningHours.branchId, branch.id)),
      executor
        .select()
        .from(branchHoursExceptions)
        .where(
          and(
            eq(branchHoursExceptions.branchId, branch.id),
            gte(branchHoursExceptions.date, addDays(date, -1)),
            lte(branchHoursExceptions.date, addDays(date, 1)),
          ),
        ),
    ]);
    const byDate = new Map(exceptions.map((e) => [e.date, e]));
    const week = weekOf(hours);
    const branchOpen =
      branch.hoursUpdatedAt === null
        ? null
        : localWindows(date, timeZone, (day) => {
            const exception = byDate.get(day);
            if (exception) return exception.closed ? [] : exception.intervals.map(intervalMinutes);
            return week.get(isoWeekday(day)) ?? [];
          });
    const closed = localWindows(date, timeZone, (day) =>
      byDate.get(day)?.closed ? [{ start: 0, end: 1440 }] : [],
    );
    return { branch, timeZone, date, span: dateSpan(date, timeZone), branchOpen, closed };
  }

  /** Free time for each staff member on the context's day (UTC ranges). */
  private async freeTime(
    executor: Executor,
    day: DayContext,
    staffIds: readonly string[],
    ignoreAppointmentId?: string,
  ): Promise<Map<string, Range[]>> {
    const result = new Map<string, Range[]>();
    if (staffIds.length === 0) return result;
    const from = new Date(day.span.start);
    const to = new Date(day.span.end);
    const [availability, timeOff, booked] = await Promise.all([
      executor
        .select()
        .from(staffAvailability)
        .where(
          and(
            eq(staffAvailability.branchId, day.branch.id),
            inArray(staffAvailability.userId, [...staffIds]),
          ),
        ),
      executor
        .select()
        .from(staffTimeOff)
        .where(
          and(
            inArray(staffTimeOff.userId, [...staffIds]),
            lt(staffTimeOff.startsAt, to),
            gt(staffTimeOff.endsAt, from),
          ),
        ),
      executor
        .select()
        .from(appointments)
        .where(
          and(
            inArray(appointments.staffUserId, [...staffIds]),
            eq(appointments.status, "booked"),
            lt(appointments.startsAt, to),
            gt(appointments.endsAt, from),
            ignoreAppointmentId ? ne(appointments.id, ignoreAppointmentId) : undefined,
          ),
        ),
    ]);
    for (const staffId of staffIds) {
      const own = availability.filter((a) => a.userId === staffId);
      const staffHours =
        own.length > 0
          ? localWindows(day.date, day.timeZone, (d) => weekOf(own).get(isoWeekday(d)) ?? [])
          : null;
      let windows: Range[];
      if (staffHours && day.branchOpen) windows = intersectRanges(staffHours, day.branchOpen);
      else windows = staffHours ?? day.branchOpen ?? [];
      const busy = [
        ...day.closed,
        ...timeOff
          .filter((t) => t.userId === staffId)
          .map((t) => ({ start: t.startsAt.getTime(), end: t.endsAt.getTime() })),
      ];
      const appointmentsBusy = booked
        .filter((b) => b.staffUserId === staffId)
        .map((b) => ({ start: b.startsAt.getTime(), end: b.endsAt.getTime() }));
      result.set(staffId, subtractRanges(subtractRanges(windows, busy), appointmentsBusy));
    }
    return result;
  }

  /** Members who can work at the branch (organization-wide or scoped to it). */
  private async staffAt(executor: Executor, organizationId: string, branchId: string) {
    return executor
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
      })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, organizationId),
          inArray(memberships.role, [...STAFF_ROLES]),
          or(isNull(memberships.branchId), eq(memberships.branchId, branchId)),
        ),
      );
  }

  /**
   * A staff member whose time off you manage: anyone (organization-wide managers) or members
   * scoped to your branch (branch-scoped managers).
   */
  private async memberInScope(executor: Executor, access: TenantAccess, userId: string) {
    const [member] = await executor
      .select()
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, access.tenant.organizationId),
          eq(memberships.userId, userId),
          inArray(memberships.role, [...STAFF_ROLES]),
        ),
      );
    if (!member) return null;
    return access.branchScope === null || member.branchId === access.branchScope ? member : null;
  }

  private async lockStaff(executor: Executor, staffUserId: string): Promise<void> {
    await executor.execute(
      sql`SELECT pg_advisory_xact_lock(hashtextextended(${`staff:${staffUserId}`}, 0))`,
    );
  }

  private async audit(
    executor: Executor,
    access: TenantAccess,
    actor: User,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: access.tenant.organizationId,
      action: `crm.${action}`,
      targetType,
      targetId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  // --- Staff, availability and time off --------------------------------------------------------

  async staff(access: TenantAccess, actor: User): Promise<StaffMemberDto[]> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    const manager = canManage(access);
    const members = await this.db
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
        displayName: users.displayName,
      })
      .from(memberships)
      .innerJoin(users, eq(users.id, memberships.userId))
      .where(
        and(
          eq(memberships.organizationId, orgId),
          inArray(memberships.role, [...STAFF_ROLES]),
          access.branchScope === null
            ? undefined
            : or(isNull(memberships.branchId), eq(memberships.branchId, access.branchScope)),
        ),
      )
      .orderBy(asc(users.displayName));
    const ids = members.map((m) => m.userId);
    if (ids.length === 0) return [];
    const [availability, timeOff] = await Promise.all([
      this.db
        .select()
        .from(staffAvailability)
        .where(
          and(
            eq(staffAvailability.organizationId, orgId),
            inArray(staffAvailability.userId, ids),
            access.branchScope === null
              ? undefined
              : eq(staffAvailability.branchId, access.branchScope),
          ),
        )
        .orderBy(asc(staffAvailability.weekday), asc(staffAvailability.opensMinute)),
      this.db
        .select()
        .from(staffTimeOff)
        .where(
          and(
            eq(staffTimeOff.organizationId, orgId),
            inArray(staffTimeOff.userId, ids),
            gt(staffTimeOff.endsAt, this.clock.now()),
          ),
        )
        .orderBy(asc(staffTimeOff.startsAt)),
    ]);
    return members.map((m) => {
      const byBranch = new Map<string, Record<string, { opens: string; closes: string }[]>>();
      for (const row of availability.filter((a) => a.userId === m.userId)) {
        const week = byBranch.get(row.branchId) ?? {};
        const day = WEEKDAYS[row.weekday - 1] ?? "mon";
        (week[day] ??= []).push({
          opens: clockOf(row.opensMinute),
          closes: row.closesMinute === 1440 ? "24:00" : clockOf(row.closesMinute),
        });
        byBranch.set(row.branchId, week);
      }
      return {
        userId: m.userId,
        displayName: m.displayName,
        role: m.role,
        branchScope: m.branchId,
        availability: [...byBranch].map(([branchId, weekly]) => ({ branchId, weekly })),
        timeOff: timeOff
          .filter((t) => t.userId === m.userId)
          .map((t) => ({
            id: t.id,
            startsAt: t.startsAt.toISOString(),
            endsAt: t.endsAt.toISOString(),
            // The reason is personal: only managers and the person see it.
            reason: manager || t.userId === actor.id ? t.reason : null,
          })),
      };
    });
  }

  async putAvailability(
    access: TenantAccess,
    actor: User,
    userId: string,
    input: AvailabilityInput,
  ): Promise<StaffMemberDto[]> {
    assertProvider(access);
    assertManager(access);
    const { branch } = await this.branchOf(this.db, access, input.branchId);
    const orgId = access.tenant.organizationId;
    if (!(await eligibleMember(this.db, orgId, userId, branch.id))) {
      throw crmError(400, "invalid_assignee");
    }
    const rows = WEEKDAYS.flatMap((day, index) =>
      (input.weekly[day] ?? []).map((interval) => {
        const { start, end } = intervalMinutes(interval);
        return {
          organizationId: orgId,
          branchId: branch.id,
          userId,
          weekday: index + 1,
          opensMinute: start,
          closesMinute: end,
        };
      }),
    );
    await this.db.transaction(async (tx) => {
      await tx
        .delete(staffAvailability)
        .where(
          and(eq(staffAvailability.branchId, branch.id), eq(staffAvailability.userId, userId)),
        );
      if (rows.length > 0) await tx.insert(staffAvailability).values(rows);
      await this.audit(tx, access, actor, "availability_saved", "user", userId, {
        branchId: branch.id,
        intervals: rows.length,
      });
    });
    return this.staff(access, actor);
  }

  /** Time off can't cover booked appointments: move or cancel those first. */
  async addTimeOff(
    access: TenantAccess,
    actor: User,
    userId: string,
    input: TimeOffInput,
  ): Promise<StaffMemberDto[]> {
    assertProvider(access);
    assertManager(access);
    const orgId = access.tenant.organizationId;
    if (!(await this.memberInScope(this.db, access, userId))) {
      throw crmError(400, "invalid_assignee");
    }
    const startsAt = new Date(input.startsAt);
    const endsAt = new Date(input.endsAt);
    await this.db.transaction(async (tx) => {
      await this.lockStaff(tx, userId);
      const clash = await tx
        .select({ id: appointments.id })
        .from(appointments)
        .where(
          and(
            eq(appointments.staffUserId, userId),
            eq(appointments.status, "booked"),
            lt(appointments.startsAt, endsAt),
            gt(appointments.endsAt, startsAt),
          ),
        )
        .limit(1);
      if (clash.length > 0) throw crmError(409, "conflicts_with_appointments");
      const [row] = await tx
        .insert(staffTimeOff)
        .values({
          organizationId: orgId,
          userId,
          startsAt,
          endsAt,
          reason: input.reason,
          createdBy: actor.id,
        })
        .returning();
      await this.audit(tx, access, actor, "time_off_added", "user", userId, {
        timeOffId: row?.id,
      });
    });
    return this.staff(access, actor);
  }

  async removeTimeOff(
    access: TenantAccess,
    actor: User,
    userId: string,
    timeOffId: string,
  ): Promise<void> {
    assertProvider(access);
    assertManager(access);
    const orgId = access.tenant.organizationId;
    if (!(await this.memberInScope(this.db, access, userId))) throw notFound();
    const removed = await this.db
      .delete(staffTimeOff)
      .where(
        and(
          eq(staffTimeOff.id, timeOffId),
          eq(staffTimeOff.userId, userId),
          eq(staffTimeOff.organizationId, orgId),
        ),
      )
      .returning();
    if (removed.length === 0) throw notFound();
    await this.audit(this.db, access, actor, "time_off_removed", "user", userId, { timeOffId });
  }

  // --- Slots -----------------------------------------------------------------------------------

  async slots(access: TenantAccess, query: SlotQuery): Promise<SlotsDto> {
    assertProvider(access);
    const { branch, timeZone } = await this.branchOf(this.db, access, query.branchId);
    const orgId = access.tenant.organizationId;
    let staffIds = (await this.staffAt(this.db, orgId, branch.id)).map((s) => s.userId);
    if (query.staffUserId !== undefined) {
      staffIds = staffIds.filter((id) => id === query.staffUserId);
      if (staffIds.length === 0) throw crmError(400, "invalid_assignee");
    }
    const day = await this.dayContext(this.db, branch, timeZone, query.date);
    const free = await this.freeTime(this.db, day, staffIds);
    const now = this.clock.now().getTime();
    const durationMs = query.durationMinutes * MINUTE;
    const slots: SlotsDto["slots"] = [];
    for (const start of slotStarts(query.date, timeZone, SLOT_STEP_MINUTES)) {
      const range = { start: start.at.getTime(), end: start.at.getTime() + durationMs };
      if (range.start <= now) continue;
      const available = staffIds.filter((id) => containsRange(free.get(id) ?? [], range));
      if (available.length === 0) continue;
      slots.push({
        start: clockOf(start.minute),
        startsAt: new Date(range.start).toISOString(),
        endsAt: new Date(range.end).toISOString(),
        staffUserIds: available,
      });
    }
    return {
      branchId: branch.id,
      date: query.date,
      timeZone,
      durationMinutes: query.durationMinutes,
      slots,
    };
  }

  // --- Booking ---------------------------------------------------------------------------------

  /** Validates time, staff and availability inside the transaction (after the staff lock). */
  private async assertBookable(
    tx: Executor,
    access: TenantAccess,
    branch: Branch,
    timeZone: string,
    staffUserId: string,
    start: { date: string; time: string },
    durationMinutes: number,
    ignoreAppointmentId?: string,
  ): Promise<{ startsAt: Date; endsAt: Date }> {
    const minute = Number(start.time.slice(0, 2)) * 60 + Number(start.time.slice(3, 5));
    const startsAt = zonedTimeToUtc(start.date, minute, timeZone);
    if (!startsAt) throw crmError(400, "invalid_local_time");
    const endsAt = new Date(startsAt.getTime() + durationMinutes * MINUTE);
    const now = this.clock.now();
    if (startsAt <= now) throw crmError(409, "in_the_past");
    if (startsAt.getTime() > now.getTime() + MAX_BOOKING_DAYS_AHEAD * DAY_MS) {
      throw crmError(409, "too_far_ahead");
    }
    if (!(await eligibleMember(tx, access.tenant.organizationId, staffUserId, branch.id))) {
      throw crmError(400, "invalid_assignee");
    }
    await this.lockStaff(tx, staffUserId);
    const range = { start: startsAt.getTime(), end: endsAt.getTime() };
    const day = await this.dayContext(tx, branch, timeZone, start.date);
    const free = (await this.freeTime(tx, day, [staffUserId], ignoreAppointmentId)).get(
      staffUserId,
    );
    if (!containsRange(free ?? [], range)) {
      // Tell a clash with another appointment apart from booking outside working hours.
      const others = await tx
        .select({ startsAt: appointments.startsAt, endsAt: appointments.endsAt })
        .from(appointments)
        .where(
          and(
            eq(appointments.staffUserId, staffUserId),
            eq(appointments.status, "booked"),
            lt(appointments.startsAt, endsAt),
            gt(appointments.endsAt, startsAt),
            ignoreAppointmentId ? ne(appointments.id, ignoreAppointmentId) : undefined,
          ),
        );
      const clash = overlapsAny(
        others.map((o) => ({ start: o.startsAt.getTime(), end: o.endsAt.getTime() })),
        range,
      );
      throw crmError(409, clash ? "slot_unavailable" : "outside_availability");
    }
    return { startsAt, endsAt };
  }

  async book(access: TenantAccess, actor: User, input: BookInput): Promise<AppointmentDto> {
    assertProvider(access);
    assertManager(access);
    const { branch, timeZone } = await this.branchOf(this.db, access, input.branchId);
    if (input.recipientId !== null) {
      const recipient = await recipientInScope(this.db, access, input.recipientId).catch(() => {
        throw crmError(400, "invalid_link");
      });
      if (recipient.status !== "accepted") throw crmError(409, "inquiry_not_bookable");
    }
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const { startsAt, endsAt } = await this.assertBookable(
          tx,
          access,
          branch,
          timeZone,
          input.staffUserId,
          input.start,
          input.durationMinutes,
        );
        const [row] = await tx
          .insert(appointments)
          .values({
            organizationId: access.tenant.organizationId,
            branchId: branch.id,
            staffUserId: input.staffUserId,
            recipientId: input.recipientId,
            title: input.title,
            customerName: input.customerName,
            notes: input.notes,
            startsAt,
            endsAt,
            createdBy: actor.id,
          })
          .returning();
        if (!row) throw new Error("appointment insert returned no row");
        await this.audit(tx, access, actor, "appointment_booked", "appointment", row.id, {
          staffUserId: row.staffUserId,
          startsAt: startsAt.toISOString(),
        });
        await this.outbox(tx, row, "AppointmentBooked", actor);
        return row.id;
      });
    } catch (error) {
      // The database guard caught a concurrent booking of the same time.
      if (isExclusionViolation(error)) throw crmError(409, "slot_unavailable");
      throw error;
    }
    return this.get(access, id);
  }

  private async outbox(
    executor: Executor,
    appointment: Appointment,
    eventType: string,
    actor: User,
  ): Promise<void> {
    await enqueueOutboxEvent(executor, {
      aggregateType: "appointment",
      aggregateId: appointment.id,
      eventType,
      payload: {
        appointmentId: appointment.id,
        organizationId: appointment.organizationId,
        staffUserId: appointment.staffUserId,
        actorUserId: actor.id,
      },
    });
  }

  private async appointmentFor(executor: Executor, access: TenantAccess, appointmentId: string) {
    const [row] = await executor
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.id, appointmentId),
          eq(appointments.organizationId, access.tenant.organizationId),
        ),
      );
    if (!row || !inScope(access, row.branchId)) throw notFound();
    return row;
  }

  /** Reschedule, reassign or edit a booked appointment (managers). */
  async update(
    access: TenantAccess,
    actor: User,
    appointmentId: string,
    input: UpdateInput,
  ): Promise<AppointmentDto> {
    assertProvider(access);
    assertManager(access);
    const current = await this.appointmentFor(this.db, access, appointmentId);
    if (current.status !== "booked") throw crmError(409, "invalid_transition");
    const { branch, timeZone } = await this.branchOf(this.db, access, current.branchId);
    const timing =
      input.start !== undefined ||
      input.durationMinutes !== undefined ||
      (input.staffUserId !== undefined && input.staffUserId !== current.staffUserId);
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .select()
          .from(appointments)
          .where(eq(appointments.id, current.id))
          .for("update");
        if (row?.status !== "booked") throw crmError(409, "invalid_transition");
        let startsAt = row.startsAt;
        let endsAt = row.endsAt;
        const staffUserId = input.staffUserId ?? row.staffUserId;
        if (timing) {
          const local = localStamp(row.startsAt, timeZone);
          const start = input.start ?? { date: local.slice(0, 10), time: local.slice(11, 16) };
          const duration =
            input.durationMinutes ??
            Math.round((row.endsAt.getTime() - row.startsAt.getTime()) / MINUTE);
          ({ startsAt, endsAt } = await this.assertBookable(
            tx,
            access,
            branch,
            timeZone,
            staffUserId,
            start,
            duration,
            row.id,
          ));
        }
        const [updated] = await tx
          .update(appointments)
          .set({
            startsAt,
            endsAt,
            staffUserId,
            ...(input.title === undefined ? {} : { title: input.title }),
            ...(input.notes === undefined ? {} : { notes: input.notes }),
          })
          .where(eq(appointments.id, row.id))
          .returning();
        if (!updated) throw notFound();
        await this.audit(tx, access, actor, "appointment_updated", "appointment", row.id, {
          staffUserId,
          startsAt: startsAt.toISOString(),
        });
        if (
          startsAt.getTime() !== row.startsAt.getTime() ||
          endsAt.getTime() !== row.endsAt.getTime()
        ) {
          await this.outbox(tx, updated, "AppointmentRescheduled", actor);
        }
        if (staffUserId !== row.staffUserId) {
          await this.outbox(tx, updated, "AppointmentAssigned", actor);
        }
      });
    } catch (error) {
      if (isExclusionViolation(error)) throw crmError(409, "slot_unavailable");
      throw error;
    }
    return this.get(access, appointmentId);
  }

  /**
   * Completed or no-show (managers, or the assigned staff member, once it has started);
   * cancelled (managers, with a reason).
   */
  async setStatus(
    access: TenantAccess,
    actor: User,
    appointmentId: string,
    input: StatusInput,
  ): Promise<AppointmentDto> {
    assertProvider(access);
    const manager = canManage(access);
    await this.db.transaction(async (tx) => {
      const current = await this.appointmentFor(tx, access, appointmentId);
      const [row] = await tx
        .select()
        .from(appointments)
        .where(eq(appointments.id, current.id))
        .for("update");
      if (!row) throw notFound();
      if (input.status === "cancelled") {
        if (!manager) throw crmError(403, "not_allowed");
      } else if (!manager && row.staffUserId !== actor.id) {
        throw crmError(403, "not_allowed");
      }
      if (row.status !== "booked") throw crmError(409, "invalid_transition");
      if (input.status !== "cancelled" && row.startsAt > this.clock.now()) {
        throw crmError(409, "not_started");
      }
      const [updated] = await tx
        .update(appointments)
        .set({
          status: input.status,
          cancelReason: input.status === "cancelled" ? input.reason : null,
        })
        .where(eq(appointments.id, row.id))
        .returning();
      if (!updated) throw notFound();
      await this.audit(tx, access, actor, `appointment_${input.status}`, "appointment", row.id);
      if (input.status === "cancelled")
        await this.outbox(tx, updated, "AppointmentCancelled", actor);
    });
    return this.get(access, appointmentId);
  }

  // --- Views -----------------------------------------------------------------------------------

  private async dtos(rows: readonly Appointment[]): Promise<AppointmentDto[]> {
    if (rows.length === 0) return [];
    const branchIds = [...new Set(rows.map((r) => r.branchId))];
    const staffIds = [...new Set(rows.map((r) => r.staffUserId))];
    const recipientIds = rows.map((r) => r.recipientId).filter((id): id is string => id !== null);
    const [branchRows, staffRows, recipients] = await Promise.all([
      this.db
        .select({ branch: branches, orgTimeZone: organizations.timezone })
        .from(branches)
        .innerJoin(organizations, eq(organizations.id, branches.organizationId))
        .where(inArray(branches.id, branchIds)),
      this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, staffIds)),
      recipientIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({
              id: serviceRequestRecipients.id,
              requestId: serviceRequestRecipients.requestId,
            })
            .from(serviceRequestRecipients)
            .where(inArray(serviceRequestRecipients.id, recipientIds)),
    ]);
    const branchBy = new Map(
      branchRows.map((b) => [
        b.branch.id,
        { name: b.branch.name, tz: b.branch.timeZone ?? b.orgTimeZone },
      ]),
    );
    const nameBy = new Map(staffRows.map((s) => [s.id, s.displayName]));
    const requestBy = new Map(recipients.map((r) => [r.id, r.requestId]));
    return rows.map((r) => {
      const branch = branchBy.get(r.branchId) ?? { name: "", tz: "UTC" };
      const start = localStamp(r.startsAt, branch.tz);
      const end = localStamp(r.endsAt, branch.tz);
      return {
        id: r.id,
        branchId: r.branchId,
        branchName: branch.name,
        staff: { userId: r.staffUserId, displayName: nameBy.get(r.staffUserId) ?? null },
        recipientId: r.recipientId,
        requestId: r.recipientId === null ? null : (requestBy.get(r.recipientId) ?? null),
        title: r.title,
        customerName: r.customerName,
        notes: r.notes,
        status: r.status,
        startsAt: r.startsAt.toISOString(),
        endsAt: r.endsAt.toISOString(),
        durationMinutes: Math.round((r.endsAt.getTime() - r.startsAt.getTime()) / MINUTE),
        timeZone: branch.tz,
        local: { date: start.slice(0, 10), start: start.slice(11, 16), end: end.slice(11, 16) },
        cancelReason: r.cancelReason,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }

  async get(access: TenantAccess, appointmentId: string): Promise<AppointmentDto> {
    assertProvider(access);
    const [dto] = await this.dtos([await this.appointmentFor(this.db, access, appointmentId)]);
    if (!dto) throw notFound();
    return dto;
  }

  /**
   * The team calendar within your branch scope. `from` / `to` are local dates: an appointment
   * is included when its local date in its branch's timezone is in the range.
   */
  async list(access: TenantAccess, query: ListQuery): Promise<AppointmentDto[]> {
    assertProvider(access);
    const today = this.clock.now().toISOString().slice(0, 10);
    const from = query.from ?? addDays(today, -1);
    const to = query.to ?? addDays(from, DEFAULT_WINDOW_DAYS);
    if (to < from || Date.parse(to) - Date.parse(from) > 92 * DAY_MS) {
      throw crmError(400, "invalid_range");
    }
    // Widen by a day each side so every timezone is covered, then filter on the local date.
    const rows = await this.db
      .select()
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, access.tenant.organizationId),
          access.branchScope === null ? undefined : eq(appointments.branchId, access.branchScope),
          query.branchId ? eq(appointments.branchId, query.branchId) : undefined,
          query.staffUserId ? eq(appointments.staffUserId, query.staffUserId) : undefined,
          query.status ? eq(appointments.status, query.status) : undefined,
          gte(appointments.startsAt, new Date(Date.parse(`${addDays(from, -1)}T00:00:00Z`))),
          lt(appointments.startsAt, new Date(Date.parse(`${addDays(to, 2)}T00:00:00Z`))),
        ),
      )
      .orderBy(asc(appointments.startsAt))
      .limit(500);
    return (await this.dtos(rows)).filter((a) => a.local.date >= from && a.local.date <= to);
  }

  /** Appointments on requests you raised: no staff identity, no internal notes. */
  async mine(actor: User): Promise<CustomerAppointmentDto[]> {
    const rows = await this.db
      .select({
        appointment: appointments,
        requestId: serviceRequests.id,
        providerName: organizations.name,
      })
      .from(appointments)
      .innerJoin(
        serviceRequestRecipients,
        eq(serviceRequestRecipients.id, appointments.recipientId),
      )
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .innerJoin(organizations, eq(organizations.id, appointments.organizationId))
      .where(eq(serviceRequests.createdBy, actor.id))
      .orderBy(asc(appointments.startsAt))
      .limit(200);
    const dtos = await this.dtos(rows.map((r) => r.appointment));
    return rows.map((r, i) => {
      const dto = dtos[i];
      if (!dto) throw notFound();
      return {
        id: dto.id,
        requestId: r.requestId,
        providerOrganizationId: r.appointment.organizationId,
        providerName: r.providerName,
        branchName: dto.branchName,
        title: dto.title,
        status: dto.status,
        startsAt: dto.startsAt,
        endsAt: dto.endsAt,
        timeZone: dto.timeZone,
        local: dto.local,
      };
    });
  }
}

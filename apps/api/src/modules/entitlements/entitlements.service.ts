import {
  and,
  branches,
  consumeDailyQuota,
  count,
  dailyUsage,
  type Database,
  desc,
  eq,
  type Executor,
  gt,
  inArray,
  invitations,
  isNull,
  localDate,
  lte,
  memberships,
  type Organization,
  type PlanAssignment,
  planAssignments,
  type PlanVersion,
  planVersionLimits,
  planVersions,
  type Plan,
  plans,
  type QuotaOverride,
  quotaOverrides,
  type User,
} from "@fleettrust/db";
import {
  CAPABILITIES,
  CAPABILITY_KEYS,
  type CapabilityKey,
  type Entitlement,
  type EntitlementsResponse,
} from "@fleettrust/types";
import { ForbiddenException, Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";

export type EntitlementSubject =
  | { type: "organization"; id: string; audience: "provider" | "fleet"; timeZone: string }
  | { type: "user"; id: string; audience: "user"; timeZone: string };

export function subjectOfOrganization(
  org: Pick<Organization, "id" | "kind" | "timezone">,
): EntitlementSubject {
  return { type: "organization", id: org.id, audience: org.kind, timeZone: org.timezone };
}

export function subjectOfUser(user: Pick<User, "id" | "timezone">): EntitlementSubject {
  return { type: "user", id: user.id, audience: "user", timeZone: user.timezone };
}

export interface ResolvedLimit {
  /** null = unlimited. */
  limit: number | null;
  source: "plan" | "grace" | "override";
  graceUntil: Date | null;
}

export interface ResolvedEntitlements {
  plan: Plan;
  version: PlanVersion;
  assignment: PlanAssignment | null;
  limits: Map<CapabilityKey, ResolvedLimit>;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** When an assignment stopped (or will stop) applying: the earlier of its term and its ending. */
function effectiveEnd(assignment: PlanAssignment): Date | null {
  const ends = [assignment.endsAt, assignment.endedAt].filter((d): d is Date => d !== null);
  if (ends.length === 0) return null;
  return new Date(Math.min(...ends.map((d) => d.getTime())));
}

/** null (unlimited) beats any number. */
function moreGenerous(a: number | null, b: number | null): boolean {
  if (a === null) return b !== null;
  return b !== null && a > b;
}

export function quotaExceeded(
  key: CapabilityKey,
  limit: number | null,
  used: number,
): ForbiddenException {
  return new ForbiddenException({
    statusCode: 403,
    error: "forbidden",
    reason: "quota_exceeded",
    key,
    limit,
    used,
  });
}

export function applicableKeys(subject: EntitlementSubject): CapabilityKey[] {
  return CAPABILITY_KEYS.filter((key) =>
    (CAPABILITIES[key].subjects as readonly string[]).includes(subject.type),
  );
}

/**
 * Entitlements (SRS FR-03..05, ADR-0008). Resolves what a user or organization may do from
 * its plan assignment (or the audience's default plan), downgrade grace periods and staff
 * overrides, and enforces it. Never called by verification, Power User, search (ADR-0009)
 * or emergency (ADR-0010): lint rules forbid those imports.
 */
@Injectable()
export class EntitlementsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  now(): Date {
    return this.clock.now();
  }

  async resolve(
    subject: EntitlementSubject,
    executor: Executor = this.db,
  ): Promise<ResolvedEntitlements> {
    const now = this.clock.now();
    const subjectFilter =
      subject.type === "organization"
        ? eq(planAssignments.organizationId, subject.id)
        : eq(planAssignments.userId, subject.id);
    const assignments = await executor
      .select()
      .from(planAssignments)
      .where(and(subjectFilter, lte(planAssignments.startsAt, now)))
      .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id));

    const active = assignments.find((a) => {
      const end = effectiveEnd(a);
      return end === null || end > now;
    });
    const graced = assignments
      .filter((a) => a !== active)
      .flatMap((a) => {
        const end = effectiveEnd(a);
        // Only ended assignments have a grace period (an open one here would be a second active).
        return end === null
          ? []
          : [{ assignment: a, until: new Date(end.getTime() + a.graceDays * DAY_MS) }];
      })
      .filter((g) => g.until > now);

    let current: { plan: Plan; version: PlanVersion };
    if (active) {
      current = await this.versionWithPlan(executor, active.planVersionId);
    } else {
      const [row] = await executor
        .select({ plan: plans, version: planVersions })
        .from(plans)
        .innerJoin(planVersions, eq(planVersions.planId, plans.id))
        .where(
          and(
            eq(plans.audience, subject.audience),
            eq(plans.isDefault, true),
            eq(planVersions.status, "published"),
          ),
        )
        .orderBy(desc(planVersions.version))
        .limit(1);
      if (!row)
        throw new Error(`No default plan for audience ${subject.audience}: run pnpm db:seed`);
      current = row;
    }

    const versionIds = [current.version.id, ...graced.map((g) => g.assignment.planVersionId)];
    const limitRows = await executor
      .select()
      .from(planVersionLimits)
      .where(inArray(planVersionLimits.planVersionId, versionIds));
    const limitOf = (versionId: string, key: string): number | null => {
      const row = limitRows.find((r) => r.planVersionId === versionId && r.key === key);
      return row === undefined ? 0 : row.limitValue; // absent = not included
    };

    const overrides = await this.openOverrides(executor, subject, now);
    const limits = new Map<CapabilityKey, ResolvedLimit>();
    for (const key of applicableKeys(subject)) {
      let resolved: ResolvedLimit = {
        limit: limitOf(current.version.id, key),
        source: "plan",
        graceUntil: null,
      };
      for (const g of graced) {
        const limit = limitOf(g.assignment.planVersionId, key);
        if (moreGenerous(limit, resolved.limit)) {
          resolved = { limit, source: "grace", graceUntil: g.until };
        }
      }
      const override = overrides.find((o) => o.key === key);
      if (override) resolved = { limit: override.limitValue, source: "override", graceUntil: null };
      limits.set(key, resolved);
    }
    return { ...current, assignment: active ?? null, limits };
  }

  async limitFor(
    subject: EntitlementSubject,
    key: CapabilityKey,
    executor: Executor = this.db,
  ): Promise<number | null> {
    const resolved = await this.resolve(subject, executor);
    // null is "unlimited" and must survive; only a key that doesn't apply means 0.
    const entry = resolved.limits.get(key);
    return entry === undefined ? 0 : entry.limit;
  }

  /**
   * Consumes one unit of a daily quota, atomically (throws 403 quota_exceeded). Call it inside
   * the transaction that creates the counted thing, so a failure releases the unit.
   */
  async consume(
    executor: Executor,
    subject: EntitlementSubject,
    key: CapabilityKey,
    options: { idempotencyKey?: string } = {},
  ): Promise<{ used: number; limit: number | null }> {
    // Unknown keys (there is no emergency capability, ADR-0010) are a programming error.
    if ((CAPABILITIES as Record<string, { kind: string } | undefined>)[key]?.kind !== "daily") {
      throw new Error(`${key} is not a daily quota`);
    }
    const limit = await this.limitFor(subject, key, executor);
    const result = await consumeDailyQuota(executor, {
      subject: { type: subject.type, id: subject.id },
      key,
      periodStart: localDate(this.clock.now(), subject.timeZone),
      limit,
      ...(options.idempotencyKey === undefined ? {} : { idempotencyKey: options.idempotencyKey }),
    });
    if (!result.allowed) throw quotaExceeded(key, limit, result.used);
    return { used: result.used, limit };
  }

  /**
   * Refuses creation that would take a capacity limit (seats, branches) above the limit.
   * Existing data above the limit after a downgrade is kept (ADR-0008). The caller must hold
   * a lock that serialises creation for the subject (the organization row lock).
   */
  async assertCapacity(
    executor: Executor,
    subject: EntitlementSubject,
    key: CapabilityKey,
    options: { current?: number; adding?: number } = {},
  ): Promise<void> {
    if (CAPABILITIES[key].kind !== "capacity") throw new Error(`${key} is not a capacity limit`);
    const limit = await this.limitFor(subject, key, executor);
    if (limit === null) return;
    const current = options.current ?? (await this.capacityUsage(executor, subject, key));
    if (current + (options.adding ?? 1) > limit) throw quotaExceeded(key, limit, current);
  }

  /** Live counts behind the capacity limits. Seats include pending (unexpired) invitations. */
  async capacityUsage(
    executor: Executor,
    subject: EntitlementSubject,
    key: CapabilityKey,
  ): Promise<number> {
    if (subject.type !== "organization") return 0;
    if (key === "branches.max") {
      const [row] = await executor
        .select({ n: count() })
        .from(branches)
        .where(eq(branches.organizationId, subject.id));
      return row?.n ?? 0;
    }
    if (key === "staff.seats") {
      const [members] = await executor
        .select({ n: count() })
        .from(memberships)
        .where(eq(memberships.organizationId, subject.id));
      const [pending] = await executor
        .select({ n: count() })
        .from(invitations)
        .where(
          and(
            eq(invitations.organizationId, subject.id),
            isNull(invitations.acceptedAt),
            isNull(invitations.revokedAt),
            gt(invitations.expiresAt, this.clock.now()),
          ),
        );
      return (members?.n ?? 0) + (pending?.n ?? 0);
    }
    return 0;
  }

  /** The usage screen: every applicable limit with current usage (SRS F-012). */
  async describe(
    subject: EntitlementSubject,
    executor: Executor = this.db,
  ): Promise<EntitlementsResponse> {
    const resolved = await this.resolve(subject, executor);
    const period = localDate(this.clock.now(), subject.timeZone);
    const daily = await dailyUsage(executor, { type: subject.type, id: subject.id }, period);
    const entitlements: Entitlement[] = [];
    for (const [key, limit] of resolved.limits) {
      const kind = CAPABILITIES[key].kind;
      const used =
        kind === "daily" ? (daily.get(key) ?? 0) : await this.capacityUsage(executor, subject, key);
      entitlements.push({
        key,
        kind,
        limit: limit.limit,
        used,
        source: limit.source,
        graceUntil: limit.graceUntil?.toISOString() ?? null,
        overLimit: limit.limit !== null && used > limit.limit,
      });
    }
    const end = resolved.assignment ? effectiveEnd(resolved.assignment) : null;
    return {
      subject: { type: subject.type, id: subject.id },
      plan: {
        code: resolved.plan.code,
        name: resolved.plan.name,
        version: resolved.version.version,
        source: resolved.assignment ? "assignment" : "default",
        activatedAt: resolved.assignment?.startsAt.toISOString() ?? null,
        endsAt: end?.toISOString() ?? null,
      },
      timeZone: subject.timeZone,
      period,
      entitlements,
    };
  }

  private async versionWithPlan(
    executor: Executor,
    planVersionId: string,
  ): Promise<{ plan: Plan; version: PlanVersion }> {
    const [row] = await executor
      .select({ plan: plans, version: planVersions })
      .from(planVersions)
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(eq(planVersions.id, planVersionId))
      .limit(1);
    if (!row) throw new Error("assignment references a missing plan version");
    return row;
  }

  private async openOverrides(
    executor: Executor,
    subject: EntitlementSubject,
    now: Date,
  ): Promise<QuotaOverride[]> {
    const rows = await executor
      .select()
      .from(quotaOverrides)
      .where(
        and(
          subject.type === "organization"
            ? eq(quotaOverrides.organizationId, subject.id)
            : eq(quotaOverrides.userId, subject.id),
          isNull(quotaOverrides.revokedAt),
        ),
      );
    return rows.filter((row) => row.expiresAt === null || row.expiresAt > now);
  }
}

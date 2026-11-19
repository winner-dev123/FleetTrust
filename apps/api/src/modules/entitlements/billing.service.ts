import {
  and,
  asc,
  type Database,
  desc,
  eq,
  type Executor,
  inArray,
  isNull,
  organizations,
  type PlanAssignment,
  planAssignments,
  planVersionLimits,
  planVersions,
  plans,
  type QuotaOverride,
  quotaOverrides,
  recordAuditEvent,
  type User,
  users,
} from "@fleettrust/db";
import {
  type BillingAccount,
  CAPABILITIES,
  type CapabilityKey,
  type PlanAssignmentDto,
  type PlanDto,
  type QuotaOverrideDto,
  type SubjectType,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import {
  type EntitlementSubject,
  EntitlementsService,
  subjectOfOrganization,
  subjectOfUser,
} from "./entitlements.service.js";

type Reason =
  | "plan_audience_mismatch"
  | "plan_version_not_assignable"
  | "capability_not_applicable"
  | "assignment_already_ended";

function badRequest(reason: Reason) {
  return new BadRequestException({ statusCode: 400, error: "bad_request", reason });
}

const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });
const requestId = () => currentRequestContext()?.requestId;

/** The database guarantees exactly one subject column is set (plan_assignments_subject). */
function subjectIdOf(row: { organizationId: string | null; userId: string | null }): string {
  const id = row.organizationId ?? row.userId;
  if (id === null) throw new Error("row has no subject");
  return id;
}

function toAssignmentDto(
  a: PlanAssignment,
  plan: { code: string; version: number },
): PlanAssignmentDto {
  return {
    id: a.id,
    subject: { type: a.subjectType, id: subjectIdOf(a) },
    planCode: plan.code,
    planVersion: plan.version,
    planVersionId: a.planVersionId,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt?.toISOString() ?? null,
    graceDays: a.graceDays,
    externalReference: a.externalReference,
    invoiceNumber: a.invoiceNumber,
    note: a.note,
    assignedBy: a.assignedBy,
    endedAt: a.endedAt?.toISOString() ?? null,
    endReason: a.endReason,
  };
}

function toOverrideDto(o: QuotaOverride): QuotaOverrideDto {
  return {
    id: o.id,
    subject: { type: o.subjectType, id: subjectIdOf(o) },
    key: o.key,
    limit: o.limitValue,
    reason: o.reason,
    expiresAt: o.expiresAt?.toISOString() ?? null,
    createdBy: o.createdBy,
    createdAt: o.createdAt.toISOString(),
    revokedAt: o.revokedAt?.toISOString() ?? null,
  };
}

/**
 * Billing-operator actions (ADR-0008, SRS J6): assign plan versions after external billing
 * confirmation, end assignments, set and revoke quota overrides. Every action is audited
 * with actor type "admin". Wording never says "paid" or "payment verified".
 */
@Injectable()
export class BillingService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async catalog(): Promise<PlanDto[]> {
    const planRows = await this.db
      .select()
      .from(plans)
      .orderBy(asc(plans.audience), asc(plans.code));
    const versionRows = await this.db
      .select()
      .from(planVersions)
      .orderBy(asc(planVersions.version));
    const limitRows = await this.db.select().from(planVersionLimits);
    return planRows.map((plan) => ({
      id: plan.id,
      code: plan.code,
      audience: plan.audience,
      name: plan.name,
      isDefault: plan.isDefault,
      versions: versionRows
        .filter((v) => v.planId === plan.id)
        .map((v) => ({
          id: v.id,
          version: v.version,
          status: v.status,
          price:
            v.priceMinor !== null && v.currency !== null && v.billingPeriod !== null
              ? { amountMinor: v.priceMinor, currency: v.currency, period: v.billingPeriod }
              : null,
          limits: Object.fromEntries(
            limitRows.filter((l) => l.planVersionId === v.id).map((l) => [l.key, l.limitValue]),
          ),
          publishedAt: v.publishedAt?.toISOString() ?? null,
        })),
    }));
  }

  /** Loads (and optionally row-locks) the subject. Unknown subjects are 404. */
  async subject(
    type: SubjectType,
    id: string,
    executor: Executor = this.db,
    lock = false,
  ): Promise<EntitlementSubject> {
    if (type === "organization") {
      const query = executor.select().from(organizations).where(eq(organizations.id, id)).limit(1);
      const [org] = lock ? await query.for("update") : await query;
      if (!org) throw notFound();
      return subjectOfOrganization(org);
    }
    const query = executor.select().from(users).where(eq(users.id, id)).limit(1);
    const [user] = lock ? await query.for("update") : await query;
    if (!user) throw notFound();
    return subjectOfUser(user);
  }

  async account(type: SubjectType, id: string): Promise<BillingAccount> {
    const subject = await this.subject(type, id);
    const filter =
      type === "organization"
        ? eq(planAssignments.organizationId, id)
        : eq(planAssignments.userId, id);
    const assignments = await this.db
      .select({ a: planAssignments, code: plans.code, version: planVersions.version })
      .from(planAssignments)
      .innerJoin(planVersions, eq(planVersions.id, planAssignments.planVersionId))
      .innerJoin(plans, eq(plans.id, planVersions.planId))
      .where(filter)
      .orderBy(desc(planAssignments.startsAt), desc(planAssignments.id));
    const overrides = await this.db
      .select()
      .from(quotaOverrides)
      .where(
        type === "organization"
          ? eq(quotaOverrides.organizationId, id)
          : eq(quotaOverrides.userId, id),
      )
      .orderBy(desc(quotaOverrides.createdAt), desc(quotaOverrides.id));
    return {
      entitlements: await this.entitlements.describe(subject),
      assignments: assignments.map((row) => toAssignmentDto(row.a, row)),
      overrides: overrides.map(toOverrideDto),
    };
  }

  async assign(
    actor: User,
    input: {
      subject: { type: SubjectType; id: string };
      planVersionId: string;
      externalReference: string;
      invoiceNumber: string | null;
      note: string | null;
      graceDays: number;
      endsAt: string | null;
    },
  ): Promise<PlanAssignmentDto> {
    return this.db.transaction(async (tx) => {
      const subject = await this.subject(input.subject.type, input.subject.id, tx, true);
      const [target] = await tx
        .select({ version: planVersions, plan: plans })
        .from(planVersions)
        .innerJoin(plans, eq(plans.id, planVersions.planId))
        .where(eq(planVersions.id, input.planVersionId))
        .limit(1);
      if (!target) throw notFound();
      if (target.version.status !== "published") throw badRequest("plan_version_not_assignable");
      if (target.plan.audience !== subject.audience) throw badRequest("plan_audience_mismatch");

      const now = this.entitlements.now();
      const endsAt = input.endsAt === null ? null : new Date(input.endsAt);
      if (endsAt !== null && endsAt <= now) {
        throw new BadRequestException({ statusCode: 400, error: "validation_failed" });
      }

      // The new assignment supersedes whatever applies now; the old one's grace period starts.
      const subjectFilter =
        subject.type === "organization"
          ? eq(planAssignments.organizationId, subject.id)
          : eq(planAssignments.userId, subject.id);
      const open = await tx
        .select()
        .from(planAssignments)
        .where(and(subjectFilter, isNull(planAssignments.endedAt)));
      const superseded = open.filter((a) => a.endsAt === null || a.endsAt > now).map((a) => a.id);
      if (superseded.length > 0) {
        await tx
          .update(planAssignments)
          .set({ endedAt: now, endedBy: actor.id, endReason: "superseded" })
          .where(inArray(planAssignments.id, superseded));
      }

      const [row] = await tx
        .insert(planAssignments)
        .values({
          subjectType: subject.type,
          organizationId: subject.type === "organization" ? subject.id : null,
          userId: subject.type === "user" ? subject.id : null,
          planVersionId: target.version.id,
          startsAt: now,
          endsAt,
          graceDays: input.graceDays,
          externalReference: input.externalReference,
          invoiceNumber: input.invoiceNumber,
          note: input.note,
          assignedBy: actor.id,
        })
        .returning();
      if (!row) throw new Error("assignment insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "admin",
        actorId: actor.id,
        organizationId: subject.type === "organization" ? subject.id : null,
        action: "plan.assigned",
        targetType: subject.type,
        targetId: subject.id,
        requestId: requestId(),
        metadata: {
          assignmentId: row.id,
          plan: target.plan.code,
          version: target.version.version,
          externalReference: row.externalReference,
          graceDays: row.graceDays,
          superseded,
        },
      });
      return toAssignmentDto(row, { code: target.plan.code, version: target.version.version });
    });
  }

  /** Ends an assignment now (cancellation). Its limits linger for its grace period. */
  async endAssignment(actor: User, assignmentId: string, note: string | null): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [existing] = await tx
        .select()
        .from(planAssignments)
        .where(eq(planAssignments.id, assignmentId))
        .limit(1)
        .for("update");
      if (!existing) throw notFound();
      const now = this.entitlements.now();
      if (existing.endedAt !== null || (existing.endsAt !== null && existing.endsAt <= now)) {
        throw new ConflictException({
          statusCode: 409,
          error: "conflict",
          reason: "assignment_already_ended",
        });
      }
      await tx
        .update(planAssignments)
        .set({ endedAt: now, endedBy: actor.id, endReason: "cancelled" })
        .where(eq(planAssignments.id, assignmentId));
      await recordAuditEvent(tx, {
        actorType: "admin",
        actorId: actor.id,
        organizationId: existing.organizationId,
        action: "plan.assignment_ended",
        targetType: existing.subjectType,
        targetId: existing.organizationId ?? existing.userId,
        requestId: requestId(),
        metadata: { assignmentId, graceDays: existing.graceDays, note },
      });
    });
  }

  async setOverride(
    actor: User,
    input: {
      subject: { type: SubjectType; id: string };
      key: CapabilityKey;
      limit: number | null;
      reason: string;
      expiresAt: string | null;
    },
  ): Promise<QuotaOverrideDto> {
    if (!(CAPABILITIES[input.key].subjects as readonly string[]).includes(input.subject.type)) {
      throw badRequest("capability_not_applicable");
    }
    return this.db.transaction(async (tx) => {
      const subject = await this.subject(input.subject.type, input.subject.id, tx, true);
      const now = this.entitlements.now();
      const subjectFilter =
        subject.type === "organization"
          ? eq(quotaOverrides.organizationId, subject.id)
          : eq(quotaOverrides.userId, subject.id);
      const previous = await tx
        .update(quotaOverrides)
        .set({ revokedAt: now, revokedBy: actor.id })
        .where(
          and(subjectFilter, eq(quotaOverrides.key, input.key), isNull(quotaOverrides.revokedAt)),
        )
        .returning({ id: quotaOverrides.id, limit: quotaOverrides.limitValue });
      const [row] = await tx
        .insert(quotaOverrides)
        .values({
          subjectType: subject.type,
          organizationId: subject.type === "organization" ? subject.id : null,
          userId: subject.type === "user" ? subject.id : null,
          key: input.key,
          limitValue: input.limit,
          reason: input.reason,
          expiresAt: input.expiresAt === null ? null : new Date(input.expiresAt),
          createdBy: actor.id,
        })
        .returning();
      if (!row) throw new Error("override insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "admin",
        actorId: actor.id,
        organizationId: subject.type === "organization" ? subject.id : null,
        action: "entitlement.override_set",
        targetType: subject.type,
        targetId: subject.id,
        requestId: requestId(),
        metadata: {
          overrideId: row.id,
          key: row.key,
          limit: row.limitValue,
          expiresAt: row.expiresAt?.toISOString() ?? null,
          reason: row.reason,
          replaced: previous,
        },
      });
      return toOverrideDto(row);
    });
  }

  async revokeOverride(actor: User, overrideId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(quotaOverrides)
        .set({ revokedAt: this.entitlements.now(), revokedBy: actor.id })
        .where(and(eq(quotaOverrides.id, overrideId), isNull(quotaOverrides.revokedAt)))
        .returning();
      if (!row) throw notFound();
      await recordAuditEvent(tx, {
        actorType: "admin",
        actorId: actor.id,
        organizationId: row.organizationId,
        action: "entitlement.override_revoked",
        targetType: row.subjectType,
        targetId: row.organizationId ?? row.userId,
        requestId: requestId(),
        metadata: { overrideId: row.id, key: row.key },
      });
    });
  }
}

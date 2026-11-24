import {
  and,
  asc,
  auditEvents,
  count,
  type Database,
  desc,
  eq,
  inArray,
  like,
  moderationActions,
  or,
  queryRows,
  sql,
  users,
} from "@fleettrust/db";
import {
  APPEAL_KINDS,
  type MemberHistoryDto,
  REPORT_REASONS,
  REPORT_TARGET_TYPES,
  type TrustDashboardDto,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { PowerUserService } from "../power-user/index.js";
import { AppealsService } from "./appeals.service.js";
import { SanctionsService } from "./sanctions.service.js";
import { notFound } from "./shared.js";

const DAY_MS = 86_400_000;

/**
 * The shared trust and safety dashboard (SRS F-161, ADR-0030) for moderators and verification
 * reviewers, and a member's moderation history built from the append-only records.
 */
@Injectable()
export class TrustDashboardService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly powerUsers: PowerUserService,
    private readonly sanctions: SanctionsService,
    private readonly appeals: AppealsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async dashboard(): Promise<TrustDashboardDto> {
    const now = this.clock.now();
    const nowIso = now.toISOString();
    const since14 = new Date(now.getTime() - 13 * DAY_MS).toISOString().slice(0, 10);
    const since30 = new Date(now.getTime() - 30 * DAY_MS).toISOString();

    const [counts] = await queryRows<{
      open_reports: number;
      pending_articles: number;
      pending_jobs: number;
      verification_appeals: number;
      cases_waiting: number;
      active_suspensions: number;
      warnings_30: number;
      revocations_30: number;
      flagged_emergencies: number;
    }>(
      this.db,
      sql`SELECT
            (SELECT count(*)::int FROM content_reports WHERE status = 'open') AS open_reports,
            (SELECT count(*)::int FROM articles WHERE status = 'pending_moderation' AND deleted_at IS NULL) AS pending_articles,
            (SELECT count(*)::int FROM jobs WHERE status = 'pending_moderation') AS pending_jobs,
            (SELECT count(*)::int FROM verification_appeals WHERE status = 'open') AS verification_appeals,
            (SELECT count(*)::int FROM verification_cases WHERE status = 'submitted') AS cases_waiting,
            (SELECT count(*)::int FROM member_sanctions WHERE kind = 'suspension' AND lifted_at IS NULL
               AND (ends_at IS NULL OR ends_at > ${nowIso}::timestamptz)) AS active_suspensions,
            (SELECT count(*)::int FROM member_sanctions WHERE kind = 'warning'
               AND created_at >= ${since30}::timestamptz) AS warnings_30,
            (SELECT count(*)::int FROM power_user_status WHERE status = 'revoked'
               AND revoked_at >= ${since30}::timestamptz) AS revocations_30,
            (SELECT count(*)::int FROM emergency_incidents WHERE flagged AND status = 'active') AS flagged_emergencies`,
    );
    const [byTarget, byReason, perDay, appealsByKind, recent, powerUsers] = await Promise.all([
      queryRows<{ target_type: string; n: number }>(
        this.db,
        sql`SELECT target_type, count(*)::int AS n FROM content_reports WHERE status = 'open' GROUP BY target_type`,
      ),
      queryRows<{ reason: string; n: number }>(
        this.db,
        sql`SELECT reason, count(*)::int AS n FROM content_reports WHERE status = 'open' GROUP BY reason`,
      ),
      queryRows<{ day: string; n: number }>(
        this.db,
        sql`SELECT to_char(created_at::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM content_reports
            WHERE created_at >= ${since14}::date GROUP BY 1`,
      ),
      queryRows<{ kind: string; n: number }>(
        this.db,
        sql`SELECT kind, count(*)::int AS n FROM moderation_appeals WHERE status = 'open' GROUP BY kind`,
      ),
      this.db
        .select()
        .from(auditEvents)
        .where(
          or(
            like(auditEvents.action, "moderation.%"),
            like(auditEvents.action, "power_user.%"),
            like(auditEvents.action, "verification.%"),
          ),
        )
        .orderBy(desc(auditEvents.occurredAt))
        .limit(20),
      this.powerUsers.activeCount(),
    ]);

    const days: { date: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const date = new Date(now.getTime() - i * DAY_MS).toISOString().slice(0, 10);
      days.push({ date, count: perDay.find((d) => d.day === date)?.n ?? 0 });
    }
    const openAppeals = appealsByKind.reduce((n, a) => n + a.n, 0);
    return {
      reports: {
        open: counts?.open_reports ?? 0,
        byTarget: REPORT_TARGET_TYPES.map((t) => ({
          targetType: t,
          open: byTarget.find((r) => r.target_type === t)?.n ?? 0,
        })).filter((r) => r.open > 0),
        byReason: REPORT_REASONS.map((reason) => ({
          reason,
          open: byReason.find((r) => r.reason === reason)?.n ?? 0,
        })).filter((r) => r.open > 0),
        last14Days: days,
      },
      pendingModeration: {
        articles: counts?.pending_articles ?? 0,
        jobs: counts?.pending_jobs ?? 0,
      },
      appeals: {
        open: openAppeals,
        byKind: APPEAL_KINDS.map((kind) => ({
          kind,
          open: appealsByKind.find((a) => a.kind === kind)?.n ?? 0,
        })).filter((a) => a.open > 0),
        verificationOpen: counts?.verification_appeals ?? 0,
      },
      members: {
        activeSuspensions: counts?.active_suspensions ?? 0,
        warningsLast30Days: counts?.warnings_30 ?? 0,
        powerUsers,
        powerUserRevocationsLast30Days: counts?.revocations_30 ?? 0,
      },
      verification: { casesWaiting: counts?.cases_waiting ?? 0 },
      emergency: { flaggedActive: counts?.flagged_emergencies ?? 0 },
      recentActions: recent.map((e) => ({
        at: e.occurredAt.toISOString(),
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        actorId: e.actorId,
      })),
    };
  }

  async memberHistory(userId: string): Promise<MemberHistoryDto> {
    const [user] = await this.db.select().from(users).where(eq(users.id, userId));
    if (!user) throw notFound();
    const [sanctions, appeals, status, contentActions, reports, audit] = await Promise.all([
      this.sanctions.forUser(userId),
      this.appeals.forUser(userId),
      this.powerUsers.statusOf(this.db, userId),
      this.db
        .select()
        .from(moderationActions)
        .where(
          and(
            sql`${moderationActions.metadata}->>'authorUserId' = ${userId}`,
            inArray(moderationActions.action, [
              "reject",
              "hide",
              "restore",
              "approve",
              "auto_flag",
              "appeal_overturned",
            ]),
          ),
        )
        .orderBy(desc(moderationActions.createdAt))
        .limit(100),
      this.db
        .select({ n: count() })
        .from(sql`content_reports`)
        .where(sql`target_type = 'user' AND target_id = ${userId}::uuid`),
      this.db
        .select()
        .from(auditEvents)
        .where(and(eq(auditEvents.targetType, "user"), eq(auditEvents.targetId, userId)))
        .orderBy(asc(auditEvents.occurredAt))
        .limit(200),
    ]);
    return {
      userId,
      status: user.status,
      powerUser: status?.status ?? "none",
      sanctions,
      appeals,
      contentActions: contentActions.map((a) => ({
        id: a.id,
        targetType: a.targetType,
        targetId: a.targetId,
        action: a.action,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
      reportsAgainst: reports[0]?.n ?? 0,
      audit: audit.map((e) => ({
        at: e.occurredAt.toISOString(),
        action: e.action,
        actorId: e.actorId,
      })),
    };
  }
}

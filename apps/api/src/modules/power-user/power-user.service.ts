import {
  and,
  type Database,
  enqueueOutboxEvent,
  eq,
  type Executor,
  gt,
  isNull,
  moderationAppeals,
  powerUserStatus,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
  users,
  verificationBadges,
} from "@fleettrust/db";
import {
  type MyPowerUserDto,
  POWER_USER_MEANING,
  POWER_USER_RULES,
  type PowerUserEligibility,
  type TrustErrorReason,
  type UserStatusDto,
} from "@fleettrust/types";
import { ConflictException, Inject, Injectable, NotFoundException } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";

export function trustError(reason: TrustErrorReason): Error {
  return new ConflictException({ statusCode: 409, error: "conflict", reason });
}

const DAY_MS = 86_400_000;
const R = POWER_USER_RULES;

/**
 * Power User status (SRS F-160, AB-12, ADR-0030).
 *
 * Earned, never bought: the only inputs are a verification badge, the account's age, the
 * person's own published activity and moderation history. This module can't import plan or
 * entitlement code or tables (lint rule, ADR-0009), and has no rating or review input.
 */
@Injectable()
export class PowerUserService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async identityVerified(executor: Executor, userId: string, now: Date) {
    const [badge] = await executor
      .select({ expiresAt: verificationBadges.expiresAt })
      .from(verificationBadges)
      .where(
        and(
          eq(verificationBadges.userId, userId),
          eq(verificationBadges.badgeType, R.identityBadge),
          isNull(verificationBadges.endedAt),
          gt(verificationBadges.expiresAt, now),
        ),
      )
      .limit(1);
    return badge ?? null;
  }

  /** Checks every rule. Pure reads; safe to call on every request. */
  async evaluate(executor: Executor, userId: string): Promise<PowerUserEligibility> {
    const now = this.clock.now();
    const [user] = await executor.select().from(users).where(eq(users.id, userId));
    if (!user) throw new NotFoundException({ statusCode: 404, error: "not_found" });

    const badge = await this.identityVerified(executor, userId, now);
    const days = Math.floor((now.getTime() - user.createdAt.getTime()) / DAY_MS);
    const windowStart = new Date(now.getTime() - R.activityWindowDays * DAY_MS).toISOString();
    const standingStart = new Date(now.getTime() - R.standingWindowDays * DAY_MS).toISOString();

    // Only the person's own, still-visible contributions count.
    const [activity] = await queryRows<{
      articles: number;
      comments: number;
      requests: number;
      active_days: number;
    }>(
      executor,
      sql`WITH events AS (
            SELECT 'article' AS kind, published_at::date AS day FROM articles
            WHERE author_user_id = ${userId}::uuid AND status = 'published' AND deleted_at IS NULL
              AND published_at >= ${windowStart}::timestamptz
            UNION ALL
            SELECT 'comment', created_at::date FROM article_comments
            WHERE author_user_id = ${userId}::uuid AND status = 'visible'
              AND created_at >= ${windowStart}::timestamptz
            UNION ALL
            SELECT 'request', closed_at::date FROM service_requests
            WHERE created_by = ${userId}::uuid AND status = 'completed'
              AND closed_at >= ${windowStart}::timestamptz
          )
          SELECT count(*) FILTER (WHERE kind = 'article')::int AS articles,
                 count(*) FILTER (WHERE kind = 'comment')::int AS comments,
                 count(*) FILTER (WHERE kind = 'request')::int AS requests,
                 count(DISTINCT day)::int AS active_days
          FROM events`,
    );
    const counts = {
      publishedArticles: activity?.articles ?? 0,
      visibleComments: activity?.comments ?? 0,
      completedRequests: activity?.requests ?? 0,
    };
    const score =
      Math.min(counts.publishedArticles, 10) * 3 +
      Math.min(counts.visibleComments, 30) +
      Math.min(counts.completedRequests, 10) * 2;
    const kinds = Object.values(counts).filter((n) => n > 0).length;
    const activeDays = activity?.active_days ?? 0;

    // Upheld human decisions in the standing window, minus those overturned on appeal.
    const [standing] = await queryRows<{ content: number; sanctions: number; revocations: number }>(
      executor,
      sql`SELECT
            (SELECT count(*)::int FROM moderation_actions a
             WHERE a.action IN ('reject', 'hide') AND a.metadata->>'authorUserId' = ${userId}
               AND a.created_at >= ${standingStart}::timestamptz
               AND NOT EXISTS (SELECT 1 FROM moderation_appeals p
                               WHERE p.moderation_action_id = a.id AND p.status = 'overturned')) AS content,
            (SELECT count(*)::int FROM member_sanctions s
             WHERE s.user_id = ${userId}::uuid AND NOT s.overturned
               AND s.created_at >= ${standingStart}::timestamptz) AS sanctions,
            (SELECT count(*)::int FROM power_user_status p
             WHERE p.user_id = ${userId}::uuid AND p.status = 'revoked'
               AND p.revoked_at >= ${standingStart}::timestamptz) AS revocations`,
    );
    const upheld =
      (standing?.content ?? 0) + (standing?.sanctions ?? 0) + (standing?.revocations ?? 0);
    const standingMet = upheld === 0 && user.status === "active";

    const criteria: PowerUserEligibility["criteria"] = {
      verifiedIdentity: {
        met: badge !== null,
        detail: badge
          ? `Verified identity until ${badge.expiresAt.toISOString().slice(0, 10)}`
          : "Needs a current verified-driver badge (identity check)",
      },
      accountAge: {
        met: days >= R.minAccountAgeDays,
        days,
        detail: `Account is ${String(days)} days old (needs ${String(R.minAccountAgeDays)})`,
      },
      activity: {
        met:
          score >= R.minActivityScore &&
          activeDays >= R.minActiveDays &&
          kinds >= R.minActivityKinds,
        score,
        activeDays,
        kinds,
        counts,
        detail: `Score ${String(score)}/${String(R.minActivityScore)}, ${String(activeDays)}/${String(R.minActiveDays)} active days, ${String(kinds)}/${String(R.minActivityKinds)} kinds of activity in the last ${String(R.activityWindowDays)} days`,
      },
      standing: {
        met: standingMet,
        upheldActions: upheld,
        detail: standingMet
          ? `No upheld moderation decisions in the last ${String(R.standingWindowDays)} days`
          : user.status !== "active"
            ? "The account is suspended"
            : `${String(upheld)} upheld moderation decision(s) in the last ${String(R.standingWindowDays)} days`,
      },
    };
    return { eligible: Object.values(criteria).every((c) => c.met), criteria };
  }

  private async row(executor: Executor, userId: string) {
    const [row] = await executor
      .select()
      .from(powerUserStatus)
      .where(eq(powerUserStatus.userId, userId));
    return row ?? null;
  }

  async mine(user: User): Promise<MyPowerUserDto> {
    const [row, eligibility] = await Promise.all([
      this.row(this.db, user.id),
      this.evaluate(this.db, user.id),
    ]);
    const [appeal] = row?.revokedAt
      ? await this.db
          .select({ id: moderationAppeals.id, status: moderationAppeals.status })
          .from(moderationAppeals)
          .where(
            and(
              eq(moderationAppeals.userId, user.id),
              eq(moderationAppeals.kind, "power_user"),
              eq(moderationAppeals.powerUserRevokedAt, row.revokedAt),
            ),
          )
      : [];
    return {
      status: row?.status ?? "none",
      shown: await this.shown(this.db, user.id, row),
      since: row?.status === "active" ? row.grantedAt.toISOString() : null,
      revokedAt: row?.revokedAt?.toISOString() ?? null,
      revokeReason: row?.revokeReason ?? null,
      appeal: appeal ?? null,
      eligibility,
      rules: POWER_USER_RULES,
      meaning: POWER_USER_MEANING,
    };
  }

  /** Shown publicly while active, the identity badge is current and the account is active. */
  private async shown(
    executor: Executor,
    userId: string,
    row: Awaited<ReturnType<PowerUserService["row"]>>,
  ): Promise<boolean> {
    if (row?.status !== "active") return false;
    const [user] = await executor
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, userId));
    if (user?.status !== "active") return false;
    return (await this.identityVerified(executor, userId, this.clock.now())) !== null;
  }

  /** The person asks; it's granted only if every rule passes (no staff endorsement involved). */
  async claim(user: User): Promise<MyPowerUserDto> {
    await this.db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`power-user:${user.id}`}, 0))`,
      );
      const current = await this.row(tx, user.id);
      if (current?.status === "active") throw trustError("already_power_user");
      const eligibility = await this.evaluate(tx, user.id);
      if (!eligibility.eligible) throw trustError("not_eligible");
      const now = this.clock.now();
      const values = {
        status: "active" as const,
        grantedAt: now,
        criteria: eligibility.criteria as unknown as Record<string, unknown>,
        revokedAt: null,
        revokedBy: null,
        revokeReason: null,
      };
      await tx
        .insert(powerUserStatus)
        .values({ userId: user.id, ...values })
        .onConflictDoUpdate({ target: powerUserStatus.userId, set: values });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        action: "power_user.granted",
        targetType: "user",
        targetId: user.id,
        requestId: currentRequestContext()?.requestId,
        metadata: { criteria: eligibility.criteria },
      });
    });
    return this.mine(user);
  }

  /**
   * Revokes an active status (a moderator's decision, or as part of a sanction). Returns false
   * when there was nothing to revoke. The caller records the moderation action.
   */
  async revoke(executor: Executor, actor: User, userId: string, reason: string): Promise<boolean> {
    const now = this.clock.now();
    const [row] = await executor
      .update(powerUserStatus)
      .set({ status: "revoked", revokedAt: now, revokedBy: actor.id, revokeReason: reason })
      .where(and(eq(powerUserStatus.userId, userId), eq(powerUserStatus.status, "active")))
      .returning();
    if (!row) return false;
    await recordAuditEvent(executor, {
      actorType: "admin",
      actorId: actor.id,
      action: "power_user.revoked",
      targetType: "user",
      targetId: userId,
      requestId: currentRequestContext()?.requestId,
      metadata: { reason },
    });
    await enqueueOutboxEvent(executor, {
      aggregateType: "user",
      aggregateId: userId,
      eventType: "PowerUserRevoked",
      payload: { reason },
    });
    return true;
  }

  /** An appeal of a revocation was overturned: the status comes back as it was. */
  async reinstate(executor: Executor, actor: User, userId: string, revokedAt: Date): Promise<void> {
    const [row] = await executor
      .update(powerUserStatus)
      .set({ status: "active", revokedAt: null, revokedBy: null, revokeReason: null })
      .where(
        and(
          eq(powerUserStatus.userId, userId),
          eq(powerUserStatus.status, "revoked"),
          eq(powerUserStatus.revokedAt, revokedAt),
        ),
      )
      .returning();
    if (!row) return;
    await recordAuditEvent(executor, {
      actorType: "admin",
      actorId: actor.id,
      action: "power_user.reinstated",
      targetType: "user",
      targetId: userId,
      requestId: currentRequestContext()?.requestId,
    });
  }

  /** The current status row (for appeals and member history). */
  async statusOf(executor: Executor, userId: string) {
    return this.row(executor, userId);
  }

  /** Public label: anyone, including visitors. */
  async publicStatus(userId: string): Promise<UserStatusDto> {
    const row = await this.row(this.db, userId);
    const [user] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, userId));
    if (!user) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    const shown = await this.shown(this.db, userId, row);
    return {
      userId,
      powerUser: shown,
      since: shown && row ? row.grantedAt.toISOString() : null,
      meaning: POWER_USER_MEANING,
    };
  }

  /** Count for the trust and safety dashboard. */
  async activeCount(): Promise<number> {
    const rows = await this.db
      .select({ userId: powerUserStatus.userId })
      .from(powerUserStatus)
      .where(eq(powerUserStatus.status, "active"));
    return rows.length;
  }
}

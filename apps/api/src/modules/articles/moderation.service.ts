import {
  and,
  type Article,
  type ArticleComment,
  articleComments,
  articles,
  asc,
  contentReports,
  type Database,
  enqueueOutboxEvent,
  eq,
  type Executor,
  isNull,
  moderationActions,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
} from "@fleettrust/db";
import {
  AUTO_FLAG_REPORTS,
  type createReportSchema,
  type ModerationCase,
  type ModerationQueueItem,
  type ReportTargetType,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { articleError, notFound, violates } from "./shared.js";

type ReportInput = z.output<typeof createReportSchema>;
export type ArticleDecision = "approve" | "reject" | "hide" | "restore";
export type CommentDecision = "hide" | "restore";

type ArticleStatus = Article["status"];
const ARTICLE_MOVES: Record<
  ArticleDecision,
  { from: readonly ArticleStatus[]; to: ArticleStatus }
> = {
  approve: { from: ["pending_moderation"], to: "published" },
  reject: { from: ["pending_moderation"], to: "rejected" },
  hide: { from: ["published", "pending_moderation"], to: "hidden" },
  restore: { from: ["hidden"], to: "published" },
};
/** Decisions that uphold reports ("actioned"); the others dismiss them. */
const UPHOLDS = new Set(["reject", "hide"]);

const OUTBOX_ACTION: Record<string, string> = {
  approve: "approved",
  reject: "rejected",
  hide: "hidden",
  restore: "restored",
  dismiss_reports: "reports_dismissed",
  auto_flag: "auto_flagged",
};

/**
 * Reports and the trust and safety queue (F-112, SRS J9, AB-06/AB-13). Every decision is written
 * to the append-only `moderation_actions` history and the audit log, and goes to the outbox so
 * the author can be told (Prompt 17). Appeals and account sanctions come with Prompt 23.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------------------------

  /** Public content only; your own content can't be reported. */
  async report(user: User, input: ReportInput): Promise<{ id: string; status: "open" }> {
    return this.db.transaction(async (tx) => {
      const target = await this.publicTarget(tx, input.targetType, input.targetId);
      if (target.authorUserId === user.id) throw articleError(400, "own_content");
      let id: string;
      try {
        const [row] = await tx
          .insert(contentReports)
          .values({
            reporterUserId: user.id,
            targetType: input.targetType,
            targetId: input.targetId,
            reason: input.reason,
            details: input.details,
          })
          .returning({ id: contentReports.id });
        if (!row) throw new Error("report insert returned no row");
        id = row.id;
      } catch (error) {
        if (violates(error, "content_reports_open_key"))
          throw articleError(409, "already_reported");
        throw error;
      }
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        action: "content_report.created",
        targetType: input.targetType,
        targetId: input.targetId,
        requestId: currentRequestContext()?.requestId,
        metadata: { reportId: id, reason: input.reason },
      });
      await enqueueOutboxEvent(tx, {
        aggregateType: input.targetType,
        aggregateId: input.targetId,
        eventType: "ContentReported",
        payload: { reportId: id, targetType: input.targetType, targetId: input.targetId },
      });
      await this.autoFlag(tx, input.targetType, input.targetId);
      return { id, status: "open" as const };
    });
  }

  private async publicTarget(
    executor: Executor,
    type: ReportTargetType,
    id: string,
  ): Promise<{ authorUserId: string }> {
    if (type === "article") {
      const [row] = await executor
        .select({ authorUserId: articles.authorUserId })
        .from(articles)
        .where(
          and(eq(articles.id, id), eq(articles.status, "published"), isNull(articles.deletedAt)),
        );
      if (!row) throw notFound();
      return row;
    }
    const [row] = await executor
      .select({ authorUserId: articleComments.authorUserId })
      .from(articleComments)
      .innerJoin(articles, eq(articles.id, articleComments.articleId))
      .where(
        and(
          eq(articleComments.id, id),
          eq(articleComments.status, "visible"),
          eq(articles.status, "published"),
          isNull(articles.deletedAt),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  /** Enough distinct reporters take content out of public view until a moderator decides. */
  private async autoFlag(executor: Executor, type: ReportTargetType, id: string): Promise<void> {
    const [counted] = await queryRows<{ n: number }>(
      executor,
      sql`SELECT count(DISTINCT reporter_user_id)::int AS n FROM content_reports
          WHERE target_type = ${type} AND target_id = ${id} AND status = 'open'`,
    );
    if ((counted?.n ?? 0) < AUTO_FLAG_REPORTS) return;
    const moved =
      type === "article"
        ? await executor
            .update(articles)
            .set({ status: "pending_moderation" })
            .where(and(eq(articles.id, id), eq(articles.status, "published")))
            .returning({ id: articles.id })
        : await executor
            .update(articleComments)
            .set({ status: "hidden" })
            .where(and(eq(articleComments.id, id), eq(articleComments.status, "visible")))
            .returning({ id: articleComments.id });
    if (moved.length === 0) return;
    await this.record(executor, null, type, id, "auto_flag", null, { reports: counted?.n });
  }

  // -------------------------------------------------------------------------------------------
  // Queue and cases (platform role trust_safety_moderator)
  // -------------------------------------------------------------------------------------------

  /** Articles waiting for moderation plus anything with open reports, oldest first. */
  async queue(): Promise<ModerationQueueItem[]> {
    const rows = await queryRows<{
      target_type: ReportTargetType;
      target_id: string;
      status: string;
      title: string;
      author_user_id: string;
      open_reports: number;
      reasons: string[] | null;
      waiting_since: Date | string;
    }>(
      this.db,
      sql`WITH open AS (
            SELECT target_type, target_id, count(*)::int AS open_reports,
                   array_agg(DISTINCT reason) AS reasons, min(created_at) AS first_report
            FROM content_reports WHERE status = 'open' GROUP BY target_type, target_id
          )
          SELECT 'article' AS target_type, a.id AS target_id, a.status, a.title,
                 a.author_user_id, coalesce(o.open_reports, 0) AS open_reports, o.reasons,
                 CASE WHEN a.status = 'pending_moderation'
                      THEN least(a.updated_at, coalesce(o.first_report, a.updated_at))
                      ELSE o.first_report END AS waiting_since
          FROM articles a
          LEFT JOIN open o ON o.target_type = 'article' AND o.target_id = a.id
          WHERE a.deleted_at IS NULL AND a.status <> 'draft'
            AND (a.status = 'pending_moderation' OR o.target_id IS NOT NULL)
          UNION ALL
          SELECT 'article_comment', c.id, c.status, left(c.body, 120), c.author_user_id,
                 o.open_reports, o.reasons, o.first_report
          FROM article_comments c
          JOIN open o ON o.target_type = 'article_comment' AND o.target_id = c.id
          ORDER BY waiting_since ASC
          LIMIT 100`,
    );
    return rows.map((r) => ({
      targetType: r.target_type,
      targetId: r.target_id,
      status: r.status,
      title: r.title,
      authorUserId: r.author_user_id,
      openReports: r.open_reports,
      reasons: (r.reasons ?? []) as ModerationQueueItem["reasons"],
      waitingSince: new Date(r.waiting_since).toISOString(),
    }));
  }

  private async article(executor: Executor, id: string, lock = false): Promise<Article> {
    const query = executor.select().from(articles).where(eq(articles.id, id));
    const [row] = lock ? await query.for("update") : await query;
    // Drafts are private to their author.
    if (!row || row.status === "draft") throw notFound();
    return row;
  }

  private async comment(executor: Executor, id: string, lock = false): Promise<ArticleComment> {
    const query = executor.select().from(articleComments).where(eq(articleComments.id, id));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  async articleCase(id: string): Promise<ModerationCase> {
    const row = await this.article(this.db, id);
    return this.caseOf(
      "article",
      row.id,
      row.status,
      row.authorUserId,
      row.title,
      row.bodyText,
      row.id,
    );
  }

  async commentCase(id: string): Promise<ModerationCase> {
    const row = await this.comment(this.db, id);
    return this.caseOf(
      "article_comment",
      row.id,
      row.status,
      row.authorUserId,
      row.body.slice(0, 120),
      row.body,
      row.articleId,
    );
  }

  private async caseOf(
    targetType: ReportTargetType,
    targetId: string,
    status: string,
    authorUserId: string,
    title: string,
    text: string,
    articleId: string,
  ): Promise<ModerationCase> {
    const [reports, actions] = await Promise.all([
      this.db
        .select()
        .from(contentReports)
        .where(
          and(eq(contentReports.targetType, targetType), eq(contentReports.targetId, targetId)),
        )
        .orderBy(asc(contentReports.createdAt)),
      this.db
        .select()
        .from(moderationActions)
        .where(
          and(
            eq(moderationActions.targetType, targetType),
            eq(moderationActions.targetId, targetId),
          ),
        )
        .orderBy(asc(moderationActions.createdAt), asc(moderationActions.id)),
    ]);
    return {
      targetType,
      targetId,
      status,
      authorUserId,
      title,
      text,
      articleId,
      reports: reports.map((r) => ({
        id: r.id,
        reason: r.reason,
        details: r.details,
        status: r.status,
        createdAt: r.createdAt.toISOString(),
      })),
      actions: actions.map((a) => ({
        id: a.id,
        targetType: a.targetType,
        targetId: a.targetId,
        action: a.action,
        moderatorUserId: a.moderatorUserId,
        reason: a.reason,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Decisions
  // -------------------------------------------------------------------------------------------

  async decideArticle(
    moderator: User,
    id: string,
    decision: ArticleDecision,
    reason: string | null,
  ): Promise<ModerationCase> {
    await this.db.transaction(async (tx) => {
      const row = await this.article(tx, id, true);
      if (row.authorUserId === moderator.id) throw articleError(409, "own_content");
      if (row.deletedAt !== null) throw articleError(409, "invalid_transition");
      const move = ARTICLE_MOVES[decision];
      if (!move.from.includes(row.status)) throw articleError(409, "invalid_transition");
      const upheld = UPHOLDS.has(decision);
      await tx
        .update(articles)
        .set({
          status: move.to,
          moderationNote: upheld ? reason : null,
          ...(move.to === "published" ? { publishedAt: row.publishedAt ?? this.clock.now() } : {}),
        })
        .where(eq(articles.id, row.id));
      const resolved = await this.resolveReports(tx, moderator, "article", row.id, upheld);
      await this.record(tx, moderator, "article", row.id, decision, reason, {
        from: row.status,
        to: move.to,
        reports: resolved,
        authorUserId: row.authorUserId,
      });
    });
    return this.articleCase(id);
  }

  async decideComment(
    moderator: User,
    id: string,
    decision: CommentDecision,
    reason: string | null,
  ): Promise<ModerationCase> {
    await this.db.transaction(async (tx) => {
      const row = await this.comment(tx, id, true);
      if (row.authorUserId === moderator.id) throw articleError(409, "own_content");
      const from = decision === "hide" ? "visible" : "hidden";
      if (row.status !== from) throw articleError(409, "invalid_transition");
      const to = decision === "hide" ? "hidden" : "visible";
      await tx.update(articleComments).set({ status: to }).where(eq(articleComments.id, row.id));
      const upheld = decision === "hide";
      const resolved = await this.resolveReports(tx, moderator, "article_comment", row.id, upheld);
      await this.record(tx, moderator, "article_comment", row.id, decision, reason, {
        from,
        to,
        reports: resolved,
        authorUserId: row.authorUserId,
      });
    });
    return this.commentCase(id);
  }

  /** Closes open reports without changing the content (e.g. the reports were unfounded). */
  async dismissReports(
    moderator: User,
    type: ReportTargetType,
    id: string,
    reason: string | null,
  ): Promise<ModerationCase> {
    await this.db.transaction(async (tx) => {
      const row =
        type === "article" ? await this.article(tx, id, true) : await this.comment(tx, id, true);
      if (row.authorUserId === moderator.id) throw articleError(409, "own_content");
      const resolved = await this.resolveReports(tx, moderator, type, id, false);
      if (resolved === 0) throw articleError(409, "invalid_transition");
      await this.record(tx, moderator, type, id, "dismiss_reports", reason, { reports: resolved });
    });
    return type === "article" ? this.articleCase(id) : this.commentCase(id);
  }

  private async resolveReports(
    executor: Executor,
    moderator: User,
    type: ReportTargetType,
    id: string,
    upheld: boolean,
  ): Promise<number> {
    const rows = await executor
      .update(contentReports)
      .set({
        status: upheld ? "actioned" : "dismissed",
        resolvedBy: moderator.id,
        resolvedAt: this.clock.now(),
      })
      .where(
        and(
          eq(contentReports.targetType, type),
          eq(contentReports.targetId, id),
          eq(contentReports.status, "open"),
        ),
      )
      .returning({ id: contentReports.id });
    return rows.length;
  }

  private async record(
    executor: Executor,
    moderator: User | null,
    type: ReportTargetType,
    id: string,
    action: (typeof moderationActions.$inferInsert)["action"],
    reason: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await executor.insert(moderationActions).values({
      moderatorUserId: moderator?.id ?? null,
      targetType: type,
      targetId: id,
      action,
      reason,
      metadata,
    });
    await recordAuditEvent(executor, {
      actorType: moderator === null ? "system" : "admin",
      actorId: moderator?.id ?? null,
      action: `moderation.${type}_${OUTBOX_ACTION[action] ?? action}`,
      targetType: type,
      targetId: id,
      requestId: currentRequestContext()?.requestId,
      metadata: { reason, ...metadata },
    });
    await enqueueOutboxEvent(executor, {
      aggregateType: type,
      aggregateId: id,
      eventType: type === "article" ? "ArticleModerated" : "ArticleCommentModerated",
      payload: { targetId: id, action, ...metadata },
    });
  }
}

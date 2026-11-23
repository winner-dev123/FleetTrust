import {
  and,
  type Article,
  articleComments,
  articles,
  asc,
  communityGroups,
  messages,
  contentReports,
  type Database,
  enqueueOutboxEvent,
  eq,
  type Executor,
  moderationActions,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
  users,
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
import { REALTIME_BUS, type RealtimeBus } from "../../platform/realtime/index.js";
import { moderationError, notFound, violates } from "./shared.js";

type ReportInput = z.output<typeof createReportSchema>;
export type ArticleDecision = "approve" | "reject" | "hide" | "restore";
/** Comments and groups can be hidden and restored. */
export type VisibilityDecision = "hide" | "restore";
type Action = (typeof moderationActions.$inferInsert)["action"];

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
const UPHOLDS = new Set<string>(["reject", "hide"]);

const PAST: Record<Action, string> = {
  approve: "approved",
  reject: "rejected",
  hide: "hidden",
  restore: "restored",
  dismiss_reports: "reports_dismissed",
  auto_flag: "auto_flagged",
};
const OUTBOX: Record<ReportTargetType, string> = {
  article: "ArticleModerated",
  article_comment: "ArticleCommentModerated",
  group: "GroupModerated",
  user: "UserModerated",
  message: "MessageModerated",
};

interface Target {
  /** Who is responsible: the author, the group's creator, or the reported member. */
  authorUserId: string;
  status: string;
  title: string;
  text: string;
  articleId: string | null;
}

/**
 * Reports and the trust and safety queue (SRS J9, F-112, AB-05/06/13), shared by articles,
 * comments, groups and members. Every decision goes to the append-only `moderation_actions`
 * history, the audit log and the outbox (so the person concerned can be told, Prompt 17).
 * Member sanctions (warnings, suspensions) and appeals come with Prompt 23: member reports can
 * only be dismissed for now.
 */
@Injectable()
export class ModerationService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBus,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Reports
  // -------------------------------------------------------------------------------------------

  /** Public content and active members only; you can't report yourself or your own content. */
  async report(
    user: User,
    input: ReportInput,
    options: { conversationAccessChecked?: boolean } = {},
  ): Promise<{ id: string; status: "open" }> {
    // Messages are private: they can only be reported from inside the conversation.
    if (input.targetType === "message" && options.conversationAccessChecked !== true) {
      throw notFound();
    }
    const result = await this.db.transaction(async (tx) => {
      const target = await this.target(tx, input.targetType, input.targetId, { publicOnly: true });
      if (target.authorUserId === user.id) throw moderationError(400, "own_content");
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
        if (violates(error, "content_reports_open_key")) {
          throw moderationError(409, "already_reported");
        }
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
      const flagged = await this.autoFlag(tx, input.targetType, input.targetId);
      return { id, status: "open" as const, flagged };
    });
    if (result.flagged && input.targetType === "message") await this.refreshMessage(input.targetId);
    return { id: result.id, status: result.status };
  }

  /** Tells open sockets to reload a message whose visibility changed. */
  private async refreshMessage(messageId: string): Promise<void> {
    const [row] = await this.db
      .select({ conversationId: messages.conversationId })
      .from(messages)
      .where(eq(messages.id, messageId));
    if (row) {
      await this.bus.publish(`conversation:${row.conversationId}`, { type: "refresh", messageId });
    }
  }

  /** Loads a report target. `publicOnly`: only what members of the public can currently see. */
  private async target(
    executor: Executor,
    type: ReportTargetType,
    id: string,
    options: { publicOnly?: boolean; lock?: boolean } = {},
  ): Promise<Target> {
    const lock = options.lock === true;
    switch (type) {
      case "article": {
        const query = executor.select().from(articles).where(eq(articles.id, id));
        const [row] = lock ? await query.for("update") : await query;
        // Drafts are private to their author, even for moderators.
        if (!row || row.status === "draft") throw notFound();
        if (options.publicOnly === true && (row.status !== "published" || row.deletedAt !== null))
          throw notFound();
        return {
          authorUserId: row.authorUserId,
          status: row.status,
          title: row.title,
          text: row.bodyText,
          articleId: row.id,
        };
      }
      case "article_comment": {
        const query = executor
          .select({ comment: articleComments, article: articles })
          .from(articleComments)
          .innerJoin(articles, eq(articles.id, articleComments.articleId))
          .where(eq(articleComments.id, id));
        const [row] = lock ? await query.for("update", { of: articleComments }) : await query;
        if (!row) throw notFound();
        if (
          options.publicOnly === true &&
          (row.comment.status !== "visible" ||
            row.article.status !== "published" ||
            row.article.deletedAt !== null)
        )
          throw notFound();
        return {
          authorUserId: row.comment.authorUserId,
          status: row.comment.status,
          title: row.comment.body.slice(0, 120),
          text: row.comment.body,
          articleId: row.article.id,
        };
      }
      case "group": {
        const query = executor.select().from(communityGroups).where(eq(communityGroups.id, id));
        const [row] = lock ? await query.for("update") : await query;
        if (!row) throw notFound();
        if (options.publicOnly === true && row.status !== "active") throw notFound();
        return {
          authorUserId: row.createdBy,
          status: row.status,
          title: row.name,
          text: row.description ?? "",
          articleId: null,
        };
      }
      case "message": {
        const query = executor.select().from(messages).where(eq(messages.id, id));
        const [row] = lock ? await query.for("update") : await query;
        if (!row) throw notFound();
        if (options.publicOnly === true && row.status !== "visible") throw notFound();
        return {
          authorUserId: row.senderUserId,
          status: row.status,
          title: row.body.slice(0, 120),
          text: row.body,
          articleId: null,
        };
      }
      case "user": {
        const [row] = await executor.select().from(users).where(eq(users.id, id));
        if (!row) throw notFound();
        if (options.publicOnly === true && row.status !== "active") throw notFound();
        return {
          authorUserId: row.id,
          status: row.status,
          title: row.displayName ?? "FleetTrust member",
          text: "",
          articleId: null,
        };
      }
    }
  }

  /** Enough distinct reporters take content out of public view until a moderator decides. */
  private async autoFlag(executor: Executor, type: ReportTargetType, id: string): Promise<boolean> {
    // Members aren't suspended automatically: sanctions need a person (Prompt 23).
    if (type === "user") return false;
    const [counted] = await queryRows<{ n: number }>(
      executor,
      sql`SELECT count(DISTINCT reporter_user_id)::int AS n FROM content_reports
          WHERE target_type = ${type} AND target_id = ${id} AND status = 'open'`,
    );
    if ((counted?.n ?? 0) < AUTO_FLAG_REPORTS) return false;
    let moved: { id: string }[];
    if (type === "article") {
      moved = await executor
        .update(articles)
        .set({ status: "pending_moderation" })
        .where(and(eq(articles.id, id), eq(articles.status, "published")))
        .returning({ id: articles.id });
    } else if (type === "article_comment") {
      moved = await executor
        .update(articleComments)
        .set({ status: "hidden" })
        .where(and(eq(articleComments.id, id), eq(articleComments.status, "visible")))
        .returning({ id: articleComments.id });
    } else if (type === "message") {
      moved = await executor
        .update(messages)
        .set({ status: "hidden" })
        .where(and(eq(messages.id, id), eq(messages.status, "visible")))
        .returning({ id: messages.id });
    } else {
      moved = await executor
        .update(communityGroups)
        .set({ status: "hidden" })
        .where(and(eq(communityGroups.id, id), eq(communityGroups.status, "active")))
        .returning({ id: communityGroups.id });
    }
    if (moved.length === 0) return false;
    await this.record(executor, null, type, id, "auto_flag", null, { reports: counted?.n });
    return true;
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
      title: string | null;
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
          UNION ALL
          SELECT 'group', g.id, g.status, g.name, g.created_by,
                 o.open_reports, o.reasons, o.first_report
          FROM community_groups g
          JOIN open o ON o.target_type = 'group' AND o.target_id = g.id
          UNION ALL
          SELECT 'user', u.id, u.status, u.display_name, u.id,
                 o.open_reports, o.reasons, o.first_report
          FROM users u
          JOIN open o ON o.target_type = 'user' AND o.target_id = u.id
          UNION ALL
          SELECT 'message', m.id, m.status, left(m.body, 120), m.sender_user_id,
                 o.open_reports, o.reasons, o.first_report
          FROM messages m
          JOIN open o ON o.target_type = 'message' AND o.target_id = m.id
          ORDER BY waiting_since ASC
          LIMIT 100`,
    );
    return rows.map((r) => ({
      targetType: r.target_type,
      targetId: r.target_id,
      status: r.status,
      title: r.title ?? "FleetTrust member",
      authorUserId: r.author_user_id,
      openReports: r.open_reports,
      reasons: (r.reasons ?? []) as ModerationQueueItem["reasons"],
      waitingSince: new Date(r.waiting_since).toISOString(),
    }));
  }

  async case(type: ReportTargetType, id: string): Promise<ModerationCase> {
    const target = await this.target(this.db, type, id);
    const [reports, actions] = await Promise.all([
      this.db
        .select()
        .from(contentReports)
        .where(and(eq(contentReports.targetType, type), eq(contentReports.targetId, id)))
        .orderBy(asc(contentReports.createdAt)),
      this.db
        .select()
        .from(moderationActions)
        .where(and(eq(moderationActions.targetType, type), eq(moderationActions.targetId, id)))
        .orderBy(asc(moderationActions.createdAt), asc(moderationActions.id)),
    ]);
    return {
      targetType: type,
      targetId: id,
      status: target.status,
      authorUserId: target.authorUserId,
      title: target.title,
      text: target.text,
      articleId: target.articleId,
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
      const target = await this.target(tx, "article", id, { lock: true });
      if (target.authorUserId === moderator.id) throw moderationError(409, "own_content");
      const [row] = await tx.select().from(articles).where(eq(articles.id, id));
      if (row?.deletedAt !== null) throw moderationError(409, "invalid_transition");
      const move = ARTICLE_MOVES[decision];
      if (!move.from.includes(row.status)) throw moderationError(409, "invalid_transition");
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
    return this.case("article", id);
  }

  /** Hide or restore a comment or a group. */
  async decideVisibility(
    moderator: User,
    type: "article_comment" | "group" | "message",
    id: string,
    decision: VisibilityDecision,
    reason: string | null,
  ): Promise<ModerationCase> {
    await this.db.transaction(async (tx) => {
      const target = await this.target(tx, type, id, { lock: true });
      if (target.authorUserId === moderator.id) throw moderationError(409, "own_content");
      const shown = type === "group" ? "active" : "visible";
      const from = decision === "hide" ? shown : "hidden";
      const to = decision === "hide" ? "hidden" : shown;
      if (target.status !== from) throw moderationError(409, "invalid_transition");
      if (type === "group") {
        await tx
          .update(communityGroups)
          .set({ status: to as "active" | "hidden" })
          .where(eq(communityGroups.id, id));
      } else if (type === "message") {
        await tx
          .update(messages)
          .set({ status: to as "visible" | "hidden" })
          .where(eq(messages.id, id));
      } else {
        await tx
          .update(articleComments)
          .set({ status: to as "visible" | "hidden" })
          .where(eq(articleComments.id, id));
      }
      const upheld = decision === "hide";
      const resolved = await this.resolveReports(tx, moderator, type, id, upheld);
      await this.record(tx, moderator, type, id, decision, reason, {
        from,
        to,
        reports: resolved,
        authorUserId: target.authorUserId,
      });
    });
    if (type === "message") await this.refreshMessage(id);
    return this.case(type, id);
  }

  /**
   * A moderator opens a case. Message cases show private conversation content, so every view is
   * audited (SRS §2.3: no message content without an audited case).
   */
  async viewCase(moderator: User, type: ReportTargetType, id: string): Promise<ModerationCase> {
    const result = await this.case(type, id);
    if (type === "message") {
      await recordAuditEvent(this.db, {
        actorType: "admin",
        actorId: moderator.id,
        action: "moderation.message_viewed",
        targetType: "message",
        targetId: id,
        requestId: currentRequestContext()?.requestId,
        metadata: { openReports: result.reports.filter((r) => r.status === "open").length },
      });
    }
    return result;
  }

  /** Closes open reports without changing anything (e.g. the reports were unfounded). */
  async dismissReports(
    moderator: User,
    type: ReportTargetType,
    id: string,
    reason: string | null,
  ): Promise<ModerationCase> {
    await this.db.transaction(async (tx) => {
      const target = await this.target(tx, type, id, { lock: true });
      if (target.authorUserId === moderator.id) throw moderationError(409, "own_content");
      const resolved = await this.resolveReports(tx, moderator, type, id, false);
      if (resolved === 0) throw moderationError(409, "invalid_transition");
      await this.record(tx, moderator, type, id, "dismiss_reports", reason, { reports: resolved });
    });
    return this.case(type, id);
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
    action: Action,
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
      action: `moderation.${type}_${PAST[action]}`,
      targetType: type,
      targetId: id,
      requestId: currentRequestContext()?.requestId,
      metadata: { reason, ...metadata },
    });
    await enqueueOutboxEvent(executor, {
      aggregateType: type,
      aggregateId: id,
      eventType: OUTBOX[type],
      payload: { targetId: id, action, ...metadata },
    });
  }
}

import {
  and,
  type ArticleComment,
  articleComments,
  asc,
  type Database,
  enqueueOutboxEvent,
  eq,
  inArray,
  recordAuditEvent,
  type User,
  users,
} from "@fleettrust/db";
import {
  type ArticleCommentDto,
  COMMUNITY_CONTENT_LABEL,
  type CommentList,
  plainTextLinks,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { ArticlesService } from "./articles.service.js";
import { articleError, notFound } from "./shared.js";

/**
 * Article comments (F-111): plain text (clients render it as text, never HTML), one level of
 * replies, no votes. Same rating and link rules as articles.
 */
@Injectable()
export class CommentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly articles: ArticlesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private checkBody(user: User, body: string): void {
    this.articles.assertNoRating(body);
    const limit = this.articles.linkLimit(user, "comment");
    if (plainTextLinks(body).length > limit) throw articleError(400, "too_many_links", { limit });
  }

  async list(slug: string): Promise<CommentList> {
    const article = await this.articles.publicArticle(this.db, { slug });
    const rows = await this.db
      .select()
      .from(articleComments)
      .where(eq(articleComments.articleId, article.id))
      .orderBy(asc(articleComments.createdAt), asc(articleComments.id))
      .limit(500);
    // Removed comments keep their place only when someone replied to them.
    const parents = new Set(
      rows.filter((r) => r.status === "visible" && r.parentId !== null).map((r) => r.parentId),
    );
    const shown = rows.filter((r) => r.status === "visible" || parents.has(r.id));
    return { items: await this.dtos(shown), label: COMMUNITY_CONTENT_LABEL };
  }

  async create(
    user: User,
    articleId: string,
    input: { body: string; parentId: string | null },
  ): Promise<ArticleCommentDto> {
    this.checkBody(user, input.body);
    const row = await this.db.transaction(async (tx) => {
      const article = await this.articles.publicArticle(tx, { id: articleId });
      if (!article.commentsEnabled) throw articleError(409, "comments_disabled");
      if (input.parentId !== null) {
        const [parent] = await tx
          .select()
          .from(articleComments)
          .where(
            and(eq(articleComments.id, input.parentId), eq(articleComments.articleId, article.id)),
          );
        if (parent?.status !== "visible" || parent.parentId !== null) {
          throw articleError(400, "invalid_parent");
        }
      }
      const [inserted] = await tx
        .insert(articleComments)
        .values({
          articleId: article.id,
          parentId: input.parentId,
          authorUserId: user.id,
          body: input.body,
        })
        .returning();
      if (!inserted) throw new Error("comment insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        action: "article_comment.created",
        targetType: "article_comment",
        targetId: inserted.id,
        requestId: currentRequestContext()?.requestId,
        metadata: { articleId: article.id },
      });
      // For the article author's notification (Prompt 17). IDs only, never the text.
      await enqueueOutboxEvent(tx, {
        aggregateType: "article",
        aggregateId: article.id,
        eventType: "ArticleCommentCreated",
        payload: {
          articleId: article.id,
          commentId: inserted.id,
          articleAuthorUserId: article.authorUserId,
          parentId: input.parentId,
        },
      });
      return inserted;
    });
    const [dto] = await this.dtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  private async own(user: User, id: string): Promise<ArticleComment> {
    const [row] = await this.db
      .select()
      .from(articleComments)
      .where(and(eq(articleComments.id, id), eq(articleComments.authorUserId, user.id)));
    if (!row || row.status === "deleted") throw notFound();
    return row;
  }

  async update(user: User, id: string, body: string): Promise<ArticleCommentDto> {
    const current = await this.own(user, id);
    if (current.status !== "visible") throw articleError(409, "invalid_transition");
    this.checkBody(user, body);
    await this.articles.publicArticle(this.db, { id: current.articleId });
    const [row] = await this.db
      .update(articleComments)
      .set({ body, editedAt: this.clock.now() })
      .where(eq(articleComments.id, current.id))
      .returning();
    if (!row) throw notFound();
    const [dto] = await this.dtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  /** The text is kept (moderation evidence) but never shown again. */
  async remove(user: User, id: string): Promise<void> {
    const current = await this.own(user, id);
    await this.db.transaction(async (tx) => {
      await tx
        .update(articleComments)
        .set({ status: "deleted" })
        .where(eq(articleComments.id, current.id));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        action: "article_comment.deleted",
        targetType: "article_comment",
        targetId: current.id,
        requestId: currentRequestContext()?.requestId,
        metadata: {},
      });
    });
  }

  private async dtos(rows: readonly ArticleComment[]): Promise<ArticleCommentDto[]> {
    const ids = [...new Set(rows.map((r) => r.authorUserId))];
    const authors =
      ids.length === 0
        ? []
        : await this.db
            .select({ id: users.id, displayName: users.displayName })
            .from(users)
            .where(inArray(users.id, ids));
    const name = new Map(authors.map((a) => [a.id, a.displayName]));
    return rows.map((row) => {
      const visible = row.status === "visible";
      return {
        id: row.id,
        articleId: row.articleId,
        parentId: row.parentId,
        body: visible ? row.body : null,
        status: row.status,
        author: visible ? { displayName: name.get(row.authorUserId) ?? "FleetTrust member" } : null,
        createdAt: row.createdAt.toISOString(),
        editedAt: row.editedAt === null ? null : row.editedAt.toISOString(),
      };
    });
  }
}

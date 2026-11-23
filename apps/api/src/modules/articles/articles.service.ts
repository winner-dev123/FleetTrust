import { createHash, randomBytes } from "node:crypto";

import {
  and,
  type Article,
  articleBookmarks,
  articleImages,
  articles,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  inArray,
  isNull,
  memberships,
  moderationActions,
  organizations,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
  users,
} from "@fleettrust/db";
import {
  analyzeArticle,
  type ArticleDocument,
  type ArticlePage,
  type ArticleSummary,
  COMMUNITY_CONTENT_LABEL,
  type createArticleSchema,
  findRatingContent,
  hasPermission,
  LINK_LIMITS,
  MAX_ARTICLE_DEPTH,
  MAX_ARTICLE_IMAGES,
  MAX_ARTICLE_NODES,
  MAX_ARTICLE_TEXT,
  type MyArticle,
  NEW_ACCOUNT_DAYS,
  plainTextLinks,
  type PublicArticle,
  renderArticleHtml,
  type Role,
  type searchArticlesQuerySchema,
  type updateArticleSchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import {
  EntitlementsService,
  subjectOfOrganization,
  subjectOfUser,
} from "../entitlements/index.js";
import { articleError, notFound } from "./shared.js";

type CreateInput = z.output<typeof createArticleSchema>;
type UpdateInput = z.output<typeof updateArticleSchema>;
type SearchInput = z.output<typeof searchArticlesQuerySchema>;

const DAY_MS = 86_400_000;
/** Authors with content rejected or hidden this recently are moderated before publication. */
const STRIKE_WINDOW_DAYS = 90;
const MIN_PUBLISH_TEXT = 20;
const MAX_SEARCH_OFFSET = 1_000;

/** Publicly visible: published and not deleted. */
const isPublic = and(eq(articles.status, "published"), isNull(articles.deletedAt));

function slugify(title: string): string {
  const base = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
  const suffix = randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(0, 6);
  return `${base === "" ? "article" : base}-${suffix}`;
}

function excerptOf(row: Pick<Article, "summary" | "bodyText">): string {
  if (row.summary !== null && row.summary !== "") return row.summary;
  const text = row.bodyText.replace(/\s+/g, " ").trim();
  if (text.length <= 200) return text;
  const cut = text.slice(0, 200);
  const space = cut.lastIndexOf(" ");
  return `${space > 120 ? cut.slice(0, space) : cut}…`;
}

const iso = (d: Date | null) => (d === null ? null : d.toISOString());

/**
 * Community articles (SRS J7, F-110/F-111, ADR-0022): drafts, publishing with the
 * `articles.daily` quota, public reading and search, and private bookmarks. Comments, reports
 * and moderation live in their own services.
 */
@Injectable()
export class ArticlesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Shared rules
  // -------------------------------------------------------------------------------------------

  /** New accounts (AB-06) get tighter link limits and pre-moderation. */
  isNewAccount(user: Pick<User, "createdAt">): boolean {
    return this.clock.now().getTime() - user.createdAt.getTime() < NEW_ACCOUNT_DAYS * DAY_MS;
  }

  /** New accounts, and authors whose content was recently rejected or hidden. */
  async needsPreModeration(executor: Executor, user: User): Promise<boolean> {
    if (this.isNewAccount(user)) return true;
    const since = new Date(this.clock.now().getTime() - STRIKE_WINDOW_DAYS * DAY_MS);
    const rows = await queryRows<{ n: number }>(
      executor,
      sql`SELECT count(*)::int AS n FROM ${moderationActions} m
          LEFT JOIN articles a ON m.target_type = 'article' AND a.id = m.target_id
          LEFT JOIN article_comments c ON m.target_type = 'article_comment' AND c.id = m.target_id
          WHERE m.action IN ('reject', 'hide') AND m.moderator_user_id IS NOT NULL
            AND m.created_at >= ${since}
            AND (a.author_user_id = ${user.id} OR c.author_user_id = ${user.id})`,
    );
    return (rows[0]?.n ?? 0) > 0;
  }

  /** Refuses rating-like text (AB-13). */
  assertNoRating(...texts: (string | null | undefined)[]): void {
    for (const text of texts) {
      if (text === null || text === undefined) continue;
      const match = findRatingContent(text);
      if (match !== null) throw articleError(400, "rating_content", { match });
    }
  }

  linkLimit(user: User, kind: "article" | "comment"): number {
    return this.isNewAccount(user) ? LINK_LIMITS[kind].newAccount : LINK_LIMITS[kind].established;
  }

  private checkContent(
    user: User,
    content: { title: string; summary: string | null; body: ArticleDocument },
  ) {
    const analysis = analyzeArticle(content.body);
    if (analysis.nodes > MAX_ARTICLE_NODES || analysis.text.length > MAX_ARTICLE_TEXT) {
      throw articleError(400, "document_too_large");
    }
    if (analysis.depth > MAX_ARTICLE_DEPTH) throw articleError(400, "document_too_deep");
    this.assertNoRating(content.title, content.summary, analysis.text);
    const links = analysis.links.length + plainTextLinks(content.summary ?? "").length;
    const limit = this.linkLimit(user, "article");
    if (links > limit) throw articleError(400, "too_many_links", { limit });
    return analysis;
  }

  /** Images must be the author's processed uploads, unused or already in this article. */
  private async claimImages(
    executor: Executor,
    user: User,
    articleId: string,
    ids: readonly string[],
  ): Promise<void> {
    const unique = [...new Set(ids)];
    if (unique.length > MAX_ARTICLE_IMAGES + 1) throw articleError(400, "too_many_images");
    if (unique.length === 0) return;
    const rows = await executor
      .select()
      .from(articleImages)
      .where(and(inArray(articleImages.id, unique), eq(articleImages.uploadedBy, user.id)))
      .for("update");
    const usable = rows.filter(
      (r) => r.status === "available" && (r.articleId === null || r.articleId === articleId),
    );
    if (usable.length !== unique.length) throw articleError(400, "image_not_ready");
    await executor
      .update(articleImages)
      .set({ articleId })
      .where(and(inArray(articleImages.id, unique), isNull(articleImages.articleId)));
  }

  /** The caller may publish for this organization (`articles.publish`, active organization). */
  private async organizationFor(executor: Executor, user: User, organizationId: string) {
    const [row] = await executor
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, user.id)));
    if (row?.organization.status !== "active") throw notFound();
    if (!hasPermission(row.role as Role, "articles.publish")) throw notFound();
    return row.organization;
  }

  private async event(
    executor: Executor,
    actor: User,
    row: Article,
    action: string,
    outbox: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: row.organizationId,
      action: `article.${action}`,
      targetType: "article",
      targetId: row.id,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
    if (outbox !== null) {
      await enqueueOutboxEvent(executor, {
        aggregateType: "article",
        aggregateId: row.id,
        eventType: outbox,
        payload: { articleId: row.id, authorUserId: row.authorUserId, ...metadata },
      });
    }
  }

  // -------------------------------------------------------------------------------------------
  // Author
  // -------------------------------------------------------------------------------------------

  async create(user: User, input: CreateInput): Promise<MyArticle> {
    const analysis = this.checkContent(user, input);
    const row = await this.db.transaction(async (tx) => {
      if (input.organizationId !== null) await this.organizationFor(tx, user, input.organizationId);
      const [inserted] = await tx
        .insert(articles)
        .values({
          authorUserId: user.id,
          organizationId: input.organizationId,
          slug: slugify(input.title),
          title: input.title,
          summary: input.summary,
          body: input.body as unknown as Record<string, unknown>,
          bodyText: analysis.text,
          category: input.category,
          tags: input.tags,
          coverImageId: input.coverImageId,
          commentsEnabled: input.commentsEnabled,
        })
        .returning();
      if (!inserted) throw new Error("article insert returned no row");
      await this.claimImages(
        tx,
        user,
        inserted.id,
        [...analysis.imageIds, input.coverImageId].filter((v): v is string => v !== null),
      );
      await this.event(tx, user, inserted, "draft_created", null);
      return inserted;
    });
    return this.mine(row);
  }

  async listMine(user: User): Promise<MyArticle[]> {
    const rows = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.authorUserId, user.id), isNull(articles.deletedAt)))
      .orderBy(desc(articles.createdAt))
      .limit(100);
    return Promise.all(rows.map((row) => this.mine(row)));
  }

  private async own(executor: Executor, user: User, id: string, lock = false): Promise<Article> {
    const query = executor
      .select()
      .from(articles)
      .where(
        and(eq(articles.id, id), eq(articles.authorUserId, user.id), isNull(articles.deletedAt)),
      );
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  async getMine(user: User, id: string): Promise<MyArticle> {
    return this.mine(await this.own(this.db, user, id));
  }

  async update(user: User, id: string, change: UpdateInput): Promise<MyArticle> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.own(tx, user, id, true);
      if (current.status === "hidden") throw articleError(409, "article_hidden");
      const next = {
        title: change.title ?? current.title,
        summary: change.summary === undefined ? current.summary : change.summary,
        body: change.body ?? (current.body as unknown as ArticleDocument),
        coverImageId:
          change.coverImageId === undefined ? current.coverImageId : change.coverImageId,
      };
      const analysis = this.checkContent(user, next);
      await this.claimImages(
        tx,
        user,
        current.id,
        [...analysis.imageIds, next.coverImageId].filter((v): v is string => v !== null),
      );
      // Rejected articles go back to draft; published articles by pre-moderated authors go
      // back to moderation, so approved content can't be swapped for spam afterwards.
      let status = current.status;
      if (status === "rejected") status = "draft";
      if (status === "published" && (await this.needsPreModeration(tx, user))) {
        status = "pending_moderation";
      }
      const [updated] = await tx
        .update(articles)
        .set({
          title: next.title,
          summary: next.summary,
          body: next.body as unknown as Record<string, unknown>,
          bodyText: analysis.text,
          coverImageId: next.coverImageId,
          ...(change.category === undefined ? {} : { category: change.category }),
          ...(change.tags === undefined ? {} : { tags: change.tags }),
          ...(change.commentsEnabled === undefined
            ? {}
            : { commentsEnabled: change.commentsEnabled }),
          status,
          ...(current.status === "rejected" ? { moderationNote: null } : {}),
          ...(current.publishedAt !== null && current.status === "published"
            ? { editedAt: this.clock.now() }
            : {}),
        })
        .where(eq(articles.id, current.id))
        .returning();
      if (!updated) throw notFound();
      await this.event(tx, user, updated, "edited", null, {
        status,
        resubmitted: status !== current.status,
      });
      return updated;
    });
    return this.mine(row);
  }

  /**
   * Publishes a draft. The first publication of an article uses one `articles.daily` unit (the
   * organization's for organization articles); unpublishing and publishing again doesn't.
   */
  async publish(user: User, id: string): Promise<MyArticle> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.own(tx, user, id, true);
      if (current.status !== "draft") throw articleError(409, "invalid_transition");
      if (current.bodyText.length < MIN_PUBLISH_TEXT) throw articleError(400, "article_incomplete");
      // Content rules may have tightened since the draft was saved (e.g. link limits).
      this.checkContent(user, {
        title: current.title,
        summary: current.summary,
        body: current.body as unknown as ArticleDocument,
      });
      if (current.quotaConsumedAt === null) {
        const subject =
          current.organizationId === null
            ? subjectOfUser(user)
            : subjectOfOrganization(await this.organizationFor(tx, user, current.organizationId));
        await this.entitlements.consume(tx, subject, "articles.daily", {
          idempotencyKey: `article:${current.id}`,
        });
      } else if (current.organizationId !== null) {
        await this.organizationFor(tx, user, current.organizationId);
      }
      const moderated = await this.needsPreModeration(tx, user);
      const now = this.clock.now();
      const [updated] = await tx
        .update(articles)
        .set({
          status: moderated ? "pending_moderation" : "published",
          quotaConsumedAt: current.quotaConsumedAt ?? now,
          ...(moderated ? {} : { publishedAt: current.publishedAt ?? now }),
        })
        .where(eq(articles.id, current.id))
        .returning();
      if (!updated) throw notFound();
      await this.event(
        tx,
        user,
        updated,
        moderated ? "submitted" : "published",
        moderated ? "ArticleSubmitted" : "ArticlePublished",
      );
      return updated;
    });
    return this.mine(row);
  }

  async unpublish(user: User, id: string): Promise<MyArticle> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.own(tx, user, id, true);
      if (current.status !== "published" && current.status !== "pending_moderation") {
        throw articleError(409, "invalid_transition");
      }
      const [updated] = await tx
        .update(articles)
        .set({ status: "draft" })
        .where(eq(articles.id, current.id))
        .returning();
      if (!updated) throw notFound();
      await this.event(tx, user, updated, "unpublished", null);
      return updated;
    });
    return this.mine(row);
  }

  /** Soft delete: kept as moderation evidence until the retention job (Prompt 27). */
  async remove(user: User, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, user, id, true);
      const [updated] = await tx
        .update(articles)
        .set({ deletedAt: this.clock.now() })
        .where(eq(articles.id, current.id))
        .returning();
      if (updated) await this.event(tx, user, updated, "deleted", null);
    });
  }

  // -------------------------------------------------------------------------------------------
  // Public
  // -------------------------------------------------------------------------------------------

  async search(query: SearchInput): Promise<ArticlePage> {
    const fingerprint = createHash("sha256")
      .update(JSON.stringify([query.q, query.category, query.tag, query.organizationId]))
      .digest("hex")
      .slice(0, 12);
    let offset = 0;
    if (query.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as {
          o?: unknown;
          f?: unknown;
        };
        if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.f !== fingerprint)
          throw new Error("mismatch");
        offset = parsed.o;
      } catch {
        throw articleError(400, "invalid_cursor");
      }
      if (offset < 0 || offset > MAX_SEARCH_OFFSET) throw articleError(400, "invalid_cursor");
    }
    const tsQuery = query.q === undefined ? null : sql`websearch_to_tsquery('simple', ${query.q})`;
    const filters = [
      isPublic,
      tsQuery === null ? undefined : sql`${articles.searchVector} @@ ${tsQuery}`,
      query.category === undefined ? undefined : eq(articles.category, query.category),
      query.tag === undefined ? undefined : sql`${articles.tags} @> ARRAY[${query.tag}]::text[]`,
      query.organizationId === undefined
        ? undefined
        : eq(articles.organizationId, query.organizationId),
    ];
    const order =
      tsQuery === null
        ? [desc(articles.publishedAt), desc(articles.id)]
        : [
            sql`ts_rank_cd(${articles.searchVector}, ${tsQuery}) DESC`,
            desc(articles.publishedAt),
            desc(articles.id),
          ];
    const rows = await this.db
      .select()
      .from(articles)
      .where(and(...filters))
      .orderBy(...order)
      .limit(query.limit + 1)
      .offset(offset);
    const page = rows.slice(0, query.limit);
    const next = offset + query.limit;
    return {
      items: await this.summaries(page),
      nextCursor:
        rows.length > query.limit && next <= MAX_SEARCH_OFFSET
          ? Buffer.from(JSON.stringify({ o: next, f: fingerprint })).toString("base64url")
          : null,
      label: COMMUNITY_CONTENT_LABEL,
    };
  }

  async getPublic(slug: string): Promise<PublicArticle> {
    const [row] = await this.db
      .select()
      .from(articles)
      .where(and(eq(articles.slug, slug), isPublic));
    if (!row) throw notFound();
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound();
    const body = row.body as unknown as ArticleDocument;
    return {
      ...summary,
      body,
      html: renderArticleHtml(body, await this.imageUrls([row])),
      commentsEnabled: row.commentsEnabled,
    };
  }

  /** A published, not deleted article (comments, bookmarks, reports). */
  async publicArticle(executor: Executor, where: { id?: string; slug?: string }): Promise<Article> {
    const [row] = await executor
      .select()
      .from(articles)
      .where(
        and(
          where.id === undefined ? undefined : eq(articles.id, where.id),
          where.slug === undefined ? undefined : eq(articles.slug, where.slug),
          isPublic,
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  // -------------------------------------------------------------------------------------------
  // Bookmarks (private; never counted publicly)
  // -------------------------------------------------------------------------------------------

  async bookmark(user: User, articleId: string): Promise<void> {
    await this.publicArticle(this.db, { id: articleId });
    await this.db
      .insert(articleBookmarks)
      .values({ userId: user.id, articleId })
      .onConflictDoNothing();
  }

  async unbookmark(user: User, articleId: string): Promise<void> {
    await this.db
      .delete(articleBookmarks)
      .where(and(eq(articleBookmarks.userId, user.id), eq(articleBookmarks.articleId, articleId)));
  }

  async bookmarks(user: User): Promise<ArticleSummary[]> {
    const rows = await this.db
      .select({ article: articles })
      .from(articleBookmarks)
      .innerJoin(articles, eq(articles.id, articleBookmarks.articleId))
      .where(and(eq(articleBookmarks.userId, user.id), isPublic))
      .orderBy(desc(articleBookmarks.createdAt))
      .limit(100);
    return this.summaries(rows.map((r) => r.article));
  }

  // -------------------------------------------------------------------------------------------
  // DTOs
  // -------------------------------------------------------------------------------------------

  private async imageUrls(rows: readonly Article[]): Promise<Map<string, string>> {
    const ids = rows.map((r) => r.id);
    if (ids.length === 0) return new Map();
    const images = await this.db
      .select({ id: articleImages.id, key: articleImages.storageKey })
      .from(articleImages)
      .where(and(inArray(articleImages.articleId, ids), eq(articleImages.status, "available")));
    return new Map(
      images.flatMap((i) => (i.key === null ? [] : [[i.id, this.storage.publicUrl(i.key)]])),
    );
  }

  private async summaries(rows: readonly Article[]): Promise<ArticleSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const authorIds = [...new Set(rows.map((r) => r.authorUserId))];
    const orgIds = [
      ...new Set(rows.map((r) => r.organizationId).filter((v): v is string => v !== null)),
    ];
    const [authors, orgs, counts, urls] = await Promise.all([
      this.db
        .select({ id: users.id, displayName: users.displayName })
        .from(users)
        .where(inArray(users.id, authorIds)),
      orgIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, orgIds)),
      queryRows<{ article_id: string; n: number }>(
        this.db,
        sql`SELECT article_id, count(*)::int AS n FROM article_comments
            WHERE status = 'visible' AND article_id IN (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}) GROUP BY article_id`,
      ),
      this.imageUrls(rows),
    ]);
    const authorName = new Map(authors.map((a) => [a.id, a.displayName]));
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    const commentCount = new Map(counts.map((c) => [c.article_id, c.n]));
    return rows.map((row) => {
      const cover = row.coverImageId === null ? undefined : urls.get(row.coverImageId);
      return {
        id: row.id,
        slug: row.slug,
        title: row.title,
        summary: row.summary,
        excerpt: excerptOf(row),
        category: row.category,
        tags: row.tags,
        coverImage:
          row.coverImageId === null || cover === undefined
            ? null
            : { id: row.coverImageId, url: cover },
        author: {
          displayName: authorName.get(row.authorUserId) ?? "FleetTrust member",
          organization:
            row.organizationId === null
              ? null
              : { id: row.organizationId, name: orgName.get(row.organizationId) ?? "" },
        },
        publishedAt: (row.publishedAt ?? row.createdAt).toISOString(),
        editedAt: iso(row.editedAt),
        commentCount: commentCount.get(row.id) ?? 0,
        label: COMMUNITY_CONTENT_LABEL,
      };
    });
  }

  private async mine(row: Article): Promise<MyArticle> {
    const urls = await this.imageUrls([row]);
    const body = row.body as unknown as ArticleDocument;
    const cover = row.coverImageId === null ? undefined : urls.get(row.coverImageId);
    return {
      id: row.id,
      slug: row.slug,
      status: row.status,
      title: row.title,
      summary: row.summary,
      body,
      html: renderArticleHtml(body, urls),
      category: row.category,
      tags: row.tags,
      coverImage:
        row.coverImageId === null || cover === undefined
          ? null
          : { id: row.coverImageId, url: cover },
      commentsEnabled: row.commentsEnabled,
      organizationId: row.organizationId,
      moderationNote: row.moderationNote,
      publishedAt: iso(row.publishedAt),
      editedAt: iso(row.editedAt),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
      label: COMMUNITY_CONTENT_LABEL,
    };
  }
}

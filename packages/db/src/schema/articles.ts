import { sql } from "drizzle-orm";
import {
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  boolean,
} from "drizzle-orm/pg-core";

import { deletedAt, id, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

/** Full-text search vector, maintained by the `articles_search_vector` trigger (migration 0022). */
const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const ARTICLE_CATEGORY_VALUES = [
  "maintenance",
  "safety",
  "regulations",
  "routes",
  "fuel_efficiency",
  "business",
  "technology",
  "driver_wellbeing",
  "other",
] as const;
export const ARTICLE_STATUS_VALUES = [
  "draft",
  "pending_moderation",
  "published",
  "rejected",
  "hidden",
] as const;
export const COMMENT_STATUS_VALUES = ["visible", "hidden", "deleted"] as const;
export const REPORT_TARGET_VALUES = [
  "article",
  "article_comment",
  "group",
  "user",
  "message",
  "job",
] as const;
export const REPORT_REASON_VALUES = [
  "spam",
  "scam",
  "harassment",
  "hate",
  "defamation",
  "misinformation",
  "sexual_content",
  "violence",
  "impersonation",
  "other",
] as const;
export const MODERATION_ACTION_VALUES = [
  "approve",
  "reject",
  "hide",
  "restore",
  "dismiss_reports",
  "auto_flag",
] as const;

/**
 * Community articles (SRS J7, F-110..F-112, ADR-0022). The body is a validated rich-text
 * document (JSON), never HTML. There are deliberately no score, star or vote columns: articles
 * are opinion, not verified reviews (AB-13). Soft-deleted so reported content stays available
 * as moderation evidence until the retention job (Prompt 27).
 */
export const articles = pgTable(
  "articles",
  {
    id: id(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when published on behalf of an organization (its article quota is used). */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    slug: text("slug").notNull(),
    status: text("status", { enum: ARTICLE_STATUS_VALUES }).notNull().default("draft"),
    title: text("title").notNull(),
    summary: text("summary"),
    body: jsonb("body").$type<Record<string, unknown>>().notNull(),
    /** Plain text derived from `body` (search, excerpts). */
    bodyText: text("body_text").notNull().default(""),
    category: text("category", { enum: ARTICLE_CATEGORY_VALUES }).notNull(),
    tags: text("tags")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    coverImageId: uuid("cover_image_id"),
    commentsEnabled: boolean("comments_enabled").notNull().default(true),
    searchVector: tsvector("search_vector"),
    /** The moderator's reason, shown to the author when rejected or hidden. */
    moderationNote: text("moderation_note"),
    /** First publication or submission: the article quota is consumed once per article. */
    quotaConsumedAt: timestamp("quota_consumed_at", { withTimezone: true, mode: "date" }),
    publishedAt: timestamp("published_at", { withTimezone: true, mode: "date" }),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    deletedAt: deletedAt(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("articles_slug_key").on(t.slug),
    index("articles_org_idx").on(t.organizationId, t.publishedAt.desc()),
    index("articles_author_idx").on(t.authorUserId, t.createdAt.desc()),
    index("articles_published_idx")
      .on(t.publishedAt.desc(), t.id.desc())
      .where(sql`${t.status} = 'published' AND ${t.deletedAt} IS NULL`),
    index("articles_tags_idx").using("gin", t.tags),
    index("articles_search_idx").using("gin", t.searchVector),
    check("articles_status_valid", sql`${t.status} IN (${list(ARTICLE_STATUS_VALUES)})`),
    check("articles_category_valid", sql`${t.category} IN (${list(ARTICLE_CATEGORY_VALUES)})`),
    check("articles_title_length", sql`char_length(${t.title}) BETWEEN 1 AND 150`),
    check("articles_summary_length", sql`${t.summary} IS NULL OR char_length(${t.summary}) <= 300`),
    check("articles_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check("articles_tags_count", sql`coalesce(array_length(${t.tags}, 1), 0) <= 5`),
    check(
      "articles_published_has_date",
      sql`${t.status} <> 'published' OR ${t.publishedAt} IS NOT NULL`,
    ),
  ],
);

/** Article images: processed like profile images, then public (unguessable keys). */
export const articleImages = pgTable(
  "article_images",
  {
    id: id(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when the image is first used in an article; it can't move to another article. */
    articleId: uuid("article_id").references(() => articles.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending_upload", "available", "rejected"] })
      .notNull()
      .default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    index("article_images_uploader_idx").on(t.uploadedBy, t.createdAt),
    index("article_images_article_idx").on(t.articleId),
    check(
      "article_images_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected')`,
    ),
    check("article_images_size_valid", sql`${t.declaredSize} BETWEEN 1 AND 5242880`),
  ],
);

/** Private bookmarks. Never counted publicly, so they can't act as a popularity score. */
export const articleBookmarks = pgTable(
  "article_bookmarks",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userId, t.articleId], name: "article_bookmarks_pkey" }),
    index("article_bookmarks_user_idx").on(t.userId, t.createdAt.desc()),
    index("article_bookmarks_article_idx").on(t.articleId),
  ],
);

/** Plain-text comments, one level of replies. No votes. */
export const articleComments = pgTable(
  "article_comments",
  {
    id: id(),
    articleId: uuid("article_id")
      .notNull()
      .references(() => articles.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id"),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    status: text("status", { enum: COMMENT_STATUS_VALUES }).notNull().default("visible"),
    editedAt: timestamp("edited_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("article_comments_article_idx").on(t.articleId, t.createdAt),
    index("article_comments_author_idx").on(t.authorUserId, t.createdAt),
    index("article_comments_parent_idx").on(t.parentId),
    check("article_comments_status_valid", sql`${t.status} IN (${list(COMMENT_STATUS_VALUES)})`),
    check("article_comments_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
  ],
);

/**
 * Reports from users (SRS J9). Generic target so later surfaces (groups, messages, jobs) can
 * join the same trust and safety queue. One open report per reporter and target.
 */
export const contentReports = pgTable(
  "content_reports",
  {
    id: id(),
    reporterUserId: uuid("reporter_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    targetType: text("target_type", { enum: REPORT_TARGET_VALUES }).notNull(),
    targetId: uuid("target_id").notNull(),
    reason: text("reason", { enum: REPORT_REASON_VALUES }).notNull(),
    details: text("details"),
    status: text("status", { enum: ["open", "actioned", "dismissed"] })
      .notNull()
      .default("open"),
    resolvedBy: uuid("resolved_by").references(() => users.id, { onDelete: "restrict" }),
    resolvedAt: timestamp("resolved_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("content_reports_open_key")
      .on(t.reporterUserId, t.targetType, t.targetId)
      .where(sql`${t.status} = 'open'`),
    index("content_reports_target_idx").on(t.targetType, t.targetId, t.status),
    index("content_reports_open_idx")
      .on(t.createdAt)
      .where(sql`${t.status} = 'open'`),
    index("content_reports_reporter_idx").on(t.reporterUserId, t.createdAt),
    check("content_reports_target_valid", sql`${t.targetType} IN (${list(REPORT_TARGET_VALUES)})`),
    check("content_reports_reason_valid", sql`${t.reason} IN (${list(REPORT_REASON_VALUES)})`),
    check("content_reports_status_valid", sql`${t.status} IN ('open', 'actioned', 'dismissed')`),
    check(
      "content_reports_details_length",
      sql`${t.details} IS NULL OR char_length(${t.details}) <= 1000`,
    ),
  ],
);

/**
 * Every moderation decision, append-only (trigger in migration 0022). `moderator_user_id` is
 * null for automatic flags. Also mirrored to `audit_events`.
 */
export const moderationActions = pgTable(
  "moderation_actions",
  {
    id: id(),
    moderatorUserId: uuid("moderator_user_id").references(() => users.id, {
      onDelete: "restrict",
    }),
    targetType: text("target_type", { enum: REPORT_TARGET_VALUES }).notNull(),
    targetId: uuid("target_id").notNull(),
    action: text("action", { enum: MODERATION_ACTION_VALUES }).notNull(),
    reason: text("reason"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("moderation_actions_target_idx").on(t.targetType, t.targetId, t.createdAt),
    index("moderation_actions_moderator_idx").on(t.moderatorUserId, t.createdAt),
    check(
      "moderation_actions_target_valid",
      sql`${t.targetType} IN (${list(REPORT_TARGET_VALUES)})`,
    ),
    check(
      "moderation_actions_action_valid",
      sql`${t.action} IN (${list(MODERATION_ACTION_VALUES)})`,
    ),
  ],
);

export type Article = typeof articles.$inferSelect;
export type ArticleImage = typeof articleImages.$inferSelect;
export type ArticleComment = typeof articleComments.$inferSelect;
export type ContentReport = typeof contentReports.$inferSelect;
export type ModerationAction = typeof moderationActions.$inferSelect;

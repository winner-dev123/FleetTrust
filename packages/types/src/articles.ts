import { z } from "zod";

import { PROFILE_IMAGE_TYPES } from "./providers.js";

/**
 * Community articles (SRS J7, F-110..F-112, ADR-0022). Articles and comments are one member's
 * opinion or knowledge, never verified service reviews (SRS §8, AB-13): no star or score fields
 * exist, rating-like text is refused, and nothing here feeds provider search or ranking.
 */
export const COMMUNITY_CONTENT_LABEL = "Community content — not a verified review";

export const ARTICLE_CATEGORIES = [
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
export const articleCategorySchema = z.enum(ARTICLE_CATEGORIES);
export type ArticleCategory = z.infer<typeof articleCategorySchema>;

export const ARTICLE_STATUSES = [
  "draft",
  "pending_moderation",
  "published",
  "rejected",
  "hidden",
] as const;
export type ArticleStatus = (typeof ARTICLE_STATUSES)[number];

export const MAX_ARTICLE_TAGS = 5;
export const MAX_ARTICLE_IMAGES = 10;
export const MAX_ARTICLE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_ARTICLE_TEXT = 40_000;
export const MAX_ARTICLE_NODES = 3_000;
export const MAX_ARTICLE_DEPTH = 6;
export const MAX_COMMENT_LENGTH = 2_000;
/** Accounts younger than this are "new" (AB-06): fewer links, articles go to moderation first. */
export const NEW_ACCOUNT_DAYS = 7;
export const LINK_LIMITS = {
  article: { newAccount: 2, established: 20 },
  comment: { newAccount: 0, established: 3 },
} as const;
/** Distinct open reports that take content out of public view until a moderator decides. */
export const AUTO_FLAG_REPORTS = 3;

// ---------------------------------------------------------------------------------------------
// Text safety
// ---------------------------------------------------------------------------------------------

/** Bidirectional overrides and isolates: used to disguise links and text (Trojan Source). */
const BIDI_CONTROLS = /[‪-‮⁦-⁩]/u;

/** True when `value` contains control characters (other than the allowed ones) or bidi controls. */
export function hasUnsafeCharacters(value: string, allow = /[\n\t]/g): boolean {
  return /\p{Cc}/u.test(value.replace(allow, "")) || BIDI_CONTROLS.test(value);
}

const safeText = (max: number, options: { min?: number; multiline?: boolean } = {}) =>
  z
    .string()
    .min(options.min ?? 0)
    .max(max)
    .transform((value) => value.normalize("NFC"))
    .refine(
      (value) => !hasUnsafeCharacters(value, options.multiline === true ? /[\n\t]/g : /\t/g),
      "Contains invalid characters",
    );

const RATING_PATTERNS: readonly RegExp[] = [
  // Star glyphs used as a score: ★★★★☆, ⭐⭐⭐
  /[★☆✩-✰⭐](?:️)?(?:\s*[★☆✩-✰⭐](?:️)?)+/u,
  // "4 stars", "5-star", "4.5 star"
  /\b(?:[0-5]|10)(?:[.,]\d)?[\s-]*stars?\b/iu,
  // "4/5 stars", "8 out of 10 stars"
  /\b\d+(?:[.,]\d+)?\s*(?:\/|out\s+of)\s*(?:5|10|100)\s*stars?\b/iu,
  // "rated 2/10", "score: 3 out of 5", "my rating 4/5"
  /\b(?:rated|rating|score|scored|grade|graded)\s*[:=-]?\s*\d+(?:[.,]\d+)?\s*(?:\/|out\s+of)\s*\d+/iu,
];

/**
 * Detects text that scores a business or person (AB-13). Articles and comments are refused with
 * `rating_content` so community content can't become rating data. A heuristic: it can't catch
 * everything, which is why reports and moderation exist.
 */
export function findRatingContent(text: string): string | null {
  for (const pattern of RATING_PATTERNS) {
    const match = pattern.exec(text);
    if (match) return match[0];
  }
  return null;
}

const URL_IN_TEXT = /\b(?:https?:\/\/|www\.)[^\s<>"]+/giu;

/** URLs written as plain text (they count towards the link limits). */
export function plainTextLinks(text: string): string[] {
  return text.match(URL_IN_TEXT) ?? [];
}

/**
 * Normalises a link target. Only absolute http(s) and mailto URLs are allowed, so
 * `javascript:`, `data:`, `vbscript:`, protocol-relative and obfuscated variants are refused.
 */
export function safeHref(raw: string): string | null {
  if (raw.length > 2_000 || hasUnsafeCharacters(raw, /$^/g) || /\s/u.test(raw)) return null;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol === "mailto:")
    return /^mailto:[^@\s]+@[^@\s]+$/u.test(url.href) ? url.href : null;
  if (url.protocol !== "https:" && url.protocol !== "http:") return null;
  if (url.username !== "" || url.password !== "") return null;
  return url.href;
}

// ---------------------------------------------------------------------------------------------
// Rich-text document (a strict subset of the ProseMirror / TipTap JSON format)
// ---------------------------------------------------------------------------------------------

export type ArticleMark =
  | { type: "bold" }
  | { type: "italic" }
  | { type: "code" }
  | { type: "link"; attrs: { href: string } };
export interface ArticleText {
  type: "text";
  text: string;
  marks?: ArticleMark[] | undefined;
}
export type ArticleInline = ArticleText | { type: "hardBreak" };
export interface ArticleListItem {
  type: "listItem";
  content: ArticleBlock[];
}
export type ArticleBlock =
  | { type: "paragraph"; content?: ArticleInline[] | undefined }
  | { type: "heading"; attrs: { level: 2 | 3 }; content?: ArticleInline[] | undefined }
  | { type: "bulletList"; content: ArticleListItem[] }
  | { type: "orderedList"; content: ArticleListItem[] }
  | { type: "blockquote"; content: ArticleBlock[] }
  | { type: "codeBlock"; content?: { type: "text"; text: string }[] | undefined }
  | { type: "horizontalRule" }
  | { type: "image"; attrs: { imageId: string; alt: string | null } };
export interface ArticleDocument {
  type: "doc";
  content: ArticleBlock[];
}

const markSchema: z.ZodType<ArticleMark> = z.union([
  z.object({ type: z.literal("bold") }).strict(),
  z.object({ type: z.literal("italic") }).strict(),
  z.object({ type: z.literal("code") }).strict(),
  z
    .object({
      type: z.literal("link"),
      attrs: z
        .object({
          href: z
            .string()
            .max(2_000)
            .transform((href, ctx) => {
              const safe = safeHref(href);
              if (safe === null) {
                ctx.addIssue({ code: "custom", message: "Only http, https and mailto links" });
                return z.NEVER;
              }
              return safe;
            }),
        })
        .strict(),
    })
    .strict(),
]);

const textSchema: z.ZodType<ArticleText> = z
  .object({
    type: z.literal("text"),
    text: safeText(MAX_ARTICLE_TEXT, { min: 1 }),
    marks: z
      .array(markSchema)
      .max(4)
      .refine((marks) => new Set(marks.map((m) => m.type)).size === marks.length, "Duplicate mark")
      .optional(),
  })
  .strict();

const inlineSchema: z.ZodType<ArticleInline> = z.union([
  textSchema,
  z.object({ type: z.literal("hardBreak") }).strict(),
]);
const inlineContent = z.array(inlineSchema).max(500).optional();

const listItemSchema: z.ZodType<ArticleListItem> = z.lazy(() =>
  z.object({ type: z.literal("listItem"), content: z.array(blockSchema).min(1).max(50) }).strict(),
);
const listSchema = (type: "bulletList" | "orderedList") =>
  z.object({ type: z.literal(type), content: z.array(listItemSchema).min(1).max(100) }).strict();

const blockSchema: z.ZodType<ArticleBlock> = z.lazy(() =>
  z.union([
    z.object({ type: z.literal("paragraph"), content: inlineContent }).strict(),
    z
      .object({
        type: z.literal("heading"),
        attrs: z.object({ level: z.union([z.literal(2), z.literal(3)]) }).strict(),
        content: inlineContent,
      })
      .strict(),
    listSchema("bulletList"),
    listSchema("orderedList"),
    z
      .object({ type: z.literal("blockquote"), content: z.array(blockSchema).min(1).max(50) })
      .strict(),
    z
      .object({
        type: z.literal("codeBlock"),
        content: z
          .array(
            z
              .object({
                type: z.literal("text"),
                text: safeText(MAX_ARTICLE_TEXT, { min: 1, multiline: true }),
              })
              .strict(),
          )
          .max(1)
          .optional(),
      })
      .strict(),
    z.object({ type: z.literal("horizontalRule") }).strict(),
    z
      .object({
        type: z.literal("image"),
        attrs: z
          .object({ imageId: z.uuid(), alt: safeText(300).nullable().default(null) })
          .strict(),
      })
      .strict(),
  ]),
);

/**
 * The article body. Anything outside this allowlist (HTML strings, `style`, event handlers,
 * iframes, unknown node types or attributes) is refused, and `renderArticleHtml` escapes every
 * piece of text, so the stored document can't carry script.
 */
export const articleDocumentSchema: z.ZodType<ArticleDocument> = z
  .object({ type: z.literal("doc"), content: z.array(blockSchema).max(1_000) })
  .strict();

export const EMPTY_ARTICLE: ArticleDocument = { type: "doc", content: [] };

export interface ArticleAnalysis {
  /** Plain text for search, excerpts and the rating check. */
  text: string;
  nodes: number;
  depth: number;
  links: string[];
  imageIds: string[];
}

/** Walks a validated document: size, nesting, links (marks and plain-text URLs) and images. */
export function analyzeArticle(doc: ArticleDocument): ArticleAnalysis {
  const parts: string[] = [];
  const links: string[] = [];
  const imageIds: string[] = [];
  let nodes = 0;
  let depth = 0;
  const inline = (items: readonly ArticleInline[] | undefined) => {
    for (const item of items ?? []) {
      nodes += 1;
      if (item.type === "hardBreak") {
        parts.push("\n");
        continue;
      }
      parts.push(item.text);
      links.push(...plainTextLinks(item.text));
      for (const mark of item.marks ?? []) if (mark.type === "link") links.push(mark.attrs.href);
    }
  };
  const blocks = (items: readonly ArticleBlock[], level: number) => {
    depth = Math.max(depth, level);
    for (const block of items) {
      nodes += 1;
      switch (block.type) {
        case "paragraph":
        case "heading":
          inline(block.content);
          parts.push("\n");
          break;
        case "bulletList":
        case "orderedList":
          for (const item of block.content) {
            nodes += 1;
            blocks(item.content, level + 1);
          }
          break;
        case "blockquote":
          blocks(block.content, level + 1);
          break;
        case "codeBlock":
          for (const t of block.content ?? []) parts.push(t.text, "\n");
          break;
        case "image":
          imageIds.push(block.attrs.imageId);
          if (block.attrs.alt !== null) parts.push(block.attrs.alt, "\n");
          break;
        case "horizontalRule":
          break;
      }
    }
  };
  blocks(doc.content, 1);
  const text = parts
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { text, nodes, depth, links, imageIds };
}

const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

/** HTML-escapes text and attribute values. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => ESCAPES[c] ?? c);
}

/**
 * Renders a validated document to HTML. Every text and attribute value is escaped, links get
 * `rel="nofollow ugc noopener noreferrer"` (no SEO value for spam, AB-06), and images render only
 * when the server resolved them to a processed upload.
 */
export function renderArticleHtml(
  doc: ArticleDocument,
  imageUrls: ReadonlyMap<string, string> = new Map(),
): string {
  const inline = (items: readonly ArticleInline[] | undefined): string =>
    (items ?? [])
      .map((item) => {
        if (item.type === "hardBreak") return "<br>";
        let html = escapeHtml(item.text);
        for (const mark of item.marks ?? []) {
          if (mark.type === "bold") html = `<strong>${html}</strong>`;
          else if (mark.type === "italic") html = `<em>${html}</em>`;
          else if (mark.type === "code") html = `<code>${html}</code>`;
        }
        const link = item.marks?.find((m) => m.type === "link");
        if (link) {
          const href = safeHref(link.attrs.href);
          if (href !== null) {
            html = `<a href="${escapeHtml(href)}" rel="nofollow ugc noopener noreferrer" target="_blank">${html}</a>`;
          }
        }
        return html;
      })
      .join("");
  const blocks = (items: readonly ArticleBlock[]): string =>
    items
      .map((block) => {
        switch (block.type) {
          case "paragraph":
            return `<p>${inline(block.content)}</p>`;
          case "heading":
            return `<h${String(block.attrs.level)}>${inline(block.content)}</h${String(block.attrs.level)}>`;
          case "bulletList":
          case "orderedList": {
            const tag = block.type === "bulletList" ? "ul" : "ol";
            const lis = block.content.map((li) => `<li>${blocks(li.content)}</li>`).join("");
            return `<${tag}>${lis}</${tag}>`;
          }
          case "blockquote":
            return `<blockquote>${blocks(block.content)}</blockquote>`;
          case "codeBlock":
            return `<pre><code>${escapeHtml((block.content ?? []).map((t) => t.text).join(""))}</code></pre>`;
          case "horizontalRule":
            return "<hr>";
          case "image": {
            const url = imageUrls.get(block.attrs.imageId);
            if (url === undefined) return "";
            return `<figure><img src="${escapeHtml(url)}" alt="${escapeHtml(block.attrs.alt ?? "")}" loading="lazy"></figure>`;
          }
        }
      })
      .join("");
  return blocks(doc.content);
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const articleTagSchema = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9-]{0,29}$/, "Lowercase letters, digits and hyphens (max 30)");

const tagsSchema = z
  .array(articleTagSchema)
  .max(MAX_ARTICLE_TAGS)
  .transform((tags) => [...new Set(tags)]);

/** Drafts can be incomplete; publishing checks the rest. Strict: rating or score fields are refused. */
export const createArticleSchema = z
  .object({
    title: safeText(150, { min: 1 }).pipe(z.string().trim().min(1)),
    summary: safeText(300).nullable().default(null),
    body: articleDocumentSchema.default(EMPTY_ARTICLE),
    category: articleCategorySchema.default("other"),
    tags: tagsSchema.default([]),
    coverImageId: z.uuid().nullable().default(null),
    commentsEnabled: z.boolean().default(true),
    /** Publish on behalf of an organization (needs `articles.publish`; uses its article quota). */
    organizationId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateArticle = z.input<typeof createArticleSchema>;

export const updateArticleSchema = z
  .object({
    title: safeText(150, { min: 1 }).pipe(z.string().trim().min(1)).optional(),
    summary: safeText(300).nullable().optional(),
    body: articleDocumentSchema.optional(),
    category: articleCategorySchema.optional(),
    tags: tagsSchema.optional(),
    coverImageId: z.uuid().nullable().optional(),
    commentsEnabled: z.boolean().optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");
export type UpdateArticle = z.input<typeof updateArticleSchema>;

export const createArticleImageSchema = z
  .object({
    contentType: z.enum(PROFILE_IMAGE_TYPES),
    size: z.number().int().min(1).max(MAX_ARTICLE_IMAGE_BYTES),
  })
  .strict();

export const createCommentSchema = z
  .object({
    body: safeText(MAX_COMMENT_LENGTH, { min: 1, multiline: true }).pipe(z.string().trim().min(1)),
    parentId: z.uuid().nullable().default(null),
  })
  .strict();

export const updateCommentSchema = z
  .object({
    body: safeText(MAX_COMMENT_LENGTH, { min: 1, multiline: true }).pipe(z.string().trim().min(1)),
  })
  .strict();

export const REPORT_REASONS = [
  "spam",
  "scam",
  "harassment",
  "hate",
  "defamation",
  "misinformation",
  "sexual_content",
  "violence",
  "other",
] as const;
export const REPORT_TARGET_TYPES = ["article", "article_comment"] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    details: safeText(1_000, { multiline: true }).nullable().default(null),
  })
  .strict();

export const searchArticlesQuerySchema = z
  .object({
    q: safeText(200).pipe(z.string().trim().min(1)).optional(),
    category: articleCategorySchema.optional(),
    tag: articleTagSchema.optional(),
    organizationId: z.uuid().optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict();
export type SearchArticlesQuery = z.input<typeof searchArticlesQuerySchema>;

export const moderationReasonSchema = z
  .object({ reason: safeText(1_000, { min: 1, multiline: true }).pipe(z.string().trim().min(3)) })
  .strict();
export const optionalModerationReasonSchema = z
  .object({ reason: safeText(1_000, { multiline: true }).nullable().default(null) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const articleAuthorSchema = z.object({
  displayName: z.string(),
  organization: z.object({ id: z.uuid(), name: z.string() }).nullable(),
});

const articleImageRefSchema = z.object({ id: z.uuid(), url: z.string() });

export const articleSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  title: z.string(),
  summary: z.string().nullable(),
  excerpt: z.string(),
  category: articleCategorySchema,
  tags: z.array(z.string()),
  coverImage: articleImageRefSchema.nullable(),
  author: articleAuthorSchema,
  publishedAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
  commentCount: z.number().int(),
  label: z.literal(COMMUNITY_CONTENT_LABEL),
});
export type ArticleSummary = z.infer<typeof articleSummarySchema>;

export const publicArticleSchema = articleSummarySchema.extend({
  body: z.custom<ArticleDocument>(),
  html: z.string(),
  commentsEnabled: z.boolean(),
});
export type PublicArticle = z.infer<typeof publicArticleSchema>;

export const articlePageSchema = z.object({
  items: z.array(articleSummarySchema),
  nextCursor: z.string().nullable(),
  label: z.literal(COMMUNITY_CONTENT_LABEL),
});
export type ArticlePage = z.infer<typeof articlePageSchema>;

/** The author's view: every status, plus the moderator's reason when rejected or hidden. */
export const myArticleSchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  status: z.enum(ARTICLE_STATUSES),
  title: z.string(),
  summary: z.string().nullable(),
  body: z.custom<ArticleDocument>(),
  html: z.string(),
  category: articleCategorySchema,
  tags: z.array(z.string()),
  coverImage: articleImageRefSchema.nullable(),
  commentsEnabled: z.boolean(),
  organizationId: z.uuid().nullable(),
  moderationNote: z.string().nullable(),
  publishedAt: z.iso.datetime().nullable(),
  editedAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  label: z.literal(COMMUNITY_CONTENT_LABEL),
});
export type MyArticle = z.infer<typeof myArticleSchema>;

export const articleCommentSchema = z.object({
  id: z.uuid(),
  articleId: z.uuid(),
  parentId: z.uuid().nullable(),
  /** Null when the comment was removed (the thread keeps its place). */
  body: z.string().nullable(),
  status: z.enum(["visible", "hidden", "deleted"]),
  author: z.object({ displayName: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
  editedAt: z.iso.datetime().nullable(),
});
export type ArticleCommentDto = z.infer<typeof articleCommentSchema>;

export const commentListSchema = z.object({
  items: z.array(articleCommentSchema),
  label: z.literal(COMMUNITY_CONTENT_LABEL),
});
export type CommentList = z.infer<typeof commentListSchema>;

export const moderationQueueItemSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.uuid(),
  status: z.string(),
  title: z.string(),
  authorUserId: z.uuid(),
  openReports: z.number().int(),
  reasons: z.array(z.enum(REPORT_REASONS)),
  waitingSince: z.iso.datetime(),
});
export type ModerationQueueItem = z.infer<typeof moderationQueueItemSchema>;

export const moderationActionSchema = z.object({
  id: z.uuid(),
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.uuid(),
  action: z.string(),
  moderatorUserId: z.uuid().nullable(),
  reason: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ModerationActionDto = z.infer<typeof moderationActionSchema>;

export const contentReportSchema = z.object({
  id: z.uuid(),
  reason: z.enum(REPORT_REASONS),
  details: z.string().nullable(),
  status: z.enum(["open", "actioned", "dismissed"]),
  createdAt: z.iso.datetime(),
});

export const moderationCaseSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.uuid(),
  status: z.string(),
  authorUserId: z.uuid(),
  /** Article title or comment body, as submitted. */
  title: z.string(),
  text: z.string(),
  articleId: z.uuid(),
  reports: z.array(contentReportSchema),
  actions: z.array(moderationActionSchema),
});
export type ModerationCase = z.infer<typeof moderationCaseSchema>;

export const articleErrorReasonSchema = z.enum([
  "rating_content",
  "too_many_links",
  "document_too_large",
  "document_too_deep",
  "too_many_images",
  "image_not_ready",
  "article_incomplete",
  "article_hidden",
  "invalid_transition",
  "comments_disabled",
  "invalid_parent",
  "own_content",
  "already_reported",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
  "invalid_cursor",
]);
export type ArticleErrorReason = z.infer<typeof articleErrorReasonSchema>;

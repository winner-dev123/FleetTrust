import { z } from "zod";

import { safeText } from "./articles.js";

/**
 * Reports and the trust and safety queue (SRS J9, F-112). Shared by every reportable surface:
 * articles and comments (Prompt 15), groups and members (Prompt 16), later messages and jobs.
 */
export const REPORT_REASONS = [
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
export const REPORT_TARGET_TYPES = [
  "article",
  "article_comment",
  "group",
  "user",
  "message",
  /** Job listings (Prompt 22). */
  "job",
] as const;
export type ReportTargetType = (typeof REPORT_TARGET_TYPES)[number];

export const createReportSchema = z
  .object({
    targetType: z.enum(REPORT_TARGET_TYPES),
    targetId: z.uuid(),
    reason: z.enum(REPORT_REASONS),
    details: safeText(1_000, { multiline: true }).nullable().default(null),
  })
  .strict();

export const moderationReasonSchema = z
  .object({ reason: safeText(1_000, { min: 1, multiline: true }).pipe(z.string().trim().min(3)) })
  .strict();
export const optionalModerationReasonSchema = z
  .object({ reason: safeText(1_000, { multiline: true }).nullable().default(null) })
  .strict();

export const moderationQueueItemSchema = z.object({
  targetType: z.enum(REPORT_TARGET_TYPES),
  targetId: z.uuid(),
  status: z.string(),
  /** Article title, comment excerpt, group name or member display name. */
  title: z.string(),
  /** The author, group creator, or the reported member. */
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
  title: z.string(),
  /** The content as submitted (empty for members). */
  text: z.string(),
  /** The article for articles and comments, otherwise null. */
  articleId: z.uuid().nullable(),
  reports: z.array(contentReportSchema),
  actions: z.array(moderationActionSchema),
});
export type ModerationCase = z.infer<typeof moderationCaseSchema>;

export const moderationErrorReasonSchema = z.enum([
  "own_content",
  "already_reported",
  "invalid_transition",
]);
export type ModerationErrorReason = z.infer<typeof moderationErrorReasonSchema>;

import { z } from "zod";

import { plainTextLinks, safeText } from "./articles.js";
import { PROFILE_IMAGE_TYPES } from "./providers.js";

/**
 * Messaging (SRS F-053..F-055, F-123, ADR-0024): direct, request-linked and group conversations
 * with durable, ordered history; WebSocket delivery with cursor replay; read receipts; inbox
 * notifications and push; opt-outs; abuse reporting.
 */

export const MAX_MESSAGE_LENGTH = 4_000;
export const MAX_MESSAGE_ATTACHMENTS = 4;
export const MAX_MESSAGE_ATTACHMENT_BYTES = 8 * 1024 * 1024;
/** Messages replayed over the socket per subscription; older history is paged over REST. */
export const MAX_REPLAY = 500;
export const MESSAGE_PAGE = 100;

export const MESSAGE_ATTACHMENT_TYPES = [...PROFILE_IMAGE_TYPES, "application/pdf"] as const;

export const CONVERSATION_KINDS = ["direct", "request", "group", "incident"] as const;
export type ConversationKind = (typeof CONVERSATION_KINDS)[number];

/** Shown on messages that ask for money with a link or account number (AB-07). */
export const PAYMENT_SCAM_WARNING =
  "Be careful: FleetTrust doesn't process payments. Never pay a deposit to an account or link you can't verify.";

const PAYMENT_WORDS =
  /\b(?:pay(?:ment)?|deposit|transfer|eft|bank|account\s*(?:no|number)|iban|swift|wire|upfront|advance|crypto|bitcoin|usdt|western\s*union|moneygram)\b/iu;
const ACCOUNT_NUMBER = /\b\d(?:[ -]?\d){7,}\b/u;

/**
 * Flags messages that look like a payment request with a link or an account number (AB-07). The
 * message is still delivered; clients show `PAYMENT_SCAM_WARNING` next to it.
 */
export function messageWarnings(text: string): "payment_request"[] {
  if (!PAYMENT_WORDS.test(text)) return [];
  return plainTextLinks(text).length > 0 || ACCOUNT_NUMBER.test(text) ? ["payment_request"] : [];
}

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

export const sendMessageSchema = z
  .object({
    /** Client-generated; resending with the same ID returns the original message. */
    clientMessageId: z.uuid(),
    body: safeText(MAX_MESSAGE_LENGTH, { multiline: true }).pipe(z.string().trim()),
    attachmentIds: z.array(z.uuid()).max(MAX_MESSAGE_ATTACHMENTS).default([]),
  })
  .strict()
  .refine((m) => m.body.length > 0 || m.attachmentIds.length > 0, "Empty message");
export type SendMessage = z.input<typeof sendMessageSchema>;

export const openDirectConversationSchema = z.object({ userId: z.uuid() }).strict();

export const markReadSchema = z.object({ seq: z.number().int().min(0) }).strict();

export const conversationSettingsSchema = z.object({ muted: z.boolean() }).strict();

export const createMessageAttachmentSchema = z
  .object({
    contentType: z.enum(MESSAGE_ATTACHMENT_TYPES),
    size: z.number().int().min(1).max(MAX_MESSAGE_ATTACHMENT_BYTES),
  })
  .strict();

export const messagesQuerySchema = z
  .object({
    /** Messages with seq greater than this (replay forwards). */
    after: z.coerce.number().int().min(0).optional(),
    /** Messages with seq lower than this (older history). */
    before: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(MESSAGE_PAGE).default(50),
  })
  .strict()
  .refine((q) => q.after === undefined || q.before === undefined, "after or before, not both");

export const reportMessageSchema = z
  .object({
    reason: z.enum([
      "spam",
      "scam",
      "harassment",
      "hate",
      "sexual_content",
      "violence",
      "impersonation",
      "other",
    ]),
    details: safeText(1_000, { multiline: true }).nullable().default(null),
  })
  .strict();

export const DIRECT_MESSAGE_AUDIENCES = ["everyone", "friends", "nobody"] as const;

export const messagingPreferencesSchema = z.object({
  /** Who can start a direct conversation with you. Request and group chats aren't affected. */
  directMessagesFrom: z.enum(DIRECT_MESSAGE_AUDIENCES),
  /** Share when you've read direct and request messages (and see others'). */
  readReceipts: z.boolean(),
  /** Show message text in push notifications (lock screen). Off: "New message" only. */
  pushPreviews: z.boolean(),
  pushMessages: z.boolean(),
  pushRequests: z.boolean(),
  pushCommunity: z.boolean(),
});
export type MessagingPreferences = z.infer<typeof messagingPreferencesSchema>;

export const DEFAULT_MESSAGING_PREFERENCES: MessagingPreferences = {
  directMessagesFrom: "friends",
  readReceipts: true,
  pushPreviews: false,
  pushMessages: true,
  pushRequests: true,
  pushCommunity: true,
};

export const updateMessagingPreferencesSchema = messagingPreferencesSchema
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, "Nothing to change");

export const registerDeviceSchema = z
  .object({
    /** Firebase Installation ID (FID) of the app on this device; FCM delivers to it. */
    fid: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/, "Invalid installation ID"),
    platform: z.enum(["ios", "android", "web"]),
  })
  .strict();

export const unregisterDeviceSchema = z
  .object({ fid: z.string().regex(/^[A-Za-z0-9_-]{16,200}$/) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const messageSenderSchema = z.object({
  /** Null in request conversations: people there act for their side, not as individuals. */
  userId: z.uuid().nullable(),
  /** Display name, or the side's label in request conversations ("Customer", a business name). */
  name: z.string(),
  side: z.enum(["requester", "provider"]).nullable(),
  mine: z.boolean(),
});

export const messageAttachmentRefSchema = z.object({
  id: z.uuid(),
  contentType: z.string(),
  size: z.number().int(),
});

export const messageSchema = z.object({
  id: z.uuid(),
  conversationId: z.uuid(),
  seq: z.number().int(),
  clientMessageId: z.uuid().nullable(),
  sender: messageSenderSchema,
  /** Null when deleted by the sender or removed by a moderator. */
  body: z.string().nullable(),
  attachments: z.array(messageAttachmentRefSchema),
  status: z.enum(["visible", "deleted", "removed", "hidden"]),
  warnings: z.array(z.literal("payment_request")),
  createdAt: z.iso.datetime(),
});
export type MessageDto = z.infer<typeof messageSchema>;

export const conversationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(CONVERSATION_KINDS),
  title: z.string(),
  /** Direct: the other person. */
  peer: z.object({ userId: z.uuid(), displayName: z.string() }).nullable(),
  serviceRequestRecipientId: z.uuid().nullable(),
  groupId: z.uuid().nullable(),
  lastSeq: z.number().int(),
  lastMessageAt: z.iso.datetime().nullable(),
  lastReadSeq: z.number().int(),
  unread: z.number().int(),
  muted: z.boolean(),
  /** Direct and request: the other side's read position (null if receipts are off). */
  peerReadSeq: z.number().int().nullable(),
  canSend: z.boolean(),
  warning: z.string().nullable(),
});
export type ConversationDto = z.infer<typeof conversationSchema>;

export const messagePageSchema = z.object({
  items: z.array(messageSchema),
  /** True when more messages exist in the requested direction. */
  more: z.boolean(),
});
export type MessagePage = z.infer<typeof messagePageSchema>;

export const NOTIFICATION_KINDS = [
  "friend_request",
  "friend_accepted",
  "group_join_request",
  "group_approved",
  "article_comment",
  "content_moderated",
  "service_request",
  "quote_received",
  "quote_accepted",
  "provider_cancelled",
  "maintenance_due",
  "document_expiring",
  "appointment_booked",
  "appointment_changed",
  "appointment_assigned",
  "part_inquiry",
  "part_inquiry_answered",
  "referral_proposed",
  "referral_decided",
  "job_application",
  "job_application_update",
  "account_sanctioned",
  "power_user",
  "appeal_decided",
] as const;

export const notificationSchema = z.object({
  id: z.uuid(),
  kind: z.enum(NOTIFICATION_KINDS),
  title: z.string(),
  body: z.string(),
  /** IDs for deep links (e.g. requestId, groupId, articleId). */
  data: z.record(z.string(), z.string()),
  readAt: z.iso.datetime().nullable(),
  createdAt: z.iso.datetime(),
});
export type NotificationDto = z.infer<typeof notificationSchema>;

export const inboxSchema = z.object({
  notifications: z.array(notificationSchema),
  unreadNotifications: z.number().int(),
  unreadConversations: z.number().int(),
});
export type InboxDto = z.infer<typeof inboxSchema>;

// ---------------------------------------------------------------------------------------------
// WebSocket protocol (`/v1/realtime`, JSON text frames)
// ---------------------------------------------------------------------------------------------

/** Client → server. The first frame must be `auth` (tokens never go in the URL). */
export const clientFrameSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("auth"), token: z.string().min(20).max(8_192) }).strict(),
  z
    .object({
      type: z.literal("subscribe"),
      conversationId: z.uuid(),
      /** Last seq the client has; missed messages are replayed first. */
      after: z.number().int().min(0).default(0),
    })
    .strict(),
  z.object({ type: z.literal("unsubscribe"), conversationId: z.uuid() }).strict(),
  z
    .object({ type: z.literal("read"), conversationId: z.uuid(), seq: z.number().int().min(0) })
    .strict(),
  z.object({ type: z.literal("ping") }).strict(),
]);
export type ClientFrame = z.input<typeof clientFrameSchema>;

/** Server → client. */
export type ServerFrame =
  | { type: "ready"; userId: string }
  | { type: "subscribed"; conversationId: string; lastSeq: number }
  | { type: "unsubscribed"; conversationId: string; reason: "requested" | "access_revoked" }
  | { type: "message"; conversationId: string; message: MessageDto; replay: boolean }
  | { type: "message_updated"; conversationId: string; message: MessageDto }
  | { type: "replay_truncated"; conversationId: string; nextAfter: number }
  | { type: "receipt"; conversationId: string; side: "peer"; seq: number }
  | { type: "inbox"; conversationId: string | null; lastSeq: number | null }
  | { type: "notification"; notification: NotificationDto }
  | { type: "pong" }
  | { type: "error"; code: string; conversationId?: string };

/** WebSocket close codes used by the server. */
export const REALTIME_CLOSE = {
  unauthenticated: 4401,
  forbidden: 4403,
  invalidFrame: 4400,
  tooManySubscriptions: 4429,
} as const;

export const messagingErrorReasonSchema = z.enum([
  "cannot_message",
  "conversation_read_only",
  "attachment_not_ready",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
  "not_allowed",
]);
export type MessagingErrorReason = z.infer<typeof messagingErrorReasonSchema>;

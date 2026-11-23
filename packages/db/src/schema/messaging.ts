import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { communityGroups } from "./community.js";
import { id, timestamps } from "./columns.js";
import { serviceRequestRecipients } from "./requests.js";
import { users } from "./users.js";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const CONVERSATION_KIND_VALUES = ["direct", "request", "group"] as const;
export const MESSAGE_STATUS_VALUES = ["visible", "deleted", "removed", "hidden"] as const;

/**
 * Conversations (ADR-0024). Direct: two users (smaller ID first). Request: one per service
 * request recipient (the requester side and that provider). Group: one per community group.
 * `last_seq` hands out per-conversation message sequence numbers (the replay cursor).
 */
export const conversations = pgTable(
  "conversations",
  {
    id: id(),
    kind: text("kind", { enum: CONVERSATION_KIND_VALUES }).notNull(),
    directUserA: uuid("direct_user_a").references(() => users.id, { onDelete: "cascade" }),
    directUserB: uuid("direct_user_b").references(() => users.id, { onDelete: "cascade" }),
    requestRecipientId: uuid("request_recipient_id").references(() => serviceRequestRecipients.id, {
      onDelete: "cascade",
    }),
    groupId: uuid("group_id").references(() => communityGroups.id, { onDelete: "cascade" }),
    lastSeq: bigint("last_seq", { mode: "number" }).notNull().default(0),
    lastMessageAt: timestamp("last_message_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("conversations_direct_key")
      .on(t.directUserA, t.directUserB)
      .where(sql`${t.kind} = 'direct'`),
    uniqueIndex("conversations_request_key").on(t.requestRecipientId),
    uniqueIndex("conversations_group_key").on(t.groupId),
    index("conversations_direct_b_idx").on(t.directUserB),
    check("conversations_kind_valid", sql`${t.kind} IN (${list(CONVERSATION_KIND_VALUES)})`),
    check(
      "conversations_kind_fields",
      sql`(${t.kind} = 'direct' AND ${t.directUserA} IS NOT NULL AND ${t.directUserB} IS NOT NULL AND ${t.directUserA} < ${t.directUserB} AND ${t.requestRecipientId} IS NULL AND ${t.groupId} IS NULL)
       OR (${t.kind} = 'request' AND ${t.requestRecipientId} IS NOT NULL AND ${t.directUserA} IS NULL AND ${t.groupId} IS NULL)
       OR (${t.kind} = 'group' AND ${t.groupId} IS NOT NULL AND ${t.directUserA} IS NULL AND ${t.requestRecipientId} IS NULL)`,
    ),
    check("conversations_last_seq_non_negative", sql`${t.lastSeq} >= 0`),
  ],
);

/** Durable, ordered history. Text is kept when deleted or moderated (evidence) but not shown. */
export const messages = pgTable(
  "messages",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    seq: bigint("seq", { mode: "number" }).notNull(),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Request conversations: which side wrote it. */
    senderSide: text("sender_side", { enum: ["requester", "provider"] }),
    clientMessageId: uuid("client_message_id"),
    body: text("body").notNull().default(""),
    status: text("status", { enum: MESSAGE_STATUS_VALUES }).notNull().default("visible"),
    warnings: text("warnings")
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("messages_conversation_seq_key").on(t.conversationId, t.seq),
    uniqueIndex("messages_client_key").on(t.conversationId, t.senderUserId, t.clientMessageId),
    index("messages_sender_idx").on(t.senderUserId, t.createdAt),
    check("messages_status_valid", sql`${t.status} IN (${list(MESSAGE_STATUS_VALUES)})`),
    check("messages_body_length", sql`char_length(${t.body}) <= 4000`),
    check(
      "messages_sender_side_valid",
      sql`${t.senderSide} IS NULL OR ${t.senderSide} IN ('requester', 'provider')`,
    ),
  ],
);

/** Private attachments, uploaded into a conversation and attached to one message. */
export const messageAttachments = pgTable(
  "message_attachments",
  {
    id: id(),
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    messageId: uuid("message_id").references(() => messages.id, { onDelete: "cascade" }),
    status: text("status", { enum: ["pending_upload", "available", "rejected"] })
      .notNull()
      .default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    quarantineKey: text("quarantine_key").notNull(),
    storageKey: text("storage_key"),
    contentType: text("content_type"),
    size: integer("size"),
    rejectionReason: text("rejection_reason"),
    ...timestamps(),
  },
  (t) => [
    index("message_attachments_conversation_idx").on(t.conversationId),
    index("message_attachments_message_idx").on(t.messageId),
    index("message_attachments_uploader_idx").on(t.uploadedBy, t.createdAt),
    check(
      "message_attachments_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected')`,
    ),
    check("message_attachments_size_valid", sql`${t.declaredSize} BETWEEN 1 AND 8388608`),
  ],
);

/** Per user and conversation: read position (receipts, unread counts) and mute. */
export const conversationStates = pgTable(
  "conversation_states",
  {
    conversationId: uuid("conversation_id")
      .notNull()
      .references(() => conversations.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    lastReadSeq: bigint("last_read_seq", { mode: "number" }).notNull().default(0),
    muted: boolean("muted").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.conversationId, t.userId], name: "conversation_states_pkey" }),
    index("conversation_states_user_idx").on(t.userId),
  ],
);

/** Messaging privacy and notification opt-outs (F-054). No row means the defaults. */
export const messagingPreferences = pgTable(
  "messaging_preferences",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    directMessagesFrom: text("direct_messages_from", { enum: ["everyone", "friends", "nobody"] })
      .notNull()
      .default("friends"),
    readReceipts: boolean("read_receipts").notNull().default(true),
    pushPreviews: boolean("push_previews").notNull().default(false),
    pushMessages: boolean("push_messages").notNull().default(true),
    pushRequests: boolean("push_requests").notNull().default(true),
    pushCommunity: boolean("push_community").notNull().default(true),
    ...timestamps(),
  },
  (t) => [
    check(
      "messaging_preferences_dm_valid",
      sql`${t.directMessagesFrom} IN ('everyone', 'friends', 'nobody')`,
    ),
  ],
);

/**
 * In-app inbox (F-054). Written by the outbox relay; `source_event_id` makes it idempotent when
 * an event is processed twice. New messages aren't inbox rows: unread conversations are.
 */
export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: text("kind").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull(),
    data: jsonb("data").$type<Record<string, string>>().notNull().default({}),
    sourceEventId: uuid("source_event_id").notNull(),
    readAt: timestamp("read_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("notifications_source_key").on(t.userId, t.sourceEventId),
    index("notifications_user_idx").on(t.userId, t.createdAt.desc()),
    index("notifications_unread_idx")
      .on(t.userId)
      .where(sql`${t.readAt} IS NULL`),
  ],
);

/**
 * Push targets: Firebase Installation IDs (FIDs), which FCM addresses directly. An installation
 * belongs to one user; registering it again (a new sign-in on that device) moves it.
 */
export const pushDevices = pgTable(
  "push_devices",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fid: text("fid").notNull(),
    platform: text("platform", { enum: ["ios", "android", "web"] }).notNull(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("push_devices_fid_key").on(t.fid),
    index("push_devices_user_idx").on(t.userId),
    check("push_devices_platform_valid", sql`${t.platform} IN ('ios', 'android', 'web')`),
  ],
);

export type Conversation = typeof conversations.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type MessageAttachment = typeof messageAttachments.$inferSelect;
export type NotificationRow = typeof notifications.$inferSelect;

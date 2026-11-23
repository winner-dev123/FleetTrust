import {
  and,
  asc,
  communityGroupMembers,
  communityGroups,
  type Conversation,
  conversationStates,
  conversations,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  friendships,
  gt,
  inArray,
  lt,
  type Message,
  messageAttachments,
  messages,
  messagingPreferences,
  memberships,
  organizations,
  queryRows,
  recordAuditEvent,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  type User,
  users,
} from "@fleettrust/db";
import {
  type ConversationDto,
  type ConversationKind,
  DEFAULT_MESSAGING_PREFERENCES,
  hasPermission,
  MAX_REPLAY,
  type MessageDto,
  type MessagePage,
  type MessagingErrorReason,
  type MessagingPreferences,
  messageWarnings,
  PAYMENT_SCAM_WARNING,
  type Role,
  type sendMessageSchema,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { REALTIME_BUS, type RealtimeBus } from "../../platform/realtime/index.js";
import { SocialService } from "../community/index.js";

type SendInput = z.output<typeof sendMessageSchema>;
type Side = "requester" | "provider";

export function messagingError(status: 400 | 403 | 409, reason: MessagingErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** What a user may do in a conversation. */
export interface ConversationAccess {
  conversation: Conversation;
  /** Request conversations: which side the user is on. */
  side: Side | null;
  /** Null when the user may send; otherwise why not. */
  readOnly: MessagingErrorReason | null;
  /** Direct conversations: the other person. */
  peerUserId: string | null;
  /** Group conversations: the user's role (for removing messages). */
  groupRole: "owner" | "moderator" | "member" | null;
}

/** A message ready for any viewer; `toDto` adapts it per viewer. */
export interface RawMessage {
  id: string;
  conversationId: string;
  kind: ConversationKind;
  seq: number;
  clientMessageId: string | null;
  senderUserId: string;
  senderName: string;
  senderSide: Side | null;
  body: string;
  status: Message["status"];
  warnings: string[];
  attachments: { id: string; contentType: string; size: number }[];
  createdAt: string;
}

export function toMessageDto(raw: RawMessage, viewerId: string): MessageDto {
  const visible = raw.status === "visible";
  const mine = raw.senderUserId === viewerId;
  return {
    id: raw.id,
    conversationId: raw.conversationId,
    seq: raw.seq,
    clientMessageId: mine ? raw.clientMessageId : null,
    sender: {
      // People in request conversations speak for their side, not as named individuals.
      userId: raw.kind === "request" ? null : raw.senderUserId,
      name: raw.senderName,
      side: raw.senderSide,
      mine,
    },
    body: visible ? raw.body : null,
    attachments: visible ? raw.attachments : [],
    status: raw.status,
    warnings: visible
      ? raw.warnings.filter((w): w is "payment_request" => w === "payment_request")
      : [],
    createdAt: raw.createdAt,
  };
}

const FALLBACK_NAME = "FleetTrust member";

/**
 * Conversations and messages (SRS F-053, F-123, ADR-0024). Access is decided per conversation
 * from the underlying relationship, never from a stored member list:
 * - direct: the two people;
 * - request: the requester side (the individual, or fleet members allowed to see that request)
 *   and the recipient provider's members who may respond (branch scope applies);
 * - group: the group's active members.
 * Sequence numbers are handed out per conversation (the replay cursor).
 */
@Injectable()
export class MessagingService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBus,
    private readonly social: SocialService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Preferences
  // -------------------------------------------------------------------------------------------

  async preferences(executor: Executor, userId: string): Promise<MessagingPreferences> {
    const [row] = await executor
      .select()
      .from(messagingPreferences)
      .where(eq(messagingPreferences.userId, userId));
    if (!row) return DEFAULT_MESSAGING_PREFERENCES;
    return {
      directMessagesFrom: row.directMessagesFrom,
      readReceipts: row.readReceipts,
      pushPreviews: row.pushPreviews,
      pushMessages: row.pushMessages,
      pushRequests: row.pushRequests,
      pushCommunity: row.pushCommunity,
    };
  }

  async updatePreferences(
    user: User,
    change: Partial<MessagingPreferences>,
  ): Promise<MessagingPreferences> {
    await this.db
      .insert(messagingPreferences)
      .values({ userId: user.id, ...DEFAULT_MESSAGING_PREFERENCES, ...change })
      .onConflictDoUpdate({ target: messagingPreferences.userId, set: change });
    return this.preferences(this.db, user.id);
  }

  // -------------------------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------------------------

  private async areFriends(executor: Executor, a: string, b: string): Promise<boolean> {
    const [low, high] = a < b ? [a, b] : [b, a];
    const rows = await executor
      .select({ a: friendships.userAId })
      .from(friendships)
      .where(and(eq(friendships.userAId, low), eq(friendships.userBId, high)))
      .limit(1);
    return rows.length > 0;
  }

  /** Whether `sender` may message `recipient` directly (blocks and the recipient's privacy). */
  private async directAllowed(
    executor: Executor,
    sender: string,
    recipient: string,
  ): Promise<boolean> {
    if (await this.social.isBlockedEitherWay(executor, sender, recipient)) return false;
    const [other] = await executor
      .select({ status: users.status })
      .from(users)
      .where(eq(users.id, recipient));
    if (other?.status !== "active") return false;
    const prefs = await this.preferences(executor, recipient);
    if (prefs.directMessagesFrom === "nobody") return false;
    if (prefs.directMessagesFrom === "friends") return this.areFriends(executor, sender, recipient);
    return true;
  }

  private async member(executor: Executor, userId: string, organizationId: string) {
    const [row] = await executor
      .select({
        role: memberships.role,
        branchId: memberships.branchId,
        status: organizations.status,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.userId, userId), eq(memberships.organizationId, organizationId)));
    if (row?.status !== "active") return null;
    return { role: row.role as Role, branchScope: row.branchId };
  }

  /** The caller's access to a conversation, or null (treated as 404). */
  async access(
    executor: Executor,
    user: User,
    conversationId: string,
  ): Promise<ConversationAccess | null> {
    const [conversation] = await executor
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) return null;
    return this.accessTo(executor, user, conversation);
  }

  async accessTo(
    executor: Executor,
    user: User,
    conversation: Conversation,
  ): Promise<ConversationAccess | null> {
    if (user.status !== "active") return null;
    const base = { conversation, side: null, peerUserId: null, groupRole: null } as const;
    if (conversation.kind === "direct") {
      const { directUserA: a, directUserB: b } = conversation;
      if (a === null || b === null || (user.id !== a && user.id !== b)) return null;
      const peer = user.id === a ? b : a;
      const allowed = await this.directAllowed(executor, user.id, peer);
      return { ...base, peerUserId: peer, readOnly: allowed ? null : "cannot_message" };
    }
    if (conversation.kind === "group") {
      if (conversation.groupId === null) return null;
      const [row] = await executor
        .select({
          status: communityGroups.status,
          role: communityGroupMembers.role,
          memberStatus: communityGroupMembers.status,
        })
        .from(communityGroupMembers)
        .innerJoin(communityGroups, eq(communityGroups.id, communityGroupMembers.groupId))
        .where(
          and(
            eq(communityGroupMembers.groupId, conversation.groupId),
            eq(communityGroupMembers.userId, user.id),
          ),
        );
      if (row?.memberStatus !== "active" || row.status === "hidden") return null;
      return {
        ...base,
        groupRole: row.role,
        readOnly: row.status === "active" ? null : "conversation_read_only",
      };
    }
    if (conversation.requestRecipientId === null) return null;
    const side = await this.requestSide(executor, user, conversation.requestRecipientId);
    if (side === null) return null;
    return { ...base, side: side.side, readOnly: side.open ? null : "conversation_read_only" };
  }

  /** Which side of a request conversation the user is on, and whether it still accepts messages. */
  private async requestSide(
    executor: Executor,
    user: User,
    recipientId: string,
  ): Promise<{ side: Side; open: boolean } | null> {
    const [row] = await executor
      .select({ recipient: serviceRequestRecipients, request: serviceRequests })
      .from(serviceRequestRecipients)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .where(eq(serviceRequestRecipients.id, recipientId));
    if (!row) return null;
    const { recipient, request } = row;
    const now = this.clock.now();
    const requestOpen =
      (request.status === "open" && request.expiresAt > now) || request.status === "accepted";
    const open =
      requestOpen && !["declined", "not_selected", "cancelled"].includes(recipient.status);

    if (request.requesterUserId === user.id) return { side: "requester", open };
    if (request.requesterOrganizationId !== null) {
      const m = await this.member(executor, user.id, request.requesterOrganizationId);
      if (
        m &&
        hasPermission(m.role, "requests.create") &&
        (request.createdBy === user.id ||
          (hasPermission(m.role, "requests.manage") &&
            (m.branchScope === null || m.branchScope === request.fleetBranchId)))
      ) {
        return { side: "requester", open };
      }
    }
    const p = await this.member(executor, user.id, recipient.organizationId);
    if (
      p &&
      hasPermission(p.role, "requests.respond") &&
      (p.branchScope === null || p.branchScope === recipient.branchId)
    ) {
      return { side: "provider", open };
    }
    return null;
  }

  /** Access with this service's database handle (used by the socket gateway). */
  accessFor(user: User, conversationId: string): Promise<ConversationAccess | null> {
    return this.access(this.db, user, conversationId);
  }

  preferencesFor(userId: string): Promise<MessagingPreferences> {
    return this.preferences(this.db, userId);
  }

  /** People the user blocked or who blocked the user (hidden from group chats). */
  blockedFor(userId: string): Promise<Set<string>> {
    return this.social.blockedIds(this.db, userId);
  }

  async requireAccess(user: User, conversationId: string): Promise<ConversationAccess> {
    const access = await this.access(this.db, user, conversationId);
    if (!access) throw notFound();
    return access;
  }

  // -------------------------------------------------------------------------------------------
  // Opening conversations
  // -------------------------------------------------------------------------------------------

  /** Finds or starts a direct conversation. Blocks and the other person's privacy apply. */
  async openDirect(user: User, otherId: string): Promise<ConversationDto> {
    if (otherId === user.id) throw messagingError(400, "not_allowed");
    const [other] = await this.db.select({ id: users.id }).from(users).where(eq(users.id, otherId));
    if (!other) throw notFound();
    const [a, b] = user.id < otherId ? [user.id, otherId] : [otherId, user.id];
    const [existing] = await this.db
      .select()
      .from(conversations)
      .where(
        and(
          eq(conversations.kind, "direct"),
          eq(conversations.directUserA, a),
          eq(conversations.directUserB, b),
        ),
      );
    if (!existing && !(await this.directAllowed(this.db, user.id, otherId))) {
      throw messagingError(403, "cannot_message");
    }
    const row =
      existing ??
      (await this.insertConversation({ kind: "direct", directUserA: a, directUserB: b }));
    return this.dtoFor(user, row);
  }

  async openRequest(user: User, recipientId: string): Promise<ConversationDto> {
    if ((await this.requestSide(this.db, user, recipientId)) === null) throw notFound();
    const [existing] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.requestRecipientId, recipientId));
    const row =
      existing ??
      (await this.insertConversation({ kind: "request", requestRecipientId: recipientId }));
    return this.dtoFor(user, row);
  }

  async openGroup(user: User, groupId: string): Promise<ConversationDto> {
    const [member] = await this.db
      .select({ status: communityGroupMembers.status, groupStatus: communityGroups.status })
      .from(communityGroupMembers)
      .innerJoin(communityGroups, eq(communityGroups.id, communityGroupMembers.groupId))
      .where(
        and(eq(communityGroupMembers.groupId, groupId), eq(communityGroupMembers.userId, user.id)),
      );
    if (member?.status !== "active" || member.groupStatus === "hidden") throw notFound();
    const [existing] = await this.db
      .select()
      .from(conversations)
      .where(eq(conversations.groupId, groupId));
    const row = existing ?? (await this.insertConversation({ kind: "group", groupId }));
    return this.dtoFor(user, row);
  }

  /** Inserts, or returns the row a concurrent request created first. */
  private async insertConversation(
    values: typeof conversations.$inferInsert,
  ): Promise<Conversation> {
    const [inserted] = await this.db
      .insert(conversations)
      .values(values)
      .onConflictDoNothing()
      .returning();
    if (inserted) return inserted;
    const where =
      values.kind === "direct"
        ? and(
            eq(conversations.kind, "direct"),
            eq(conversations.directUserA, values.directUserA ?? ""),
            eq(conversations.directUserB, values.directUserB ?? ""),
          )
        : values.kind === "request"
          ? eq(conversations.requestRecipientId, values.requestRecipientId ?? "")
          : eq(conversations.groupId, values.groupId ?? "");
    const [row] = await this.db.select().from(conversations).where(where);
    if (!row) throw new Error("conversation insert lost its row");
    return row;
  }

  // -------------------------------------------------------------------------------------------
  // Listing
  // -------------------------------------------------------------------------------------------

  async list(user: User): Promise<ConversationDto[]> {
    const candidates = await queryRows<{ id: string }>(
      this.db,
      sql`SELECT c.id FROM conversations c
          WHERE (c.kind = 'direct' AND (c.direct_user_a = ${user.id} OR c.direct_user_b = ${user.id}))
             OR (c.kind = 'group' AND c.group_id IN (
                  SELECT group_id FROM community_group_members WHERE user_id = ${user.id} AND status = 'active'))
             OR (c.kind = 'request' AND c.request_recipient_id IN (
                  SELECT r.id FROM service_request_recipients r
                  JOIN service_requests sr ON sr.id = r.request_id
                  WHERE sr.requester_user_id = ${user.id}
                     OR sr.requester_organization_id IN (SELECT organization_id FROM memberships WHERE user_id = ${user.id})
                     OR r.organization_id IN (SELECT organization_id FROM memberships WHERE user_id = ${user.id})))
          ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC
          LIMIT 300`,
    );
    if (candidates.length === 0) return [];
    const rows = await this.db
      .select()
      .from(conversations)
      .where(
        inArray(
          conversations.id,
          candidates.map((c) => c.id),
        ),
      );
    const byId = new Map(rows.map((r) => [r.id, r]));
    const result: ConversationDto[] = [];
    for (const { id } of candidates) {
      const row = byId.get(id);
      if (!row) continue;
      const access = await this.accessTo(this.db, user, row);
      if (access) result.push(await this.dto(user, access));
    }
    return result;
  }

  async get(user: User, conversationId: string): Promise<ConversationDto> {
    return this.dto(user, await this.requireAccess(user, conversationId));
  }

  private async dtoFor(user: User, row: Conversation): Promise<ConversationDto> {
    const access = await this.accessTo(this.db, user, row);
    if (!access) throw notFound();
    return this.dto(user, access);
  }

  private async dto(user: User, access: ConversationAccess): Promise<ConversationDto> {
    const c = access.conversation;
    const [state] = await this.db
      .select()
      .from(conversationStates)
      .where(
        and(eq(conversationStates.conversationId, c.id), eq(conversationStates.userId, user.id)),
      );
    const lastReadSeq = state?.lastReadSeq ?? 0;
    const blocked = c.kind === "group" ? [...(await this.social.blockedIds(this.db, user.id))] : [];
    const [unread] = await queryRows<{ n: number }>(
      this.db,
      sql`SELECT count(*)::int AS n FROM messages
          WHERE conversation_id = ${c.id} AND seq > ${lastReadSeq} AND sender_user_id <> ${user.id}
            AND status = 'visible'
            ${
              blocked.length === 0
                ? sql``
                : sql`AND sender_user_id NOT IN (${sql.join(
                    blocked.map((b) => sql`${b}::uuid`),
                    sql`, `,
                  )})`
            }`,
    );
    let title = "Conversation";
    let peer: ConversationDto["peer"] = null;
    if (c.kind === "direct" && access.peerUserId !== null) {
      const [p] = await this.db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, access.peerUserId));
      peer = { userId: access.peerUserId, displayName: p?.name ?? FALLBACK_NAME };
      title = peer.displayName;
    } else if (c.kind === "group" && c.groupId !== null) {
      const [g] = await this.db
        .select({ name: communityGroups.name })
        .from(communityGroups)
        .where(eq(communityGroups.id, c.groupId));
      title = g?.name ?? "Group";
    } else if (c.kind === "request" && c.requestRecipientId !== null) {
      title = await this.requestTitle(c.requestRecipientId, access.side);
    }
    return {
      id: c.id,
      kind: c.kind,
      title,
      peer,
      serviceRequestRecipientId: c.requestRecipientId,
      groupId: c.groupId,
      lastSeq: c.lastSeq,
      lastMessageAt: c.lastMessageAt?.toISOString() ?? null,
      lastReadSeq,
      unread: unread?.n ?? 0,
      muted: state?.muted ?? false,
      peerReadSeq: await this.peerReadSeq(user, access),
      canSend: access.readOnly === null,
      warning: c.kind === "direct" || c.kind === "request" ? PAYMENT_SCAM_WARNING : null,
    };
  }

  /** The requester sees the provider's name; the provider sees "Customer" or the fleet's name. */
  private async requestTitle(
    recipientId: string,
    side: Side | null,
    executor: Executor = this.db,
  ): Promise<string> {
    const [row] = await executor
      .select({
        providerOrg: serviceRequestRecipients.organizationId,
        fleetOrg: serviceRequests.requesterOrganizationId,
      })
      .from(serviceRequestRecipients)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .where(eq(serviceRequestRecipients.id, recipientId));
    if (!row) return "Service request";
    const orgId = side === "requester" ? row.providerOrg : row.fleetOrg;
    if (orgId === null) return "Customer";
    const [org] = await executor
      .select({ name: organizations.name })
      .from(organizations)
      .where(eq(organizations.id, orgId));
    return org?.name ?? "Service request";
  }

  /** Read receipts are mutual: both sides must have them on. Groups never show them. */
  private async peerReadSeq(user: User, access: ConversationAccess): Promise<number | null> {
    const c = access.conversation;
    if (c.kind === "group") return null;
    if (!(await this.preferences(this.db, user.id)).readReceipts) return null;
    // Only people who share receipts count; if nobody on the other side does, nothing is shown.
    const peers: string[] = [];
    for (const id of await this.peerUserIds(this.db, access, user.id)) {
      if ((await this.preferences(this.db, id)).readReceipts) peers.push(id);
    }
    if (peers.length === 0) return null;
    const rows = await this.db
      .select({ userId: conversationStates.userId, seq: conversationStates.lastReadSeq })
      .from(conversationStates)
      .where(
        and(eq(conversationStates.conversationId, c.id), inArray(conversationStates.userId, peers)),
      );
    return rows.reduce((best, r) => Math.max(best, r.seq), 0);
  }

  /** People on the other side: the direct peer, or the other side of a request. */
  async peerUserIds(
    executor: Executor,
    access: ConversationAccess,
    userId: string,
  ): Promise<string[]> {
    if (access.conversation.kind === "direct")
      return access.peerUserId === null ? [] : [access.peerUserId];
    if (access.conversation.kind !== "request") return [];
    const everyone = await this.participantIds(executor, access.conversation);
    const result: string[] = [];
    for (const id of everyone) {
      if (id === userId) continue;
      const [u] = await executor.select().from(users).where(eq(users.id, id));
      if (!u) continue;
      const other = await this.accessTo(executor, u, access.conversation);
      if (other && other.side !== access.side) result.push(id);
    }
    return result;
  }

  /** Everyone who can currently read the conversation (notifications, receipts). */
  async participantIds(executor: Executor, conversation: Conversation): Promise<string[]> {
    if (conversation.kind === "direct") {
      return [conversation.directUserA, conversation.directUserB].filter(
        (v): v is string => v !== null,
      );
    }
    if (conversation.kind === "group") {
      const rows = await executor
        .select({ id: communityGroupMembers.userId })
        .from(communityGroupMembers)
        .where(
          and(
            eq(communityGroupMembers.groupId, conversation.groupId ?? ""),
            eq(communityGroupMembers.status, "active"),
          ),
        );
      return rows.map((r) => r.id);
    }
    const [row] = await executor
      .select({ recipient: serviceRequestRecipients, request: serviceRequests })
      .from(serviceRequestRecipients)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .where(eq(serviceRequestRecipients.id, conversation.requestRecipientId ?? ""));
    if (!row) return [];
    const ids = new Set<string>();
    if (row.request.requesterUserId !== null) ids.add(row.request.requesterUserId);
    if (row.request.requesterOrganizationId !== null) {
      ids.add(row.request.createdBy);
      const fleet = await executor
        .select({
          userId: memberships.userId,
          role: memberships.role,
          branchId: memberships.branchId,
        })
        .from(memberships)
        .where(eq(memberships.organizationId, row.request.requesterOrganizationId));
      for (const m of fleet) {
        if (
          hasPermission(m.role as Role, "requests.manage") &&
          (m.branchId === null || m.branchId === row.request.fleetBranchId)
        )
          ids.add(m.userId);
      }
    }
    const provider = await executor
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
      })
      .from(memberships)
      .where(eq(memberships.organizationId, row.recipient.organizationId));
    for (const m of provider) {
      if (
        hasPermission(m.role as Role, "requests.respond") &&
        (m.branchId === null || m.branchId === row.recipient.branchId)
      )
        ids.add(m.userId);
    }
    return [...ids];
  }

  // -------------------------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------------------------

  /** Sends a message. Resending the same `clientMessageId` returns the original (no new seq). */
  async send(user: User, conversationId: string, input: SendInput): Promise<MessageDto> {
    const existing = await this.byClientId(conversationId, user.id, input.clientMessageId);
    if (existing) return toMessageDto(existing, user.id);
    let messageId: string;
    try {
      messageId = await this.db.transaction(async (tx) => {
        const access = await this.access(tx, user, conversationId);
        if (!access) throw notFound();
        if (access.readOnly === "cannot_message") throw messagingError(403, "cannot_message");
        if (access.readOnly !== null) throw messagingError(409, access.readOnly);
        const [bumped] = await tx
          .update(conversations)
          .set({ lastSeq: sql`${conversations.lastSeq} + 1`, lastMessageAt: this.clock.now() })
          .where(eq(conversations.id, conversationId))
          .returning({ seq: conversations.lastSeq });
        if (!bumped) throw notFound();
        const [message] = await tx
          .insert(messages)
          .values({
            conversationId,
            seq: bumped.seq,
            senderUserId: user.id,
            senderSide: access.side,
            clientMessageId: input.clientMessageId,
            body: input.body,
            warnings: messageWarnings(input.body),
          })
          .returning();
        if (!message) throw new Error("message insert returned no row");
        if (input.attachmentIds.length > 0) {
          const claimed = await tx
            .update(messageAttachments)
            .set({ messageId: message.id })
            .where(
              and(
                inArray(messageAttachments.id, input.attachmentIds),
                eq(messageAttachments.conversationId, conversationId),
                eq(messageAttachments.uploadedBy, user.id),
                eq(messageAttachments.status, "available"),
                sql`${messageAttachments.messageId} IS NULL`,
              ),
            )
            .returning({ id: messageAttachments.id });
          if (claimed.length !== new Set(input.attachmentIds).size)
            throw messagingError(400, "attachment_not_ready");
        }
        // The sender has read their own message.
        await this.markReadIn(tx, user.id, conversationId, bumped.seq);
        await enqueueOutboxEvent(tx, {
          aggregateType: "conversation",
          aggregateId: conversationId,
          eventType: "MessageSent",
          payload: {
            conversationId,
            messageId: message.id,
            seq: bumped.seq,
            senderUserId: user.id,
          },
        });
        return message.id;
      });
    } catch (error) {
      // A concurrent retry with the same clientMessageId won the race.
      if (String((error as { cause?: unknown }).cause ?? error).includes("messages_client_key")) {
        const winner = await this.byClientId(conversationId, user.id, input.clientMessageId);
        if (winner) return toMessageDto(winner, user.id);
      }
      throw error;
    }
    const raw = await this.raw(this.db, messageId);
    if (!raw) throw notFound();
    await this.bus.publish(`conversation:${conversationId}`, { type: "message", message: raw });
    return toMessageDto(raw, user.id);
  }

  private async byClientId(
    conversationId: string,
    userId: string,
    clientMessageId: string,
  ): Promise<RawMessage | null> {
    const [row] = await this.db
      .select({ id: messages.id })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, conversationId),
          eq(messages.senderUserId, userId),
          eq(messages.clientMessageId, clientMessageId),
        ),
      );
    if (!row) return null;
    // Only the sender, who must still have access, gets the original back.
    return this.raw(this.db, row.id);
  }

  /** History for a viewer, ordered by seq. Messages from people you blocked (or who blocked you) are left out of group chats. */
  async history(
    user: User,
    conversationId: string,
    query: { after?: number | undefined; before?: number | undefined; limit: number },
  ): Promise<MessagePage> {
    const access = await this.requireAccess(user, conversationId);
    return this.page(access, user, query);
  }

  async page(
    access: ConversationAccess,
    user: User,
    query: { after?: number | undefined; before?: number | undefined; limit: number },
  ): Promise<MessagePage> {
    const c = access.conversation;
    const blocked =
      c.kind === "group" ? await this.social.blockedIds(this.db, user.id) : new Set<string>();
    const rows = await this.db
      .select({ id: messages.id, sender: messages.senderUserId })
      .from(messages)
      .where(
        and(
          eq(messages.conversationId, c.id),
          query.after === undefined ? undefined : gt(messages.seq, query.after),
          query.before === undefined ? undefined : lt(messages.seq, query.before),
        ),
      )
      .orderBy(
        query.before === undefined && query.after !== undefined
          ? asc(messages.seq)
          : desc(messages.seq),
      )
      .limit(query.limit + 1);
    const more = rows.length > query.limit;
    const ids = rows
      .slice(0, query.limit)
      .filter((r) => !blocked.has(r.sender))
      .map((r) => r.id);
    const raws = await this.raws(ids);
    raws.sort((a, b) => a.seq - b.seq);
    return { items: raws.map((r) => toMessageDto(r, user.id)), more };
  }

  /** Replay for the socket: messages after `after`, oldest first, capped at MAX_REPLAY. */
  async replay(
    access: ConversationAccess,
    user: User,
    after: number,
  ): Promise<{ items: RawMessage[]; more: boolean }> {
    const blocked =
      access.conversation.kind === "group"
        ? await this.social.blockedIds(this.db, user.id)
        : new Set<string>();
    const rows = await this.db
      .select({ id: messages.id, sender: messages.senderUserId })
      .from(messages)
      .where(and(eq(messages.conversationId, access.conversation.id), gt(messages.seq, after)))
      .orderBy(asc(messages.seq))
      .limit(MAX_REPLAY + 1);
    const more = rows.length > MAX_REPLAY;
    const raws = await this.raws(
      rows
        .slice(0, MAX_REPLAY)
        .filter((r) => !blocked.has(r.sender))
        .map((r) => r.id),
    );
    raws.sort((a, b) => a.seq - b.seq);
    return { items: raws, more };
  }

  /** The sender deletes their message; group owners and moderators remove others' messages. */
  async remove(user: User, conversationId: string, messageId: string): Promise<MessageDto> {
    const access = await this.requireAccess(user, conversationId);
    const [row] = await this.db
      .select()
      .from(messages)
      .where(and(eq(messages.id, messageId), eq(messages.conversationId, conversationId)));
    if (!row) throw notFound();
    if (row.status !== "visible") throw messagingError(409, "not_allowed");
    const own = row.senderUserId === user.id;
    const moderator = access.groupRole === "owner" || access.groupRole === "moderator";
    if (!own && !moderator) throw messagingError(403, "not_allowed");
    await this.db.transaction(async (tx) => {
      await tx
        .update(messages)
        .set({ status: own ? "deleted" : "removed" })
        .where(eq(messages.id, row.id));
      if (!own) {
        await recordAuditEvent(tx, {
          actorType: "user",
          actorId: user.id,
          action: "group.message_removed",
          targetType: "message",
          targetId: row.id,
          requestId: currentRequestContext()?.requestId,
          metadata: {
            conversationId,
            groupId: access.conversation.groupId,
            senderUserId: row.senderUserId,
          },
        });
      }
    });
    await this.bus.publish(`conversation:${conversationId}`, {
      type: "refresh",
      messageId: row.id,
    });
    const raw = await this.raw(this.db, row.id);
    if (!raw) throw notFound();
    return toMessageDto(raw, user.id);
  }

  /** A message as a viewer with access sees it (used by the socket after updates). */
  async messageFor(
    user: User,
    conversationId: string,
    messageId: string,
  ): Promise<MessageDto | null> {
    const raw = await this.raw(this.db, messageId);
    if (raw?.conversationId !== conversationId) return null;
    return toMessageDto(raw, user.id);
  }

  async raw(executor: Executor, messageId: string): Promise<RawMessage | null> {
    const [raw] = await this.raws([messageId], executor);
    return raw ?? null;
  }

  private async raws(ids: readonly string[], executor: Executor = this.db): Promise<RawMessage[]> {
    if (ids.length === 0) return [];
    const rows = await executor
      .select({ message: messages, conversation: conversations, name: users.displayName })
      .from(messages)
      .innerJoin(conversations, eq(conversations.id, messages.conversationId))
      .innerJoin(users, eq(users.id, messages.senderUserId))
      .where(inArray(messages.id, [...ids]));
    const attachments = await executor
      .select()
      .from(messageAttachments)
      .where(inArray(messageAttachments.messageId, [...ids]));
    const labels = new Map<string, string>();
    const result: RawMessage[] = [];
    for (const r of rows) {
      let senderName = r.name ?? FALLBACK_NAME;
      if (r.conversation.kind === "request" && r.conversation.requestRecipientId !== null) {
        const key = `${r.conversation.requestRecipientId}:${r.message.senderSide ?? ""}`;
        let label = labels.get(key);
        if (label === undefined) {
          // Each side sees the other's label; the provider's name, or "Customer" / the fleet's name.
          label = await this.requestTitle(
            r.conversation.requestRecipientId,
            r.message.senderSide === "provider" ? "requester" : "provider",
            executor,
          );
          labels.set(key, label);
        }
        senderName = label;
      }
      result.push({
        id: r.message.id,
        conversationId: r.message.conversationId,
        kind: r.conversation.kind,
        seq: r.message.seq,
        clientMessageId: r.message.clientMessageId,
        senderUserId: r.message.senderUserId,
        senderName,
        senderSide: r.message.senderSide,
        body: r.message.body,
        status: r.message.status,
        warnings: r.message.warnings,
        attachments: attachments
          .filter((a) => a.messageId === r.message.id && a.status === "available")
          .map((a) => ({
            id: a.id,
            contentType: a.contentType ?? a.declaredContentType,
            size: a.size ?? a.declaredSize,
          })),
        createdAt: r.message.createdAt.toISOString(),
      });
    }
    return result;
  }

  // -------------------------------------------------------------------------------------------
  // Read state and mute
  // -------------------------------------------------------------------------------------------

  private async markReadIn(
    executor: Executor,
    userId: string,
    conversationId: string,
    seq: number,
  ): Promise<number> {
    const [row] = await executor
      .insert(conversationStates)
      .values({ conversationId, userId, lastReadSeq: seq })
      .onConflictDoUpdate({
        target: [conversationStates.conversationId, conversationStates.userId],
        set: { lastReadSeq: sql`greatest(${conversationStates.lastReadSeq}, ${seq})` },
      })
      .returning({ seq: conversationStates.lastReadSeq });
    return row?.seq ?? seq;
  }

  /** Moves the read position forward (never back, never past the last message). */
  async markRead(
    user: User,
    conversationId: string,
    seq: number,
  ): Promise<{ lastReadSeq: number }> {
    const access = await this.requireAccess(user, conversationId);
    const target = Math.min(seq, access.conversation.lastSeq);
    const lastReadSeq = await this.markReadIn(this.db, user.id, conversationId, target);
    if (
      access.conversation.kind !== "group" &&
      (await this.preferences(this.db, user.id)).readReceipts
    ) {
      await this.bus.publish(`conversation:${conversationId}`, {
        type: "receipt",
        readerUserId: user.id,
        readerSide: access.side,
        seq: lastReadSeq,
      });
    }
    return { lastReadSeq };
  }

  async setMuted(user: User, conversationId: string, muted: boolean): Promise<ConversationDto> {
    const access = await this.requireAccess(user, conversationId);
    await this.db
      .insert(conversationStates)
      .values({ conversationId, userId: user.id, muted })
      .onConflictDoUpdate({
        target: [conversationStates.conversationId, conversationStates.userId],
        set: { muted },
      });
    return this.dto(user, access);
  }

  /** Conversations with unread messages (for the inbox badge). */
  async unreadConversations(user: User): Promise<number> {
    return (await this.list(user)).filter((c) => c.unread > 0).length;
  }
}

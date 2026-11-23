import {
  and,
  articleComments,
  articles,
  communityGroupMembers,
  communityGroups,
  conversationStates,
  conversations,
  type Database,
  desc,
  pushDevices,
  eq,
  type Executor,
  inArray,
  isNull,
  memberships,
  moderationActions,
  type NotificationRow,
  notifications,
  organizations,
  type OutboxEvent,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  type User,
  users,
} from "@fleettrust/db";
import {
  hasPermission,
  type InboxDto,
  type MessagingPreferences,
  type NotificationDto,
  NOTIFICATION_KINDS,
  type Role,
} from "@fleettrust/types";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { PUSH_SENDER, type PushMessage, type PushSender } from "../../platform/push/index.js";
import { REALTIME_BUS, type RealtimeBus } from "../../platform/realtime/index.js";
import { SocialService } from "../community/index.js";
import { MessagingService } from "../messaging/index.js";

type Kind = (typeof NOTIFICATION_KINDS)[number];
type Category = "messages" | "requests" | "community";
/** Work to do after the event's transaction commits (push, realtime). */
export type Effect = () => Promise<void>;

const FALLBACK_NAME = "FleetTrust member";
const PUSH_PREF: Record<Category, keyof MessagingPreferences> = {
  messages: "pushMessages",
  requests: "pushRequests",
  community: "pushCommunity",
};

const str = (value: unknown): string | null => (typeof value === "string" ? value : null);

/**
 * Turns domain events from the outbox into inbox notifications, realtime inbox updates and push
 * notifications (F-054, ADR-0024). Inbox rows are idempotent per event, so a retried event
 * doesn't notify twice. Opt-outs: per-category push switches, muted conversations, blocks.
 * New messages aren't inbox rows: the unread conversation is the notification.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger("Notifications");

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(PUSH_SENDER) private readonly push: PushSender,
    @Inject(REALTIME_BUS) private readonly bus: RealtimeBus,
    private readonly messaging: MessagingService,
    private readonly social: SocialService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Event handling
  // -------------------------------------------------------------------------------------------

  /** Handles one outbox event inside its transaction; returns the side effects to run after commit. */
  async handle(tx: Executor, event: OutboxEvent): Promise<Effect[]> {
    const p = event.payload;
    switch (event.eventType) {
      case "MessageSent":
        return this.messageSent(tx, p);
      case "FriendRequestSent": {
        const sender = str(p["senderId"]);
        const recipient = str(p["recipientId"]);
        if (sender === null || recipient === null) return [];
        if (await this.social.isBlockedEitherWay(tx, sender, recipient)) return [];
        const name = await this.name(tx, sender);
        return this.notify(tx, event, [recipient], "community", {
          kind: "friend_request",
          title: "New friend request",
          body: `${name} wants to be your friend.`,
          data: { requestId: str(p["requestId"]) ?? "", userId: sender },
        });
      }
      case "FriendRequestAccepted": {
        const sender = str(p["senderId"]);
        const recipient = str(p["recipientId"]);
        if (sender === null || recipient === null) return [];
        const name = await this.name(tx, recipient);
        return this.notify(tx, event, [sender], "community", {
          kind: "friend_accepted",
          title: "Friend request accepted",
          body: `${name} accepted your friend request.`,
          data: { userId: recipient },
        });
      }
      case "GroupJoinRequested": {
        const groupId = str(p["groupId"]);
        const userId = str(p["userId"]);
        if (groupId === null || userId === null) return [];
        const managers = await tx
          .select({ id: communityGroupMembers.userId })
          .from(communityGroupMembers)
          .where(
            and(
              eq(communityGroupMembers.groupId, groupId),
              eq(communityGroupMembers.status, "active"),
              inArray(communityGroupMembers.role, ["owner", "moderator"]),
            ),
          );
        const [group] = await tx
          .select({ name: communityGroups.name })
          .from(communityGroups)
          .where(eq(communityGroups.id, groupId));
        return this.notify(
          tx,
          event,
          managers.map((m) => m.id),
          "community",
          {
            kind: "group_join_request",
            title: "New join request",
            body: `${await this.name(tx, userId)} asked to join ${group?.name ?? "your group"}.`,
            data: { groupId, userId },
          },
        );
      }
      case "GroupMemberApproved": {
        const groupId = str(p["groupId"]);
        const userId = str(p["userId"]);
        if (groupId === null || userId === null) return [];
        const [group] = await tx
          .select({ name: communityGroups.name })
          .from(communityGroups)
          .where(eq(communityGroups.id, groupId));
        return this.notify(tx, event, [userId], "community", {
          kind: "group_approved",
          title: "You're in",
          body: `You joined ${group?.name ?? "the group"}.`,
          data: { groupId },
        });
      }
      case "ArticleCommentCreated": {
        const commentId = str(p["commentId"]);
        const authorId = str(p["articleAuthorUserId"]);
        const articleId = str(p["articleId"]);
        if (commentId === null || authorId === null || articleId === null) return [];
        const [comment] = await tx
          .select({ by: articleComments.authorUserId })
          .from(articleComments)
          .where(eq(articleComments.id, commentId));
        if (!comment || comment.by === authorId) return [];
        if (await this.social.isBlockedEitherWay(tx, comment.by, authorId)) return [];
        const [article] = await tx
          .select({ title: articles.title })
          .from(articles)
          .where(eq(articles.id, articleId));
        return this.notify(tx, event, [authorId], "community", {
          kind: "article_comment",
          title: "New comment",
          body: `${await this.name(tx, comment.by)} commented on "${article?.title ?? "your article"}".`,
          data: { articleId, commentId },
        });
      }
      case "ArticleModerated":
      case "ArticleCommentModerated":
      case "GroupModerated":
      case "MessageModerated":
        return this.moderated(tx, event);
      case "ServiceRequestSent":
      case "ServiceRequestQuoteAccepted": {
        const orgId = str(p["organizationId"]);
        if (orgId === null) return [];
        const users = await this.providerUsers(tx, event.aggregateId, orgId);
        const sent = event.eventType === "ServiceRequestSent";
        return this.notify(tx, event, users, "requests", {
          kind: sent ? "service_request" : "quote_accepted",
          title: sent ? "New service request" : "Quote accepted",
          body: sent
            ? "A customer sent your business a service request."
            : "A customer accepted your quote. Payment is arranged directly with them.",
          data: { requestId: event.aggregateId },
        });
      }
      case "ServiceRequestQuoteSubmitted":
      case "ServiceRequestQuoteRevised":
      case "ServiceRequestProviderCancelled": {
        const orgId = str(p["organizationId"]);
        const users = await this.requesterUsers(tx, event.aggregateId);
        const [org] =
          orgId === null
            ? []
            : await tx
                .select({ name: organizations.name })
                .from(organizations)
                .where(eq(organizations.id, orgId));
        const provider = org?.name ?? "A provider";
        const cancelled = event.eventType === "ServiceRequestProviderCancelled";
        return this.notify(tx, event, users, "requests", {
          kind: cancelled ? "provider_cancelled" : "quote_received",
          title: cancelled ? "Provider cancelled" : "New quote",
          body: cancelled
            ? `${provider} cancelled. Your request is open again for other quotes.`
            : `${provider} sent you a quote.`,
          data: { requestId: event.aggregateId },
        });
      }
      default:
        return [];
    }
  }

  private async messageSent(tx: Executor, p: Record<string, unknown>): Promise<Effect[]> {
    const conversationId = str(p["conversationId"]);
    const messageId = str(p["messageId"]);
    const senderId = str(p["senderUserId"]);
    const seq = typeof p["seq"] === "number" ? p["seq"] : null;
    if (conversationId === null || messageId === null || senderId === null || seq === null)
      return [];
    const [conversation] = await tx
      .select()
      .from(conversations)
      .where(eq(conversations.id, conversationId));
    if (!conversation) return [];
    const raw = await this.messaging.raw(tx, messageId);
    if (raw?.status !== "visible") return [];
    const everyone = (await this.messaging.participantIds(tx, conversation)).filter(
      (id) => id !== senderId,
    );
    if (everyone.length === 0) return [];
    const blocked = await this.social.blockedIds(tx, senderId);
    const recipients = everyone.filter((id) => !blocked.has(id));
    const states = await tx
      .select({ userId: conversationStates.userId, muted: conversationStates.muted })
      .from(conversationStates)
      .where(
        and(
          eq(conversationStates.conversationId, conversationId),
          inArray(conversationStates.userId, recipients),
        ),
      );
    const muted = new Set(states.filter((s) => s.muted).map((s) => s.userId));
    let title = raw.senderName;
    if (conversation.kind === "group" && conversation.groupId !== null) {
      const [group] = await tx
        .select({ name: communityGroups.name })
        .from(communityGroups)
        .where(eq(communityGroups.id, conversation.groupId));
      title = `${raw.senderName} · ${group?.name ?? "Group"}`;
    }
    const effects: Effect[] = recipients.map(
      (id) => () => this.bus.publish(`user:${id}`, { type: "inbox", conversationId, lastSeq: seq }),
    );
    const pushTo = recipients.filter((id) => !muted.has(id));
    effects.push(() =>
      this.pushTo(pushTo, "messages", (prefs) => ({
        title,
        body:
          prefs.pushPreviews && raw.body !== ""
            ? raw.body.length > 120
              ? `${raw.body.slice(0, 117)}…`
              : raw.body
            : raw.attachments.length > 0
              ? "Sent an attachment"
              : "New message",
        data: { type: "message", conversationId, seq: String(seq) },
      })),
    );
    return effects;
  }

  private async moderated(tx: Executor, event: OutboxEvent): Promise<Effect[]> {
    const action = str(event.payload["action"]);
    // Authors hear about decisions that change what others see.
    if (action === null || action === "dismiss_reports") return [];
    const [latest] = await tx
      .select()
      .from(moderationActions)
      .where(eq(moderationActions.targetId, event.aggregateId))
      .orderBy(desc(moderationActions.createdAt))
      .limit(1);
    let authorId = str(event.payload["authorUserId"]);
    let what = "Your content";
    const data: Record<string, string> = {
      targetType: event.aggregateType,
      targetId: event.aggregateId,
    };
    if (event.aggregateType === "article") {
      const [a] = await tx
        .select({ by: articles.authorUserId, title: articles.title })
        .from(articles)
        .where(eq(articles.id, event.aggregateId));
      authorId ??= a?.by ?? null;
      what = a ? `Your article "${a.title}"` : "Your article";
    } else if (event.aggregateType === "article_comment") {
      const [c] = await tx
        .select({ by: articleComments.authorUserId })
        .from(articleComments)
        .where(eq(articleComments.id, event.aggregateId));
      authorId ??= c?.by ?? null;
      what = "Your comment";
    } else if (event.aggregateType === "group") {
      const [g] = await tx
        .select({ by: communityGroups.createdBy, name: communityGroups.name })
        .from(communityGroups)
        .where(eq(communityGroups.id, event.aggregateId));
      authorId ??= g?.by ?? null;
      what = g ? `Your group "${g.name}"` : "Your group";
    } else if (event.aggregateType === "message") {
      if (action !== "hide" && action !== "auto_flag") return [];
      const raw = await this.messaging.raw(tx, event.aggregateId);
      authorId ??= raw?.senderUserId ?? null;
      what = "Your message";
      if (raw) data["conversationId"] = raw.conversationId;
    }
    if (authorId === null) return [];
    const outcome: Record<string, string> = {
      approve: "was approved and is now public",
      reject: "was sent back to you",
      hide: "was hidden by FleetTrust moderators",
      restore: "was restored",
      auto_flag: "is hidden while moderators look at reports about it",
    };
    const reason = latest?.reason ? ` Reason: ${latest.reason}` : "";
    return this.notify(tx, event, [authorId], "community", {
      kind: "content_moderated",
      title: "Moderation update",
      body: `${what} ${outcome[action] ?? "was reviewed"}.${reason}`,
      data,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Recipients
  // -------------------------------------------------------------------------------------------

  /** Provider members who may respond to this request (branch scope of their recipient row). */
  private async providerUsers(
    tx: Executor,
    requestId: string,
    organizationId: string,
  ): Promise<string[]> {
    const [recipient] = await tx
      .select({ branchId: serviceRequestRecipients.branchId })
      .from(serviceRequestRecipients)
      .where(
        and(
          eq(serviceRequestRecipients.requestId, requestId),
          eq(serviceRequestRecipients.organizationId, organizationId),
        ),
      );
    if (!recipient) return [];
    const rows = await tx
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
      })
      .from(memberships)
      .where(eq(memberships.organizationId, organizationId));
    return rows
      .filter(
        (m) =>
          hasPermission(m.role as Role, "requests.respond") &&
          (m.branchId === null || m.branchId === recipient.branchId),
      )
      .map((m) => m.userId);
  }

  /** The requester: the individual, or the fleet member who raised it and managers in scope. */
  private async requesterUsers(tx: Executor, requestId: string): Promise<string[]> {
    const [request] = await tx
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, requestId));
    if (!request) return [];
    if (request.requesterUserId !== null) return [request.requesterUserId];
    if (request.requesterOrganizationId === null) return [];
    const rows = await tx
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
      })
      .from(memberships)
      .where(eq(memberships.organizationId, request.requesterOrganizationId));
    const ids = new Set([request.createdBy]);
    for (const m of rows) {
      if (
        hasPermission(m.role as Role, "requests.manage") &&
        (m.branchId === null || m.branchId === request.fleetBranchId)
      )
        ids.add(m.userId);
    }
    return [...ids];
  }

  private async name(tx: Executor, userId: string): Promise<string> {
    const [u] = await tx
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, userId));
    return u?.name ?? FALLBACK_NAME;
  }

  // -------------------------------------------------------------------------------------------
  // Delivery
  // -------------------------------------------------------------------------------------------

  /** Writes inbox rows (once per event and user) and returns realtime and push effects. */
  private async notify(
    tx: Executor,
    event: OutboxEvent,
    userIds: readonly string[],
    category: Category,
    content: { kind: Kind; title: string; body: string; data: Record<string, string> },
  ): Promise<Effect[]> {
    const unique = [...new Set(userIds)];
    if (unique.length === 0) return [];
    const active = await tx
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.id, unique), eq(users.status, "active")));
    if (active.length === 0) return [];
    const rows = await tx
      .insert(notifications)
      .values(active.map((u) => ({ userId: u.id, sourceEventId: event.id, ...content })))
      .onConflictDoNothing()
      .returning();
    if (rows.length === 0) return [];
    return [
      ...rows.map(
        (row) => () =>
          this.bus.publish(`user:${row.userId}`, {
            type: "notification",
            notification: this.dto(row),
          }),
      ),
      () =>
        this.pushTo(
          rows.map((r) => r.userId),
          category,
          () => ({
            title: content.title,
            body: content.body,
            data: { type: content.kind, ...content.data },
          }),
        ),
    ];
  }

  /** Sends to every registered device of users who allow this category. Dead tokens are removed. */
  private async pushTo(
    userIds: readonly string[],
    category: Category,
    build: (prefs: MessagingPreferences) => PushMessage,
  ): Promise<void> {
    if (userIds.length === 0) return;
    const devices = await this.db
      .select({ userId: pushDevices.userId, fid: pushDevices.fid })
      .from(pushDevices)
      .where(inArray(pushDevices.userId, [...userIds]));
    const byUser = new Map<string, string[]>();
    for (const d of devices) byUser.set(d.userId, [...(byUser.get(d.userId) ?? []), d.fid]);
    for (const [userId, list] of byUser) {
      const prefs = await this.messaging.preferencesFor(userId);
      if (!prefs[PUSH_PREF[category]]) continue;
      try {
        const result = await this.push.send(list, build(prefs));
        if (result.invalid.length > 0) {
          await this.db.delete(pushDevices).where(inArray(pushDevices.fid, result.invalid));
        }
      } catch (error) {
        this.logger.warn(`push failed: ${(error as Error).message}`);
      }
    }
  }

  // -------------------------------------------------------------------------------------------
  // Inbox and devices
  // -------------------------------------------------------------------------------------------

  private dto(row: NotificationRow): NotificationDto {
    return {
      id: row.id,
      kind: row.kind as Kind,
      title: row.title,
      body: row.body,
      data: row.data,
      readAt: row.readAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
    };
  }

  async inbox(user: User): Promise<InboxDto> {
    const rows = await this.db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, user.id))
      .orderBy(desc(notifications.createdAt))
      .limit(50);
    const [unread] = await this.db
      .select({ n: sql<number>`count(*)::int` })
      .from(notifications)
      .where(and(eq(notifications.userId, user.id), isNull(notifications.readAt)));
    return {
      notifications: rows.map((r) => this.dto(r)),
      unreadNotifications: unread?.n ?? 0,
      unreadConversations: await this.messaging.unreadConversations(user),
    };
  }

  async markRead(user: User, id: string | null): Promise<void> {
    await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(
        and(
          eq(notifications.userId, user.id),
          isNull(notifications.readAt),
          id === null ? undefined : eq(notifications.id, id),
        ),
      );
  }

  /** Registers an app installation; one registered by someone else moves to this user (new sign-in). */
  async registerDevice(
    user: User,
    fid: string,
    platform: "ios" | "android" | "web",
  ): Promise<void> {
    await this.db
      .insert(pushDevices)
      .values({ userId: user.id, fid, platform })
      .onConflictDoUpdate({
        target: pushDevices.fid,
        set: { userId: user.id, platform, lastSeenAt: new Date() },
      });
  }

  async unregisterDevice(user: User, fid: string): Promise<void> {
    await this.db
      .delete(pushDevices)
      .where(and(eq(pushDevices.userId, user.id), eq(pushDevices.fid, fid)));
  }
}

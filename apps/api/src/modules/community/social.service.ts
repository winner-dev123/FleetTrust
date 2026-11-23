import {
  and,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  type FriendRequest,
  friendRequests,
  friendships,
  gt,
  inArray,
  lte,
  or,
  queryRows,
  socialSettings,
  sql,
  type User,
  userBlocks,
  users,
} from "@fleettrust/db";
import {
  type BlockedUserDto,
  DECLINE_COOLDOWN_DAYS,
  DEFAULT_SOCIAL_SETTINGS,
  FRIEND_REQUEST_DAYS,
  type FriendDto,
  type FriendRequestDto,
  MAX_FRIENDS,
  MAX_PENDING_FRIEND_REQUESTS,
  type PersonDto,
  type PersonProfile,
  type Relationship,
  type SendFriendRequestResult,
  type SocialSettings,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { EntitlementsService, subjectOfUser } from "../entitlements/index.js";
import { communityError, likeEscape, notFound, violates } from "./shared.js";

const DAY_MS = 86_400_000;
const FALLBACK_NAME = "FleetTrust member";
const pair = (a: string, b: string) =>
  a < b ? { userAId: a, userBId: b } : { userAId: b, userBId: a };

/** Why a request can't be sent right now (null: it can). */
type SendBlocker =
  | "cannot_befriend_self"
  | "already_friends"
  | "request_pending"
  | "request_received"
  | "cannot_send";

/**
 * Friendships, blocks, social privacy and people lookup (F-120, F-121, ADR-0023). Harassment
 * controls (AB-05):
 * - blocks are private and cut every connection;
 * - privacy settings decide who may send requests;
 * - a daily quota counts only requests that were actually sent;
 * - pending requests are capped, and a decline starts a cooldown.
 * Block, privacy and cooldown refusals all look the same (`cannot_send`), so nobody can tell
 * which applies.
 */
@Injectable()
export class SocialService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Relationship checks (also used by groups, and by messaging in Prompt 17)
  // -------------------------------------------------------------------------------------------

  async isBlockedEitherWay(executor: Executor, a: string, b: string): Promise<boolean> {
    const rows = await executor
      .select({ blocker: userBlocks.blockerId })
      .from(userBlocks)
      .where(
        or(
          and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
          and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
        ),
      )
      .limit(1);
    return rows.length > 0;
  }

  /** IDs of users who blocked `userId` or whom `userId` blocked. */
  async blockedIds(executor: Executor, userId: string): Promise<Set<string>> {
    const rows = await executor
      .select({ blocker: userBlocks.blockerId, blocked: userBlocks.blockedId })
      .from(userBlocks)
      .where(or(eq(userBlocks.blockerId, userId), eq(userBlocks.blockedId, userId)));
    return new Set(rows.map((r) => (r.blocker === userId ? r.blocked : r.blocker)));
  }

  private async areFriends(executor: Executor, a: string, b: string): Promise<boolean> {
    const p = pair(a, b);
    const rows = await executor
      .select({ a: friendships.userAId })
      .from(friendships)
      .where(and(eq(friendships.userAId, p.userAId), eq(friendships.userBId, p.userBId)))
      .limit(1);
    return rows.length > 0;
  }

  private async friendCount(executor: Executor, userId: string): Promise<number> {
    const [row] = await queryRows<{ n: number }>(
      executor,
      sql`SELECT count(*)::int AS n FROM friendships WHERE user_a_id = ${userId} OR user_b_id = ${userId}`,
    );
    return row?.n ?? 0;
  }

  /** Friends shared by `a` and `b`. */
  private async mutualFriendIds(executor: Executor, a: string, b: string): Promise<string[]> {
    const rows = await queryRows<{ id: string }>(
      executor,
      sql`WITH fa AS (
            SELECT CASE WHEN user_a_id = ${a} THEN user_b_id ELSE user_a_id END AS id
            FROM friendships WHERE user_a_id = ${a} OR user_b_id = ${a}
          ), fb AS (
            SELECT CASE WHEN user_a_id = ${b} THEN user_b_id ELSE user_a_id END AS id
            FROM friendships WHERE user_a_id = ${b} OR user_b_id = ${b}
          )
          SELECT fa.id FROM fa JOIN fb ON fa.id = fb.id ORDER BY fa.id`,
    );
    return rows.map((r) => r.id);
  }

  async settings(executor: Executor, userId: string): Promise<SocialSettings> {
    const [row] = await executor
      .select()
      .from(socialSettings)
      .where(eq(socialSettings.userId, userId));
    if (!row) return DEFAULT_SOCIAL_SETTINGS;
    return {
      friendRequestsFrom: row.friendRequestsFrom,
      friendListVisibility: row.friendListVisibility,
      discoverable: row.discoverable,
    };
  }

  /** Unanswered requests past their expiry are closed before any check. */
  private async expireStale(executor: Executor, a: string, b: string): Promise<void> {
    await executor
      .update(friendRequests)
      .set({ status: "expired" })
      .where(
        and(
          eq(friendRequests.status, "pending"),
          lte(friendRequests.expiresAt, this.clock.now()),
          or(
            and(eq(friendRequests.senderId, a), eq(friendRequests.recipientId, b)),
            and(eq(friendRequests.senderId, b), eq(friendRequests.recipientId, a)),
          ),
        ),
      );
  }

  private async pendingBetween(
    executor: Executor,
    a: string,
    b: string,
  ): Promise<FriendRequest | undefined> {
    const [row] = await executor
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.status, "pending"),
          gt(friendRequests.expiresAt, this.clock.now()),
          or(
            and(eq(friendRequests.senderId, a), eq(friendRequests.recipientId, b)),
            and(eq(friendRequests.senderId, b), eq(friendRequests.recipientId, a)),
          ),
        ),
      );
    return row;
  }

  /** Every rule for sending, in the order the API applies them. */
  private async sendBlocker(
    executor: Executor,
    me: string,
    other: string,
  ): Promise<SendBlocker | null> {
    if (me === other) return "cannot_befriend_self";
    if (await this.isBlockedEitherWay(executor, me, other)) return "cannot_send";
    if (await this.areFriends(executor, me, other)) return "already_friends";
    const pending = await this.pendingBetween(executor, me, other);
    if (pending) return pending.senderId === me ? "request_pending" : "request_received";
    const settings = await this.settings(executor, other);
    if (settings.friendRequestsFrom === "nobody") return "cannot_send";
    if (
      settings.friendRequestsFrom === "friends_of_friends" &&
      (await this.mutualFriendIds(executor, me, other)).length === 0
    ) {
      return "cannot_send";
    }
    const since = new Date(this.clock.now().getTime() - DECLINE_COOLDOWN_DAYS * DAY_MS);
    const declined = await executor
      .select({ id: friendRequests.id })
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.senderId, me),
          eq(friendRequests.recipientId, other),
          eq(friendRequests.status, "declined"),
          gt(friendRequests.respondedAt, since),
        ),
      )
      .limit(1);
    if (declined.length > 0) return "cannot_send";
    return null;
  }

  private async activeUser(executor: Executor, id: string): Promise<User> {
    const [row] = await executor.select().from(users).where(eq(users.id, id));
    if (row?.status !== "active") throw notFound();
    return row;
  }

  // -------------------------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------------------------

  async updateSettings(user: User, change: Partial<SocialSettings>): Promise<SocialSettings> {
    await this.db
      .insert(socialSettings)
      .values({ userId: user.id, ...DEFAULT_SOCIAL_SETTINGS, ...change })
      .onConflictDoUpdate({ target: socialSettings.userId, set: change });
    return this.settings(this.db, user.id);
  }

  getSettings(user: User): Promise<SocialSettings> {
    return this.settings(this.db, user.id);
  }

  // -------------------------------------------------------------------------------------------
  // Friend requests
  // -------------------------------------------------------------------------------------------

  /**
   * Sends a request. Only a request that is actually sent uses a `friend_requests.daily` unit:
   * refusals (blocked, privacy, cooldown, duplicates, limits) and accepting a request the other
   * person already sent use none.
   */
  async send(user: User, otherId: string): Promise<SendFriendRequestResult> {
    if (otherId === user.id) throw communityError(400, "cannot_befriend_self");
    try {
      return await this.db.transaction(async (tx) => {
        const other = await this.activeUser(tx, otherId);
        await this.expireStale(tx, user.id, other.id);
        const blocker = await this.sendBlocker(tx, user.id, other.id);
        if (blocker === "request_received") {
          const pending = await this.pendingBetween(tx, user.id, other.id);
          if (!pending) throw communityError(409, "request_not_pending");
          await this.acceptRow(tx, pending);
          return {
            outcome: "accepted" as const,
            friend: {
              userId: other.id,
              displayName: other.displayName ?? FALLBACK_NAME,
              relationship: "friends" as const,
            },
          };
        }
        if (blocker === "cannot_befriend_self") throw communityError(400, blocker);
        if (blocker === "cannot_send") throw communityError(403, blocker);
        if (blocker !== null) throw communityError(409, blocker);

        const [pendingCount] = await queryRows<{ n: number }>(
          tx,
          sql`SELECT count(*)::int AS n FROM friend_requests
              WHERE sender_id = ${user.id} AND status = 'pending' AND expires_at > ${this.clock.now()}`,
        );
        if ((pendingCount?.n ?? 0) >= MAX_PENDING_FRIEND_REQUESTS) {
          throw communityError(409, "too_many_pending", { limit: MAX_PENDING_FRIEND_REQUESTS });
        }
        if ((await this.friendCount(tx, user.id)) >= MAX_FRIENDS) {
          throw communityError(409, "too_many_friends");
        }
        const now = this.clock.now();
        const [row] = await tx
          .insert(friendRequests)
          .values({
            senderId: user.id,
            recipientId: other.id,
            expiresAt: new Date(now.getTime() + FRIEND_REQUEST_DAYS * DAY_MS),
          })
          .returning();
        if (!row) throw new Error("friend request insert returned no row");
        // Counted only now that the request exists; a quota refusal rolls the request back.
        await this.entitlements.consume(tx, subjectOfUser(user), "friend_requests.daily", {
          idempotencyKey: `friend_request:${row.id}`,
        });
        await enqueueOutboxEvent(tx, {
          aggregateType: "friend_request",
          aggregateId: row.id,
          eventType: "FriendRequestSent",
          payload: { requestId: row.id, senderId: user.id, recipientId: other.id },
        });
        return {
          outcome: "sent" as const,
          request: this.requestDto(row, "outgoing", {
            userId: other.id,
            displayName: other.displayName ?? FALLBACK_NAME,
            relationship: "request_sent",
          }),
        };
      });
    } catch (error) {
      // A concurrent request between the same two people won the race.
      if (violates(error, "friend_requests_pending_pair_key")) {
        throw communityError(409, "request_pending");
      }
      throw error;
    }
  }

  private async acceptRow(executor: Executor, request: FriendRequest): Promise<void> {
    for (const id of [request.senderId, request.recipientId]) {
      if ((await this.friendCount(executor, id)) >= MAX_FRIENDS) {
        throw communityError(409, "too_many_friends");
      }
    }
    await executor
      .insert(friendships)
      .values(pair(request.senderId, request.recipientId))
      .onConflictDoNothing();
    await executor
      .update(friendRequests)
      .set({ status: "accepted", respondedAt: this.clock.now() })
      .where(eq(friendRequests.id, request.id));
    await enqueueOutboxEvent(executor, {
      aggregateType: "friend_request",
      aggregateId: request.id,
      eventType: "FriendRequestAccepted",
      payload: {
        requestId: request.id,
        senderId: request.senderId,
        recipientId: request.recipientId,
      },
    });
  }

  private async ownRequest(
    executor: Executor,
    user: User,
    id: string,
    side: "sender" | "recipient",
  ): Promise<FriendRequest> {
    const [row] = await executor
      .select()
      .from(friendRequests)
      .where(
        and(
          eq(friendRequests.id, id),
          eq(side === "sender" ? friendRequests.senderId : friendRequests.recipientId, user.id),
        ),
      )
      .for("update");
    if (!row) throw notFound();
    if (row.status !== "pending" || row.expiresAt <= this.clock.now()) {
      throw communityError(409, "request_not_pending");
    }
    return row;
  }

  async accept(user: User, id: string): Promise<FriendDto> {
    return this.db.transaction(async (tx) => {
      const row = await this.ownRequest(tx, user, id, "recipient");
      if (await this.isBlockedEitherWay(tx, row.senderId, row.recipientId)) throw notFound();
      await this.acceptRow(tx, row);
      const sender = await this.activeUser(tx, row.senderId);
      return {
        userId: sender.id,
        displayName: sender.displayName ?? FALLBACK_NAME,
        relationship: "friends" as const,
        since: this.clock.now().toISOString(),
      };
    });
  }

  /** The sender isn't told; their request simply leaves their outgoing list. */
  async decline(user: User, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.ownRequest(tx, user, id, "recipient");
      await tx
        .update(friendRequests)
        .set({ status: "declined", respondedAt: this.clock.now() })
        .where(eq(friendRequests.id, row.id));
    });
  }

  /** Cancelling doesn't give the quota unit back (the request was sent). */
  async cancel(user: User, id: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.ownRequest(tx, user, id, "sender");
      await tx
        .update(friendRequests)
        .set({ status: "cancelled", respondedAt: this.clock.now() })
        .where(eq(friendRequests.id, row.id));
    });
  }

  async requests(user: User, direction: "incoming" | "outgoing"): Promise<FriendRequestDto[]> {
    const mine = direction === "incoming" ? friendRequests.recipientId : friendRequests.senderId;
    const theirs = direction === "incoming" ? friendRequests.senderId : friendRequests.recipientId;
    const rows = await this.db
      .select({ request: friendRequests, name: users.displayName, status: users.status })
      .from(friendRequests)
      .innerJoin(users, eq(users.id, theirs))
      .where(
        and(
          eq(mine, user.id),
          eq(friendRequests.status, "pending"),
          gt(friendRequests.expiresAt, this.clock.now()),
        ),
      )
      .orderBy(desc(friendRequests.createdAt))
      .limit(200);
    return rows
      .filter((r) => r.status === "active")
      .map((r) =>
        this.requestDto(r.request, direction, {
          userId: direction === "incoming" ? r.request.senderId : r.request.recipientId,
          displayName: r.name ?? FALLBACK_NAME,
          relationship: direction === "incoming" ? "request_received" : "request_sent",
        }),
      );
  }

  private requestDto(
    row: FriendRequest,
    direction: "incoming" | "outgoing",
    person: PersonDto,
  ): FriendRequestDto {
    return {
      id: row.id,
      direction,
      person,
      createdAt: row.createdAt.toISOString(),
      expiresAt: row.expiresAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Friends
  // -------------------------------------------------------------------------------------------

  private async friendsOfUser(executor: Executor, userId: string): Promise<FriendDto[]> {
    const rows = await queryRows<{ id: string; display_name: string | null; since: Date | string }>(
      executor,
      sql`SELECT u.id, u.display_name, f.created_at AS since
          FROM friendships f
          JOIN users u ON u.id = CASE WHEN f.user_a_id = ${userId} THEN f.user_b_id ELSE f.user_a_id END
          WHERE (f.user_a_id = ${userId} OR f.user_b_id = ${userId}) AND u.status = 'active'
          ORDER BY u.display_name NULLS LAST, u.id
          LIMIT ${MAX_FRIENDS}`,
    );
    return rows.map((r) => ({
      userId: r.id,
      displayName: r.display_name ?? FALLBACK_NAME,
      relationship: "friends" as const,
      since: new Date(r.since).toISOString(),
    }));
  }

  friends(user: User): Promise<FriendDto[]> {
    return this.friendsOfUser(this.db, user.id);
  }

  async unfriend(user: User, otherId: string): Promise<void> {
    const p = pair(user.id, otherId);
    const removed = await this.db
      .delete(friendships)
      .where(and(eq(friendships.userAId, p.userAId), eq(friendships.userBId, p.userBId)))
      .returning({ a: friendships.userAId });
    if (removed.length === 0) throw notFound();
  }

  // -------------------------------------------------------------------------------------------
  // Blocks
  // -------------------------------------------------------------------------------------------

  /** Ends the friendship and any pending requests, both ways. The other person isn't told. */
  async block(user: User, otherId: string): Promise<void> {
    if (otherId === user.id) throw communityError(400, "not_allowed");
    await this.db.transaction(async (tx) => {
      const [other] = await tx.select({ id: users.id }).from(users).where(eq(users.id, otherId));
      if (!other) throw notFound();
      await tx
        .insert(userBlocks)
        .values({ blockerId: user.id, blockedId: other.id })
        .onConflictDoNothing();
      const p = pair(user.id, other.id);
      await tx
        .delete(friendships)
        .where(and(eq(friendships.userAId, p.userAId), eq(friendships.userBId, p.userBId)));
      await tx
        .update(friendRequests)
        .set({ status: "cancelled", respondedAt: this.clock.now() })
        .where(
          and(
            eq(friendRequests.status, "pending"),
            or(
              and(eq(friendRequests.senderId, user.id), eq(friendRequests.recipientId, other.id)),
              and(eq(friendRequests.senderId, other.id), eq(friendRequests.recipientId, user.id)),
            ),
          ),
        );
    });
  }

  async unblock(user: User, otherId: string): Promise<void> {
    await this.db
      .delete(userBlocks)
      .where(and(eq(userBlocks.blockerId, user.id), eq(userBlocks.blockedId, otherId)));
  }

  async blocks(user: User): Promise<BlockedUserDto[]> {
    const rows = await this.db
      .select({ id: userBlocks.blockedId, at: userBlocks.createdAt, name: users.displayName })
      .from(userBlocks)
      .innerJoin(users, eq(users.id, userBlocks.blockedId))
      .where(eq(userBlocks.blockerId, user.id))
      .orderBy(desc(userBlocks.createdAt));
    return rows.map((r) => ({
      userId: r.id,
      displayName: r.name ?? FALLBACK_NAME,
      blockedAt: r.at.toISOString(),
    }));
  }

  // -------------------------------------------------------------------------------------------
  // People
  // -------------------------------------------------------------------------------------------

  private async relationship(
    executor: Executor,
    me: string,
    other: string,
  ): Promise<{ relationship: Relationship; pendingRequestId: string | null }> {
    if (me === other) return { relationship: "self", pendingRequestId: null };
    const [blocked] = await executor
      .select({ id: userBlocks.blockedId })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, me), eq(userBlocks.blockedId, other)));
    if (blocked) return { relationship: "blocked", pendingRequestId: null };
    if (await this.areFriends(executor, me, other)) {
      return { relationship: "friends", pendingRequestId: null };
    }
    const pending = await this.pendingBetween(executor, me, other);
    if (pending) {
      return {
        relationship: pending.senderId === me ? "request_sent" : "request_received",
        pendingRequestId: pending.id,
      };
    }
    return { relationship: "none", pendingRequestId: null };
  }

  /** Discoverable members only (opt-in), by display name prefix. Blocks hide both ways. */
  async search(user: User, q: string, limit: number): Promise<PersonDto[]> {
    const blocked = await this.blockedIds(this.db, user.id);
    const rows = await queryRows<{ id: string; display_name: string }>(
      this.db,
      sql`SELECT u.id, u.display_name FROM users u
          JOIN social_settings s ON s.user_id = u.id AND s.discoverable
          WHERE u.status = 'active' AND u.id <> ${user.id} AND u.display_name IS NOT NULL
            AND u.display_name ILIKE ${`${likeEscape(q)}%`}
          ORDER BY u.display_name, u.id
          LIMIT ${limit + blocked.size}`,
    );
    const visible = rows.filter((r) => !blocked.has(r.id)).slice(0, limit);
    return Promise.all(
      visible.map(async (r) => ({
        userId: r.id,
        displayName: r.display_name,
        relationship: (await this.relationship(this.db, user.id, r.id)).relationship,
      })),
    );
  }

  /** A member's card. 404 when they blocked you. Mutual friends unless they hide their list. */
  async profile(user: User, otherId: string): Promise<PersonProfile> {
    const other = await this.activeUser(this.db, otherId);
    const [blockedMe] = await this.db
      .select({ id: userBlocks.blockerId })
      .from(userBlocks)
      .where(and(eq(userBlocks.blockerId, other.id), eq(userBlocks.blockedId, user.id)));
    if (blockedMe) throw notFound();
    const { relationship, pendingRequestId } = await this.relationship(this.db, user.id, other.id);
    let mutualFriends: PersonProfile["mutualFriends"] = null;
    const settings = await this.settings(this.db, other.id);
    if (
      relationship !== "self" &&
      relationship !== "blocked" &&
      settings.friendListVisibility === "friends"
    ) {
      const ids = await this.mutualFriendIds(this.db, user.id, other.id);
      const sample =
        ids.length === 0
          ? []
          : await this.db
              .select({ id: users.id, name: users.displayName })
              .from(users)
              .where(and(inArray(users.id, ids.slice(0, 5)), eq(users.status, "active")));
      mutualFriends = {
        count: ids.length,
        sample: sample.map((s) => ({
          userId: s.id,
          displayName: s.name ?? FALLBACK_NAME,
          relationship: "friends" as const,
        })),
      };
    }
    const canSendRequest =
      relationship === "none" && (await this.sendBlocker(this.db, user.id, other.id)) === null;
    return {
      userId: other.id,
      displayName: other.displayName ?? FALLBACK_NAME,
      relationship,
      pendingRequestId,
      canSendRequest,
      mutualFriends,
    };
  }

  /** A member's friend list: yours, or a friend's who shares it with friends. */
  async friendsOf(user: User, otherId: string): Promise<FriendDto[]> {
    if (otherId === user.id) return this.friends(user);
    const other = await this.activeUser(this.db, otherId);
    const settings = await this.settings(this.db, other.id);
    if (
      settings.friendListVisibility !== "friends" ||
      !(await this.areFriends(this.db, user.id, other.id))
    ) {
      throw notFound();
    }
    const blocked = await this.blockedIds(this.db, user.id);
    const friends = await this.friendsOfUser(this.db, other.id);
    return Promise.all(
      friends
        .filter((f) => !blocked.has(f.userId))
        .map(async (f) => ({
          ...f,
          relationship: (await this.relationship(this.db, user.id, f.userId)).relationship,
        })),
    );
  }
}

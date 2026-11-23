import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { geographyPoint, id, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { users } from "./users.js";

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

export const FRIEND_REQUEST_STATUS_VALUES = [
  "pending",
  "accepted",
  "declined",
  "cancelled",
  "expired",
] as const;
export const GROUP_KIND_VALUES = ["region", "route", "specialty"] as const;
export const GROUP_SPECIALTY_VALUES = [
  "heavy_haulage",
  "refrigerated",
  "hazardous_goods",
  "tankers",
  "livestock",
  "car_carriers",
  "abnormal_loads",
  "owner_operators",
  "mechanics",
  "towing_recovery",
  "fleet_management",
  "driver_training",
] as const;
export const GROUP_ROLE_VALUES = ["owner", "moderator", "member"] as const;

/** Social privacy settings (F-121). No row means the defaults. */
export const socialSettings = pgTable(
  "social_settings",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    friendRequestsFrom: text("friend_requests_from", {
      enum: ["everyone", "friends_of_friends", "nobody"],
    })
      .notNull()
      .default("everyone"),
    friendListVisibility: text("friend_list_visibility", { enum: ["friends", "only_me"] })
      .notNull()
      .default("friends"),
    discoverable: boolean("discoverable").notNull().default(false),
    ...timestamps(),
  },
  (t) => [
    check(
      "social_settings_requests_from_valid",
      sql`${t.friendRequestsFrom} IN ('everyone', 'friends_of_friends', 'nobody')`,
    ),
    check(
      "social_settings_friend_list_valid",
      sql`${t.friendListVisibility} IN ('friends', 'only_me')`,
    ),
  ],
);

/**
 * Friend requests (F-120). No message field: requests can't carry harassment (AB-05). At most
 * one pending request per pair of users, in either direction.
 */
export const friendRequests = pgTable(
  "friend_requests",
  {
    id: id(),
    senderId: uuid("sender_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: text("status", { enum: FRIEND_REQUEST_STATUS_VALUES }).notNull().default("pending"),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    respondedAt: timestamp("responded_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("friend_requests_pending_pair_key")
      .on(
        sql`least(${t.senderId}, ${t.recipientId})`,
        sql`greatest(${t.senderId}, ${t.recipientId})`,
      )
      .where(sql`${t.status} = 'pending'`),
    index("friend_requests_recipient_idx").on(t.recipientId, t.status, t.createdAt.desc()),
    index("friend_requests_sender_idx").on(t.senderId, t.status, t.createdAt.desc()),
    index("friend_requests_pair_idx").on(t.senderId, t.recipientId, t.respondedAt),
    check(
      "friend_requests_status_valid",
      sql`${t.status} IN (${list(FRIEND_REQUEST_STATUS_VALUES)})`,
    ),
    check("friend_requests_not_self", sql`${t.senderId} <> ${t.recipientId}`),
  ],
);

/** One row per friendship, stored with the smaller user ID first. */
export const friendships = pgTable(
  "friendships",
  {
    userAId: uuid("user_a_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    userBId: uuid("user_b_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.userAId, t.userBId], name: "friendships_pkey" }),
    index("friendships_user_b_idx").on(t.userBId),
    check("friendships_ordered", sql`${t.userAId} < ${t.userBId}`),
  ],
);

/** Blocks are one-directional and private: the blocked person is never told. */
export const userBlocks = pgTable(
  "user_blocks",
  {
    blockerId: uuid("blocker_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    blockedId: uuid("blocked_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.blockerId, t.blockedId], name: "user_blocks_pkey" }),
    index("user_blocks_blocked_idx").on(t.blockedId),
    check("user_blocks_not_self", sql`${t.blockerId} <> ${t.blockedId}`),
  ],
);

/** Community groups by region, route or specialty (F-122). Messaging attaches in Prompt 17. */
export const communityGroups = pgTable(
  "community_groups",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    kind: text("kind", { enum: GROUP_KIND_VALUES }).notNull(),
    specialty: text("specialty", { enum: GROUP_SPECIALTY_VALUES }),
    locationLabel: text("location_label"),
    location: geographyPoint("location"),
    joinPolicy: text("join_policy", { enum: ["open", "approval"] })
      .notNull()
      .default("open"),
    status: text("status", { enum: ["active", "hidden", "archived"] })
      .notNull()
      .default("active"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when hosted by an organization (its group quota is used). */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("community_groups_slug_key").on(t.slug),
    index("community_groups_org_idx").on(t.organizationId),
    index("community_groups_creator_idx").on(t.createdBy, t.createdAt),
    index("community_groups_status_idx").on(t.status, t.kind, t.createdAt.desc()),
    index("community_groups_location_gist").using("gist", t.location),
    check("community_groups_kind_valid", sql`${t.kind} IN (${list(GROUP_KIND_VALUES)})`),
    check(
      "community_groups_specialty_valid",
      sql`${t.specialty} IS NULL OR ${t.specialty} IN (${list(GROUP_SPECIALTY_VALUES)})`,
    ),
    check(
      "community_groups_kind_fields",
      sql`(${t.kind} = 'specialty' AND ${t.specialty} IS NOT NULL) OR (${t.kind} <> 'specialty' AND ${t.locationLabel} IS NOT NULL)`,
    ),
    check("community_groups_join_policy_valid", sql`${t.joinPolicy} IN ('open', 'approval')`),
    check("community_groups_status_valid", sql`${t.status} IN ('active', 'hidden', 'archived')`),
    check("community_groups_name_length", sql`char_length(${t.name}) BETWEEN 3 AND 80`),
    check(
      "community_groups_description_length",
      sql`${t.description} IS NULL OR char_length(${t.description}) <= 2000`,
    ),
    check("community_groups_slug_format", sql`${t.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
  ],
);

/** Members, join requests and bans. Exactly one owner per group. */
export const communityGroupMembers = pgTable(
  "community_group_members",
  {
    groupId: uuid("group_id")
      .notNull()
      .references(() => communityGroups.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role", { enum: GROUP_ROLE_VALUES }).notNull().default("member"),
    status: text("status", { enum: ["active", "pending", "banned"] })
      .notNull()
      .default("active"),
    /** The owner or moderator who approved, banned or changed the role. */
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps(),
  },
  (t) => [
    primaryKey({ columns: [t.groupId, t.userId], name: "community_group_members_pkey" }),
    uniqueIndex("community_group_members_owner_key")
      .on(t.groupId)
      .where(sql`${t.role} = 'owner'`),
    index("community_group_members_user_idx").on(t.userId, t.status),
    index("community_group_members_group_idx").on(t.groupId, t.status, t.role),
    check("community_group_members_role_valid", sql`${t.role} IN (${list(GROUP_ROLE_VALUES)})`),
    check(
      "community_group_members_status_valid",
      sql`${t.status} IN ('active', 'pending', 'banned')`,
    ),
    check(
      "community_group_members_owner_active",
      sql`${t.role} <> 'owner' OR ${t.status} = 'active'`,
    ),
  ],
);

export type SocialSettingsRow = typeof socialSettings.$inferSelect;
export type FriendRequest = typeof friendRequests.$inferSelect;
export type CommunityGroup = typeof communityGroups.$inferSelect;
export type CommunityGroupMember = typeof communityGroupMembers.$inferSelect;

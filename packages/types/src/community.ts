import { z } from "zod";

import { safeText } from "./articles.js";

/**
 * Friendships and groups (SRS J7, F-120..F-122, ADR-0023). Harassment controls (AB-05): blocks,
 * privacy settings, a daily quota on successful outgoing requests, a cap on pending requests and
 * a cooldown after a decline. Requests carry no free text.
 */

// ---------------------------------------------------------------------------------------------
// Limits
// ---------------------------------------------------------------------------------------------

/** Unanswered outgoing requests a user can have at once. */
export const MAX_PENDING_FRIEND_REQUESTS = 50;
/** Unanswered requests expire after this many days. */
export const FRIEND_REQUEST_DAYS = 30;
/** After a decline, the same sender can't ask the same person again for this many days. */
export const DECLINE_COOLDOWN_DAYS = 30;
export const MAX_FRIENDS = 5_000;
export const MAX_GROUP_MEMBERSHIPS = 200;

// ---------------------------------------------------------------------------------------------
// Privacy
// ---------------------------------------------------------------------------------------------

export const FRIEND_REQUEST_AUDIENCES = ["everyone", "friends_of_friends", "nobody"] as const;
export const FRIEND_LIST_VISIBILITY = ["friends", "only_me"] as const;

export const socialSettingsSchema = z.object({
  /** Who can send you friend requests. */
  friendRequestsFrom: z.enum(FRIEND_REQUEST_AUDIENCES),
  /** Who can see your friends (and therefore mutual friends with you). */
  friendListVisibility: z.enum(FRIEND_LIST_VISIBILITY),
  /** Appear in people search by display name. Off by default. */
  discoverable: z.boolean(),
});
export type SocialSettings = z.infer<typeof socialSettingsSchema>;

export const DEFAULT_SOCIAL_SETTINGS: SocialSettings = {
  friendRequestsFrom: "everyone",
  friendListVisibility: "friends",
  discoverable: false,
};

export const updateSocialSettingsSchema = socialSettingsSchema
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

// ---------------------------------------------------------------------------------------------
// People and friends
// ---------------------------------------------------------------------------------------------

export const RELATIONSHIPS = [
  "self",
  "none",
  "friends",
  "request_sent",
  "request_received",
  "blocked",
] as const;
export type Relationship = (typeof RELATIONSHIPS)[number];

export const personSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  relationship: z.enum(RELATIONSHIPS),
});
export type PersonDto = z.infer<typeof personSchema>;

export const personProfileSchema = personSchema.extend({
  /** Pending request between you, if any (to accept, decline or cancel). */
  pendingRequestId: z.uuid().nullable(),
  canSendRequest: z.boolean(),
  /** Null when their friend list isn't visible to you. */
  mutualFriends: z
    .object({ count: z.number().int(), sample: z.array(personSchema).max(5) })
    .nullable(),
});
export type PersonProfile = z.infer<typeof personProfileSchema>;

export const searchPeopleQuerySchema = z
  .object({
    q: safeText(50).pipe(z.string().trim().min(2)),
    limit: z.coerce.number().int().min(1).max(20).default(20),
  })
  .strict();

export const sendFriendRequestSchema = z.object({ userId: z.uuid() }).strict();

export const friendRequestSchema = z.object({
  id: z.uuid(),
  direction: z.enum(["incoming", "outgoing"]),
  person: personSchema,
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
});
export type FriendRequestDto = z.infer<typeof friendRequestSchema>;

/** Sending to someone who already asked you accepts their request instead. */
export const sendFriendRequestResultSchema = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("sent"), request: friendRequestSchema }),
  z.object({ outcome: z.literal("accepted"), friend: personSchema }),
]);
export type SendFriendRequestResult = z.infer<typeof sendFriendRequestResultSchema>;

export const friendSchema = personSchema.extend({ since: z.iso.datetime() });
export type FriendDto = z.infer<typeof friendSchema>;

export const blockedUserSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  blockedAt: z.iso.datetime(),
});
export type BlockedUserDto = z.infer<typeof blockedUserSchema>;

// ---------------------------------------------------------------------------------------------
// Groups
// ---------------------------------------------------------------------------------------------

export const GROUP_KINDS = ["region", "route", "specialty"] as const;
export const GROUP_SPECIALTIES = [
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
export const GROUP_JOIN_POLICIES = ["open", "approval"] as const;
export const GROUP_ROLES = ["owner", "moderator", "member"] as const;
export type GroupRole = (typeof GROUP_ROLES)[number];

const lngLat = z
  .object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
  .strict();

const groupName = safeText(80, { min: 3 }).pipe(z.string().trim().min(3));

export const createGroupSchema = z
  .object({
    name: groupName,
    description: safeText(2_000, { multiline: true }).nullable().default(null),
    kind: z.enum(GROUP_KINDS),
    /** Required for specialty groups. */
    specialty: z.enum(GROUP_SPECIALTIES).nullable().default(null),
    /** Region or route name, e.g. "Gauteng" or "N1 Cape Town – Johannesburg". Required for region and route groups. */
    locationLabel: safeText(120).pipe(z.string().trim()).nullable().default(null),
    /** Optional point for "groups near me" (region centre or a point on the route). */
    location: lngLat.nullable().default(null),
    joinPolicy: z.enum(GROUP_JOIN_POLICIES).default("open"),
    /** Host the group as an organization (needs `groups.host`; uses its group quota). */
    organizationId: z.uuid().nullable().default(null),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.kind === "specialty" && value.specialty === null) {
      ctx.addIssue({
        code: "custom",
        path: ["specialty"],
        message: "Required for specialty groups",
      });
    }
    if (
      value.kind !== "specialty" &&
      (value.locationLabel === null || value.locationLabel === "")
    ) {
      ctx.addIssue({
        code: "custom",
        path: ["locationLabel"],
        message: "Required for region and route groups",
      });
    }
  });
export type CreateGroup = z.input<typeof createGroupSchema>;

export const updateGroupSchema = z
  .object({
    name: groupName.optional(),
    description: safeText(2_000, { multiline: true }).nullable().optional(),
    locationLabel: safeText(120).pipe(z.string().trim().min(1)).optional(),
    location: lngLat.nullable().optional(),
    joinPolicy: z.enum(GROUP_JOIN_POLICIES).optional(),
  })
  .strict()
  .refine((value) => Object.keys(value).length > 0, "Nothing to change");

export const searchGroupsQuerySchema = z
  .object({
    q: safeText(100).pipe(z.string().trim().min(1)).optional(),
    kind: z.enum(GROUP_KINDS).optional(),
    specialty: z.enum(GROUP_SPECIALTIES).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    radiusKm: z.coerce.number().min(1).max(500).default(100),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    cursor: z.string().max(200).optional(),
  })
  .strict()
  .refine((v) => (v.lng === undefined) === (v.lat === undefined), "lng and lat go together");
export type SearchGroupsQuery = z.input<typeof searchGroupsQuerySchema>;

export const groupMemberRoleSchema = z.object({ role: z.enum(GROUP_ROLES) }).strict();

export const groupSummarySchema = z.object({
  id: z.uuid(),
  slug: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  kind: z.enum(GROUP_KINDS),
  specialty: z.enum(GROUP_SPECIALTIES).nullable(),
  locationLabel: z.string().nullable(),
  joinPolicy: z.enum(GROUP_JOIN_POLICIES),
  memberCount: z.number().int(),
  host: z.object({ id: z.uuid(), name: z.string() }).nullable(),
  createdAt: z.iso.datetime(),
});
export type GroupSummary = z.infer<typeof groupSummarySchema>;

export const groupSchema = groupSummarySchema.extend({
  status: z.enum(["active", "hidden", "archived"]),
  /** Your membership, when signed in through the member routes. */
  membership: z
    .object({
      role: z.enum(GROUP_ROLES),
      status: z.enum(["active", "pending"]),
    })
    .nullable(),
});
export type GroupDto = z.infer<typeof groupSchema>;

export const groupPageSchema = z.object({
  items: z.array(groupSummarySchema),
  nextCursor: z.string().nullable(),
});
export type GroupPage = z.infer<typeof groupPageSchema>;

export const groupMemberSchema = z.object({
  userId: z.uuid(),
  displayName: z.string(),
  role: z.enum(GROUP_ROLES),
  status: z.enum(["active", "pending", "banned"]),
  since: z.iso.datetime(),
});
export type GroupMemberDto = z.infer<typeof groupMemberSchema>;

export const communityErrorReasonSchema = z.enum([
  "cannot_befriend_self",
  "already_friends",
  "request_pending",
  "cannot_send",
  "too_many_pending",
  "too_many_friends",
  "request_not_pending",
  "too_many_groups",
  "cannot_join",
  "already_member",
  "owner_must_transfer",
  "not_allowed",
  "invalid_cursor",
]);
export type CommunityErrorReason = z.infer<typeof communityErrorReasonSchema>;

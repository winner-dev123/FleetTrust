# Friendships and groups

SRS J7, F-120..F-122. Design: [ADR-0023](../adr/0023-friendships-and-groups.md).

## Friends

| Method & path                                               | Notes                                                                                                                                           |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/me/friend-requests`                               | `{ userId }`. Display name required. Returns `{ outcome: "sent", request }`, or `{ outcome: "accepted", friend }` if they had already asked you |
| `GET /v1/me/friend-requests?direction=incoming`             | Or `outgoing`. Pending, unexpired requests                                                                                                      |
| `POST /v1/me/friend-requests/:requestId/accept`             | Recipient only                                                                                                                                  |
| `POST /v1/me/friend-requests/:requestId/decline`            | Recipient only. The sender isn't told                                                                                                           |
| `POST /v1/me/friend-requests/:requestId/cancel`             | Sender only. The quota unit isn't returned                                                                                                      |
| `GET /v1/me/friends`                                        |                                                                                                                                                 |
| `DELETE /v1/me/friends/:userId`                             | Unfriend                                                                                                                                        |
| `GET /v1/me/blocks`, `PUT` / `DELETE /v1/me/blocks/:userId` | Blocking ends the friendship and pending requests. The other person isn't told                                                                  |

**Quota:** a request that is actually sent uses one `friend_requests.daily` unit (personal free plan: 20 per day). Refusals and accepting a crossing request use none.

**Errors when sending:**

| Status | Reason                                                                                               | When                                                                                                                      |
| ------ | ---------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| 400    | `cannot_befriend_self`                                                                               |                                                                                                                           |
| 403    | `cannot_send`                                                                                        | Blocked (either way), their privacy setting, or a decline in the last 30 days. Deliberately the same answer for all three |
| 403    | `quota_exceeded`                                                                                     | `friend_requests.daily`                                                                                                   |
| 404    |                                                                                                      | No such active member                                                                                                     |
| 409    | `already_friends`, `request_pending`, `too_many_pending` (50 unanswered), `too_many_friends` (5,000) |                                                                                                                           |

Requests expire after 30 days.

## Privacy

`GET /v1/me/social-settings`, `PATCH /v1/me/social-settings`:

```json
{
  "friendRequestsFrom": "friends_of_friends",
  "friendListVisibility": "friends",
  "discoverable": true
}
```

| Setting                | Values                                                                           |
| ---------------------- | -------------------------------------------------------------------------------- |
| `friendRequestsFrom`   | `everyone` (default), `friends_of_friends`, `nobody`                             |
| `friendListVisibility` | `friends` (default: friends see your list, others see mutual friends), `only_me` |
| `discoverable`         | Appear in people search. **Off by default**                                      |

## People

| Method & path                    | Notes                                                                                                                                                                                                            |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/people?q=`              | Discoverable members whose display name starts with `q` (2–50 characters)                                                                                                                                        |
| `GET /v1/people/:userId`         | Card: `relationship` (`self`, `none`, `friends`, `request_sent`, `request_received`, `blocked`), `pendingRequestId`, `canSendRequest`, `mutualFriends` (`null` if they hide their list). 404 if they blocked you |
| `GET /v1/people/:userId/friends` | Their friends, if you're their friend and they share the list                                                                                                                                                    |

No email address or contact detail appears in any of these.

## Groups

| Method & path                                                   | Who                                                            | Notes                                                                             |
| --------------------------------------------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET /v1/groups`                                                | anyone                                                         | `q`, `kind`, `specialty`, `lng` + `lat` + `radiusKm` (near me), `limit`, `cursor` |
| `GET /v1/groups/:slug`                                          | anyone                                                         | Active groups only                                                                |
| `POST /v1/groups`                                               | signed in, display name                                        | Uses one `groups.daily` unit (personal free plan: 1 per day)                      |
| `GET /v1/me/groups`                                             | signed in                                                      | Your memberships and pending requests                                             |
| `PATCH /v1/groups/:groupId`                                     | owner, moderator                                               | Name, description, location, join policy                                          |
| `POST /v1/groups/:groupId/archive`                              | owner                                                          |                                                                                   |
| `POST /v1/groups/:groupId/join`                                 | signed in                                                      | Open groups: joined at once. Approval groups: pending                             |
| `POST /v1/groups/:groupId/leave`                                | member                                                         | The owner must hand over first (409 `owner_must_transfer`)                        |
| `GET /v1/groups/:groupId/members?status=`                       | members (`active`); owner and moderators (`pending`, `banned`) |                                                                                   |
| `POST /v1/groups/:groupId/members/:userId/approve` or `/reject` | owner, moderator                                               | Join requests                                                                     |
| `PATCH /v1/groups/:groupId/members/:userId`                     | owner                                                          | `{ role: owner \| moderator \| member }`. `owner` hands over ownership            |
| `DELETE /v1/groups/:groupId/members/:userId`                    | owner, moderator                                               | Remove                                                                            |
| `PUT` / `DELETE /v1/groups/:groupId/bans/:userId`               | owner, moderator                                               | Ban (also non-members) or unban                                                   |

Moderators act on members only; the owner acts on everyone but themselves.

**Creating a group:**

```json
{
  "name": "N1 Cape Town to Joburg drivers",
  "description": "Road conditions and stops along the N1.",
  "kind": "route",
  "specialty": null,
  "locationLabel": "N1 Cape Town – Johannesburg",
  "location": { "lng": 25.0, "lat": -30.5 },
  "joinPolicy": "approval",
  "organizationId": null
}
```

- **`kind`:** `region` and `route` need `locationLabel`; `specialty` needs `specialty`.
- **Specialties:** `heavy_haulage`, `refrigerated`, `hazardous_goods`, `tankers`, `livestock`, `car_carriers`, `abnormal_loads`, `owner_operators`, `mechanics`, `towing_recovery`, `fleet_management`, `driver_training`.
- **`organizationId`:** host as an organization. This needs `groups.host` and uses the organization's quota.

**Errors:**

- 403 `cannot_join`: you're banned, or the owner blocked you.
- 403 `not_allowed`: your role can't do this.
- 409 `already_member`, `too_many_groups` (200), `owner_must_transfer`.

## Reports and platform moderation

`POST /v1/reports` accepts `targetType`: `article`, `article_comment`, `group` or `user` (reason `impersonation` added). Moderator routes (platform role `trust_safety_moderator`):

| Method & path                                         | Notes                                        |
| ----------------------------------------------------- | -------------------------------------------- |
| `GET /v1/moderation/groups/:groupId`                  | Case: reports and decision history           |
| `POST /v1/moderation/groups/:groupId/hide`            | `{ reason }` required                        |
| `POST /v1/moderation/groups/:groupId/restore`         |                                              |
| `POST /v1/moderation/groups/:groupId/dismiss-reports` |                                              |
| `GET /v1/moderation/users/:userId`                    | Case                                         |
| `POST /v1/moderation/users/:userId/dismiss-reports`   | Warnings and suspensions come with Prompt 23 |

Three distinct reporters hide a group until a moderator decides. Member reports never act automatically.

## Data

| Table                     | Notes                                                                                                                                                                  |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `social_settings`         | Per user; no row = defaults                                                                                                                                            |
| `friend_requests`         | Sender, recipient, status (`pending`, `accepted`, `declined`, `cancelled`, `expired`), `expires_at`. One pending per pair (partial unique index on the unordered pair) |
| `friendships`             | One row per pair, smaller ID first                                                                                                                                     |
| `user_blocks`             | Blocker → blocked                                                                                                                                                      |
| `community_groups`        | Kind, specialty, location label and point (GiST index), join policy, status, creator, host organization                                                                |
| `community_group_members` | Role, status (`active`, `pending`, `banned`), who decided. One owner per group                                                                                         |

**Outbox:** `FriendRequestSent`, `FriendRequestAccepted`, `GroupJoinRequested`, `GroupMemberApproved`, `GroupModerated`, `UserModerated` (IDs only), ready for notifications (Prompt 17).

# ADR-0023: Friendships with harassment controls, and community groups with in-group moderation

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 16 builds friendships and communities (SRS J7, F-120..F-122): friend requests, blocks, mutual friends, privacy settings, request quotas, and groups by region, route or specialty with memberships and moderation.

Constraints:

- **Harassment via friend requests** (AB-05): block, mute, report, quotas on _successful_ outgoing requests, privacy settings.
- **Quota rule** (SRS J7, backlog): the daily friend-request quota counts only successful outgoing requests.
- **Not built yet:** messaging and mute (Prompt 17), member sanctions and appeals (Prompt 23).

## Decision

1. **Friend requests carry no free text.** A request is only "this person wants to be your friend", so it can't carry abuse.
2. **What counts as successful.**
   - A request that was actually created and delivered uses one `friend_requests.daily` unit. The unit is consumed in the same transaction, idempotent by request ID, so a quota refusal rolls the request back.
   - **Uses no unit:** every refusal (yourself, unknown person, blocked, privacy, cooldown, already friends, already pending, pending cap). Accepting by "sending" to someone who already asked you uses none either.
   - **Cancelling** doesn't give the unit back, so send-and-cancel loops still cost quota.
3. **Spam controls.**
   - **Pending cap:** at most 50 unanswered outgoing requests.
   - **Expiry:** requests expire after 30 days.
   - **Cooldown:** after a decline, the same sender can't ask again for 30 days.
   - **Silent declines:** the request simply leaves the sender's list.
   - **Same answer for every refusal:** block, privacy and cooldown all return `403 cannot_send`, so a sender can't tell which applies or whether they were blocked.
4. **Blocks.**
   - Blocks are one-directional, private and immediate: they end the friendship and cancel pending requests both ways.
   - **Effects:** the blocked person gets 404 for the blocker's profile, can't send requests and can't join groups the blocker owns. People search and group member lists hide blocked people in both directions.
   - `SocialService.isBlockedEitherWay` is exported for messaging (Prompt 17).
5. **Privacy settings** (`social_settings`; no row means the defaults):

   | Setting                | Values                                                                 | Default    |
   | ---------------------- | ---------------------------------------------------------------------- | ---------- |
   | `friendRequestsFrom`   | `everyone`, `friends_of_friends`, `nobody`                             | `everyone` |
   | `friendListVisibility` | `friends` (friends see the list, others see mutual friends), `only_me` | `friends`  |
   | `discoverable`         | appear in people search by display name                                | **off**    |

   **Privacy by default:** people search is opt-in. Members otherwise find each other through groups, friends and mutual friends. No email or contact detail is ever exposed.

6. **Friendships** are stored once per pair, smaller user ID first. A partial unique index allows only one pending request per pair in either direction, which also settles concurrent crossing requests.
7. **Groups.**
   - **Kinds:**
     - `region`: a name, plus an optional point for "near me".
     - `route`: a route name, plus an optional point.
     - `specialty`: one of 12 specialties.
   - **Joining:** open or by approval. Groups are public to browse; member lists are for members only.
   - **Roles:** owner (exactly one, enforced by a unique index), moderator, member.
     - Moderators approve or reject join requests, and remove or ban members.
     - The owner can also act on moderators, change roles and hand over ownership.
     - Nobody acts on someone of equal or higher rank.
   - **Owner rules:** the owner must hand over ownership before leaving, and can archive the group.
   - **Quota:** creating a group uses one `groups.daily` unit: the creator's, or the organization's for groups hosted by an organization. Hosting needs the new `groups.host` permission (owner, admin, manager).
   - **Limit:** a member can belong to (or have pending requests for) at most 200 groups.
   - **Audit:** every in-group moderation action is in `audit_events` (`group.member_banned`, `group.ownership_transferred`, …).
8. **Platform moderation is shared.**
   - Reports and the trust and safety queue moved out of the articles module into a `moderation` module. They now cover four targets:
     - articles and comments;
     - groups (3 reporters hide the group until a moderator restores it; moderators can hide or restore);
     - members (reports reach the queue and can be dismissed; warnings and suspensions are Prompt 23).
   - The `impersonation` report reason was added.

## Consequences

- **Mute isn't here.** It only matters once there are messages (Prompt 17).
- **Group member counts are public.** They describe a community, not a business, so they aren't rating data.
- **Opt-in search makes people harder to find at first.** That is the intended privacy trade-off; groups are the main way to meet.
- **Organization-hosted groups belong to their creator as owner.** The organization only lends its name and quota. Handing groups over when staff leave can follow with the CRM work if needed.

## Alternatives considered

- **Counting attempted requests:** it punishes users for others' privacy settings, and the SRS says _successful_.
- **Counting only accepted requests:** it doesn't limit spam at all.
- **Telling senders they were blocked:** it invites escalation through other channels.
- **Discoverable by default:** it exposes everyone to strangers from day one.

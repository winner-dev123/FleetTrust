# Handoff — Prompt 16: Friendships and communities

- Date: 2026-11-23
- Status: **approved** · PR **#18** squash-merged as `99af6bc` (CI 5/5 green on `d2f764e`)
- Prompt 15 approved and merged (PR #17 → `3e5d27b`).

## Assumptions

- **"Successful" outgoing request** = a request that was actually created and delivered. Refusals (blocked, privacy, cooldown, duplicates, limits) use no quota. Accepting by "sending" back to someone who already asked uses no quota either. Cancelling doesn't refund.
- **No message on requests:** requests can't carry harassment.
- **People search is opt-in** (`discoverable` off by default). Members meet through groups, friends and mutual friends.
- **One answer for every refusal:** block, privacy and cooldown all answer `403 cannot_send`, so nobody can tell they were blocked.
- **Groups** are public to browse, with member lists for members only.
- **Group hosts:** organizations can host groups (new `groups.host` permission: owner, admin, manager), using their group quota.
- **Shared moderation:** reports and moderation moved into a shared `moderation` module, now covering groups and members as well as articles and comments.
- **Not built yet:** mute and messaging (Prompt 17), member warnings, suspensions and appeals (Prompt 23), the UI (Prompts 24 and 25).

## What was built

| Area       | Details                                                                                                                                                                                                                                                                                                                              |
| ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data       | `social_settings`, `friend_requests` (one pending per pair, by partial unique index), `friendships` (one row per pair), `user_blocks`, `community_groups` (GiST location), `community_group_members` (one owner per group). Report targets widened to `group` and `user`, plus the `impersonation` reason. Migrations `0023`, `0024` |
| Friends    | Send, accept, decline (silent), cancel, unfriend, lists; crossing requests accept; 30-day expiry                                                                                                                                                                                                                                     |
| Quota      | `friend_requests.daily` consumed only when a request is created, in the same transaction (idempotent per request)                                                                                                                                                                                                                    |
| Spam       | Pending cap (50), 30-day cooldown after a decline, friend cap (5,000), rate limits, display name required                                                                                                                                                                                                                            |
| Blocks     | End the friendship and pending requests; the blocked person gets 404 on the profile, can't send, and can't join the blocker's groups; hidden from search and member lists                                                                                                                                                            |
| Privacy    | Requests from everyone, friends of friends or nobody; friend list for friends or only me; search opt-in                                                                                                                                                                                                                              |
| People     | Search (opt-in, prefix), member card with relationship, mutual friends and `canSendRequest`, friend lists. No emails                                                                                                                                                                                                                 |
| Groups     | Region, route or specialty; open or approval; search by text, kind, specialty and distance; owner, moderator and member roles; approve, reject, remove, ban, unban, role change, ownership transfer, archive; `groups.daily` quota; every in-group action audited                                                                    |
| Moderation | Shared `moderation` module. Groups: 3 reporters hide, moderators hide or restore. Members: reports reach the queue and can be dismissed                                                                                                                                                                                              |
| SDK, docs  | 29 community methods; moderation helpers cover all targets; [ADR-0023](../adr/0023-friendships-and-groups.md); [architecture/community.md](../architecture/community.md)                                                                                                                                                             |

## Acceptance criteria

| Criterion                                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Daily quotas count only successful outgoing requests | `community.e2e-spec.ts`: six refused attempts (yourself, unknown person, blocked, privacy `nobody`, already friends, cooldown) leave usage unchanged; duplicate pending refused without a unit; 20 sent → 20 used; the 21st → 403 `quota_exceeded` and the target receives nothing; a crossing request accepts without a unit; **25 concurrent sends against a limit of 20 → exactly 20 sent, 20 used**. **Checked that the tests catch a regression:** counting outside the request transaction makes these tests fail |
| Spam controls work                                   | Pending cap (50) → 409 `too_many_pending` with no unit used; silent decline and 30-day cooldown; cancel; expiry after 30 days (clock moved forward); group creation quota (second group → 403); rate limits on every write                                                                                                                                                                                                                                                                                              |
| Block controls work                                  | Blocking ends the friendship and pending requests; blocked person: profile 404, requests 403 (same answer as privacy), can't join the blocker's group; blocker sees `blocked`; unblock restores sending                                                                                                                                                                                                                                                                                                                 |
| Privacy                                              | Friends-of-friends requests (stranger refused, mutual friend allowed); search opt-in; friend list hidden from non-friends and, with `only_me`, from friends; mutual friends hidden with `only_me`; no email in people responses; suspended members disappear                                                                                                                                                                                                                                                            |
| Group memberships and moderation                     | Approval flow; member list for members only (outsiders and pending 404); moderators can't promote, can't act on the owner; ban stops rejoining, unban; removal; owner must transfer before leaving; ownership transfer; archive; audit events for each action; organization-hosted groups use the organization's quota and need `groups.host`                                                                                                                                                                           |
| Platform moderation                                  | 3 group reports hide the group, moderator restores (history: `auto_flag`, `restore`), hide needs a reason; reporting yourself or your own group refused; member reports reach the queue and can be dismissed; non-moderators 404. All 25 article tests still pass after moving moderation into its own module                                                                                                                                                                                                           |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                       |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **267** (+11 community e2e), types **60** (+4), sdk **23** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                          |

## Migration notes

- **`0023`** adds six tables and widens the `content_reports` and `moderation_actions` checks (targets `group`, `user`; reason `impersonation`). drizzle-kit quoted the geography type again, so it was unquoted by hand.
- **`0024`** adds `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- **Nothing new to configure.**
- **Optional:** review the sample limits (friend requests 20 per day on the free plan and 100 on pro; groups 1 per day on free plans and 5 on pro).
- **Optional:** review the pending cap (50), the cooldown and expiry (30 days) and the membership cap (200) in `packages/types/src/community.ts`.

## Next: Prompt 17 — Messaging and community notifications

Direct and group messaging with durable history, WebSocket delivery, attachment permissions, read receipts, inbox notifications, opt-out controls and abuse reporting. It builds on the request recipients (Prompt 14), blocks (`SocialService.isBlockedEitherWay`) and the outbox events queued so far.

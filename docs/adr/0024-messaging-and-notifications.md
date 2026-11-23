# ADR-0024: Messaging with derived access, per-conversation sequence cursors, WebSocket replay, and outbox-driven notifications

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 17 builds messaging (SRS F-053..F-055, F-123): direct and group messaging, durable history, WebSocket delivery, attachment permissions, read receipts, inbox notifications, opt-outs and abuse reporting.

The acceptance criteria are:

- no unauthorized conversation access;
- reconnect and replay work;
- message delivery is tested.

ADR-0007 proposed WebSockets on Cloud Run, Redis pub/sub for fan-out and FCM for push. Request-linked conversations attach to the recipient rows from Prompt 14; blocks come from Prompt 16.

## Decision

1. **Conversation kinds.** Each kind is anchored to an existing relationship and is unique per anchor.

   | Kind      | Anchor                      | Who can read                                                                                                                                                 |
   | --------- | --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
   | `direct`  | the pair of users           | the two people                                                                                                                                               |
   | `request` | a service request recipient | the requester side (the individual, or fleet members allowed to see that request) and that provider's members with `requests.respond` (branch scope applies) |
   | `group`   | a community group           | the group's active members                                                                                                                                   |

2. **Access is derived, never stored.**
   - Every REST call and every socket subscription computes access from the anchor at that moment. Removed members, closed requests and blocks take effect immediately on REST.
   - On the socket, access is re-checked when a live event arrives and the last check is older than 30 seconds.
   - Anything without access is 404.
   - **Read-only cases:** a closed request (cancelled, completed, expired, or the provider declined or wasn't selected) and an archived group can be read but not written to (409 `conversation_read_only`).
   - **Direct messages** need the other person's `directMessagesFrom` setting to allow it (default **friends**) and no block either way (403 `cannot_message`).
3. **Durable, ordered history.**
   - Each conversation hands out sequence numbers (`last_seq + 1` in the sending transaction), so every message has a gap-free `seq`. That seq is the replay cursor.
   - **Idempotent sending:** sends carry a client-generated `clientMessageId` (unique per sender and conversation), so retries return the original message.
   - **Kept as evidence:** deleted, removed and hidden messages keep their text but show `body: null`.
4. **Realtime delivery: WebSocket at `/v1/realtime`.**
   - **Authentication:** the first frame must be `{type:"auth", token}`, so Firebase ID tokens never appear in URLs or access logs. Otherwise the socket closes with code 4401. Origins outside `CORS_ORIGINS` are refused.
   - **Subscribing:** `subscribe {conversationId, after}` listens on the bus first, replays every message with `seq > after` (up to 500, then `replay_truncated` tells the client to page over REST), sends `subscribed`, then streams live events. Duplicates between replay and live are dropped by seq.
   - **Fan-out:** a `RealtimeBus` port, implemented with Redis pub/sub when `REDIS_URL` is set (required when deployed) and in memory otherwise. Channels are `conversation:<id>` and `user:<id>` (inbox updates).
   - **Limits:** heartbeat pings every 30 s, at most 100 subscriptions and 200 frames per 10 s per socket, frames up to 16 KB.
   - **Cloud Run:** the request timeout is 60 minutes; clients reconnect and replay.
5. **Read receipts** are mutual and only shown in direct and request conversations. You see the other side's read position only if you and they both have `readReceipts` on. Groups never show them.
6. **Attachments.**
   - Uploaded into one conversation by someone who may send there: images and PDF, up to 8 MB, 4 per message.
   - **Processing:** quarantine, type sniffing, malware scan, image metadata stripping, then the private bucket.
   - **Downloads:** they check conversation access every time and require a visible message (or your own unsent upload). Responses are `private, no-store` and `nosniff`.
   - **Single use:** an attachment can be attached to one message only.
7. **Notifications.**
   - **Outbox relay:** domain events in the outbox (from Prompts 14–17) are processed by an `OutboxRelay`. It runs in the worker role, polling with `FOR UPDATE SKIP LOCKED`, one transaction per event, retrying with exponential backoff.
   - **Inbox rows:** for friend, group, comment, moderation and service-request events. They are idempotent per event and user, so a re-processed event never notifies twice.
   - **New messages aren't inbox rows:** the unread conversation is the notification. They do produce push and a `user:<id>` inbox frame.
   - **Push:** through a `PushSender` port: FCM (`PUSH_PROVIDER=fcm`, required when deployed), addressed by **Firebase Installation ID** (the current Admin SDK target; registration tokens are deprecated), or recorded in development and tests. Installations FCM reports as gone are deleted.
   - **Opt-outs:** per-category push switches (`pushMessages`, `pushRequests`, `pushCommunity`), per-conversation mute, and blocks.
   - **Lock-screen privacy:** pushes say "New message" unless the user turns `pushPreviews` on.
8. **Abuse controls.**
   - **Reporting:** a participant can report someone else's message from inside the conversation. Reports go to the shared queue (target `message`). The generic `/v1/reports` route refuses message targets, so message IDs can't be probed.
   - **Moderator access:** opening a message case is audited (`moderation.message_viewed`), because it is private content (SRS §2.3).
   - **Moderation outcomes:** moderators hide or restore; three reporters hide a message automatically.
   - **In-group moderation:** group owners and moderators can remove messages (audited `group.message_removed`).
   - **Blocks** hide a blocked person's messages from the blocker in group chats.
   - **Payment-scam heuristic (AB-07):** messages that ask for money with a link or account number carry `warnings: ["payment_request"]`. Direct and request conversations always carry the scam warning text.

## Consequences

- **Access checks cost queries on every call.** That is acceptable at pilot scale; caching per socket covers the hot path. Very large groups may need a membership cache later.
- **The relay polls.** Production can move to Pub/Sub push by calling `drain()` from an authenticated worker endpoint (Prompt 29) without changing handlers.
- **Clients must register their FID,** not a registration token (`@react-native-firebase/installations` / `getId()`, Prompt 25).
- **Group message retention and export** come with privacy work (Prompt 27).

## Alternatives considered

- **Storing participant lists:** fast, but they go stale as memberships, branch scopes and request states change, which risks the "no unauthorized access" criterion.
- **Firestore for chat:** rejected in ADR-0007; it would split authorization and history.
- **Tokens in the WebSocket URL:** they leak into proxies and logs.
- **Timestamp cursors:** ambiguous under concurrent writes. Per-conversation sequence numbers are exact.

# Messaging and notifications

SRS F-053..F-055, F-123. Design: [ADR-0024](../adr/0024-messaging-and-notifications.md).

## Conversations

| Method & path                                                   | Notes                                                                                                                      |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/conversations`                                         | Yours, most recent first: `unread`, `lastSeq`, `lastReadSeq`, `peerReadSeq`, `muted`, `canSend`, `warning`                 |
| `POST /v1/conversations/direct`                                 | `{ userId }`. Finds or starts. 403 `cannot_message` if blocked or their setting doesn't allow it (default: friends only)   |
| `POST /v1/conversations/request`                                | `{ recipientId }`. Requester side and that provider only                                                                   |
| `POST /v1/conversations/group`                                  | `{ groupId }`. Active members only                                                                                         |
| `GET /v1/conversations/:id`                                     | 404 without access                                                                                                         |
| `PATCH /v1/conversations/:id`                                   | `{ muted }`                                                                                                                |
| `GET /v1/conversations/:id/messages`                            | `after` (replay forwards), `before` (older), `limit` ≤ 100 → `{ items, more }`, ordered by `seq`                           |
| `POST /v1/conversations/:id/messages`                           | `{ clientMessageId, body, attachmentIds? }` (60 per minute). Retrying with the same `clientMessageId` returns the original |
| `DELETE /v1/conversations/:id/messages/:messageId`              | Your own (→ `deleted`); group owners and moderators remove others' (→ `removed`, audited)                                  |
| `POST /v1/conversations/:id/messages/:messageId/report`         | `{ reason, details? }`. Not your own                                                                                       |
| `POST /v1/conversations/:id/read`                               | `{ seq }`. Never moves back                                                                                                |
| `POST /v1/conversations/:id/attachments`                        | `{ contentType: image/jpeg\|png\|webp \| application/pdf, size ≤ 8 MB }` → `{ attachmentId, upload }`                      |
| `POST /v1/conversations/:id/attachments/:attachmentId/complete` | Scan, strip metadata, store privately                                                                                      |
| `GET /v1/conversations/:id/attachments/:attachmentId`           | Participants, visible messages only; `private, no-store`                                                                   |

**Request conversations:** people speak for their side.

- Messages show `sender.userId: null`.
- The provider's business name is shown to the requester; "Customer" (or the fleet's name) is shown to the provider.
- The requester's identity and contact details stay private.
- When the request closes, the conversation becomes read-only (409 `conversation_read_only`).

**Message statuses:**

| Status    | Meaning                               |
| --------- | ------------------------------------- |
| `visible` | Shown normally                        |
| `deleted` | Deleted by the sender                 |
| `removed` | Removed by a group owner or moderator |
| `hidden`  | Hidden by a FleetTrust moderator      |

Only `visible` messages have a `body`.

**Scam warning:** messages asking for money with a link or account number carry `warnings: ["payment_request"]`. Show the conversation's `warning` text next to them.

## Realtime: `wss://<api>/v1/realtime`

JSON text frames. **The first frame must be `auth`.** Never put the token in the URL.

```json
→ { "type": "auth", "token": "<Firebase ID token>" }
← { "type": "ready", "userId": "…" }
→ { "type": "subscribe", "conversationId": "…", "after": 41 }
← { "type": "message", "conversationId": "…", "message": { "seq": 42, … }, "replay": true }
← { "type": "subscribed", "conversationId": "…", "lastSeq": 42 }
← { "type": "message", "conversationId": "…", "message": { "seq": 43, … }, "replay": false }
→ { "type": "read", "conversationId": "…", "seq": 43 }
← { "type": "receipt", "conversationId": "…", "side": "peer", "seq": 43 }
← { "type": "message_updated", "conversationId": "…", "message": { "status": "hidden", "body": null, … } }
← { "type": "inbox", "conversationId": "…", "lastSeq": 44 }
← { "type": "notification", "notification": { … } }
→ { "type": "ping" }   ← { "type": "pong" }
```

**Reconnecting:** keep the highest `seq` you have per conversation. After reconnecting, subscribe with `after` set to it; the missed messages arrive first, in order, then live ones. If you get `replay_truncated`, page the rest over REST with `after=nextAfter`.

**Errors:** `{ type: "error", code: "not_found", conversationId }` means no access.

| Close code | Meaning                            |
| ---------- | ---------------------------------- |
| 4401       | Not authenticated or invalid token |
| 4403       | Suspended account                  |
| 4400       | Invalid frame                      |
| 4429       | Too many frames                    |

The server pings every 30 s. A connection lasts at most 60 minutes on Cloud Run; reconnect and resume.

## Inbox, opt-outs and push

| Method & path                                                              | Notes                                                                                                                                         |
| -------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/inbox`                                                         | `{ notifications (latest 50), unreadNotifications, unreadConversations }`                                                                     |
| `POST /v1/me/notifications/:id/read`, `POST /v1/me/notifications/read-all` |                                                                                                                                               |
| `GET` / `PATCH /v1/me/messaging-preferences`                               | See below                                                                                                                                     |
| `PUT /v1/me/devices`                                                       | `{ fid, platform: ios \| android \| web }`. The Firebase Installation ID of the app. Re-registering on a new sign-in moves it to the new user |
| `POST /v1/me/devices/unregister`                                           | `{ fid }` (sign-out)                                                                                                                          |

| Preference                                      | Default   | Meaning                                                                    |
| ----------------------------------------------- | --------- | -------------------------------------------------------------------------- |
| `directMessagesFrom`                            | `friends` | `everyone`, `friends` or `nobody`. Request and group chats aren't affected |
| `readReceipts`                                  | on        | Mutual: off hides your reads and theirs                                    |
| `pushPreviews`                                  | **off**   | Off: pushes say "New message"                                              |
| `pushMessages`, `pushRequests`, `pushCommunity` | on        | Per-category push. The inbox always records                                |

**Notification kinds:** `friend_request`, `friend_accepted`, `group_join_request`, `group_approved`, `article_comment`, `content_moderated`, `service_request`, `quote_received`, `quote_accepted`, `provider_cancelled`. New messages aren't inbox rows: unread conversations are.

## Outbox relay (worker)

The worker role (`APP_ROLE=worker`) drains the outbox every `OUTBOX_RELAY_INTERVAL_MS` (default 2000).

- Each event runs in its own transaction (`FOR UPDATE SKIP LOCKED`, safe with several workers).
- Inbox rows are idempotent per event.
- Push and realtime effects run after the commit.
- Failures back off up to an hour; `outbox_events.last_error` keeps the reason.
- On Cloud Run the worker needs `run.googleapis.com/cpu-throttling: "false"`.

## Configuration

| Variable                   | Default | Notes                                                                               |
| -------------------------- | ------- | ----------------------------------------------------------------------------------- |
| `PUSH_PROVIDER`            | `log`   | `fcm` required in staging and production. `log` records pushes and never sends them |
| `OUTBOX_RELAY_INTERVAL_MS` | `2000`  | Worker polling interval (200–60,000)                                                |
| `REDIS_URL`                | —       | Enables Redis pub/sub fan-out across instances (already required when deployed)     |
| `CORS_ORIGINS`             | —       | Also restricts browser WebSocket origins                                            |

## Moderation

- **Reports:** a reported message appears in the shared queue as `targetType: "message"`.
- **Moderator routes:** `GET /v1/moderation/messages/:id` (audited view), and `POST /v1/moderation/messages/:id/hide`, `/restore` and `/dismiss-reports`.
- **Automatic hiding:** three distinct reporters hide a message until a moderator decides.

## Data

| Table                   | Notes                                                                                                                       |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `conversations`         | Kind and anchor (direct pair, request recipient, or group; each unique), `last_seq`, `last_message_at`                      |
| `messages`              | `seq` unique per conversation, `client_message_id` unique per sender, sender side (request conversations), status, warnings |
| `message_attachments`   | Conversation, uploader, message (once attached), pipeline state, private storage key                                        |
| `conversation_states`   | Per user: `last_read_seq`, `muted`                                                                                          |
| `messaging_preferences` | Per user; no row = defaults                                                                                                 |
| `notifications`         | Inbox rows; unique per user and source event                                                                                |
| `push_devices`          | Firebase Installation IDs per user                                                                                          |

# Handoff — Prompt 17: Messaging and community notifications

- Date: 2026-11-23
- Status: **awaiting owner approval** · branch `feat/prompt-17-messaging`
- Prompt 16 approved and merged (PR #18 → `99af6bc`).

## Assumptions

- **Three conversation kinds:**
  - direct;
  - request-linked: one per service request recipient, joining the requester side with that provider;
  - group: one per community group.
- **Access is never stored:** it is worked out each time from the friendship, request or group membership, so changes take effect immediately.
- **Direct-message privacy:** direct messages from friends only by default (AB-05). Users can open them to everyone or close them.
- **Request chats stay private:** people speak for their side ("Customer", or the business name), and the requester's identity and contact details stay hidden.
- **Push targets:** FCM addresses **Firebase Installation IDs** (the current Admin SDK target; registration tokens are deprecated there). The mobile app registers its installation ID (Prompt 25).
- **Lock-screen previews are off by default:** pushes say "New message".
- **Not built yet:** the UI (Prompts 24 and 25). Emergency messaging and quota exemptions are Prompt 18; it can reuse this transport. Message retention and export are Prompt 27.

## What was built

| Area          | Details                                                                                                                                                                                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data          | `conversations`, `messages`, `message_attachments`, `conversation_states`, `messaging_preferences`, `notifications`, `push_devices`; report target `message`. Migrations `0025`, `0026`                                                                                                                            |
| History       | Per-conversation sequence numbers (gap-free, the replay cursor); idempotent sends by `clientMessageId`; paging forwards (`after`) and backwards (`before`)                                                                                                                                                         |
| Realtime      | WebSocket `/v1/realtime`: token in the first frame, never the URL; origin check; subscribe with a cursor → replay then live, with no duplicates; access re-checked on delivery; heartbeat; subscription, frame-rate and size limits. Fan-out via the realtime bus (Redis pub/sub when deployed, in memory locally) |
| Receipts      | Mutual and opt-out; direct and request chats only                                                                                                                                                                                                                                                                  |
| Attachments   | Images and PDF, scanned and stripped, private, access-checked on every download, single use; deleting the message hides them                                                                                                                                                                                       |
| Notifications | Outbox relay (worker role, `SKIP LOCKED`, backoff); idempotent inbox rows for friend, group, comment, moderation and service-request events; push via FCM (recorded locally) with per-category opt-outs, mute and previews off by default; gone installations cleaned up; realtime inbox frames                    |
| Abuse         | Report a message from inside the conversation (generic route refuses message targets); audited moderator view; hide, restore and 3-report auto-hide; group owners and moderators remove messages (audited); blocks hide blocked people in groups; payment-request warning (AB-07)                                  |
| Platform      | `RealtimeModule` (`REALTIME_BUS`), `PushModule` (`PUSH_SENDER`), env `PUSH_PROVIDER` (`fcm` required when deployed) and `OUTBOX_RELAY_INTERVAL_MS`; Cloud Run timeout raised to 60 minutes for sockets; the identity module now global (the gateway verifies tokens). New dependency: `ws` 8.23.0                  |
| SDK, docs     | 21 messaging and notification methods, plus `realtimeUrl()`; [ADR-0024](../adr/0024-messaging-and-notifications.md); [architecture/messaging.md](../architecture/messaging.md)                                                                                                                                     |

## Acceptance criteria

| Criterion                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No unauthorized conversation access | `messaging.e2e-spec.ts`: strangers get 404 on the conversation, history, sending and read; unauthenticated 401; socket subscription → `not_found`; non-friends can't open direct messages until allowed; blocked → 403 and read-only; group outsiders 404; removed members lose read and send; another provider can't open or read a request conversation; attachments 404 for strangers and for unsent uploads; message reports only from inside. **Checked that the tests catch a regression:** dropping the participant check makes the access test fail |
| Reconnect and replay work           | Live delivery to a subscribed socket; after disconnecting, three messages (from both sides) are replayed **exactly**, in order, after the client's cursor, then live delivery continues; concurrent duplicate sends return one message; ordered `seq` 1..6; paging backwards. **Checked that the tests catch a regression:** ignoring the cursor makes the replay test fail                                                                                                                                                                                 |
| Message delivery tests pass         | Group delivery; `message_updated` on removal and moderation; receipts live and in the conversation, none when turned off; sockets refuse missing or invalid auth (4401), garbage (4400) and other paths                                                                                                                                                                                                                                                                                                                                                     |
| Notifications and opt-outs          | Friend request → inbox row, realtime notification and push to the registered installation; gone installation removed; re-processing an event doesn't duplicate; message push "New message" (previews off) and the text with previews on; `pushMessages` off → no push; muted conversation → no push; unread counts and mark-read; service request → provider notified, quote → requester notified                                                                                                                                                           |
| Abuse reporting                     | Payment-request warning set (and not for ordinary bank mentions); report → moderator's audited view → hide → `message_updated` over the socket and `hidden` in history                                                                                                                                                                                                                                                                                                                                                                                      |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                   |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **278** (+11 messaging e2e over real WebSockets), types 60, sdk **24** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                      |

## Migration notes

- **`0025`** adds seven tables and widens the report and moderation target checks to `message`.
- **`0026`** adds `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- **Set `PUSH_PROVIDER=fcm`:** done in `deploy/cloudrun/api.service.yaml`. The Cloud Run service account needs permission to send FCM messages (Firebase Cloud Messaging API enabled in the project).
- **Deploy the worker** (same image, `APP_ROLE=worker`, internal ingress) with `run.googleapis.com/cpu-throttling: "false"`, so the outbox relay runs. Without it, notifications and push wait in the outbox.
- **Redis** (already required) carries realtime fan-out between API instances.

## Next: Prompt 18 — Emergency assistance and trusted circles

Emergency requests with no ordinary quota, trusted contacts by mutual consent, FCM push with email fallback and escalation, and safety-oriented abuse protections. It can reuse the push sender, the outbox relay and the messaging transport.

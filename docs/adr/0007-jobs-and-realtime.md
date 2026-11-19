# ADR-0007: Background jobs, notifications and realtime delivery

- Status: **Proposed**. Confirm in Prompt 03/05 once local-infrastructure parity is tested
- Date: 2026-11-19

## Context

The platform needs several kinds of asynchronous and realtime work:

- **Background jobs:** upload scanning, reminders, badge expiry, quota resets, emergency escalation timers, and email/push fan-out.
- **Realtime messaging:** WebSocket delivery with reconnect and replay.

Cloud Run scales to zero and throttles CPU between requests by default. That makes long-running in-process queue consumers, such as BullMQ workers, costly or unreliable unless CPU is always allocated.

## Decision (proposed)

- **Jobs** go through a `JobQueue` port:
  - **Production:** Cloud Tasks for delayed or targeted jobs such as escalation timers and reminders. Pub/Sub push for event fan-out from the transactional outbox. Both push HTTP to the `worker` role ([ADR-0002](0002-modular-monolith-api.md)).
  - **Local and tests:** an in-process/Redis-backed adapter with the same at-least-once semantics.
- **All job handlers are idempotent.** Each job carries an idempotency key, stored with a unique constraint.
- **Emergency jobs** go on a dedicated high-priority Cloud Tasks queue with its own retry policy and alerting ([ADR-0010](0010-emergency-exempt-from-quotas.md)).
- **Realtime:**
  - WebSockets are served by the `api` role on Cloud Run, which supports WebSockets with a request timeout of up to 60 minutes. Clients reconnect automatically.
  - Redis pub/sub on Memorystore fans messages out across instances.
  - Durable message history lives in Postgres; clients replay from their last-seen cursor on reconnect.
- **Push** uses FCM. Delivery outcomes are recorded so email fallback can be triggered.

## Consequences

- The local adapter differs from production. Contract tests must run against both, or against the Cloud Tasks HTTP shape, to avoid drift.
- Memorystore has a fixed hourly cost. If budget is tight ([OQ-07](../product/open-questions.md)), consider a smaller managed Redis or deferring Redis until messaging (Prompt 17), using Postgres-backed rate limiting in the meantime.

## Alternatives considered

- **BullMQ workers on Cloud Run with always-on CPU**: viable and simpler locally, but adds always-on cost. Kept as a fallback.
- **Firestore listeners for realtime chat**: rejected. It would create a second store for messages and split authorization.

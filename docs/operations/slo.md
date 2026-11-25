# Service level objectives and measurements

Targets come from [SRS §7](../product/SRS.md#7-non-functional-requirements). The latency targets are server-side, at pilot volume: 10k users, 1k provider organisations, 100 requests/s peak. Measurements come from the load harness in [tools/perf](../../tools/perf). It runs on every pull request in the CI job "Load tests and restore drill" ([performance.yml](../../.github/workflows/performance.yml)), and the job summary shows each run's table.

## Objectives

| Area                          | SLO                                                                     | Window         | Measured by                                                        |
| ----------------------------- | ----------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------ |
| Availability: API and web     | 99.5 % of requests succeed (non-5xx; 503 `overloaded` counts as failed) | 30 days        | Cloud Run request logs (Prompt 29 alerting)                        |
| Availability: emergency path  | 99.9 % of alerts have a push send attempted                             | 30 days        | `incident_deliveries` (sent or failed ÷ created)                   |
| Provider search near a point  | p95 ≤ 400 ms, p99 ≤ 1 s, errors ≤ 0.5 %                                 | Rolling 1 hour | Harness `search`; production: Cloud Run latency for `/v1/search/*` |
| Writes (e.g. service request) | p95 ≤ 500 ms, p99 ≤ 1 s, errors ≤ 0.5 %                                 | Rolling 1 hour | Harness `requestCreate`, `messageSend`                             |
| Live message delivery         | p95 ≤ 1 s from send to every subscribed socket; none lost               | Rolling 1 hour | Harness `messageDelivery`                                          |
| Emergency fan-out             | p95 ≤ 10 s from alert to push send; email fallback within 60 s          | Every alert    | Harness `emergencyFanout`; `incident_deliveries` timestamps        |
| Quota correctness             | Never more than the daily limit, under any concurrency                  | Always         | Harness `requestBurst` (gates CI)                                  |
| Recoverability                | RPO ≤ 15 min, RTO ≤ 4 h                                                 | Per incident   | Restore drill (below) and the Cloud SQL PITR drill on staging      |

**Error budget:** 99.5 % over 30 days is about 3.6 hours of failed requests. When more than half the budget is gone, feature releases wait until reliability work brings it back (owner decision at launch).

## Measurements (CI runner)

The runner is a standard GitHub-hosted Linux machine (the CPU count is printed in each report). PostgreSQL 17 + PostGIS, the API (api role), the worker, the Auth emulator and the load generator all share it, and the API pool is the default 5 connections. Production has separate Cloud Run instances and Cloud SQL, so these are conservative numbers, not production numbers.

<!-- MEASUREMENTS -->

## What the load tests found (fixed in Prompt 28)

1. **Pool exhaustion was a 500.** 250 simultaneous creates need more connections than the pool's 5, and the ones that waited more than 5 s failed as unexpected errors. Transient database pressure now answers **503 `overloaded` with `Retry-After: 1`** (ADR-0035). Clients retry with the same idempotency key, so quota is never consumed twice. In the burst test every user ends with exactly the daily limit.
2. **Live messages could be lost under concurrent sends.** Messages commit in seq order but can be published out of order, and the realtime gateway dropped the late one. It now delivers strictly in seq order and fills gaps from the database after `GAP_WAIT_MS`.
3. **Unlimited limits were enforced as zero.** An override or plan limit of "unlimited" (`null`) became 0 when enforced: every daily-quota use and capacity addition was refused, although the entitlements page showed "unlimited". It is fixed, and the entitlements test now proves unlimited enforcement.

## Capacity notes and levers

- **Search cost grows with the number of branches inside the radius.** Every candidate is scored (distance, coverage, open now, text). At pilot volume a 25 km search ranks about 180 branches and meets the target. At 20× density (20,000 branches in one metro area, about 3,300 per search) it does not. If real density approaches that:
  - pre-filter to the nearest K candidates before scoring (changes ranking semantics, ADR-0019);
  - precompute open-now per branch each minute instead of calling `branch_is_open` per row;
  - shrink the default radius in dense areas.
- **Pool size versus Cloud Run concurrency.** `DB_POOL_MAX` is 5 per instance. With Cloud Run's default concurrency of 80, a burst can queue for connections. Keep `max instances × DB_POOL_MAX` under the Cloud SQL connection limit, and set Cloud Run concurrency to about 4–8 × the pool size (Prompt 29). Sustained 503 `overloaded` responses are the signal to change it (alert in [observability.md](observability.md)).
- **Quota race.** Requests from one user are serialised on that user's daily counter row until their transaction commits. That's correct but slow when one user fires many at once. Real clients send one at a time, with offline drafts and idempotency keys.

## Reliability tests (chaos and retry)

Each test breaks one dependency mid-flow and checks three things: the failure is visible, nothing is left half-done, and the retry succeeds.

| Failure                                         | Expected behaviour                                                      | Test                                                                       |
| ----------------------------------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Database pool exhausted / serialization failure | 503 `overloaded` + Retry-After, no error report; next request succeeds  | `apps/api/test/chaos.e2e-spec.ts`                                          |
| Outbox handler fails (database blip)            | Event kept with the error, retried after backoff, notifies exactly once | `chaos.e2e-spec.ts`                                                        |
| Push provider down (messages)                   | Message stored, inbox updated, relay not blocked; later pushes go out   | `chaos.e2e-spec.ts`                                                        |
| Object storage write fails (attachment)         | 500, upload stays pending, retry makes it available                     | `chaos.e2e-spec.ts`                                                        |
| Key service (KMS) fails                         | Nothing written in the clear, upload stays pending, retry works         | `chaos.e2e-spec.ts`                                                        |
| Malware scanner down                            | Fails closed (not available), retry works                               | `chaos.e2e-spec.ts`                                                        |
| Realtime events out of order or lost            | Delivered in seq order; gap filled from the database                    | `messaging.e2e-spec.ts` ("delivers in seq order…")                         |
| Push down for emergency alerts                  | Retries 5 s → 15 s → 45 s → 135 s, then email fallback; no duplicates   | `emergency.e2e-spec.ts`                                                    |
| Database down or hanging                        | `/health/ready` 503 quickly, liveness stays up                          | `readiness.e2e-spec.ts`                                                    |
| Routing vendor fails or is slow                 | Straight-line fallback route, flagged approximate, within the timeout   | `routes.e2e-spec.ts`                                                       |
| Rate-limit store (Redis) down                   | Requests allowed (fail open) with a warning; nothing blocked            | `chaos.e2e-spec.ts`                                                        |
| Realtime bus (Redis) publish fails              | Logged; clients get the message on their next replay or gap fill        | Code path in `realtime-bus.ts`; gap fill tested in `messaging.e2e-spec.ts` |

## Disaster recovery

- **Logical restore drill: automated, every CI run.** See the [backup and restore runbook](backup-restore-runbook.md#drill-log) for what it checks and the latest result.
- **Cloud SQL point-in-time restore:** owner drill on staging once Prompt 29 creates it. Record the result in the runbook's drill log.

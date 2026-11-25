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

**Reference run:** 2026-11-25, commit `4bc2c48` (PR #30). The runner has 4 vCPU and 16 GiB. Search is measured at 1,000 provider branches (pilot volume) and at 20,000 (stress). Latencies are milliseconds, measured at the client (they include HTTP and JSON).

| Scenario                                           | Load                                               | Samples | p50   | p95    | p99    | Error rate | Target p95 / p99 | Result                          |
| -------------------------------------------------- | -------------------------------------------------- | ------- | ----- | ------ | ------ | ---------- | ---------------- | ------------------------------- |
| Provider search, pilot volume (≈174 ranked/search) | 16 concurrent visitors, 30 s, 25 km, random points | 2,960   | 160   | 195    | 233    | 0          | 400 / 1,000      | **Met**                         |
| Provider search, 20× density (≈3,720 ranked)       | Same                                               | 856     | 560   | 693    | 762    | 0          | 400 / 1,000      | Missed p95                      |
| Create a service request (match + quota)           | 8 in flight, 1,500 requests                        | 1,500   | 336   | 458    | 514    | 0          | 500 / 1,000      | **Met**                         |
| Burst: 250 creates at once (quota race)            | 25 users × 10 at the same instant                  | 250     | 5,576 | 10,033 | 10,048 | 0          | 5,000 / 10,000   | Missed (stress case, see below) |
| Send a message                                     | 10 senders, 100 messages, one group                | 100     | 38    | 55     | 66     | 0          | 500 / 1,000      | **Met**                         |
| Message delivered to every member's socket         | 50 subscribers, 4,910 deliveries                   | 4,910   | 37    | 57     | 66     | 0          | 1,000 / 2,000    | **Met**                         |
| Emergency alert → push sent                        | 40 alerts at once × 5 contacts                     | 200     | 278   | 387    | 392    | 0          | 10,000 / 15,000  | **Met**                         |

**Correctness (gates CI), all passing:**

- **Search:** every search returned providers.
- **Quota burst:** no user exceeded the daily limit of 3, and every user got exactly 3. The responses were 75 × 201, 175 × 403 `quota_exceeded` and 98 × 503 `overloaded`, each overloaded request retried and answered.
- **Messaging:** every subscribed member received every message.
- **Emergency:** all 200 trusted contacts' pushes were sent.

**Run-to-run variation.** Hosted runners vary. Earlier runs on this PR, with the same scenarios on slower runners, measured:

| Scenario          | Slower runners, p95 |
| ----------------- | ------------------- |
| Pilot search      | up to 377 ms        |
| 20× search        | up to 1,530 ms      |
| Request creation  | up to 907 ms        |
| Message delivery  | up to 93 ms         |
| Emergency fan-out | up to 581 ms        |

Correctness was the same in every run once the defects below were fixed. On the slowest runner, pilot search still met its target, but request creation did not. Request creation should be re-measured on staging before calling the write SLO met in production.

**The burst case is a stress test, not normal traffic.** One instance with 5 connections receives 250 transactions at the same moment. About 100 are shed with 503 and retried after a second, so the p95 includes up to two retry waits. What it proves is correctness under the race, and that overload produces retryable answers instead of errors.

**Not measured here:** availability (needs production traffic; Cloud Run and uptime checks in Prompt 29) and email fallback timing (covered by `emergency.e2e-spec.ts` with a controlled clock).

## What the load tests found (fixed in Prompt 28)

1. **Pool exhaustion was a 500.** 250 simultaneous creates need more connections than the pool's 5, and the ones that waited more than 5 s failed as unexpected errors. Transient database pressure now answers **503 `overloaded` with `Retry-After: 1`** (ADR-0035). Clients retry with the same idempotency key, so quota is never consumed twice. In the burst test every user ends with exactly the daily limit.
2. **Live messages could be lost under concurrent sends.** Messages commit in seq order but can be published out of order, and the realtime gateway dropped the late one as a "duplicate". It now delivers strictly in seq order and fills gaps from the database after `GAP_WAIT_MS`. The run before the fix lost two messages; the run after it lost one, the last message (finding 4).
3. **The last message of a burst waited for the next request.** With the in-memory realtime bus (local and single-instance), the final message's delivery sat unsent in an otherwise idle API process until any other request arrived. The evidence:
   - the message was stored and replayable;
   - both WebSocket client libraries missed it;
   - it went out 5 ms after an unrelated REST call.

   The bus scheduled delivery with `setImmediate`; it now uses a microtask, and all 4,910 deliveries arrive. Deployed environments use the Redis bus (ADR-0024), which doesn't use that code path; the staging run in Prompt 29 should confirm delivery with Redis.

4. **Unlimited limits were enforced as zero.** An override or plan limit of "unlimited" (`null`) became 0 when enforced: every daily-quota use and capacity addition was refused, although the entitlements page showed "unlimited". It is fixed, and the entitlements test now proves unlimited enforcement.

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

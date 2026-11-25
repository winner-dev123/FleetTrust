# Handoff — Prompt 28: Performance, reliability and end-to-end QA

- Date: 2026-11-25
- Status: **awaiting approval** · PR #30
- Prompt 27 approved and merged (PR #29 → `ad7fc0d`).

## Assumptions

- **Measurements run in CI.** There is no staging environment yet (Prompt 29), and no Docker or PostGIS on the development machine. The load test therefore runs on a GitHub-hosted runner: PostgreSQL 17 + PostGIS, the built API (api and worker roles), the Auth emulator and the load generator share one machine. These numbers are conservative, not production numbers. The same harness must be re-run against staging.
- **SLO targets are the SRS §7 pilot targets:**
  - search p95 ≤ 400 ms at pilot volume (1k providers);
  - writes p95 ≤ 500 ms;
  - emergency p95 ≤ 10 s;
  - RPO ≤ 15 min and RTO ≤ 4 h.
- **The restore drill is a logical backup and restore**, automated in CI. The Cloud SQL point-in-time drill needs staging and stays an owner action.
- **Real-device mobile runs and screen-reader passes** need dev builds and developer accounts (OQ-19). They are written as a plan, not run.

## What was built

| Area             | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Load harness     | [tools/perf](../../tools/perf) drives the built API over HTTP and WebSocket. Users come from the Auth emulator; one provider is published through the API, then cloned in SQL. **Scenarios:** search at 1,000 and 20,000 providers; request creation at a steady rate; a 250-at-once quota burst; group messaging (50 sockets); emergency fan-out (40 alerts × 5 contacts). **Correctness checks gate CI; latency is reported** against targets in [slo.ts](../../tools/perf/src/slo.ts) |
| CI job           | "Load tests and restore drill" ([performance.yml](../../.github/workflows/performance.yml)) on every PR and push to `main`. Results go to the job summary; warnings and errors from the API are printed                                                                                                                                                                                                                                                                                  |
| Restore drill    | [restore-drill.ts](../../tools/perf/src/restore-drill.ts): `pg_dump` → new database → `pg_restore`. It then compares row counts of every table, 5 content checksums and the migration history, and runs a PostGIS query on the copy. Writers are stopped first                                                                                                                                                                                                                           |
| Load shedding    | Pool exhaustion and transient SQLSTATEs (53300, 57P03, 40001, 40P01, 55P03) now answer **503 `overloaded` with `Retry-After: 1`**, logged as a warning, instead of a reported 500 ([transient-errors.ts](../../apps/api/src/observability/transient-errors.ts)). SDK reason `overloaded`                                                                                                                                                                                                 |
| Realtime         | The gateway delivers strictly in seq order, holds messages that skip ahead, and fills gaps from the database after `GAP_WAIT_MS` (1 s). The in-memory bus delivers in a microtask                                                                                                                                                                                                                                                                                                        |
| Entitlements fix | "Unlimited" (`null`) limits were enforced as 0. Fixed, and the test now creates more branches than the plan allows under an unlimited override                                                                                                                                                                                                                                                                                                                                           |
| Chaos tests      | [chaos.e2e-spec.ts](../../apps/api/test/chaos.e2e-spec.ts), 7 tests: pool exhaustion → 503 and recovery; rate-limit store down → fail open; outbox handler failure → backoff, error kept, exactly-once notification; push outage for messages; storage, KMS or scanner failure during attachment completion → nothing half-done, retry works                                                                                                                                             |
| Browser matrix   | Web e2e in CI on Chromium desktop and 320 px phone, **plus Firefox, WebKit desktop and iPhone** (`E2E_ALL_BROWSERS=1`)                                                                                                                                                                                                                                                                                                                                                                   |
| Docs             | [slo.md](../operations/slo.md) (SLOs, measurements, findings, capacity levers, reliability test map); [backup-restore-runbook.md](../operations/backup-restore-runbook.md) (automated drill, drill log); [device-matrix.md](../qa/device-matrix.md) (browsers, accessibility checks, manual screen-reader and device plan); [ADR-0035](../adr/0035-performance-and-reliability.md); a load-shedding alert in [observability.md](../operations/observability.md)                          |

## Acceptance criteria

| Criterion                                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SLO targets and actual measurements documented | [slo.md](../operations/slo.md) has every target and the reference CI run (commit `4bc2c48`, 4 vCPU). **Met:** pilot search p95 195 ms (target 400); request creation p95 458 ms (500); message send p95 55 ms; delivery to 50 sockets p95 57 ms with 0 of 4,910 lost; emergency fan-out p95 387 ms (10 s). **Missed and explained:** search at 20× pilot density (p95 693 ms; levers listed) and the 250-at-once burst (a stress case; correct, with retries). The ranges from slower runners are recorded too. **Correctness passes in CI:** quota never over-granted, everyone got exactly the limit, every message and every alert delivered |
| Restore drill completed                        | **Passed in CI** (PR #30, `4bc2c48`): 92 tables and 146,936 rows. Backup 0.7 s, restore 2.4 s. Every row count identical, 5 checksums equal, migration history matches, geospatial query on the copy returned 4,450 branches. It repeats on every CI run. The drill log is in the runbook. The Cloud SQL PITR drill on staging is the remaining owner item                                                                                                                                                                                                                                                                                      |

## Evidence (actual results)

- **CI on `4bc2c48`:** 7 of 7 checks green, including the load tests and restore drill, and web e2e on five browser projects.
- **Load test findings, each fixed and covered by a test:**
  1. Pool exhaustion gave 500s: the first burst run left 8 of 25 users under their limit, because requests that waited over 5 s for a connection failed.
  2. Out-of-order realtime publishes were dropped.
  3. The last message of a burst waited for the next request (`setImmediate` in the in-memory bus). Proved with evidence in CI: the message was stored and replayable, both client libraries missed it, and it went out 5 ms after an unrelated REST call.
  4. Unlimited limits were enforced as 0.
- **Checked that the new tests catch regressions:** the entitlements test fails with the old `?? 0` line, and the in-order test fails with the old gateway rule. The A/B and sentinel diagnostics stay in the harness and only print when a delivery is missed.
- **`pnpm check`:** passes locally (prettier, module guard: 893 files, 42/42 turbo tasks).
- **Tests:**
  - API **372** (was 362): chaos 7, transient errors 2, in-order delivery 1; the entitlements test extended;
  - web 67; mobile 83; db 99 + 6 skipped; sdk 34; types 84; perf 4.
- **Browser tests:** **80 passed** in CI (was 32 on two projects): the 16 journeys and accessibility tests on each of five browser projects (Chromium desktop and phone, Firefox, WebKit desktop, iPhone).
- **Drift check:** no schema changes (no migration in this stage).

## Not built here (gaps)

- **Production-sized measurements:** re-run `tools/perf` against staging (Prompt 29) with the Redis bus, several instances and Cloud SQL. Then decide whether latency misses should fail the job.
- **Search at very high density:** nearest-K pre-filter or a precomputed open-now column (changes ranking, ADR-0019). Not needed at pilot volume.
- **Soak test** (hours) and memory-leak checks.
- **Real-device and screen-reader runs** ([device-matrix.md](../qa/device-matrix.md), [mobile-device-test-plan.md](../qa/mobile-device-test-plan.md)).

## Before launch (owner)

- **Cloud SQL point-in-time restore drill** on staging: time each step and record it in the runbook's drill log.
- **Production capacity settings:** Cloud Run concurrency versus `DB_POOL_MAX`, and the Cloud SQL tier and connection limit (Prompt 29).
- **Manual accessibility passes** (NVDA, VoiceOver, TalkBack) and the real-device plan.
- **Supported-browser statement** on the accessibility page.

## Next: Prompt 29 — Staging, production and launch

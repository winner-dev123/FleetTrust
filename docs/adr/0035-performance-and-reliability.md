# ADR-0035: Performance and reliability — SLOs, a load harness that gates on correctness, load shedding, in-order realtime delivery, restore drill in CI

- Status: Accepted
- Date: 2026-11-25

## Context

Prompt 28 asks for:

- load tests of geospatial search, service request quota concurrency, messaging fan-out and emergency notification fan-out;
- chaos and retry tests;
- disaster recovery and a backup restore drill;
- an accessibility and device matrix.

The acceptance criteria: SLO targets and actual measurements are documented, and a restore drill is completed.

Constraints:

- There is no staging environment yet (Prompt 29). There is no Docker or PostGIS on the development machine either.
- Measurements therefore run on a GitHub Actions runner. The database, the API (api and worker roles), the Auth emulator and the load generator share one small machine.
- The SRS §7 targets are stated for the pilot: nearby search p95 ≤ 400 ms; writes p95 ≤ 500 ms; emergency p95 ≤ 10 s to the first push; RPO ≤ 15 min, RTO ≤ 4 h.

## Decision

1. **A load harness in the repo** (`tools/perf`). It is plain Node 24 with type stripping, `pg`, `fetch` and the `WebSocket` global, and runs in CI on every pull request ("Load tests and restore drill", `performance.yml`).
   - It drives the **built** API over HTTP and WebSocket, exactly as clients do.
   - Users are minted in the Auth emulator.
   - One provider is published through the API, then cloned in SQL (`jsonb_populate_record`, so clones stay correct when columns change).
2. **Correctness gates the build; latency is reported.** The run fails when:
   - a user gets more service requests than the daily limit;
   - a user gets fewer than the limit after retries;
   - a subscribed member misses a message;
   - an emergency contact's push is never sent.

   Latency misses on the shared CI runner are recorded against the targets but don't fail the job. A production-sized run on staging is an owner task (Prompt 29).

3. **SLOs come from SRS §7** (`tools/perf/src/slo.ts`, `docs/operations/slo.md`).
   - Search is measured twice: at pilot volume (1,000 providers), where the SRS target applies, and at 20× density as a stress level.
   - Request creation is measured at a steady rate. It is also measured as a 250-at-once burst, which is a correctness test for the quota race.
4. **Load shedding: 503 `overloaded` with Retry-After, not 500.** The last-resort exception filter recognises transient database pressure:
   - the pool's connect timeout;
   - SQLSTATE 53300, 57P03, 40001, 40P01 and 55P03 (also when wrapped by drizzle).

   It answers 503 `{ error: "service_unavailable", reason: "overloaded" }` with `Retry-After: 1` and logs a warning, not an error report. The SDK already exposes `retryAfterSeconds`. Write endpoints are idempotent (`clientRequestId`, `clientMessageId`, `clientIncidentId`), so a retry never duplicates work or consumes quota twice.

5. **In-order realtime delivery.** Sends commit in seq order but can publish to the bus out of order. The gateway previously dropped any message at or below the last delivered seq, which silently lost the late one. It now:
   - delivers strictly in seq order;
   - holds a message that skips ahead;
   - waits up to `GAP_WAIT_MS` (1 s) for the missing one, then fills the gap from the database.

   Clients keep the simple "ignore seq ≤ last seen" rule.

6. **Chaos tests in the API suite** (`test/chaos.e2e-spec.ts`). Each test breaks one dependency mid-flow and proves three things: the failure is visible, nothing is left half-done, and the retry succeeds. Dependencies covered:
   - pool exhaustion;
   - an outbox handler failure (backoff, error kept, notifies exactly once on retry);
   - a push provider outage for messages;
   - object storage, the key service, and the malware scanner during attachment completion.

   Existing coverage is listed rather than duplicated: database down or hanging (readiness), routing vendor failure (route fallback), and emergency push retries with email fallback.

7. **Restore drill in CI** on every run:
   - take a `pg_dump` of the database the load test filled;
   - restore it into a new database;
   - compare row counts of every table, content checksums of five key tables and the migration history;
   - run a PostGIS query on the copy.

   Writers are stopped first, so the comparison is exact. The Cloud SQL point-in-time drill on staging stays an owner task (runbook).

8. **Browser matrix in CI.** Web end-to-end tests run on Chromium desktop and a 320 px phone, plus Firefox, WebKit desktop and an iPhone viewport (`E2E_ALL_BROWSERS=1`). Real-device mobile checks and screen-reader passes are a documented manual plan (`docs/qa/device-matrix.md`).

## Consequences

- Every pull request re-measures the main paths, so a regression in latency or correctness shows up in the job summary before merge.
- The load test found two real defects, both fixed here:
  - pool exhaustion answered with a reported 500, now a 503 the client retries;
  - out-of-order realtime publishes were lost, now delivered in order.
- CI numbers are not production numbers. Production capacity (pool size, Cloud Run concurrency, Cloud SQL tier) must be confirmed with the same harness against staging.
- The e2e job takes longer, because it runs five browser projects.

## Alternatives considered

- **k6, Artillery or Locust.** These are another runtime and language. Correctness checks such as quota counts per user, per-socket delivery and database timestamps would need custom glue anyway. A small TypeScript harness reuses the repo's tooling.
- **Failing the build on latency misses.** That would make CI flaky on shared runners. It is kept as a report until staging gives a stable baseline.
- **Raising the pool size to hide the burst errors.** That only moves the limit. Shedding with Retry-After plus idempotent retries is correct at any size.
- **Capping search candidates (nearest K) before ranking.** This would bound cost at high density, but it changes ranking semantics (ADR-0019). It is recorded as an option in `slo.md`, not done in this stage.

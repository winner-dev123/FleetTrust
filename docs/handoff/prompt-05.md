# Handoff — Prompt 05: CI/CD and observability foundation

- Date: 2026-11-19
- Status: **awaiting owner approval. CI has not run yet:** GitHub refused to start the jobs because of a billing block on the account (see Blockers).
- Prompt 04 approved by owner ("pls continue develop"). Sample PR: winner-dev123/FleetTrust **#1**.

## What was built

### CI (`.github/workflows/ci.yml`)

Five parallel jobs on every PR and push to `main`. Details in [docs/operations/ci-cd.md](../operations/ci-cd.md).

| Job         | Covers                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| quality     | format, **ADR-0011 module guard**, lint, typecheck, tests, builds, **migration drift**, **tracing smoke test**                                                                                                                                                                 |
| database    | migrate + seed twice + real-Postgres tests on **PG 17 + PostGIS** (same image digest as local)                                                                                                                                                                                 |
| local-infra | Compose stack healthy; wrong DB password, unauthenticated Redis and an unauthenticated Mailpit UI all rejected; DB tests against Compose; Firebase emulators on Java 21; unauthenticated Storage upload → 403. **Closes the Prompt 03/04 checks that need Docker and Java 21** |
| container   | Dockerfile builds; non-root; `/health` 200, `/health/ready` 503                                                                                                                                                                                                                |
| security    | `pnpm audit --prod` (high/critical) + gitleaks over full history                                                                                                                                                                                                               |

Every action is pinned to a commit SHA and every image to a digest. Permissions are read-only.

### Also added

- **Dependabot** (`.github/dependabot.yml`): weekly grouped updates with a 7-day cooldown.
- **Staging deploy** (`.github/workflows/deploy-staging.yml`): manual. Workload Identity Federation (no JSON keys), migrations as a Cloud Run job before the new revision, then a smoke test. Dormant until the `GCP_*` repository variables exist; setup in [staging-deployment.md](../operations/staging-deployment.md).
- **Observability** (`apps/api/src/observability`):
  - Structured JSON logs in Cloud Logging format, with **secrets redacted by field path and by pattern** (connection strings, Bearer tokens, JWTs, key=value pairs), including inside error messages and stacks.
  - Request IDs (`X-Request-Id`); request logs record paths without query strings.
  - Log ↔ trace correlation.
  - Global exception filter: generic 500 plus a single report through the `ErrorReporter` port, in Cloud Error Reporting format.
  - OpenTelemetry (HTTP, Express, pg) through the ESM import hook; OTLP or console exporter; spans flushed on SIGTERM.
- **Deployment artefacts:**
  - `apps/api/Dockerfile`: multi-stage, `pnpm deploy`, non-root, digest-pinned Node 24.
  - `.dockerignore`.
  - `deploy/cloudrun/api.service.yaml`, with an OpenTelemetry Collector sidecar exporting to Cloud Trace.
  - `apps/web/apphosting.yaml`.
- **`tools/repo-guards`:** ADR-0011 excluded-module guard covering tables, columns, API routes, UI routes, env/feature-flag keys and payment SDKs, with `guard-allow: <reason>` escapes.
- **`@fleettrust/env`:** env validation moved out of `@fleettrust/config`, so production images carry no lint tooling (deploy bundle 100 MB → 68 MB).
- **Docs:** [CI/CD and branch protection](../operations/ci-cd.md), [observability](../operations/observability.md), [staging setup](../operations/staging-deployment.md), [backup and restore runbook](../operations/backup-restore-runbook.md).

## Acceptance criteria

| Criterion                     | Result                                                                                                                                                                                                                                           |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Pipeline works on a sample PR | **Not yet demonstrated.** PR #1 is open and the workflow parsed (5 jobs listed), but GitHub didn't start any job: _"recent account payments have failed or your spending limit needs to be increased"_. Every step was run locally first (below) |
| Logs redact secrets           | **Pass**: 7 pattern cases, a field-path plus pattern test covering 9 planted secrets, and an e2e test where an exception carrying a DB password returns a generic 500 and the log contains `[REDACTED]`, never the password                      |
| Backup restoration documented | **Pass**: [runbook](../operations/backup-restore-runbook.md) with a decision table, PITR clone and cut-over, daily-backup restore, object restore and drill log (first drill due in Prompt 28)                                                   |

## Local evidence (actual results, 2026-11-19)

| Check                                                                        | Result                                                                                                                                                                         |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `pnpm turbo run lint typecheck test build` (11 workspaces)                   | **Pass**: 39/39 tasks                                                                                                                                                          |
| Tests                                                                        | **185 passed, 3 skipped** (real-PG suite needs Docker): api 40, db 36, local-infra 44, repo-guards 22, ui 22, env 5, types 3, sdk 4, web 4, mobile 5                           |
| `pnpm guard:modules`                                                         | **Pass**: 251 files, no excluded modules. Its own tests show it catches 20 violation patterns and allows verification reviews, operating hours and external payment references |
| ESM tracing on the built API (console exporter)                              | **Pass**: HTTP, Express and **pg** spans, route attributes, incoming `traceparent` continued, `traceId`/`spanId` on log lines                                                  |
| Dockerfile build stage replayed outside Docker (same context, same commands) | **Pass**: filtered frozen install, 4 build tasks, `pnpm deploy` bundle of 70 MB that runs standalone (`/health` 200); no source, tests or PGlite                               |
| `pnpm audit --prod --audit-level high`                                       | **Pass** (exit 0). One **moderate** advisory remains: `minimatch` in Expo's build-time `@expo/fingerprint` (not at runtime); fixed by a future Expo update                     |
| Schema drift                                                                 | **Pass**: "No schema changes"                                                                                                                                                  |

Not runnable on this machine: the Docker build itself, the Compose stack, the emulators (Java 17) and the SIGTERM-flush half of the smoke test (Windows has no graceful SIGTERM). These are exactly what CI covers.

## Blockers

1. **GitHub Actions billing (owner action):** github.com → Settings → Billing and licensing. Fix the failed payment or raise the Actions spending limit. Private repos on GitHub Free include 2,000 minutes/month; one full run uses about 20–30. Then re-run PR #1's checks (Actions → CI → Re-run jobs).
2. **Branch protection** isn't available for private repos on GitHub Free. The recommended settings are documented as working agreements.
3. **Staging (OQ-19, OQ-02):** a GCP project and region are needed before `deploy-staging.yml` can run.

## Risks

- The OpenTelemetry ESM hook is marked experimental upstream. The smoke test in CI guards against regressions on upgrade.
- Tracing samples 100 % in staging (`TRACE_SAMPLE_RATIO`). Lower it for production (Prompt 29).
- gitleaks skips test files on purpose (they hold fake secrets). Reviewers must reject real secrets in tests.

## Next: Prompt 06 — Authentication and minimal signup (not started)

Firebase Auth (email link, Google, Apple) behind an `AuthVerifier` adapter, an API guard verifying ID and App Check tokens, a `users` table mapping `firebase_uid` → UUID, session revocation, rate limits, and tests using the Auth emulator in CI. Needs CI running (emulator tests) and, for real sign-in later, a Firebase project (OQ-19).

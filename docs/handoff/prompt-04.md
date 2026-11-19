# Handoff — Prompt 04: Database and migration foundation

- Date: 2026-11-19
- Status: **awaiting owner approval**
- The owner asked me to proceed on my own recommendations ("pls recommand you and continue"). Prompt 03 is treated as approved, with its container start-up checks still pending Docker and Java 21.

## Recommendations taken (owner delegated the choice)

| Decision                                          | Why                                                                                                     | Record                                                            |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| **Drizzle ORM** + drizzle-kit, not Prisma         | Native PostGIS support, SQL migrations you can review, ESM-native, same schema on `pg` and PGlite       | [ADR-0013](../adr/0013-drizzle-orm-and-pglite-tests.md)           |
| **PGlite + PostGIS** for database tests           | Real Postgres + PostGIS in-process: tests run now without Docker, and in CI without a DB service        | ADR-0013                                                          |
| Only foundation tables in this stage              | Users and organizations belong to Prompts 06–07; building them now would pre-empt those stages          | [data conventions](../architecture/data-conventions.md)           |
| Forward-only migrations, expand/contract rollback | drizzle-kit has no down migrations; expand/contract makes "redeploy the previous image" a safe rollback | [database workflow](../development/database.md#rollback-strategy) |
| API readiness probe `GET /health/ready`           | Promised in Prompt 02; liveness stays dependency-free                                                   | `apps/api/src/health`                                             |

## What was built

**`packages/db` (`@fleettrust/db`)**

- **Schema:** `currencies` (ISO 4217 reference data), `audit_events` (append-only: triggers reject UPDATE/DELETE/TRUNCATE), `outbox_events` (transactional outbox with a partial "unpublished" index). CHECK constraints on every enumerated or formatted column.
- **Column helpers:** UUIDv7 `id()`, `timestamps()`, `deletedAt()`, and a `geographyPoint` custom type (Drizzle has no `geography`).
- **Migrations:**
  - `0000_extensions_and_functions` (custom): PostGIS, `set_updated_at()`, `reject_modification()`.
  - `0001_foundation_tables` (generated).
  - `0002_triggers` (custom).
- **Spatial helpers:** `withinMeters`, `distanceMeters`, `withinBoundingBox`, `geographyOf`. They validate coordinates and reject antimeridian-crossing boxes explicitly.
- **Tenancy:** branded `TenantContext`, `tenantFilter()`, `assertSameTenant()` (errors carry no IDs).
- **Events:** `recordAuditEvent()` and `enqueueOutboxEvent()`; pass the transaction.
- **Seed:** 160 active ISO 4217 currencies, idempotent upsert that only touches changed rows and never overrides the operator `is_active` flag, all steps in one transaction.
- **CLIs:** `migrate`, `seed`, `reset` (refuses non-localhost hosts and deployed `APP_ENV`, needs `--yes`). Credentials are never printed.
- **Testing entry point** (`@fleettrust/db/testing`): `createTestDatabase()` and `expectTenantIsolation()`.

**API**

- `DATABASE_URL` (required in staging and production, optional locally) and `DB_POOL_MAX`.
- `DatabaseModule` with a lazily connecting pool that closes on shutdown.
- `GET /health/ready` returns 200, or 503 with `unavailable` or `not_configured`. There's a 2 s timeout, and no error details are returned.

**Root scripts:** `db:generate`, `db:migrate`, `db:seed`, `db:reset`, `test:db`.

**Docs:** ADR-0013, [data conventions](../architecture/data-conventions.md) (keys, timestamps, soft-delete policy, tenancy, audit, outbox, spatial, money), [database workflow and rollback strategy](../development/database.md), [tenant isolation test plan](../qa/tenant-isolation-test-plan.md).

## Acceptance criteria

| Criterion                      | Result                                                                                                                                                                                                           |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Migrations apply to a fresh DB | **Pass (PGlite / Postgres 18.6 + PostGIS 3.6.2)**: full chain applies to an empty database, re-run is a no-op, every SQL file is in the journal. **Not yet run on Postgres 17** (needs Docker: `pnpm test:db`)   |
| Seed repeatable                | **Pass**: second run changes nothing (not even `updated_at`), drifted data is repaired, operator flags are kept, a failing step rolls back everything                                                            |
| Spatial query test passes      | **Pass**: geodesic distances match WGS 84 references (1° lat at the equator = 110,574 m, 1° lng = 111,319 m), radius boundaries are exact to the metre, nearest-first ordering, viewport filter, GiST index used |
| Tenant leak tests planned      | **Done**: [test plan](../qa/tenant-isolation-test-plan.md) with a resource register for Prompts 07–26, plus a working `expectTenantIsolation()` harness, itself tested to catch a deliberately leaky repository  |

## Test evidence (actual results, 2026-11-19)

| Check                                                 | Result                                                                                                                                                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run lint typecheck test build --force`    | **Pass**: 35/35 tasks, no cache                                                                                                                                                                                     |
| Tests                                                 | **141 passed, 0 failed, 3 skipped**: db 36 (+3 real-Postgres skipped), api 18, local-infra 44, ui 22, config 5, types 3, sdk 4, web 4, mobile 5                                                                     |
| Schema drift (`drizzle-kit generate` on a clean tree) | **Pass**: "No schema changes"                                                                                                                                                                                       |
| Built API without DB / with unreachable DB            | **Pass**: `/health` 200; `/health/ready` 503                                                                                                                                                                        |
| Production bundle loads no PGlite                     | **Pass**: 0 PGlite imports in the `@fleettrust/db` runtime entry                                                                                                                                                    |
| `db:migrate`, `db:reset`, `test:db` without Docker    | Fail as designed: connection refused with a "run `pnpm infra:up`" hint; reset refuses a remote host and an unconfirmed run; the real-PG suite fails loudly instead of being skipped when `DATABASE_URL_TEST` is set |

### Not verified (needs Docker, KC-04)

- `pnpm infra:up && pnpm db:migrate && pnpm db:seed && pnpm test:db`: migrations and the 3 integration tests on **Postgres 17**, the version Cloud SQL runs.

## Install-script decisions

`esbuild` (pulled in by drizzle-kit) denied in `pnpm-workspace.yaml` → `allowBuilds`: its postinstall only verifies a binary that pnpm already installs as an optional dependency. drizzle-kit generation works without it.

## Risks

- **PGlite runs Postgres 18 and production runs 17.** Mitigation: the conventions doc forbids 18-only features, and `pnpm test:db` is the authority. Prompt 05 should run it in CI with a Postgres 17 service container.
- **Drizzle is pre-1.0.** Versions are pinned exactly.
- The `audit_events` append-only trigger also blocks future retention purges. When OQ-03 sets retention, purging needs a dedicated maintenance role that may bypass the trigger, using `session_replication_role` or a SECURITY DEFINER function, and that purge must itself be audited.

## Files

```text
packages/db/**                                   (new package: src, test, migrations, configs)
apps/api/src/database/database.module.ts         (new)
apps/api/src/health/health.controller.ts         (readiness)
apps/api/src/app.module.ts, src/config/env.ts, src/config/env.spec.ts, .env.example, package.json, vitest.config.ts
apps/api/test/readiness.e2e-spec.ts              (new)
packages/types/src/health.ts                     (readiness schema)
package.json (db scripts), pnpm-workspace.yaml (esbuild), pnpm-lock.yaml
docs/adr/0013-drizzle-orm-and-pglite-tests.md, docs/adr/README.md
docs/architecture/data-conventions.md, docs/development/database.md, docs/qa/tenant-isolation-test-plan.md
docs/handoff/{CHECKLIST.md, prompt-04.md}, docs/prompt-pack/OVERLAY.md, README.md
```

## Next: Prompt 05 — CI/CD and observability foundation (not started)

Proposed plan:

1. GitHub Actions: install (frozen lockfile), `format:check`, lint, typecheck, test, build, plus a **Postgres 17 + PostGIS service container running `pnpm test:db`**, a migration drift check, and the ADR-0011 forbidden-module guard.
2. Security scanning: dependency audit, secret scanning (gitleaks), CodeQL. Dependabot/Renovate for npm, GitHub Actions and Docker digests.
3. Observability in the API: structured JSON logs with secret redaction, request IDs, OpenTelemetry tracing (Cloud Trace exporter behind an adapter), and an error-monitoring adapter.
4. Staging deployment templates (Cloud Run + App Hosting, Workload Identity Federation) and a backup/restore runbook.

**Needs from you:** a GitHub repository (and whether it's private), plus a Google Cloud project for staging (OQ-19). Without these I can still write and locally validate the workflows, but "pipeline works on a sample PR" can only be shown once the repo exists.

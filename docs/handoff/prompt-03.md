# Handoff — Prompt 03: Local infrastructure

- Date: 2026-11-19
- Status: **awaiting owner approval. Container start-up is NOT yet verified** (Docker isn't installed on this machine)
- Prompt 02 approved by owner on 2026-11-19 ("pls continue").

## What was built

| Piece                                   | Details                                                                                                                                                                                                                                                                                                                                     |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `infra/local/compose.yaml`              | Postgres 17 + PostGIS 3.6, Redis 7.2 (password required, AOF persistence), Mailpit (optional `email` profile). Images pinned by tag **and** digest. All ports on `127.0.0.1`. Named volumes `pgdata`, `redisdata`. Health check on every service. `no-new-privileges`. Every credential is `${VAR:?…}`: Compose refuses to start without it |
| `infra/local/postgres/20-fleettrust.sh` | First-start bootstrap: PostGIS in `fleettrust`, plus a separate `fleettrust_test` database with PostGIS. No schema; that belongs to Prompt 04 migrations                                                                                                                                                                                    |
| `firebase.json`, `.firebaserc`          | Auth (9099) and Storage (9199) emulators plus UI (4000), all on `127.0.0.1`, project `demo-fleettrust`                                                                                                                                                                                                                                      |
| `infra/firebase/storage.rules`          | Deny-all client access (ADR-0006), the same file production will deploy                                                                                                                                                                                                                                                                     |
| `tools/local-infra`                     | Typed CLI run directly by Node 24 (no build): `env`, `up [--all]`, `status`, `down`, `destroy --yes`, `emulators`                                                                                                                                                                                                                           |
| Root scripts                            | `infra:env`, `infra:up`, `infra:up:all`, `infra:status`, `infra:down`, `infra:destroy`, `emulators`                                                                                                                                                                                                                                         |
| `firebase-tools` 15.36.0                | Pinned root dev dependency (no global install needed)                                                                                                                                                                                                                                                                                       |
| Docs                                    | [docs/development/local-infrastructure.md](../development/local-infrastructure.md), [ADR-0012](../adr/0012-local-storage-emulation.md) (Firebase Storage emulator instead of MinIO), README commands                                                                                                                                        |

### Decisions

- **No public default credentials.** `pnpm infra:env` generates per-developer random 32-character passwords into a git-ignored `infra/local/.env`, never overwrites edited values, and recomputes `DATABASE_URL`, `DATABASE_URL_TEST`, `REDIS_URL` and `SMTP_URL` for Prompt 04.
- **Versions match production:** Postgres 17 (Cloud SQL), Redis 7.2 (Memorystore for Redis). Versions at least a week old were chosen over the newest ones.
- **Storage:** Firebase Storage emulator instead of MinIO (ADR-0012). Trade-off: signed URLs and upload events aren't emulated, so they get tested against staging (Prompt 05/09).
- **Install scripts denied** (recorded in `pnpm-workspace.yaml`): `protobufjs` (postinstall only prints a warning) and `re2` (optional for the Hosting emulator, with a RegExp fallback).

## Test evidence (actual results, 2026-11-19)

| Check                                                                     | Result                                                                                                                                                                                                                                                                                                         |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm turbo run lint typecheck test build --force` (whole repo, no cache) | **Pass**: 31/31 tasks                                                                                                                                                                                                                                                                                          |
| Tests                                                                     | **99 passed, 0 failed**: local-infra 44 (new), config 5, types 3, sdk 4, ui 22, api 12, web 4, mobile 5                                                                                                                                                                                                        |
| Static compose checks (run without Docker)                                | **Pass**: every image pinned by digest; every service has a health check; all ports `127.0.0.1`; every credential `${VAR:?}` with no default; init script LF-only and enables PostGIS in both databases; emulators on `127.0.0.1` with a `demo-` project; Storage rules contain exactly one `allow … if false` |
| `pnpm infra:env`                                                          | **Pass**: created `infra/local/.env`; second run "up to date"; file is git-ignored; generated passwords appear in 0 trackable files                                                                                                                                                                            |
| `pnpm infra:up` without Docker                                            | **Pass** (expected failure): exit 2 with install instructions, no stack trace                                                                                                                                                                                                                                  |
| `pnpm infra:status` without Docker                                        | **Pass** (expected failure): readable report, exit 1                                                                                                                                                                                                                                                           |
| `pnpm infra:destroy` without `--yes`                                      | **Pass**: refuses, exit 1                                                                                                                                                                                                                                                                                      |
| `pnpm format:check`, internal link check                                  | **Pass**                                                                                                                                                                                                                                                                                                       |

### Not verified (blocked on this machine)

| Check                                                      | Blocker                                                         | How to verify once unblocked                                                                                                                                    |
| ---------------------------------------------------------- | --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Containers start and turn healthy                          | Docker and WSL 2 not installed (KC-04)                          | `pnpm infra:up && pnpm infra:status` should exit 0 with postgres and redis `ok`                                                                                 |
| PostGIS works and the test DB exists                       | same                                                            | `docker compose --env-file infra/local/.env -f infra/local/compose.yaml exec postgres psql -U fleettrust -d fleettrust_test -c "select postgis_full_version()"` |
| Mailpit UI login                                           | same                                                            | `pnpm infra:up:all`, open http://127.0.0.1:8025 with the generated credentials                                                                                  |
| Firebase emulators start; Storage rules deny client access | Java 17 installed; firebase-tools 15 needs **Java 21+** (KC-06) | `pnpm emulators`, then `pnpm infra:status` shows both emulators `ok`                                                                                            |

I tried to fetch a portable Java 21 runtime into the scratch folder to test the emulators, but the session's permission policy blocked it. I didn't try another route.

Prompt 03's acceptance criterion "local services start with documented commands and health checks" is therefore **met for documentation and configuration, but not demonstrated**. Please treat approval as conditional on the four checks above, or have me run them once Docker and Java 21 are installed.

## Files created or changed

```text
infra/local/compose.yaml
infra/local/.env.example
infra/local/postgres/20-fleettrust.sh
infra/firebase/storage.rules
firebase.json  .firebaserc
tools/local-infra/{package.json, tsconfig.json, eslint.config.js}
tools/local-infra/src/{cli.ts, docker.ts, env-file.ts, health.ts, paths.ts}
tools/local-infra/test/{config-files.test.ts, docker.test.ts, env-file.test.ts, health.test.ts}
docs/development/local-infrastructure.md
docs/adr/0012-local-storage-emulation.md, docs/adr/README.md
docs/handoff/{CHECKLIST.md, prompt-03.md}
docs/prompt-pack/OVERLAY.md, docs/product/open-questions.md (KC-04, KC-05, new KC-06)
package.json (infra scripts, firebase-tools), pnpm-workspace.yaml (tools/*, allowBuilds), pnpm-lock.yaml
.gitignore (.firebase-data/), README.md
```

Generated locally and git-ignored: `infra/local/.env`.

## Next: Prompt 04 — Database and migration foundation (not started)

Needs a running Postgres, so it depends on Docker. Proposed plan:

1. ORM: **Prisma** is the pack's default. I'll check its current major's support for NestJS 12 ESM, PostGIS (`Unsupported("geography")` plus raw SQL) and Windows before committing; Drizzle is the fallback.
2. Conventions: UUID v7 primary keys, `created_at` / `updated_at`, soft-delete policy, `organization_id` tenant column, an append-only `audit_events` table and an `outbox` table.
3. Migration workflow (`pnpm db:migrate`, `db:reset`, `db:seed`), repeatable seed data, rollback strategy doc.
4. Tests against `DATABASE_URL_TEST`: migrations apply to a fresh DB, seed is idempotent, a spatial (`ST_DWithin`) query test, and a plan for tenant-leak tests.

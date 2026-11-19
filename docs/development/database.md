# Database workflow

PostgreSQL 17 + PostGIS through Drizzle ORM ([ADR-0013](../adr/0013-drizzle-orm-and-pglite-tests.md)). Everything lives in `packages/db`.

```text
packages/db/
  src/schema/         table definitions (source of truth for generated migrations)
  migrations/         SQL migrations + drizzle-kit journal/snapshots (committed, reviewed)
  src/seed/           idempotent reference-data seeds
  src/testing/        createTestDatabase() (PGlite) and expectTenantIsolation()
  test/               migration, seed, spatial, audit/outbox, tenancy and convention tests
```

## Commands

| Command                                                                         | What it does                                                                         | Needs                      |
| ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------ | -------------------------- |
| `pnpm db:generate`                                                              | Diff `src/schema` against the snapshots and write a new SQL migration                | nothing (no DB connection) |
| `pnpm --filter @fleettrust/db exec drizzle-kit generate --custom --name=<name>` | Empty migration for hand-written SQL (functions, triggers, data fixes)               | nothing                    |
| `pnpm db:migrate`                                                               | Apply pending migrations to `DATABASE_URL` (add `-- --test` for `DATABASE_URL_TEST`) | running Postgres           |
| `pnpm db:seed`                                                                  | Upsert reference data (idempotent)                                                   | running Postgres           |
| `pnpm db:reset --yes`                                                           | Drop, re-migrate and re-seed. **Refuses** non-localhost hosts and deployed `APP_ENV` | running local Postgres     |
| `pnpm test`                                                                     | All tests; DB suites use in-process PGlite + PostGIS                                 | nothing                    |
| `pnpm test:db`                                                                  | DB suites **plus** the real-Postgres integration suite against `DATABASE_URL_TEST`   | `pnpm infra:up` (Docker)   |

Connection strings come from `infra/local/.env`, written by `pnpm infra:env` / `pnpm infra:up`.

## Changing the schema

1. Edit or add a table in `src/schema/` following the [data conventions](../architecture/data-conventions.md).
2. `pnpm db:generate`, then **read the generated SQL**. drizzle-kit can't express triggers or extensions; add those in a `--custom` migration.
3. Tables with `updated_at` need a `CREATE TRIGGER <table>_set_updated_at …` in a custom migration (the conventions test fails otherwise).
4. Run `pnpm test`; with Docker, also `pnpm test:db`.
5. Never edit a migration that has been applied in any shared environment. Write a new one.

When mapping database errors to HTTP responses, note that a delete blocked by an `ON DELETE RESTRICT` foreign key raises SQLSTATE **23001** (`restrict_violation`), not 23503. Drizzle wraps driver errors, so read the code from `error.cause`.

Drift check: `pnpm db:generate` on a clean tree must print "No schema changes". CI enforces this from Prompt 05.

## Rollback strategy

Migrations are **forward-only** (drizzle-kit has no down migrations, by design). Safety comes from how changes are shaped:

1. **Expand / contract.** Breaking changes ship as separate releases:
   - Expand: add new columns or tables, nullable or with defaults. The old app version still works.
   - Migrate: backfill data and switch the app to the new shape.
   - Contract: drop old columns in a later release, once no running version uses them.

   Because every migration is backward-compatible with the previous app version, **rolling back = redeploying the previous app image**, with no schema rollback.

2. **Mistakes in a just-applied migration** are fixed by a new corrective migration (roll forward).
3. **Destructive operations** (DROP, data rewrites) need a reviewed plan in the PR, a verified backup or PITR window, and run as their own release.
4. **Last resort:** Cloud SQL point-in-time recovery to a new instance, then cut over. RPO ≤ 15 min, RTO ≤ 4 h targets ([SRS §7](../product/SRS.md#7-non-functional-requirements)). The restore drill is part of Prompt 28.
5. Long locks are avoided: `CREATE INDEX CONCURRENTLY` (in a custom migration without a transaction) for large tables; add NOT NULL via a CHECK … NOT VALID, then VALIDATE.

## PGlite vs real Postgres

`createTestDatabase()` gives each test file a fresh, fully migrated Postgres + PostGIS in WebAssembly: no Docker, about 6 s to start. Limits:

- **It runs Postgres 18.6**, not 17. Don't depend on 18-only features (e.g. built-in `uuidv7()`).
- **Single connection.** Concurrency tests (row locks, atomic quota counters, `SKIP LOCKED` relays) must use `pnpm test:db`.
- Use it for logic and SQL correctness. `pnpm test:db` remains the authority before shipping a migration.

## Seeds

Seeds hold **reference data only** (currencies now; plans in Prompt 08, service taxonomy in Prompt 11). Each step is idempotent (natural keys or deterministic IDs + `ON CONFLICT`), all steps run in one transaction, and operator-controlled flags (e.g. `currencies.is_active`) are never overwritten. Demo and test data belong to the tests that need them.

Currency data was generated once from CLDR (Node 24 / ICU 78) and committed. `display_decimals` is display precision, **not** the ISO 4217 minor unit.

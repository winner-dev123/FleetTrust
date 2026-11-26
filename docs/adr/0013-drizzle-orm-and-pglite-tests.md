# ADR-0013: Drizzle ORM, SQL migrations, and PGlite for database tests

- Status: Accepted
- Date: 2026-11-19
- Refines: [ADR-0003](0003-postgresql-postgis-system-of-record.md) ("ORM chosen in Prompt 04, Prisma default candidate")

## Context

The pack suggests "Prisma or another well-supported ORM with PostGIS-compatible raw SQL where needed". As of 2026-11, the candidates were:

|                                                         | Prisma 7.x (stable; 8.0 in RC)                                                | Drizzle ORM 0.45 + drizzle-kit 0.31                                                               |
| ------------------------------------------------------- | ----------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| PostGIS columns                                         | None native: `Unsupported("geography")`, every spatial read/write via raw SQL | Native `geometry`; `geography` as a ~20-line custom type; spatial SQL composes with typed queries |
| Migrations                                              | Generated SQL, managed by the Prisma CLI                                      | Generated SQL files plus hand-written custom migrations in the same journal                       |
| ESM / NestJS 12                                         | Supported via driver adapters                                                 | ESM-native, no code generation step                                                               |
| Same schema on Postgres and an in-process test database | Not without adapters                                                          | Built-in drivers for both `pg` and PGlite                                                         |
| Runtime footprint (Cloud Run cold start)                | Query compiler and generated client                                           | Thin query builder over `pg`                                                                      |

Separately, Docker isn't available on the development machine (KC-04), and CI runners shouldn't need a database service for most tests.

## Decision

1. **Drizzle ORM** with **node-postgres** (`pg`) in every deployed environment.
2. **drizzle-kit** generates SQL migrations into `packages/db/migrations`. Extensions, functions and triggers live in hand-written `--custom` migrations in the same journal. Every migration file is reviewed like code.
3. **PGlite + `@electric-sql/pglite-postgis`** (Postgres compiled to WebAssembly) runs database tests in-process: no Docker, about 6 s to boot, a fresh database per test file. The same suites run against the real Postgres 17 container with `pnpm test:db`.
4. Schema, migrations, seeds and helpers live in one package, `@fleettrust/db`. Test helpers are exported from `@fleettrust/db/testing`, so production code never loads PGlite.

## Consequences

- **Version skew:** PGlite 0.5 embeds **Postgres 18** (18.7 in 0.5.17; PostGIS 3.6.2), while Cloud SQL and the local container run **17**. PGlite 0.6 moves to Postgres 19; stay on 0.5 until production moves past 17, so the skew stays one major version. Code must not use features newer than 17. Example: the app generates UUIDv7 values because `uuidv7()` is built into Postgres 18 only. `pnpm test:db` against Postgres 17 is the authority before a migration ships, and CI should run it once a database service is available (Prompt 05).
- PGlite is single-connection, so it can't test concurrency (e.g. atomic quota counters in Prompt 08). Those tests must run against real Postgres.
- Drizzle is pre-1.0 (1.0 is in beta). Upgrades may need code changes; versions are pinned exactly.
- There are no down migrations. Rollback follows the expand/contract strategy in [docs/development/database.md](../development/database.md#rollback-strategy).

## Alternatives considered

- **Prisma**: rejected for weaker PostGIS support and the extra client-generation step. Revisit only if Drizzle stalls.
- **Testcontainers / Docker-only DB tests**: rejected as the _only_ path, because they'd block all DB testing on this machine today and slow CI. Kept as the authoritative path via `pnpm test:db`.
- **SQLite for tests**: rejected. No PostGIS, different SQL dialect.

# FleetTrust

A multi-tenant transport and logistics SaaS that connects drivers, fleets and service providers (workshops, towing, tyres, fuel, parts, parking, mobile mechanics). It covers provider discovery, service requests with indicative quotes, evidence-based verification, emergency alerts to trusted contacts, and vehicle maintenance.

> **Status:** CI/CD and observability (stage 05 of 30). Apps start and pass their checks; no product features exist yet.

## Repository layout

| Path                            | What it is                                                                                                      |
| ------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `apps/api`                      | NestJS 12 modular-monolith API (ESM). Runs as `APP_ROLE=api` or `worker`                                        |
| `apps/web`                      | Next.js 16 web app (App Router)                                                                                 |
| `apps/mobile`                   | Expo SDK 58 / React Native 0.88 app for iOS and Android                                                         |
| `packages/config`               | Shared TypeScript, ESLint and Prettier presets (dev tooling only)                                               |
| `packages/env`                  | Runtime env validation: `parseEnv`, `envFields` (never echoes values)                                           |
| `packages/types`                | Shared domain types and zod schemas                                                                             |
| `packages/sdk`                  | Typed API client used by web and mobile                                                                         |
| `packages/ui`                   | Design tokens (colours with WCAG AA contrast tests, spacing, type)                                              |
| `packages/db`                   | PostgreSQL/PostGIS schema, SQL migrations, seeds, spatial/tenancy/audit helpers (Drizzle); PGlite test database |
| `tools/local-infra`             | CLI behind `pnpm infra:*` and `pnpm emulators` (runs on Node directly, no build)                                |
| `tools/repo-guards`             | CI policy checks: ADR-0011 excluded-module guard (`pnpm guard:modules`)                                         |
| `deploy/`, `.github/`           | Cloud Run templates, CI and staging deploy workflows, Dependabot ([CI/CD](docs/operations/ci-cd.md))            |
| `infra/local`, `infra/firebase` | Docker Compose for local Postgres/PostGIS, Redis, Mailpit; Firebase Storage rules                               |

## Getting started

Requirements: **Node.js 24** (see `.nvmrc`) and **pnpm 12** via Corepack.

```sh
corepack enable pnpm          # once per machine (add --install-directory <dir on PATH> if Node is in a protected folder)
pnpm install
pnpm build                    # builds shared packages first, then the apps
```

Optional local overrides: copy each app's `.env.example` to `.env` (API, mobile) or `.env.local` (web). All variables have safe local defaults, and apps refuse to start with an invalid configuration.

| Task                              | Command                                                                                                                                        |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Run everything in watch mode      | `pnpm dev` (API on :8080, web on :3000, Expo dev server)                                                                                       |
| One app only                      | `pnpm turbo run dev --filter=@fleettrust/api`                                                                                                  |
| Lint / typecheck / test / build   | `pnpm lint` · `pnpm typecheck` · `pnpm test` · `pnpm build`                                                                                    |
| Format                            | `pnpm format` (write) · `pnpm format:check`                                                                                                    |
| Everything CI will run            | `pnpm check`                                                                                                                                   |
| Local Postgres/Redis/Mailpit      | `pnpm infra:up` · `pnpm infra:status` · `pnpm infra:down` (needs Docker; see [local infrastructure](docs/development/local-infrastructure.md)) |
| Firebase Auth + Storage emulators | `pnpm emulators` (needs Java 21+)                                                                                                              |
| Database                          | `pnpm db:migrate` · `pnpm db:seed` · `pnpm db:generate` · `pnpm test:db` (see [database workflow](docs/development/database.md))               |

The mobile app uses Expo. `pnpm --filter @fleettrust/mobile dev` starts the dev server. Native Firebase modules arrive in later stages and will require an Expo **dev build** rather than Expo Go.

## Documentation

| Area                    | Document                                                                                  |
| ----------------------- | ----------------------------------------------------------------------------------------- |
| Requirements            | [docs/product/SRS.md](docs/product/SRS.md)                                                |
| Feature → phase → role  | [docs/product/feature-matrix.md](docs/product/feature-matrix.md)                          |
| Backlog                 | [docs/product/backlog.md](docs/product/backlog.md)                                        |
| Open questions          | [docs/product/open-questions.md](docs/product/open-questions.md)                          |
| Architecture (C4)       | [docs/architecture/c4.md](docs/architecture/c4.md)                                        |
| Decisions               | [docs/adr/](docs/adr/README.md)                                                           |
| Build stages            | [docs/handoff/CHECKLIST.md](docs/handoff/CHECKLIST.md)                                    |
| Prompt pack and overlay | [docs/prompt-pack/](docs/prompt-pack/INDEX.md), [OVERLAY.md](docs/prompt-pack/OVERLAY.md) |

## Stack

TypeScript monorepo (pnpm + Turborepo): Next.js web, React Native (Expo) mobile, NestJS modular-monolith API. PostgreSQL + PostGIS on Cloud SQL. Firebase for authentication, push, storage, App Check and Crashlytics. Everything runs on Google Cloud. See [ADR-0004](docs/adr/0004-firebase-hybrid-platform.md).

## Non-negotiable product rules

- No customer-to-provider payments, escrow, reviews, ratings, reputation scores or rewards.
- Paid plans never buy verification, Power User status or search ranking.
- Emergency features ignore plan quotas and never promise rescue.

These rules are enforced in code where possible. For example, lint rules stop the emergency, verification and search modules from importing entitlements; see `apps/api/eslint.boundaries.js`.

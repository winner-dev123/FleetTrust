# Architecture Decision Records

We record significant decisions as short ADRs ([Nygard format](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)). ADRs are immutable once accepted. To change a decision, add a new ADR that supersedes the old one.

| ADR                                                  | Title                                                                                                                                    | Status                                                                                          |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| [0001](0001-typescript-monorepo.md)                  | TypeScript monorepo with pnpm and Turborepo                                                                                              | Accepted                                                                                        |
| [0002](0002-modular-monolith-api.md)                 | NestJS modular monolith API                                                                                                              | Accepted                                                                                        |
| [0003](0003-postgresql-postgis-system-of-record.md)  | PostgreSQL + PostGIS as the system of record                                                                                             | Accepted                                                                                        |
| [0004](0004-firebase-hybrid-platform.md)             | Firebase hybrid platform on Google Cloud                                                                                                 | Accepted                                                                                        |
| [0005](0005-authn-firebase-authz-api.md)             | Authentication by Firebase, authorization by the API                                                                                     | Accepted                                                                                        |
| [0006](0006-object-storage-and-private-documents.md) | Object storage and private documents                                                                                                     | Accepted                                                                                        |
| [0007](0007-jobs-and-realtime.md)                    | Background jobs, notifications and realtime delivery                                                                                     | Proposed                                                                                        |
| [0008](0008-manual-plan-activation.md)               | Manual plan activation after external billing                                                                                            | Accepted                                                                                        |
| [0009](0009-trust-independent-of-payment.md)         | Trust signals and ranking are independent of payment                                                                                     | Accepted                                                                                        |
| [0010](0010-emergency-exempt-from-quotas.md)         | Emergency functionality is exempt from ordinary quotas                                                                                   | Accepted                                                                                        |
| [0011](0011-future-modules-spec-only.md)             | Future modules are specification-only                                                                                                    | Accepted                                                                                        |
| [0012](0012-local-storage-emulation.md)              | Local object storage uses the Firebase Storage emulator                                                                                  | Accepted                                                                                        |
| [0013](0013-drizzle-orm-and-pglite-tests.md)         | Drizzle ORM, SQL migrations, and PGlite for database tests                                                                               | Accepted                                                                                        |
| [0014](0014-tenancy-and-rbac.md)                     | Tenancy and role-based access in the API, RLS later                                                                                      | Accepted                                                                                        |
| [0015](0015-entitlements-model.md)                   | Entitlements: daily counters, capacity limits, grace                                                                                     | Accepted                                                                                        |
| [0016](0016-verification-documents.md)               | Verification documents: pipeline, encryption, reviewer access                                                                            | Accepted                                                                                        |
| [0017](0017-provider-profile-publication.md)         | Provider profiles: draft, published snapshot, public visibility                                                                          | Accepted                                                                                        |
| [0018](0018-catalog-pricing-and-hours.md)            | Catalog in the snapshot, exact indicative prices, live opening hours                                                                     | Accepted                                                                                        |
| [0019](0019-search-projection-and-ranking.md)        | Search projection, relevance-only ranking, rounded visitor locations                                                                     | Accepted                                                                                        |
| [0020](0020-route-discovery-and-saved-lists.md)      | Route corridors with graceful degradation; link-shared personal lists                                                                    | Accepted                                                                                        |
| [0021](0021-service-requests-and-quotes.md)          | Service requests: atomic quota, informational quotes, staged disclosure, append-only history                                             | Accepted                                                                                        |
| $1 $1 $1                                             | [0025](0025-emergency-incidents-and-dispatch.md)                                                                                         | Emergency: consent-based contacts, dedicated delivery queue, escalation waves, erased locations | Accepted |
| [0026](0026-vehicles-history-and-vault.md)           | Vehicles: per-vehicle access, source-attributed history (never verified), reminders, encrypted vault                                     | Accepted                                                                                        |
| [0027](0027-provider-crm-and-appointments.md)        | Provider CRM: derived pipeline, local-time appointments with a database double-booking guard, response status from history               | Accepted                                                                                        |
| [0028](0028-parts-and-referrals.md)                  | Parts: live time-stamped listings, stale stock labelled, inquiry-only availability; referrals need customer consent and are audited      | Accepted                                                                                        |
| [0029](0029-fleet-operations-and-job-board.md)       | Fleet dashboards from tenant-scoped records, spending never a verified payment, jobs gated by employer verification and moderation       | Accepted                                                                                        |
| [0030](0030-power-user-sanctions-and-appeals.md)     | Power User earned from identity, age, activity and standing (never bought); member sanctions, appeals, shared trust and safety dashboard | Accepted                                                                                        |
| [0031](0031-web-app-and-design-system.md)            | Web app on the shared SDK: token-based design system, built-in tile map, browser tests against a contract-checked mock API               | Accepted                                                                                        |
| [0032](0032-mobile-app.md)                           | Mobile app: Expo dev builds and Expo Router, device ports, web-path deep links, offline drafts, idempotent message outbox                | Accepted                                                                                        |

## Template

```markdown
# ADR-NNNN: Title

- Status: Proposed | Accepted | Superseded by ADR-XXXX
- Date: YYYY-MM-DD

## Context

## Decision

## Consequences

## Alternatives considered
```

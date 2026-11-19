# Stage checklist

Each stage needs explicit owner approval before the next starts. Status values: `todo` · `in progress` · `awaiting approval` · `approved`

| #   | Stage                                      | Status                             | Handoff                      |
| --- | ------------------------------------------ | ---------------------------------- | ---------------------------- |
| 01  | Product requirements and architecture      | approved                           | [prompt-01.md](prompt-01.md) |
| 02  | Monorepo bootstrap                         | approved                           | [prompt-02.md](prompt-02.md) |
| 03  | Local infrastructure                       | approved (start-up verified in CI) | [prompt-03.md](prompt-03.md) |
| 04  | Database and migration foundation          | approved                           | [prompt-04.md](prompt-04.md) |
| 05  | CI/CD and observability foundation         | approved (merged, PR #1)           | [prompt-05.md](prompt-05.md) |
| 06  | Authentication and minimal signup          | approved (merged, PR #6)           | [prompt-06.md](prompt-06.md) |
| 07  | Organizations, memberships and RBAC        | approved (merged, PR #7)           | [prompt-07.md](prompt-07.md) |
| 08  | Subscription catalog and entitlements      | awaiting approval                  | [prompt-08.md](prompt-08.md) |
| 09  | Document verification workflow             | todo                               |                              |
| 10  | Provider profile onboarding                | todo                               |                              |
| 11  | Service catalogs and published pricing     | todo                               |                              |
| 12  | Geospatial provider search                 | todo                               |                              |
| 13  | Route-aware discovery and saved lists      | todo                               |                              |
| 14  | Service requests and quotations            | todo                               |                              |
| 15  | Article publishing and knowledge hub       | todo                               |                              |
| 16  | Friendships and communities                | todo                               |                              |
| 17  | Messaging and community notifications      | todo                               |                              |
| 18  | Emergency assistance and trusted circles   | todo                               |                              |
| 19  | Vehicle profiles and maintenance           | todo                               |                              |
| 20  | Provider CRM and appointments              | todo                               |                              |
| 21  | Parts inventory and provider referrals     | todo                               |                              |
| 22  | Fleet dashboards and job board             | todo                               |                              |
| 23  | Status, power users and moderation         | todo                               |                              |
| 24  | Web product and design system              | todo                               |                              |
| 25  | React Native mobile product                | todo                               |                              |
| 26  | Administration and operations              | todo                               |                              |
| 27  | Security and privacy hardening             | todo                               |                              |
| 28  | Performance, reliability and end-to-end QA | todo                               |                              |
| 29  | Staging, production and launch             | todo                               |                              |
| 30  | Future extensibility specification only    | todo                               |                              |

## Prompt 01 acceptance criteria

- [x] Every approved feature is mapped to a phase and a role ([feature-matrix.md](../product/feature-matrix.md): 82 features across R0/R1/R2/F)
- [x] Exclusions are explicit ([SRS §9](../product/SRS.md#9-explicit-non-goals), [ADR-0011](../adr/0011-future-modules-spec-only.md))
- [x] Unknown jurisdiction and billing questions are tracked ([open-questions.md](../product/open-questions.md): OQ-03, OQ-02, OQ-01, OQ-05, OQ-09, OQ-18)
- [x] Separate individual, provider, fleet and admin experiences are modelled ([SRS §2–3](../product/SRS.md#2-roles))
- [x] Roles, journeys, NFRs, trust model, abuse cases, C4 diagrams, ADRs and backlog are present

## Prompt 02 acceptance criteria

- [x] Clean install works: all `node_modules` and build outputs deleted, then `pnpm install --frozen-lockfile` succeeded
- [x] Lint, typecheck, unit test and build all pass: `turbo run lint typecheck test build --force`, 28/28 tasks, 55 tests
- [x] No secrets committed: `.env*` ignored except `.env.example` placeholders; env errors never echo values (tested)

## Prompt 03 acceptance criteria

- [x] Documented commands for every service (`pnpm infra:*`, `pnpm emulators`; [local-infrastructure.md](../development/local-infrastructure.md))
- [x] Health checks defined for every service, and `pnpm infra:status` reports them
- [x] No public default credentials: random per-developer secrets, `${VAR:?}` in Compose, enforced by tests
- [x] Services actually start and turn healthy: verified in CI (`local-infra` job, [run](https://github.com/winner-dev123/FleetTrust/actions/runs/44585455998)): Compose healthy, credentials enforced, emulators up, Storage rules deny client uploads

## Prompt 04 acceptance criteria

- [x] Migrations apply to a fresh database (PGlite / PG 18 + PostGIS); re-run is a no-op
- [x] Seed is repeatable (second run changes nothing; failures roll back)
- [x] Spatial query tests pass (geodesic accuracy, radius, viewport, GiST index)
- [x] Tenant leak tests planned ([test plan](../qa/tenant-isolation-test-plan.md)) with a working, self-tested harness
- [x] Same migrations verified on **Postgres 17** (CI `database` and `local-infra` jobs, [run](https://github.com/winner-dev123/FleetTrust/actions/runs/44585455998))

## Prompt 05 acceptance criteria

- [x] Pipeline works on a sample PR: PR #1, 5/5 jobs green ([run](https://github.com/winner-dev123/FleetTrust/actions/runs/44585455998))
- [x] Logs redact secrets (unit and e2e tests with planted secrets)
- [x] Backup restoration documented ([runbook](../operations/backup-restore-runbook.md))

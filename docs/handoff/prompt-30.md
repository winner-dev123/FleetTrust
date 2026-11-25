# Handoff — Prompt 30: Future extensibility (specification only)

- Date: 2026-11-25
- Status: **approved** · merged as PR #32 → `1640145` (CI 10/10 green on `6ab2ce2`)
- Prompt 29 approved and merged (PR #31 → `d13425e`).
- This is the **last stage** of the prompt pack.

## Assumptions

- **"Specification only" means documents and checks, nothing executable for the modules** (ADR-0011): no tables, migrations, routes, UI, workers, queues, feature settings, SDKs or event producers. The only code changes are to the repository guard and its tests, which enforce that rule.
- **Event schemas are documentation** (JSON Schema files under `docs/rfcs/events/`). They are never imported or loaded by the application.
- **The RFCs are Draft.** Accepting one is an owner decision that needs a new ADR (superseding ADR-0011 for that module only) and the guard change in the same pull request.

## What was built

| Area                | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| RFCs                | [docs/rfcs](../rfcs/README.md): **0001** rewards, check-ins, streaks and ledger · **0002** payments and escrow · **0003** transaction-backed reviews (text only, no scores) · **0004** AI assistance (advisory only, never in the emergency or trust paths) · **0005** telematics (vehicle health first; positions and ELD a separate later decision) · **0006** multilingual (with an honest baseline: most screen text is still inline). Each RFC covers why it's excluded today, the constraints (trust model, emergency, privacy), the proposed module and the data it would own (described, not created), the seams, the event schemas, a phased expand-only migration path with withdrawal, risks, open questions and exit criteria |
| Event schemas       | 13 proposed events as JSON Schema 2020-12 in [docs/rfcs/events](../rfcs/events/). Outbox envelope metadata, money as decimal strings with ISO 4217 currency, no card or personal free text, and no score fields in the review events by design                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Architecture review | [architecture-review.md](../rfcs/architecture-review.md): verdict, how it was checked, lookalikes that are in scope (and why), migration paths at a glance, residual risks                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Guard               | Extended to the three modules it didn't cover: AI model SDKs, i18n frameworks, telematics SDKs, and the stems `llm`, `embedding`, `telematics`, `geofence`, `translation`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| RFC tests           | [rfcs.test.ts](../../tools/repo-guards/test/rfcs.test.ts) checks that:<br>• every RFC has the required sections<br>• every consumed event **exists in the API today**<br>• every proposed event has a valid schema and **appears nowhere in code**<br>• every schema belongs to an RFC<br>• no future table exists in a migration or the schema                                                                                                                                                                                                                                                                                                                                                                                           |
| ADR                 | [ADR-0011](../adr/0011-future-modules-spec-only.md) gained a Prompt 30 update section                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |

## Acceptance criteria

| Criterion                                                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Architecture review confirms no excluded modules implemented | [architecture-review.md](../rfcs/architecture-review.md):<br>• the guard checks 962 files (42 migrations, routes, UI folders, config keys, dependencies) with no violations<br>• the specification-only and future-table tests pass<br>• the feature settings list is fixed and contains no future-module flag<br>• lookalikes (plans, referral fees, verification reviews, Power User, emergency location, odometer, `Intl` formatting, search ranking, auto-hide) are each explained as in scope<br>All of it runs in `pnpm check` and CI, so it stays true after this stage |
| Clear future migration paths                                 | Every RFC has a phased path: decide (ADR plus guard change) → expand-only migration → shadow or sandbox → pilot → general availability, plus a withdrawal path. The review's table summarises the first safe step, the guard change and the withdrawal for each                                                                                                                                                                                                                                                                                                                |

## Evidence (actual results)

- **`pnpm check`:** passes locally (prettier, rollback guard: 42 migrations, module guard: 962 files, 45/45 turbo tasks; API 373). Drift check: no schema changes.
- **Tests:** repo-guards **74** (was 44): 21 RFC tests and 9 new guard cases. Every other suite is unchanged.
- **Checked that the new tests catch regressions:**
  - an RFC citing an event that doesn't exist fails the seams test;
  - a proposed event name placed in API code fails the specification-only test.

## Not built here (by design)

- **No module code of any kind** (ADR-0011).
- **Recommended follow-up (in scope under SRS §7, independent of choosing languages):** extract inline screen text into an English catalog (RFC-0006 step 1).

## Project status after 30 stages

Built and merged:

- the product (API, web, mobile) with verification, search, requests, messaging, emergency, vehicles, CRM, parts, fleets, moderation and admin;
- security and privacy hardening;
- performance SLOs with load tests and a restore drill;
- release engineering: Terraform, release workflows, rehearsed rollback.

The remaining work is **owner actions to launch**, listed in the [go/no-go checklist](../launch/go-no-go.md):

- cloud projects and billing;
- `terraform apply`;
- Firebase and domains;
- first releases;
- the staging rollback and point-in-time restore drills;
- legal review;
- jurisdiction (OQ-03);
- email and map vendors;
- store accounts;
- filling the pilot allowlist;
- signing the checklist.

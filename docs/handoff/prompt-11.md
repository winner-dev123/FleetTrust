# Handoff — Prompt 11: Service catalogs and published pricing

- Date: 2026-11-19
- Status: **awaiting owner approval** · branch `feat/prompt-11-catalog`
- Prompt 10 approved and merged (PR #11 → `ddb185e`).

## Assumptions

- **Catalog and prices go through publication.** Offerings and prices join the profile draft and the published snapshot (ADR-0017). A price change goes public when an owner or admin republishes.
- **Opening hours are live.** Hours and holiday exceptions are not frozen, so closures show at once. This amends ADR-0017's expectation that hours would join the snapshot ([ADR-0018](../adr/0018-catalog-pricing-and-hours.md)).
- **Amounts are exact decimal strings.** Precision is capped at the currency's display decimals (no ISO minor-unit data exists). No FX conversion (SRS A-05).
- **Branch-scoped managers** manage hours and offerings for their own branch only (SRS §2.2), and can't publish.
- **Service radius** already exists per branch (Prompt 10). This stage adds `at_customer` offerings, which require it.
- **Labels are English** (locale `en` by default; `formatIndicativePrice` takes a locale). Translation comes with i18n.
- **Not built yet:** the catalog and hours UI (web Prompt 24, mobile Prompt 25), and the search "open now" filter (Prompt 12, which reads `branch_opening_hours`).

## What was built

| Area        | Details                                                                                                                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data        | `provider_offerings` (price-shape check, currency FK, `numeric(14,4)`); `provider_offering_branches` and `branch_opening_hours` and `branch_hours_exceptions` (composite same-tenant FKs, cascade with the branch); `branches.time_zone`, `hours_updated_at`. Migrations `0013`, `0014`                                      |
| Offerings   | Category, name, description, vehicle compatibility, `at_premises`/`at_customer`, optional branches, sort order; create / list / replace / delete; 200 per provider                                                                                                                                                           |
| Prices      | `fixed`, `from`, `range`, `quote_required`, with currency and unit. Validated: active currency, precision per currency, range max > min, amounts > 0                                                                                                                                                                         |
| Publication | New wizard steps `catalog` (blocking fit checks: category chosen, vehicle types served, a publishable branch, radius for `at_customer`) and `hours` (optional). Offerings are frozen into the snapshot; draft price edits stay private until republished                                                                     |
| Public view | `catalog: { disclaimer, offerings[] }` with `indicative: true` and a `label` on every price. Each branch gains `timeZone` and live `hours { weekly, exceptions (60 days), status }`                                                                                                                                          |
| Hours       | Weekly intervals (overnight allowed, up to 4 per day, no overlaps), branch IANA timezone with fallback to the organization's, holiday exceptions (closed or special hours) for the local today up to two years ahead. "Not provided" is distinct from "closed"                                                               |
| Shared code | `openingStatus()` (DST-aware via `Intl`, overnight spill, merged intervals, local `closesAt`/`opensAt`) and `formatIndicativePrice()` in `@fleettrust/types` for API, web and mobile                                                                                                                                         |
| Permissions | `catalog.manage` and `hours.manage` for owner, admin and manager; branch-scoped managers limited to their branch                                                                                                                                                                                                             |
| Platform    | `CLOCK` moved to a global `platform/clock` module, so providers and search don't depend on entitlements                                                                                                                                                                                                                      |
| SDK / docs  | 8 methods (`offerings`, `createOffering`, `replaceOffering`, `deleteOffering`, `branchHours`, `saveBranchHours`, `saveHoursException`, `removeHoursException`); [ADR-0018](../adr/0018-catalog-pricing-and-hours.md); [architecture/catalog-and-hours.md](../architecture/catalog-and-hours.md) (API reference and examples) |

## Acceptance criteria

| Criterion                        | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Price display clearly indicative | **API:** every public price has `indicative: true` and a typed label ("£95.00 per vehicle", "From …", "a–b", "Price on request (quote required)"), and the catalog always carries the disclaimer (`catalog.e2e-spec.ts`). **Types:** labels never contain buy, pay, checkout, cart or order (`catalog.test.ts`)                                                 |
| No checkout                      | No payment fields in the public payload; `POST /v1/providers/:slug/checkout` → 404; offerings reject unknown fields such as `checkoutUrl`; the ADR-0011 repo guards still pass                                                                                                                                                                                  |
| Validation tests pass            | **Catalog:** all four price types round-trip exactly. Rejected: unknown currency, too many decimals (JPY), another tenant's branch, range max ≤ min, numeric amounts, empty vehicle types. Plus the 200-offering cap, DB checks on raw inserts, fit issues blocking publish, and permissions. **Hours:** overlap, bad times, unknown timezone, bad dates        |
| Timezone tests pass              | **Unit:** London spring and autumn DST, Auckland's local date ahead of UTC, Kolkata's half-hour offset, overnight intervals, merging across midnight, 24/7, holidays and special days. **e2e:** London vs Tokyo for the same instant, organization-timezone fallback (New York), exception dates checked against the branch's own calendar (Auckland vs London) |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                         |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **186** (+14 catalog/hours e2e), db 63 (+4 skipped PG-only), types **43** (+40), sdk **18** (+1), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                            |

## Migration notes

- **`0013` is additive:** four new tables and two nullable `branches` columns. No backfill, safe on existing rows. No hand edits were needed this time.
- **`0014`:** `updated_at` triggers.
- **Earlier snapshots:** profiles published before this stage have no catalog. They show an empty one and `hasUnpublishedChanges: true` until republished.

## Before production (owner)

- Nothing new to configure: no new environment variables or buckets.
- Optionally decide whether plans should limit catalog size. Today it's a flat 200 per provider.

## Next: Prompt 12 — Geospatial provider search

Nearby and bounding-box search over published snapshots (GiST), with filters for category, open now (from `branch_opening_hours`), verification, vehicle type, distance and service radius. Visitors get approximate locations.

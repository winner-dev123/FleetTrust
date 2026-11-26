# Architecture review: excluded modules (Prompt 30)

- **Date:** 2026-11-25
- **Scope:** the whole repository at the end of Prompt 30: API, web, mobile, database, packages, tools, workflows and infrastructure.
- **Question 1:** is any excluded module ([SRS §9](../product/SRS.md#9-explicit-non-goals), [ADR-0011](../adr/0011-future-modules-spec-only.md)) implemented, partly or behind a flag?
- **Question 2:** does each one have a clear future migration path?

## Verdict

1. **No excluded module is implemented.** There is no table, migration, API route, UI screen, worker, queue, feature setting, SDK or event for rewards, payments/escrow, reviews, AI, telematics or multilingual content. This is checked automatically on every pull request, not only by reading.
2. **Every excluded module has an RFC** with:
   - integration seams on events that exist today (verified by a test);
   - proposed event schemas that don't exist in code (verified by a test);
   - a phased, expand-only migration path with a withdrawal path;
   - risks and exit criteria.

## How it was checked

| Check                                                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           | Result                                                    | Runs                                                    |
| ------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------- | ------------------------------------------------------- |
| **Module guard** ([rules.ts](../../tools/repo-guards/src/rules.ts))            | Table and column names in all 42 migrations; API route decorators; UI route folders (web and mobile); configuration keys; dependencies. Stems: `escrow`, `payout`, `rating`, `reward`, `streak`, `checkout`, `cart`, `basket`, `reservation`, `commission`, `wallet`, `ledger`, `testimonial`, payment SDK names, `review(s)` outside verification; **added in Prompt 30:** `llm`, `embedding`, `telematics`, `geofence`, `translation`, plus AI model SDKs, i18n frameworks and telematics SDKs | **962 files, no violations**                              | `pnpm check`, CI                                        |
| **RFC seams test** ([rfcs.test.ts](../../tools/repo-guards/test/rfcs.test.ts)) | Every event an RFC consumes exists in the API source today                                                                                                                                                                                                                                                                                                                                                                                                                                       | Pass                                                      | `pnpm check`, CI                                        |
| **Specification-only test** (same file)                                        | None of the 13 proposed events appears in any app, package or tool                                                                                                                                                                                                                                                                                                                                                                                                                               | Pass                                                      | `pnpm check`, CI                                        |
| **Future tables test** (same file)                                             | None of the future tables named in the RFCs exists in a migration or the Drizzle schema                                                                                                                                                                                                                                                                                                                                                                                                          | Pass                                                      | `pnpm check`, CI                                        |
| **Feature settings**                                                           | The complete list is fixed in code (`FEATURE_SETTINGS`): `signups.paused`, `signups.pilot_allowlist`, `community.auto_hide_reporters`, `site.notice`. No flag for any future module                                                                                                                                                                                                                                                                                                              | Reviewed                                                  | Code review; `admin.e2e-spec.ts` asserts the exact list |
| **Inventory**                                                                  | 90 tables, about 381 API route handlers, 55 web pages, 18 app screens, read for anything resembling an excluded module                                                                                                                                                                                                                                                                                                                                                                           | No excluded module found; the lookalikes are listed below | This review                                             |
| **Guard tests**                                                                | Each guard rule has positive and negative cases, including the new AI, i18n and telematics rules                                                                                                                                                                                                                                                                                                                                                                                                 | Pass (74 tests)                                           | CI                                                      |

The guard and tests were themselves checked against deliberate regressions during the review:

- an RFC citing an event that doesn't exist fails the seams test;
- a proposed event name added to API code fails the specification-only test;
- the new dependency and table rules flag the intended packages and names, and leave today's columns alone.

## Lookalikes: in scope, and why they aren't the excluded module

| Exists today                                                   | Looks like                 | Why it's in scope                                                                                                                                             |
| -------------------------------------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Plans, quotas, `plan_assignments` (ADR-0008, ADR-0015)         | Payments                   | Plans are activated **manually** after payment arranged outside FleetTrust. No payment data, SDK or route exists, and plans never affect trust (ADR-0009)     |
| Referral fees on `provider_referrals` (ADR-0028)               | Commissions                | Fees are **disclosed, never processed** (AB-17)                                                                                                               |
| Verification reviews (`verification_cases`, ADR-0016)          | Reviews                    | Staff reviewing identity and business evidence; not customer opinions. The guard exempts the verification context explicitly                                  |
| Power User status (ADR-0030)                                   | Rewards and gamification   | Earned from verified identity, account age and good standing, and revocable. There are no points, streaks or ledger, and it never affects ranking             |
| Emergency location sharing (ADR-0025)                          | Telematics / live tracking | One person shares a position with chosen contacts for one incident they raised. Nothing is collected continuously, and there are no devices                   |
| `vehicles.odometer_km`, maintenance schedules (ADR-0026)       | Telematics                 | Entered by people. RFC-0005 would feed the same column from devices later                                                                                     |
| `Intl` formatting in `format.ts`, central labels               | Multilingual               | SRS §7 asks for locale-aware formatting and externalised strings at launch. The locale is fixed to English, and no translation tables or i18n framework exist |
| Search ranking (ADR-0019)                                      | AI recommendations         | Deterministic, documented weights (text, distance, coverage, open now). No model and no personalisation                                                       |
| Content moderation auto-hide (`community.auto_hide_reporters`) | AI moderation              | A count of distinct human reports hides content until a **moderator** decides. No model is involved                                                           |

## Migration paths at a glance

| RFC                                                      | First safe step                                              | Guard change needed when accepted                                       | Withdrawal                                                   |
| -------------------------------------------------------- | ------------------------------------------------------------ | ----------------------------------------------------------------------- | ------------------------------------------------------------ |
| [0001 Rewards](0001-rewards-check-ins-streaks-ledger.md) | Shadow-mode ledger on existing events; nothing shown         | Allow `engagement_*` tables (narrow `reward`, `streak`, `ledger`)       | Stop consuming events; export, then contract                 |
| [0002 Payments](0002-payments-and-escrow.md)             | PSP sandbox end to end in staging                            | Allow the chosen PSP SDK and the `payments` module routes only          | Refund or settle open intents; keep legally required records |
| [0003 Reviews](0003-transaction-backed-reviews.md)       | Collect accounts visible to the provider only                | None for the name (`accounts`); add a test forbidding aggregate columns | Hide, export to authors, contract                            |
| [0004 AI](0004-ai-features.md)                           | Offline evaluation, then staff-only triage                   | Allow one AI SDK inside `assist` only                                   | Stop calling the port; delete suggestions                    |
| [0005 Telematics](0005-telematics.md)                    | Shadow ingestion compared with manual odometer entries       | Allow `telematics_*` tables                                             | Disconnect vendors; keep the manual odometer                 |
| [0006 Multilingual](0006-multilingual.md)                | Extract English strings into a catalog (no behaviour change) | Allow the chosen i18n library                                           | Remove the language; English stays complete                  |

All paths share the release rules from [release-and-rollback.md](../operations/release-and-rollback.md):

- expand-only migrations, protected by the rollback guard;
- candidate revisions and rehearsed rollback;
- a new ADR that supersedes ADR-0011 for exactly that module, in the same pull request as the guard change.

## Residual risks and follow-ups

- **The guard works on names.** A determined implementation under neutral names could slip past it. Mitigation: ADR-0011 stays a review rule, and design reviews check new modules against SRS §9.
- **Multilingual readiness: English extraction done.** The text of the mobile app and the website is in the English catalog (`@fleettrust/copy`), and both have guard tests. What remains is the owner's decision on languages and translation workflow (RFC-0006 step 2) before any translation work.
- **RFCs age.** Revisit them at each roadmap review. The seams test fails if an event they rely on is renamed or removed, which keeps them honest.

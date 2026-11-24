# Handoff — Prompt 21: Parts inventory and provider referrals

- Date: 2026-11-24
- Status: **approved** · merged as PR #23 → `6848643` (CI 5/5 green on `8aff8c7`)
- Prompt 20 approved and merged (PR #22 → `3778406`).

## Assumptions

- **Parts are live listings** with a stock confirmation time. They are not part of the published profile snapshot, because stock changes daily.
- **"No checkout"** also means no cart, reservation or "hold for me" (SRS §8: inquiry only). An availability answer is information only.
- **Stale stock:**
  - The ages are fresh up to 3 days, aging up to 14 days and stale up to 90 days.
  - After 90 days a listing leaves public search until the provider confirms it again.
  - Stale listings stay visible with a clear label, because "they had it two weeks ago" is still a useful lead.
- **Who edits:**
  - **Editors:** the new `parts.manage` permission (owner, admin, manager; branch-scoped managers edit their branch's stock).
  - **Counter staff** (`requests.respond`) confirm stock and answer inquiries for their branch.
- **Referrals:**
  - A provider that received a request suggests another provider, and must declare any business relationship or referral fee.
  - **Nothing reaches the other provider until the customer consents.**
  - The customer chooses whether photos are shared and whether the referrer sees the outcome.
  - FleetTrust never processes referral fees.
- **Not built:** bulk import (CSV), inventory feeds, provider opt-out from referrals, an admin referral screen (Prompt 26), the UI (Prompts 24 and 25).

## What was built

| Area             | Details                                                                                                                                                                                                                                                         |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data             | `parts`, `part_compatibility`, `part_inquiries`, `provider_referrals`. Migrations `0033` and `0034` (referral guard trigger, `updated_at` triggers)                                                                                                             |
| Listings         | Create, replace, archive, delete; compatibility ranges; indicative price (catalog rules); stock status, count and confirmation time; "needs a check" list (`stale=true`)                                                                                        |
| Stock labels     | `fresh` / `aging` / `stale` / `expired` with one ready-made label for every client; stale stock shows no count and is left out of "in stock only"                                                                                                               |
| Public search    | `GET /v1/parts` (visitors, approximate distances), `/v1/parts/full` (signed in, exact distances, `vehicleId`), `GET /v1/parts/:id`; text, part number in any format, category, condition, vehicle compatibility, provider, distance                             |
| Inquiries        | People and fleets ask; branch staff answer `available` / `not_available` / `can_order`; answering confirms the stock; close; 14-day expiry; notifications `part_inquiry`, `part_inquiry_answered`                                                               |
| Referrals        | Refer with reason and declared relationship; customer consents (explicit `consent: true`, photo and outcome choices) or declines; referrer withdraws; receiver gets a normal inquiry marked `referredBy`; notifications `referral_proposed`, `referral_decided` |
| Audit            | `audit_events` for parts and every referral step; request history events; stored consent text and version; database trigger keeps the disclosure and decisions unchangeable                                                                                     |
| Guard, SDK, docs | Repository guard rejects `cart`, `basket`, `reservation`, `commission`; 20 SDK methods; [ADR-0028](../adr/0028-parts-and-referrals.md); [architecture/parts-and-referrals.md](../architecture/parts-and-referrals.md)                                           |

## Acceptance criteria

| Criterion                    | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| No checkout                  | **Schema:** no price, hold, order or payment columns on `part_inquiries`; listing prices use the indicative price shape and carry `PARTS_DISCLAIMER`. <br>**API** (`parts.e2e-spec.ts`): `POST /v1/parts/:id/checkout`, `cart`, `reserve` and `order` all return 404; the inquiry DTO has no price. <br>**Guard:** the ADR-0011 module guard now also flags `cart`, `basket`, `reservation` and `commission` routes and tables (`rules.test.ts`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| Stale stock clearly labelled | **Unit** (`parts.test.ts`): the age boundaries (3, 14 and 90 days), and stale labels never read as a plain "In stock". <br>**API:** after 20 days the public listing says "Stock not confirmed for 20 days (last reported: in stock). It may have changed: ask the provider.", shows no count, and drops out of `inStockOnly`; the provider's `stale=true` list shows it; a stock confirmation or an inquiry answer makes it fresh again; after 120 days it leaves public search and `GET /v1/parts/:id` returns 404. <br>**Checked that the test catches a regression:** showing the count on stale stock makes it fail.                                                                                                                                                                                                                                                                                                                                                                                                           |
| Referrals auditable          | **Database** (`referrals.test.ts`): the disclosure (target, message, relationship, details) can't be changed; a decision can't be reversed; rows can't be deleted while the request exists; a relationship must be described; consent needs its consent text. <br>**API:** `audit_events` has `referral.proposed` (with relationship and details), `referral.consented` (with sharing choices and consent version), `referral.withdrawn` and `referral.declined`; each referral DTO shows its history; the request history shows the steps to the customer. <br>**Consent and visibility:** before consent the receiver sees no inquiry, no referral and gets 404; `consent: false` or missing is refused; the receiver gets no photo without photo consent (DTO and download); the referrer sees the outcome only if allowed. <br>**Checked that the tests catch a regression:** each of these breaks the test: showing pending referrals to the receiver, skipping the consent audit event, sharing photos regardless of consent. |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                                                      |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard (606 files), 39/39 turbo tasks. Tests: api **317** (+5 parts and referrals e2e), types **70** (+7), sdk **28** (+1), db **92** + 6 PG-only skipped locally (+4 referral and parts constraint tests), repo-guards **25** (+3), web 18, local-infra 44, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                                                         |

## Migration notes

- **`0033`** adds four tables.
- **`0034`** adds the `provider_referrals_guard()` trigger function, its update and delete triggers, and `updated_at` triggers for `parts`, `part_inquiries` and `provider_referrals`.
- Both are additive, with no backfill and no new extension.

## Before production (owner)

- Nothing new to configure.

## Next: Prompt 22 — Fleet dashboards and job board

See [the prompt](../prompt-pack/22-fleet-dashboards-and-job-board.md).

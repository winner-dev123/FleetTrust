# Handoff — Prompt 23: Status, power users and moderation

- Date: 2026-11-24
- Status: **approved** · merged as PR #25 → `fd20171` (CI 5/5 green on `dc46329`)
- Prompt 22 approved and merged (PR #24 → `7bbfe0b`).

## Assumptions

- **Verified identity means an active verified-driver badge**, the only person-level identity badge so far.
- **Power User is claimed by the person** once every rule passes. No moderator or staff member grants it, because the label must not be an endorsement (SRS §8.1).
- **Activity counts only the person's own visible contributions:** published articles, visible comments and completed service requests. Each kind is capped, with minimum days and kinds, so farming one action doesn't work.
- **Standing:** no upheld human moderation decision in 180 days. Overturned decisions and automatic flags don't count.
- **Sanctions:** member sanctions (warning, suspension) were deferred from Prompt 15 and are built here. Suspended members can still see and appeal their sanctions. An account suspended without a suspension record (for example by an operator script) stays suspended: only ended moderation suspensions reactivate an account.
- **The dashboard is shared** by trust and safety moderators and verification reviewers.
- **Not built:** automatic sanctions, the admin console UI (Prompt 26), an identity-only badge for people who aren't drivers (OQ-14).

## What was built

| Area       | Details                                                                                                                                                                                                                                                         |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data       | `power_user_status`, `member_sanctions` (history kept by a trigger), `moderation_appeals` (one per decision); new moderation actions `warn`, `suspend`, `lift_suspension`, `revoke_power_user`, `appeal_upheld`, `appeal_overturned`. Migrations `0037`, `0038` |
| Power User | Rules with an explanation for each; claim; public label (visitors included) that follows the identity badge and suspension; revocation by moderators or by any sanction; reinstated when an appeal is overturned                                                |
| Sanctions  | Warning; suspension for some days or until lifted; resolves open reports; lift; suspension ends by itself when it runs out; `@AllowSuspended()` for sanctions and appeals                                                                                       |
| Appeals    | Sanction, Power User revocation, or content decision (reject or hide); 30-day window; decided by a different moderator; overturning undoes the decision                                                                                                         |
| Dashboard  | Reports (by target, by reason, 14 days), waiting moderation, appeals, suspensions and warnings, Power Users, verification queue, flagged emergencies, recent audited actions; member history                                                                    |
| Guards     | Lint rule: `verification`, `power-user`, `search` can't import plan or quota tables; `PlatformRoleRequired` accepts several roles                                                                                                                               |
| SDK, docs  | 13 SDK methods; [ADR-0030](../adr/0030-power-user-sanctions-and-appeals.md); [architecture/trust-and-safety.md](../architecture/trust-and-safety.md)                                                                                                            |

## Acceptance criteria

| Criterion                                          | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Paid plans can't buy verified or Power User badges | **Design:** no plan or payment input exists in the rules or the tables. <br>**Lint:** the modules can't import entitlements **or** plan and quota tables (`module-boundaries.spec.ts`, 3 new cases). <br>**API** (`trust.e2e-spec.ts`): a billing operator assigns the paid `personal-plus` plan, and eligibility is identical, claiming still fails (`not_eligible`) and no verification label changes. <br>**Checked that the test catches a regression:** counting a plan assignment as identity makes it fail.                                                                                                                                                                                                                                                                                                                                                                                                |
| No review-based reputation                         | **Types** (`trust.test.ts`): the rules and criteria are exactly identity, age, activity and standing, with no plan, rating, review or endorsement fields. <br>**API:** the eligibility response has exactly those four criteria and nothing matching rating, review, plan or paid. <br>**Activity:** it counts only the person's own contributions; 25 comments alone (one kind) don't qualify. <br>**Guard:** the repository guard (ADR-0011) still rejects rating and review tables and routes. <br>**Checked that the test catches a regression:** removing the "at least two kinds" rule makes it fail.                                                                                                                                                                                                                                                                                                       |
| Revocation, appeals, audit (task)                  | **Flow:** a warning revokes Power User and breaks standing; appeals by the member; the deciding moderator gets 409 `own_decision`; a second moderator overturns, the warning is marked overturned and Power User is reinstated. <br>**Suspensions:** a suspended member gets 403 except on sanctions and appeals; a lift reactivates; a suspension that has ended reactivates on the next request. <br>**Content:** a hidden article comes back when the appeal is overturned. <br>**History:** the member history shows the audit trail (granted, warned, revoked, appeal overturned, reinstated). <br>**Database** (`trust.test.ts`): sanctions can't be deleted; a revocation needs a reason; one appeal per decision; a decision needs a reason. <br>**Checked that the tests catch a regression:** ignoring sanctions in standing makes the test fail, and so does letting deciders decide their own appeal. |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                                            |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard (649 files), 39/39 turbo tasks. Tests: api **326** (+4 trust e2e, +3 module-boundary cases), types **76** (+2), sdk **30** (+1), db **96** + 6 PG-only skipped locally (+2 trust constraint tests), web 18, local-infra 44, repo-guards 25, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                                               |

## Found in passing (not fixed here)

Two Prompt 09 checks don't refuse a missing note, because a length check on NULL passes in Postgres:

- `verification_badges_revocation_reason`;
- `verification_cases_reason_required`.

The API always sends a note, so this only matters for direct database writes. Proposed fix: Prompt 27 (security hardening). The same mistake was caught in this prompt's own checks by the new database test and fixed before commit.

## CI fix (Prompt 20 test)

The first CI run of this branch failed one check, in the Compose Postgres job: the Prompt 20 test where 10 transactions book the same slot at once.

- **What happened:** exactly one booking still succeeded. But one of the refused transactions got Postgres error `40P01` (deadlock) instead of `23P01` (exclusion violation).
- **Why:** Postgres documents that simultaneous inserts into an exclusion-constrained index can abort one of them as a deadlock.
- **The API is not affected:** it takes a per-staff lock before booking, so the two inserts never run at the same time.
- **The fix:** the test now accepts either refusal code, still requires exactly one success, and also checks that only one booked row exists.
- **Verification:** the test can't run on this machine (no Docker; it needs real Postgres), so CI checks it.

## Migration notes

- **`0037`:**
  - adds three tables;
  - widens the `moderation_actions` action check.
- **`0038`** adds the sanction-history trigger and the `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- Nothing new to configure. **OQ-14** (identity evidence) now also decides who can become a Power User.

## Next: Prompt 24 — Web product and design system

See [the prompt](../prompt-pack/24-web-product-and-design-system.md).

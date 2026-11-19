# Handoff — Prompt 08: Subscription catalog and entitlements

- Date: 2026-11-19
- Status: **awaiting owner approval** · branch `feat/prompt-08-entitlements`
- Prompt 07 approved and merged (PR #7 → `8a250d9`).

## Assumptions

- **Catalog as code.** Plans are defined in `packages/db/src/seed/plans.data.ts` and published by `pnpm db:seed`. Limits and prices are **samples** (OQ-09); prices are display-only (OQ-18).
- **Billing operators are platform staff** in a new `platform_staff` table, granted through `pnpm db:staff`. There is no API for granting roles until the admin console adds MFA (Prompt 26).
- **Daily reset at local midnight**, in the organization's or user's timezone, UTC by default (OQ-08 default).
- Friend requests, service requests, articles and groups don't exist yet. Their quotas are defined and the consumption mechanism is tested; each feature prompt (14–16) calls `consume()`. Staff seats and branches exist and are enforced now.

## What was built

| Area       | Details                                                                                                                                                                                                                                                                                                                                                    |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data       | `plans`, `plan_versions` (immutable once published, by trigger), `plan_version_limits`, `plan_assignments` (operator, external reference, invoice number, note, grace days, term, end reason), `quota_overrides`, `quota_counters`, `quota_consumptions` (idempotency), `platform_staff`; `timezone` on users and organizations. Migrations `0007`, `0008` |
| Catalog    | 6 sample plans: personal free/plus, provider free/pro, fleet free/pro. One default per audience. Re-seeding with changed terms publishes v+1 and retires the old version                                                                                                                                                                                   |
| Quotas     | Daily: one conditional upsert per consumption (atomic), optional idempotency key, runs in a savepoint inside the caller's transaction. Capacity: counted from live data under the organization lock                                                                                                                                                        |
| Resolution | Active assignment → default plan; ended assignments within their own grace period lift limits; open overrides replace them. `GET /v1/me/entitlements`, `GET /v1/orgs/:orgId/entitlements` with usage meters and `overLimit`                                                                                                                                |
| Enforced   | `branches.max` on branch creation; `staff.seats` on invitations (members + pending) and acceptance (members). 403 `quota_exceeded` with `key`, `limit`, `used`                                                                                                                                                                                             |
| Operators  | `/v1/admin/billing/*`: catalog, account view (meters + history), assign (supersedes), end, set/revoke overrides. 404 for non-staff, revocation-checked, all audited as `admin`. No payment wording                                                                                                                                                         |
| Timezones  | `PATCH /v1/me` and `PATCH /v1/orgs/:orgId` accept `timeZone` (validated IANA name)                                                                                                                                                                                                                                                                         |
| SDK / web  | `myEntitlements()`, `organizationEntitlements()`, entitlement error reasons. The account page shows the plan ("Activated by FleetTrust staff on …") and usage                                                                                                                                                                                              |
| Tests      | The PGlite snapshot now includes the seed (currencies, catalog)                                                                                                                                                                                                                                                                                            |
| Docs       | [ADR-0015](../adr/0015-entitlements-model.md), [plans-and-entitlements.md](../architecture/plans-and-entitlements.md) (capabilities, catalog, usage in features, API, staff CLI, downgrade behaviour)                                                                                                                                                      |

## Acceptance criteria

| Criterion                            | Evidence                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Concurrent quota tests pass          | PGlite: 20 parallel consumptions, limit 5 → exactly 5. API: 30 parallel friend-request consumptions → exactly 20 (plan limit). HTTP: 8 parallel branch creations, limit 3 → exactly 3 rows. Idempotency: 4–5 retries with one key → counted once. **Real Postgres 17, 10 connections** (CI `database` job): 40 parallel, limit 7 → exactly 7; 20 parallel same-key retries → 1 |
| Plan downgrades safe                 | Pro → free with 7 branches: during Pro's grace period the limit stays 20 (`source: grace`); after it, creation → 403 while all 7 branches remain listed, renamable and deletable; meters show `overLimit`. Ending an assignment falls back to the default plan. Accepting an old invitation after a seat downgrade is refused                                                  |
| Emergency exempt from standard quota | No emergency capability exists in the catalog (asserted); `consume()` refuses unknown keys (asserted); lint forbids the emergency module from importing entitlements (existing boundary test). The incident-with-exhausted-quotas test comes with the emergency module (Prompt 18), as ADR-0010 requires                                                                       |
| Override audit logs                  | `entitlement.override_set` / `override_revoked` with actor, key, limit, reason and the replaced override. `plan.assigned` and `plan.assignment_ended` carry the external reference, grace days and superseded IDs. Asserted to contain no payment wording                                                                                                                      |
| Daily reset semantics                | Counters keyed by local day; a user in `Pacific/Auckland` at their limit can act again after local midnight (clock moved); the local date is checked against UTC, Auckland and Honolulu boundaries                                                                                                                                                                             |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                         |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **125** (+18), db **63** (+11), sdk **15** (+1), web 18, local-infra 44, repo-guards 22, ui 22, env 5, types 3, mobile unchanged |
| Schema drift                    | "No schema changes"                                                                                                                                                                            |
| Postgres 17 concurrency test    | Not runnable locally (no Docker); runs in CI's `database` job on this PR                                                                                                                       |

## Decisions and notes

- **Grace belongs to the assignment being left** (ADR-0015 §5). To give a customer 30 days of Pro limits after a lapse, set `graceDays: 30` on their **Pro** assignment.
- **Migration notes:** `0007` adds the tables plus a `timezone` column on `users` and `organizations` (`DEFAULT 'UTC'`, safe on existing rows). `0008` adds `updated_at` triggers and the plan-version immutability triggers. Run `pnpm db:seed` after migrating, or the API refuses to resolve entitlements ("No default plan … run pnpm db:seed").
- **Breaking-ish response change:** `MeResponse` and `OrganizationDto` gained `timeZone`. Clients built from this SDK version expect it; the API always sends it.
- `consume()` must be called inside the creating transaction (documented). A purge job for old counter rows is left for the jobs runtime.

## Before production (owner)

- Decide the real catalog (OQ-09), payment channel and reference format (OQ-05), and price display/tax (OQ-18). Then edit `plans.data.ts` and seed.
- Grant billing operators with `pnpm db:staff grant <email> billing_operator` against production (they must have signed in once).

## Next: Prompt 09 — Document verification workflow

Verification cases, document uploads to private Storage, reviewer queue, badges granted/denied/revoked with reasons, appeals; independent of plans (ADR-0009, lint-enforced).

# Handoff — Prompt 22: Fleet dashboards and job board

- Date: 2026-11-24
- Status: **awaiting owner approval** · branch `feat/prompt-22-fleet`
- Prompt 21 approved and merged (PR #23 → `6848643`).

## Assumptions

- **Fleet incidents are a new, separate record** (breakdown, accident, damage, theft, fine). Personal emergency alerts from Prompt 18 stay private to the person and never appear on a fleet dashboard.
- **Who does what:**
  - **Managers** (`vehicles.manage`) see dashboards, incidents and spending for their branch scope.
  - **The driver assigned to a vehicle** records incidents and spending for it and sees only their own entries.
  - **Preferred providers** use the request permissions: `requests.create` reads, `requests.manage` edits.
- **Spending records** are typed in by people. They are always labelled "not verified payments", summed per currency and never converted. Service record costs from Prompt 19 count too, shown separately.
- **Employer verification reuses the business badge** from Prompt 09. Verified employers publish directly unless the text mentions fees or deposits; everyone else goes through moderation.
- **Recruiters** get the new `jobs.manage` permission and nothing else.
- **Not built:** expense receipts and export, currency conversion, CV uploads, job alerts, incident photos, the UI (Prompts 24 and 25).

## What was built

| Area                | Details                                                                                                                                                                                                             |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data                | `fleet_incidents`, `fleet_expenses`, `fleet_preferred_providers`, `jobs`, `job_applications`; unique `vehicles(id, organization_id)`; `job` added to report and moderation targets. Migrations `0035` and `0036`    |
| Dashboard           | Vehicles and drivers, maintenance status with the most urgent items, documents expiring, incidents, service requests, spending per currency (expenses and service records), branch-scoped                           |
| Incidents           | Report (driver or manager), list, resolve and reopen (managers); audited                                                                                                                                            |
| Spending            | Create, list (date, vehicle, category filters), correct, delete; organization-level costs for organization-wide managers; `verified: false` and a disclaimer on everything                                          |
| Preferred providers | Fleet-wide or per branch, with categories and a note; drivers see; providers see a count only                                                                                                                       |
| Jobs                | Drafts, publish (direct or moderated), edit (checked again), close, delete; public board with filters and `verifiedOnly`; applications with typed contact details; shortlist, reject, hire; withdraw; notifications |
| Moderation          | Job listings in the queue; reports (three reporters hide a listing); approve, reject, hide, restore, dismiss; the employer is notified                                                                              |
| SDK, docs           | 29 SDK methods; [ADR-0029](../adr/0029-fleet-operations-and-job-board.md); [architecture/fleet-and-jobs.md](../architecture/fleet-and-jobs.md)                                                                      |

## Acceptance criteria

| Criterion                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fleet tenant isolation                            | **Database** (`fleet.test.ts`): an expense or incident pointing at another fleet's vehicle fails (`23503`); a provider can't own fleet expenses or jobs (`23503`). <br>**API** (`fleet.e2e-spec.ts`): <br>• Another fleet's owner gets 404 on incidents, expenses, dashboard, preferred providers, jobs and applications. <br>• The driver can't record on an unassigned vehicle and sees only their own entries. <br>• The North manager sees only North, and gets 403 on Main's dashboard. <br>• Recruiters get 403 on dashboard and vehicles. <br>• Providers see only a count. <br>**Checked that the tests catch a regression:** dropping the branch filter on incidents makes the test fail, and so does ignoring the branch on the dashboard. |
| Job posting moderation                            | **Publishing:** an unverified employer's listing goes to `pending_moderation`, stays off the public board, appears in the moderation queue, and goes live only after approval, with an "unverified employer" notice. A verified employer's clean listing goes live at once. "Training fee" or "deposit" text goes to moderation even for a verified employer, including when edited into a live listing. <br>**Reports:** three reporters take a listing off the board; a moderator hides it; the employer is notified with the reason and can't edit a hidden listing. Drafts can't be reported. <br>**Checked that the test catches a regression:** publishing everything directly makes the test fail.                                            |
| Financial data not presented as verified payments | **Schema:** no paid, verified or payment-reference columns; `verified: z.literal(false)`, `source: "entered_by_user"` and `SPENDING_DISCLAIMER` are fixed in the response schemas (`fleet.test.ts` checks `verified: true` is refused). <br>**API:** each expense and the dashboard totals carry `verified: false` and the disclaimer; totals stay per currency (ZAR and USD lines), split into expenses and service records; no `paid`/`payment` keys. <br>**Salaries** are labelled "(advertised)".                                                                                                                                                                                                                                                |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                           |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard (629 files), 39/39 turbo tasks. Tests: api **319** (+2 fleet and jobs e2e), types **74** (+4), sdk **29** (+1), db **94** + 6 PG-only skipped locally (+2 fleet constraint tests), web 18, local-infra 44, repo-guards 25, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                              |

## Migration notes

- **`0035`:**
  - adds five tables;
  - adds the unique key `vehicles(id, organization_id)` (placed first, because the composite FKs need it);
  - widens the `content_reports` and `moderation_actions` target checks to include `job`.
- **`0036`** adds `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- Nothing new to configure.

## Next: Prompt 23 — Status, power users and moderation

See [the prompt](../prompt-pack/23-status,-power-users-and-moderation.md).

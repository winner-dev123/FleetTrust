# Handoff — Prompt 20: Provider CRM and appointments

- Date: 2026-11-24
- Status: **awaiting owner approval** · branch `feat/prompt-20-crm`
- Prompt 19 approved and merged (PR #21 → `5b5f9cc`).

## Assumptions

- **Who books:** providers book appointments. Customers (individuals and fleets) see appointments on their requests but don't book them themselves (feature matrix: "sees").
- **Staff vs managers:**
  - **Staff** (`requests.respond`) can:
    - work on their branch's inquiries: claim, notes, own tasks;
    - see the team calendar and slots;
    - complete their own appointments.
  - **Managers** (new `crm.manage`: owner, admin, manager) can also:
    - assign work to others;
    - manage availability and time off;
    - book, move and cancel appointments;
    - see analytics.
  - **Branch-scoped members** stay within their branch.
- **Pipeline stages are derived** from the existing inquiry and request statuses, never stored.
- **Response deadline** for the first reply (quote or decline): 2 h urgent, 8 h soon, 24 h routine.
- **Times:** appointments are entered and shown in the branch's local time, and stored in UTC.
- **Public response status** shows only from 5 inquiries in 90 days, and is computed from the request history.
- **Not built:** customer self-booking, quote templates, task reminders, the UI (Prompts 24 and 25).

## What was built

| Area         | Details                                                                                                                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data         | `crm_inquiry_states`, `crm_inquiry_notes`, `crm_tasks`, `staff_availability`, `staff_time_off`, `appointments`. Migrations `0031`, `0032` (`btree_gist`, exclusion constraint against double-booking, triggers)                                                    |
| Pipeline     | Stages `new` → `open` → `quoted` → `won` → `completed` / `lost`; counts; filters by stage, assignee, priority; response deadline and overdue flag; open tasks; next appointment; latest quote                                                                      |
| Inquiries    | Assign (managers), claim and release (staff), priority, internal notes (author deletes)                                                                                                                                                                            |
| Quotes       | Quote list across inquiries with status, expiry and "expiring soon"                                                                                                                                                                                                |
| Tasks        | Optional link to an inquiry or appointment; due date; assignee; done; staff limited to their own                                                                                                                                                                   |
| Availability | Weekly staff hours per branch (local time), time off (refused over booked appointments), staff list                                                                                                                                                                |
| Appointments | Local-time slots every 15 minutes; booking, rescheduling, reassigning; completed, no-show, cancelled; per-staff lock, re-check and database exclusion constraint; customer view; notifications `appointment_booked`, `appointment_changed`, `appointment_assigned` |
| Analytics    | Response rate, median first-response time, replies within deadline, quotes won and lost, appointment outcomes, stage counts; public `GET /v1/providers/:slug/response-status`                                                                                      |
| SDK, docs    | 25 CRM methods; [ADR-0027](../adr/0027-provider-crm-and-appointments.md); [architecture/crm-and-appointments.md](../architecture/crm-and-appointments.md)                                                                                                          |

## Acceptance criteria

| Criterion                            | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| ------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Booking conflicts handled atomically | **Database:** exclusion constraint `appointments_staff_no_overlap` (`btree_gist`). <br>• `packages/db/test/appointments.test.ts`: an overlapping insert fails with `23P01`; back-to-back, other staff and cancelled rows are fine. <br>• `postgres.integration.test.ts` (real PG17 in CI): 10 concurrent transactions book the same time, and exactly one succeeds. <br>**API** (`crm.e2e-spec.ts`): an overlap gets 409 `slot_unavailable`; **5 bookings at once → exactly one 201, four 409**; cancelling frees the time; reschedules and time off use the same checks. <br>**Checked that the tests catch a regression:** with the app check and the constraint both removed, the test fails. With only the constraint in place, every booking assertion still passes.        |
| Timezones tested                     | **Unit tests:** New York before and after 14 March 2027 (−5 h / −4 h), Johannesburg, Kolkata (+5:30), the skipped 02:30 refused, the repeated 01:30 resolved to the earlier one. <br>**API:** New York slots on the change day are `01:00, 01:15, 01:30, 01:45, 03:00` with the right UTC times; 02:30 gets 400 `invalid_local_time`; 09:00 is 14:00Z one week and 13:00Z the next; a Johannesburg booking at the same instant shows its own local time; the calendar filters by local date. <br>**Checked that the test catches a regression:** ignoring the branch timezone makes it fail.                                                                                                                                                                                     |
| Staff permissions tested             | **Branch scope:** other-branch staff and managers see no inquiry (404), tasks, quotes or staff; outsiders and customers get 404. <br>**Staff:** can claim but not assign others (403 `not_allowed`), can set priority only on their own, and get 403 on booking, availability, time off and analytics. Only the author deletes a note (403 `not_author`), and notes never reach the customer. Staff tasks are their own only. Staff complete only their own appointments, after the start (409 `not_started`), and can't cancel. <br>**Managers:** assignees must work at the branch (400 `invalid_assignee`), and branch-scoped managers' analytics are limited to their branch. <br>**Checked that the test catches a regression:** giving staff manager rights makes it fail. |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                                                       |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard (583 files), 39/39 turbo tasks. Tests: api **312** (+6 CRM e2e, +5 schedule unit), types **63** (+3 timezone), sdk **27** (+1), db **88** + 6 PG-only skipped locally (run in CI; +1 concurrent-booking test), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                                                          |

## Migration notes

- **`0031`** adds six tables.
- **`0032`** runs `CREATE EXTENSION IF NOT EXISTS btree_gist`, adds the exclusion constraint and the `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- **Cloud SQL:** the migration user must be able to create the `btree_gist` extension, the same way it creates `postgis`; it's on Cloud SQL's supported list. Nothing else to configure.

## Next: Prompt 21 — Parts inventory and provider referrals

See [the prompt](../prompt-pack/21-parts-inventory-and-provider-referrals.md).

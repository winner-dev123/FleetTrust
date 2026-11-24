# ADR-0027: Provider CRM over the inquiry inbox, local-time appointments with a database double-booking guard, and response status from request history

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 20 builds the provider CRM (SRS F-130..F-132). It covers:

- the inquiry inbox and pipeline;
- tasks and quote management;
- appointment slots, staff availability and staff assignment;
- provider analytics and response status.

The acceptance criteria are:

- booking conflicts are handled atomically;
- timezones and staff permissions are tested.

## Decision

1. **The pipeline is derived, not stored.** Stages come from the existing inquiry (recipient) and request statuses, so they can never drift from the real request:

   | Stage       | When                                                                                        |
   | ----------- | ------------------------------------------------------------------------------------------- |
   | `new`       | Not opened yet                                                                              |
   | `open`      | Opened, no quote yet                                                                        |
   | `quoted`    | A quote is live                                                                             |
   | `won`       | The customer accepted this provider's quote                                                 |
   | `completed` | The accepted request is completed                                                           |
   | `lost`      | Declined, not selected, or the request ended (cancelled, expired, went to another provider) |
   - **The CRM stores only what's new:**
     - an assignee and a priority (`crm_inquiry_states`);
     - internal notes (`crm_inquiry_notes`);
     - tasks (`crm_tasks`).
   - **Response deadline:** the first reply (a quote or a decline) is due 2, 8 or 24 hours after the inquiry arrives, for urgent, soon and routine requests. The pipeline flags overdue replies.

2. **Permissions.**

   | Who                                                | Can                                                                                                                                                                                                                                                             |
   | -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
   | Staff (`requests.respond`)                         | See the pipeline, quotes, team calendar, staff list and slots; claim an unassigned inquiry, release their own, set the priority of their own; add notes (delete their own); keep their own tasks; mark their own appointments completed or no-show once started |
   | Managers (new `crm.manage`: owner, admin, manager) | Everything staff can, plus assign anyone, manage availability and time off, book, reschedule, reassign and cancel appointments, and see analytics                                                                                                               |
   - **Branch scope applies everywhere.** A branch-scoped member only sees inquiries, quotes, tasks, appointments and staff for their branch. Branch-scoped managers' analytics are limited to their branch.
   - **Assignees** must be able to work at the item's branch: organization-wide members, or members scoped to that branch.
   - **Outsiders** get 404.

3. **Appointments live in UTC and are entered and shown in the branch's local time.**
   - **Input:** the API takes `{ date, time }` in the branch's IANA timezone (the branch's own, or the organization's).
   - **Conversion** uses `Intl`, so daylight-saving changes are handled.
   - **Edge cases:** a local time skipped by a spring-forward change is refused (`invalid_local_time`). A time that happens twice resolves to the earlier one.
   - **Output:** every appointment carries `startsAt` / `endsAt` (UTC), `timeZone` and the local date, start and end.
4. **Bookable time.**
   - **Whose hours count:** a staff member's weekly hours at the branch (`staff_availability`), or the branch's opening hours when they have none.
   - **Narrowed by:**
     - the branch's opening hours, when it has any;
     - holiday closures;
     - time off (`staff_time_off`);
     - their other booked appointments.
   - **Slots** start every 15 minutes of local time.
   - **Limits:** durations are 15 minutes to 8 hours, in multiples of 15. Bookings must be in the future and at most 365 days ahead.
5. **Booking conflicts are refused atomically, in three layers.**
   - **Lock:** the booking transaction takes a per-staff advisory lock (`pg_advisory_xact_lock`).
   - **Check:** it re-checks availability inside the transaction.
   - **Database guard:** the final say is an exclusion constraint:

     ```sql
     EXCLUDE USING gist (staff_user_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
     WHERE (status = 'booked')
     ```

     Two booked appointments for the same person can never overlap, whatever the application does. It needs the `btree_gist` extension.

   - **Errors:** a violation (Postgres `23P01`) becomes 409 `slot_unavailable`. Back-to-back appointments are allowed because the ranges are half-open.
   - **Time off** takes the same lock, and is refused if it covers a booked appointment.
6. **Customers see appointments on their requests, without staff details.**
   - **Linking:** an appointment can link to an inquiry only after the customer accepted that provider's quote.
   - **What the customer sees:** the person who raised the request sees it in `GET /v1/me/appointments` with the provider, branch, title and times. They don't see staff identity or internal notes.
   - **Notifications** go through the outbox:
     - `appointment_booked` and `appointment_changed` (moved or cancelled) to the customer;
     - `appointment_assigned` to the staff member, unless they made the change.
7. **Analytics and response status come only from the request history.**
   - **The source:** the response time of an inquiry is from its arrival to the provider's first `quote_submitted` or `declined` event. Both timestamps are written by the database.
   - **Analytics** (managers) show received, responded, response rate, median first-response minutes, replies within the deadline, quotes sent, won, lost and win rate, appointment outcomes, and stage counts.
   - **Public response status** (`GET /v1/providers/:slug/response-status`):
     - Buckets the median over the last 90 days into "within an hour", "within a few hours", "within a day" or "more than a day".
     - Below 5 inquiries it says "Not enough inquiries yet".
     - It always carries a note that it is based on past replies and may change.

## Consequences

- **The pipeline is computed per request** from at most 200 recent inquiries, plus batched queries. That is fine at pilot scale; a materialised view can come later.
- **Cloud SQL must allow `btree_gist`.** It is on Cloud SQL's supported list, and the migration user already creates `postgis` the same way.
- **Former members:** removing a member doesn't delete their appointments. Managers reassign or cancel them; the staff name still shows.
- **Not built yet:**
  - **Customer self-booking:** customers only see appointments; providers book them (feature matrix: individuals and fleets "see").
  - **Quote templates.**
  - **Task reminders.**
  - **The UI** comes in Prompts 24 and 25.

## Alternatives considered

- **Storing pipeline stages:** two sources of truth that drift whenever a request changes outside the CRM.
- **Application-only conflict checks** (`SELECT` then `INSERT`): two concurrent transactions can both pass the check. The lock helps, but the database constraint is the only guard that holds for every code path.
- **Accepting UTC instants from clients:** pushes timezone and daylight-saving maths to every client and makes "09:00 at the branch" ambiguous. Local input with server conversion keeps one rule.
- **A self-reported "response time" field:** anyone could claim "within an hour". It is derived from history instead.

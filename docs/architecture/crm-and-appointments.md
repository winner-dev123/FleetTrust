# Provider CRM and appointments

SRS F-130..F-132. Design: [ADR-0027](../adr/0027-provider-crm-and-appointments.md).

All CRM routes are under `/v1/orgs/:orgId/crm` and are for **provider** organizations (other organizations get 400 `not_a_provider`). Branch scope applies everywhere: a branch-scoped member only sees their branch.

## Who can do what

|                                                                    |                   Staff (`requests.respond`)                    | Owner, admin, manager (`crm.manage`) |
| ------------------------------------------------------------------ | :-------------------------------------------------------------: | :----------------------------------: |
| Pipeline, inquiry detail, quotes, team calendar, slots, staff list |                                ✓                                |                  ✓                   |
| Assign an inquiry                                                  |                claim if unassigned, release own                 |     anyone working at its branch     |
| Priority                                                           |                   inquiries assigned to them                    |                  ✓                   |
| Internal notes                                                     |                         add; delete own                         |           add; delete own            |
| Tasks                                                              | own (assigned to or created by them); assign only to themselves |         everything in scope          |
| Staff availability, time off                                       |                                —                                |                  ✓                   |
| Book, reschedule, reassign, cancel appointments                    |                                —                                |                  ✓                   |
| Mark completed / no-show                                           |                     their own, once started                     |           ✓, once started            |
| Analytics                                                          |                                —                                |   ✓ (branch-scoped: their branch)    |

Outsiders get 404; a role that's too low gets 403 (`not_allowed`).

## Pipeline and inquiries

| Method & path                                                           | Notes                                                                                        |
| ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `GET …/crm/pipeline?stage=&assignee=me\|unassigned\|<userId>&priority=` | `{ stages: { new, open, quoted, won, completed, lost }, items }` (200 most recent inquiries) |
| `GET …/crm/inquiries/:recipientId`                                      | `{ item, notes }`                                                                            |
| `PATCH …/crm/inquiries/:recipientId`                                    | `{ assigneeUserId?, priority?: low\|normal\|high }`                                          |
| `POST …/crm/inquiries/:recipientId/notes`                               | `{ body }` (internal, never shown to the customer)                                           |
| `DELETE …/crm/inquiries/:recipientId/notes/:noteId`                     | Author only (403 `not_author`)                                                               |
| `GET …/crm/quotes?status=&expiringWithinDays=`                          | Quotes across inquiries; `expiringSoon` within 3 days by default                             |

**A pipeline item:**

```json
{
  "recipientId": "…",
  "requestId": "…",
  "stage": "open",
  "urgency": "urgent",
  "assignee": { "userId": "…", "displayName": "Thandi" },
  "priority": "high",
  "response": {
    "state": "awaiting",
    "dueAt": "2026-11-24T10:00:00.000Z",
    "overdue": true,
    "firstResponseAt": null
  },
  "openTasks": 1,
  "nextAppointmentAt": null,
  "latestQuote": null
}
```

The first reply (a quote or a decline) is due 2, 8 or 24 hours after the inquiry arrives, for urgent, soon and routine requests.

## Tasks

| Method & path                                              | Notes                                                                             |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------- |
| `GET …/crm/tasks?assignee=&status=open\|done&recipientId=` | Soonest due first                                                                 |
| `POST …/crm/tasks`                                         | `{ title, dueAt?, assigneeUserId? (default: you), recipientId?, appointmentId? }` |
| `PATCH …/crm/tasks/:taskId`                                | `{ title?, dueAt?, assigneeUserId?, done? }`                                      |
| `DELETE …/crm/tasks/:taskId`                               | Managers, or the creator                                                          |

## Staff and availability

| Method & path                                    | Notes                                                                                                                        |
| ------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| `GET …/crm/staff`                                | Members who can take work, their weekly hours per branch and upcoming time off (reasons: managers and the person only)       |
| `PUT …/crm/staff/:userId/availability`           | `{ branchId, weekly: { mon: [{ opens: "08:00", closes: "13:00" }], … } }` (local time; replaces the week)                    |
| `POST …/crm/staff/:userId/time-off`              | `{ startsAt, endsAt, reason? }` (ISO with offset, at most 90 days). 409 `conflicts_with_appointments` if it covers a booking |
| `DELETE …/crm/staff/:userId/time-off/:timeOffId` |                                                                                                                              |

**Bookable time** for a staff member is:

1. Their weekly hours at the branch, or the branch's opening hours if they have none.
2. Within the branch's opening hours, when the branch has any.
3. Minus holiday closures, time off and their booked appointments.

## Slots and appointments

| Method & path                                                               | Notes                                                                                                                             |
| --------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `GET …/crm/slots?branchId=&date=YYYY-MM-DD&durationMinutes=60&staffUserId=` | Free start times on that local date, every 15 minutes, each with the staff free then                                              |
| `GET …/crm/appointments?from=&to=&staffUserId=&branchId=&status=`           | Local dates (default: yesterday plus 28 days, at most 92 days)                                                                    |
| `POST …/crm/appointments`                                                   | See below                                                                                                                         |
| `GET` / `PATCH …/crm/appointments/:appointmentId`                           | PATCH `{ start?, durationMinutes?, staffUserId?, title?, notes? }`: same checks as booking                                        |
| `POST …/crm/appointments/:appointmentId/status`                             | `{ status: "completed" }`, `{ status: "no_show" }` (after the start, 409 `not_started` before), `{ status: "cancelled", reason }` |

**Booking:**

```json
{
  "branchId": "…",
  "staffUserId": "…",
  "start": { "date": "2027-03-15", "time": "09:00" },
  "durationMinutes": 60,
  "title": "Brake service",
  "recipientId": null,
  "customerName": "Walk-in: J. Mokoena",
  "notes": "Bring the torque wrench"
}
```

- **Times:** `start` is the branch's local time. The response has `startsAt` / `endsAt` in UTC, plus `timeZone` and `local: { date, start, end }`.
- **Durations:** 15–480 minutes, in multiples of 15.
- **Errors:**

  | Reason                 | Status | When                                                               |
  | ---------------------- | ------ | ------------------------------------------------------------------ |
  | `slot_unavailable`     | 409    | The staff member is already booked (checked atomically)            |
  | `outside_availability` | 409    | Outside their hours, during time off or on a closed day            |
  | `invalid_local_time`   | 400    | The local time doesn't exist (skipped by a daylight-saving change) |
  | `in_the_past`          | 409    |                                                                    |
  | `too_far_ahead`        | 409    | More than 365 days ahead                                           |
  | `invalid_assignee`     | 400    | The person can't work at this branch                               |
  | `inquiry_not_bookable` | 409    | `recipientId` given but the customer hasn't accepted your quote    |

**No double-booking.** A per-staff lock and a re-check run inside the transaction. Behind them, a database exclusion constraint (`appointments_staff_no_overlap`) makes overlapping booked appointments for one person impossible, even when requests race.

**Customers:** `GET /v1/me/appointments` lists appointments on requests you raised. It shows the provider, branch, title, times and status, but not staff or internal notes. Customers get `appointment_booked` and `appointment_changed` notifications, and staff get `appointment_assigned`.

## Analytics and response status

| Method & path                             | Notes                                                                                                                                                                                          |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET …/crm/analytics?days=30&branchId=`   | Managers. `days` 7–365. Inquiries (received, responded, rate, median first-response minutes, within deadline), quotes (sent, won, lost, win rate), appointments, stage counts, response status |
| `GET /v1/providers/:slug/response-status` | **No sign-in.** `{ level, label, responseRate, basedOnInquiries, windowDays: 90, note }`                                                                                                       |

**Response time** runs from when an inquiry arrives to the provider's first quote or decline. It is computed from the request history, and providers can't edit it.

**Public labels** (median over 90 days, shown from 5 inquiries):

| Median response | Label                                              |
| --------------- | -------------------------------------------------- |
| ≤ 1 hour        | "Usually responds within an hour"                  |
| ≤ 6 hours       | "Usually responds within a few hours"              |
| ≤ 24 hours      | "Usually responds within a day"                    |
| more            | "Usually takes more than a day to respond"         |
| < 5 inquiries   | "Not enough inquiries yet to show a response time" |

## Data

| Table                | Notes                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `crm_inquiry_states` | Assignee and priority per inquiry (created on first change)                                                                                             |
| `crm_inquiry_notes`  | Internal notes                                                                                                                                          |
| `crm_tasks`          | Title, due date, assignee, status; optional inquiry or appointment link; branch                                                                         |
| `staff_availability` | Weekly hours per staff member per branch (local minutes, like opening hours)                                                                            |
| `staff_time_off`     | UTC ranges                                                                                                                                              |
| `appointments`       | Branch, staff, optional inquiry, title, customer name, notes, UTC start and end, status. **Exclusion constraint** on staff plus time range while booked |

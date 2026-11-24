# Fleet operations and job board

SRS J5, F-150..F-154. Design: [ADR-0029](../adr/0029-fleet-operations-and-job-board.md).

## Who can do what

|                               | Driver (assigned) | Manager (`vehicles.manage`, `requests.manage`) | Recruiter (`jobs.manage`) | Owner, admin |
| ----------------------------- | :---------------: | :--------------------------------------------: | :-----------------------: | :----------: |
| Dashboard                     |         —         |        ✓ (branch-scoped: their branch)         |             —             |      ✓       |
| Record incidents and spending | for their vehicle |                   ✓ in scope                   |             —             |      ✓       |
| See incidents and spending    | what they entered |                   ✓ in scope                   |             —             |      ✓       |
| Resolve incidents             |         —         |                   ✓ in scope                   |             —             |      ✓       |
| Organization-level costs      |         —         |        organization-wide managers only         |             —             |      ✓       |
| See preferred providers       |         ✓         |                       ✓                        |             —             |      ✓       |
| Edit preferred providers      |         —         |   ✓ (branch-scoped: their branch's entries)    |             —             |      ✓       |
| Jobs and applications         |         —         |                       —                        |             ✓             |      ✓       |

Members of other organizations get 404.

## Dashboard

`GET /v1/orgs/:orgId/fleet/dashboard?days=30&branchId=`

```json
{
  "window": { "days": 30, "from": "2026-10-25", "to": "2026-11-24" },
  "branchId": null,
  "vehicles": { "active": 2, "withDriver": 1 },
  "maintenance": {
    "overdue": 1,
    "dueSoon": 0,
    "ok": 0,
    "unknown": 0,
    "items": [
      {
        "vehicle": { "name": "CA 100-001" },
        "title": "Major service",
        "status": "overdue",
        "nextDueOn": "2026-11-09"
      }
    ]
  },
  "documents": { "expiringWithin30Days": 0, "expired": 0 },
  "incidents": {
    "open": 1,
    "inWindow": 2,
    "byKind": [{ "kind": "breakdown", "count": 2 }],
    "highSeverityOpen": 0
  },
  "serviceRequests": { "open": 0, "accepted": 0 },
  "spending": {
    "lines": [
      {
        "currency": "ZAR",
        "total": "14650.5",
        "byCategory": [
          { "category": "insurance", "total": "9000" },
          { "category": "repair", "total": "3200" }
        ],
        "bySource": { "expenses": "11450.5", "serviceRecords": "3200" }
      }
    ],
    "verified": false,
    "disclaimer": "Entered by your team. These are records, not verified payments: FleetTrust doesn't process or check payments."
  }
}
```

- **Spending:** one line per currency, never converted. It includes costs typed into service records (Prompt 19).
- **Branch scope:** branch-scoped managers always get their branch, and get 403 for another one.

## Incidents

| Method & path                                            | Notes                                                                |
| -------------------------------------------------------- | -------------------------------------------------------------------- |
| `GET /v1/orgs/:orgId/fleet/incidents?status=&vehicleId=` | Managers: in scope. Drivers: what they reported                      |
| `POST …/fleet/incidents`                                 | `{ vehicleId, kind, severity?, occurredAt, location?, description }` |
| `GET …/fleet/incidents/:id`                              |                                                                      |
| `PATCH …/fleet/incidents/:id`                            | Managers: `{ severity?, status?: open\|resolved, resolutionNote? }`  |

- **Kinds:** `breakdown`, `accident`, `damage`, `theft`, `traffic_fine`, `other`.
- **Severities:** `low`, `medium`, `high`.
- **Not emergency alerts:** personal emergency alerts (Prompt 18) never appear here.

## Spending records

| Method & path                                                       | Notes                                            |
| ------------------------------------------------------------------- | ------------------------------------------------ |
| `GET /v1/orgs/:orgId/fleet/expenses?from=&to=&vehicleId=&category=` |                                                  |
| `POST …/fleet/expenses`                                             | See below                                        |
| `GET` / `PUT` / `DELETE …/fleet/expenses/:id`                       | The person who entered it, or a manager in scope |

```json
{
  "vehicleId": "…",
  "category": "fuel",
  "amount": "2450.50",
  "currency": "ZAR",
  "spentOn": "2026-11-22",
  "vendor": "Engen N1",
  "litres": "105.2",
  "odometerKm": 412000
}
```

- **Categories:** `fuel`, `maintenance`, `tyres`, `parts`, `tolls`, `parking`, `insurance`, `licensing`, `fines`, `cleaning`, `other`.
- **Litres** go with fuel only.
- **Organization-level costs:** `vehicleId: null` is for organization-wide managers only.
- **Every record** comes back with `verified: false`, `source: "entered_by_user"` and `disclaimer`.

## Preferred providers

| Method & path                                   | Who                                                                  |
| ----------------------------------------------- | -------------------------------------------------------------------- |
| `GET /v1/orgs/:orgId/fleet/preferred-providers` | `requests.create`                                                    |
| `POST …/preferred-providers`                    | `requests.manage`: `{ providerSlug, branchId?, categories?, note? }` |
| `PATCH` / `DELETE …/preferred-providers/:id`    | `requests.manage`                                                    |
| `GET /v1/orgs/:orgId/preferred-by`              | A provider: `{ fleets: n }`                                          |

- **`available: false`** marks a provider that is no longer published or active.
- **Errors:** `provider_not_found`, `already_preferred`, `invalid_branch`, `not_allowed` (403).

## Jobs

| Method & path                                                          | Who / notes                                                     |
| ---------------------------------------------------------------------- | --------------------------------------------------------------- |
| `GET`, `POST /v1/orgs/:orgId/jobs`                                     | `jobs.manage`. A new job is a draft                             |
| `GET`, `PUT`, `DELETE …/jobs/:id`                                      | Delete only if never live                                       |
| `POST …/jobs/:id/publish`                                              | Live at once, or `pending_moderation` with a `moderationNote`   |
| `POST …/jobs/:id/close`                                                |                                                                 |
| `GET …/jobs/:id/applications`                                          |                                                                 |
| `PATCH /v1/orgs/:orgId/job-applications/:id`                           | `{ status: submitted\|shortlisted\|rejected\|hired }`           |
| `GET /v1/jobs?q=&role=&employmentType=&countryCode=&verifiedOnly=true` | **No sign-in**                                                  |
| `GET /v1/jobs/:id`                                                     | **No sign-in**                                                  |
| `POST /v1/jobs/:id/applications`                                       | Signed in: `{ message, phone?, email? }` (at least one contact) |
| `GET /v1/me/job-applications`, `POST …/:id/withdraw`                   | The applicant                                                   |

**A listing:**

```json
{
  "title": "Long-haul truck driver (EC)",
  "description": "…",
  "role": "driver",
  "employmentType": "full_time",
  "licenceClasses": ["EC"],
  "locality": "Johannesburg",
  "countryCode": "ZA",
  "salary": { "currency": "ZAR", "min": "18000", "max": "22000", "period": "month" },
  "closesOn": "2026-12-24"
}
```

- **Closing date:** `closesOn` must be within 90 days.
- **Public listings** carry:
  - `employer.verified`;
  - `scamWarning`;
  - `employerNotice` (for unverified employers);
  - a salary `label` ending in "(advertised)".

**Publishing:**

| Employer verified (business badge) | Scam signs in the text | Result               |
| ---------------------------------- | ---------------------- | -------------------- |
| yes                                | no                     | `published`          |
| yes                                | yes                    | `pending_moderation` |
| no                                 | —                      | `pending_moderation` |

- **Editing a live listing** runs the check again.
- **A hidden listing** (by a moderator) can't be edited.

**Moderation:**

- **Report:** `POST /v1/reports` with `targetType: "job"`. Three reporters move the listing to `pending_moderation`.
- **Moderator routes:**
  - `GET /v1/moderation/jobs/:id`;
  - `POST /v1/moderation/jobs/:id/approve|reject|hide|restore|dismiss-reports`.
- **Queue:** jobs waiting for moderation appear in `GET /v1/moderation/queue`.

**Errors:**

| Reason               | Status | When                                          |
| -------------------- | ------ | --------------------------------------------- |
| `not_a_fleet`        | 400    | Jobs are for fleet organizations              |
| `invalid_close_date` | 400    | Past, or more than 90 days ahead              |
| `job_not_open`       | 409    | Applying to a listing that isn't live         |
| `own_job`            | 400    | Members can't apply to their own organization |
| `already_applied`    | 409    |                                               |
| `invalid_transition` | 409    |                                               |

**Notifications:**

- `job_application` goes to members with `jobs.manage`.
- `job_application_update` goes to the applicant.
- `content_moderated` goes to the employer when a moderator acts.

## Data

| Table                       | Notes                                                                                  |
| --------------------------- | -------------------------------------------------------------------------------------- |
| `fleet_incidents`           | Fleet-only (composite FK with kind), same-fleet vehicle (composite FK)                 |
| `fleet_expenses`            | Exact decimal amount and currency; no paid or verified columns                         |
| `fleet_preferred_providers` | Unique per fleet, provider and branch (`NULLS NOT DISTINCT`)                           |
| `jobs`                      | Fleet-only; salary columns as a whole or not at all; `published_at` required once live |
| `job_applications`          | One per person per job; contact details typed by the applicant                         |

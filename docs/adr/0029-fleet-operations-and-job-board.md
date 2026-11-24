# ADR-0029: Fleet dashboards from tenant-scoped records, spending that is never a verified payment, and a job board gated by employer verification and moderation

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 22 covers fleet operations and hiring (SRS J5, F-150..F-154):

- maintenance and incident dashboards;
- preferred provider lists;
- spending records entered by users;
- job listings and applications;
- employer verification and recruiter permissions.

The acceptance criteria are:

- fleet tenant isolation;
- job posting moderation;
- financial data not presented as verified payments.

Abuse case AB-14 is fake job postings and recruiter scams.

## Decision

1. **Fleet records belong to one fleet, enforced twice.**
   - **In the database:**
     - Every fleet table (`fleet_incidents`, `fleet_expenses`, `fleet_preferred_providers`, `jobs`) carries `organization_kind = 'fleet'` into a composite FK to `organizations(id, kind)`, so a provider can't own a row.
     - Incidents and expenses reference `vehicles(id, organization_id)`, so a record can't point at another fleet's vehicle.
   - **In the API:**

     | Who                                           | What they reach                                                           |
     | --------------------------------------------- | ------------------------------------------------------------------------- |
     | Managers (`vehicles.manage`)                  | Everything in their branch scope                                          |
     | The driver assigned to a vehicle              | Can record incidents and spending for it, and sees only what they entered |
     | Recruiters and members of other organizations | Get 403 or 404                                                            |

2. **Fleet incidents are their own records, not emergency alerts.**
   - **What they are:** a breakdown, accident, damage, theft, fine or other event on a fleet vehicle, with a severity, recorded by the driver or a manager.
   - **What stays out:** personal emergency alerts (Prompt 18) belong to the person and never appear on a fleet dashboard. An employer must not see an employee's emergency without their choice.
3. **Spending is a record, never a payment.**
   - **The table:** `fleet_expenses` stores the category, amount (exact decimal), currency, date, vendor and optional litres, plus who entered it.
   - **What doesn't exist:** paid, verified or payment-reference columns.
   - **Every expense** says `verified: false`, `source: "entered_by_user"` and carries `SPENDING_DISCLAIMER` ("Entered by your team. These are records, not verified payments…").
   - **Dashboard totals:**
     - They combine expenses and the costs typed into service records (Prompt 19).
     - They are split by source, summed per currency and never converted.
     - They carry the same `verified: false` and disclaimer, enforced as literals in the response schema.
4. **The dashboard is computed on request from the fleet's own data.** It shows:
   - active vehicles and how many have a driver;
   - maintenance status per schedule (the Prompt 19 rules), with the 20 most urgent;
   - documents expired or expiring within 30 days;
   - open and recent incidents;
   - open and accepted service requests;
   - spending for a window of 7 to 366 days.

   Branch-scoped managers always get their branch.

5. **Preferred providers are a fleet list.**
   - **Editing:** members with `requests.manage` edit it; branch-scoped managers edit entries for their branch.
   - **Reading:** everyone who raises requests (`requests.create`) sees it.
   - **Providers** see only how many fleets prefer them, never which ones.
6. **The job board publishes only trusted listings without review.**
   - **Who manages jobs:** the new `jobs.manage` permission, held by owners, admins and recruiters.
   - **Recruiters:** they now have `org.read` and `jobs.manage` only. No vehicles, dashboards or requests.
   - **Publishing:**
     - A listing goes live at once only when the employer holds an active **business verification badge** (Prompt 09) **and** the text has no scam signs.
     - Scam signs are application, training or uniform fees, deposits, Western Union, crypto and gift cards.
     - Everything else goes to `pending_moderation` with a note, and appears in the shared trust and safety queue.
   - **Edits:** editing a live listing runs the same check again, so approved text can't be swapped for a scam.
   - **Reports:** listings are a report target (`job`). Three reporters take a listing out of public view until a moderator decides.
   - **Moderator decisions:** approve, reject, hide, restore or dismiss reports. Each is audited and the employer is notified.
   - **What applicants see:**
     - `JOB_SCAM_WARNING` on every listing;
     - whether the employer is verified;
     - for unverified employers, `UNVERIFIED_EMPLOYER_NOTICE`.
   - **Salaries** are labelled "(advertised)".
7. **Applications share only what the applicant types in.**
   - **Contact:** a message and a phone number or email address, at least one. The account email is never shared.
   - **Limits:** one application per person per job; members can't apply to their own organization.
   - **Statuses:** recruiters move applications between submitted, shortlisted, rejected and hired. The applicant can withdraw, and that is final.
   - **Notifications:** recruiters get `job_application`; applicants get `job_application_update`.

## Consequences

- **Dashboard cost:** dashboards are computed per request. That is fine at pilot scale; a nightly rollup can come later.
- **Spending is only as reliable as what people type**, and the API says so everywhere. There are no receipt uploads yet.
- **Unverified fleets can still hire**, through moderation. That's slower and labelled, which pushes employers towards verification without blocking small fleets.
- **Schema additions:**
  - A unique key `vehicles(id, organization_id)`, which the composite FKs need.
  - `job` added to the report and moderation target checks.
- **Not built:**
  - expense receipts and CSV export;
  - converting currencies;
  - customer self-service job alerts;
  - applicant CV uploads;
  - fleet incident photos;
  - the UI (Prompts 24 and 25).

## Alternatives considered

- **Showing emergency incidents on fleet dashboards:** it exposes personal safety events to employers.
- **A "verified" flag for spending when a receipt is attached:** FleetTrust can't verify a payment from a photo, and the label would mislead.
- **Converting spending to one currency:** exchange rates would make user-entered numbers look authoritative.
- **Moderating every job listing:** it slows verified employers for no benefit. Verification plus scam checks plus reports targets the risk.
- **Letting recruiters see the whole fleet:** they need jobs only (SRS role table).

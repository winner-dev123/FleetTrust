# Handoff — Prompt 18: Emergency assistance and trusted circles

- Date: 2026-11-23
- Status: **approved** · PR **#20** squash-merged as `ab611fa` (CI 5/5 green on `d5adc9a`)
- Prompt 17 approved and merged (PR #19 → `0a6b2cc`).

## Assumptions

- **Official numbers ship empty** (OQ-03). Until the launch country is decided, guidance says "Call your local emergency number". Rows are added to `emergency_guidance` after legal review (OQ-04).
- **Contacts need consent:** trusted contacts must accept, and can pause or leave. Primary contacts are alerted first, backups on escalation.
- **Never refused:** no quota, plan check or rate limit applies (ADR-0010). More than 3 incidents an hour are **flagged**, never refused.
- **Location is shared per incident** only with consent, and erased when the incident closes or expires.
- **Emergency pushes ignore ordinary push opt-outs** (the contact agreed to be an emergency contact). Pausing is their opt-out.
- **Email has no vendor yet** (OQ-06). The email port records messages locally and in tests. A real provider is a **launch blocker**.
- **Not built yet:** the UI (Prompts 24 and 25), and the copy lint over UI text (Prompt 24); this stage already tests the API and type copy. Emergency fan-out load testing is Prompt 28.

## What was built

| Area      | Details                                                                                                                                                                                                                                                               |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data      | `emergency_guidance`, `trusted_contacts`, `emergency_incidents` (one active per person; location only with consent), `incident_recipients`, `incident_deliveries` (the queue), `provider_emergency_settings`; conversation kind `incident`. Migrations `0027`, `0028` |
| Guidance  | Public endpoint; configured number or the generic fallback; disclaimer on every response                                                                                                                                                                              |
| Contacts  | Invite, accept, decline, pause, priority, remove or leave; blocks end the link; 10 at most                                                                                                                                                                            |
| Incidents | Idempotent create; one active at a time; soft flag; per-incident location consent; resolve, cancel, expire, with the location erased                                                                                                                                  |
| Delivery  | Dedicated queue: first push inline; leased, idempotent retries with backoff (5 attempts); email fallback (no device, failed push, or unacknowledged after 60 s); escalation waves to backups, or reminders; final failures logged at error level                      |
| Providers | Opt-in with a radius (published profiles only); 10 nearest within radius; approximate area only, no identity; offers with name and phone go to the person                                                                                                             |
| Room      | Messaging conversation of kind `incident`: owner and alerted contacts; read-only for 24 hours after closing, then gone                                                                                                                                                |
| Audit     | Created, flagged, acknowledged, escalated, location updated (no coordinates), resolved, cancelled, expired, provider offered, contact changes                                                                                                                         |
| Platform  | `EmailModule` (`EMAIL_SENDER`), env `EMAIL_*` and `EMERGENCY_*`; the push recorder can simulate outages                                                                                                                                                               |
| SDK, docs | 20 emergency methods; [ADR-0025](../adr/0025-emergency-incidents-and-dispatch.md); [architecture/emergency.md](../architecture/emergency.md)                                                                                                                          |

## Acceptance criteria

| Criterion                      | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Independent of ordinary quotas | `emergency.e2e-spec.ts`: with **every daily quota overridden to 0**, an ordinary action is refused (403 `quota_exceeded`) but an incident is created, the contact is pushed, and the room accepts messages; no quota consumption rows; the emergency module has no imports from entitlements (source test plus the existing lint boundary); 5 incidents in a row are all created and alerted (the 4th and 5th flagged, never refused)                                                                 |
| No guaranteed-rescue claims    | Forbidden-wording test over the emergency module, the shared types, and every push and email sent in the suite; disclaimer and guidance on every response. **Checked that the test catches a regression:** adding "Help is on the way" to a push makes it fail                                                                                                                                                                                                                                        |
| Safety tests pass              | Consent (pending, declined and paused contacts aren't alerted; blocks end links); location shared only with consent, visible to alerted contacts only, erased on resolve and expiry (checked in the database); strangers and not-yet-alerted backups 404; providers see an approximate area and no identity; idempotent and one-active creation; room read-only after closing, then gone                                                                                                              |
| Retry tests pass               | A failing push retries on schedule (no attempt before the backoff), succeeds on the 3rd attempt, and sends exactly one push; a permanently failing push stops after 5 attempts and emails; contacts without devices are emailed; unacknowledged pushes are emailed after 60 s; escalation to backups at 120 s; an acknowledgement stops escalation and tells the owner; without backups, reminders; expiry after 12 h. **Checked that the test catches a regression:** removing retries makes it fail |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                              |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **291** (+13 emergency e2e), types 60, sdk **25** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                 |

## Migration notes

- **`0027`** adds six tables and the `incident` conversation kind (a new column, with checks updated). drizzle-kit quoted the geography type again, so it was unquoted by hand.
- **`0028`** adds `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- **Launch blocker: choose an email provider (OQ-06).** Until then, emergency email fallback is only recorded.
- **Launch blocker: legal review of the emergency wording and of provider matching (OQ-04),** then add official numbers for the launch country to `emergency_guidance` (OQ-03).
- **Run the worker** (`APP_ROLE=worker`, CPU always on): it runs retries, email fallback, escalation and expiry. Without it, only the first push is sent.
- **Alerting:** create a log-based alert on `EmergencyDispatcher` error logs ("failed after 5 attempts", "emergency tick failed").

## Next: Prompt 19 — Vehicle profiles and maintenance

Vehicle records, driver assignment, service history with source attribution, maintenance schedules, mileage and inspection reminders, and a private document vault with controlled sharing. Service requests can then link a vehicle instead of the current snapshot.

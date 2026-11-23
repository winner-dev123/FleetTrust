# Handoff — Prompt 19: Vehicle profiles and maintenance

- Date: 2026-11-23
- Status: **awaiting owner approval** · branch `feat/prompt-19-vehicles`
- Prompt 18 approved and merged (PR #20 → `ab611fa`).

## Assumptions

- **Ownership:** a vehicle belongs to a person or to a fleet.
- **Fleet access:** fleet owners, admins and managers (new `vehicles.manage` permission, branch-scoped managers for their branch) manage vehicles.
- **Drivers:** a driver only reaches the vehicle assigned to them, and only for reading, odometer readings, service records, completing maintenance and documents marked visible to drivers.
- **Service record sources are set by the server,** never by the app: owner, fleet, driver, provider, or from a document. **No record has, or can get, a "verified" label.**
- **Providers add records through service requests:** a request can now link a vehicle, and the accepted provider adds a record from the inquiry. Providers get no other access to the vehicle.
- **Spend is "as entered"**, never a verified payment.
- **Not built yet:** fleet dashboards (Prompt 22), the UI (Prompts 24 and 25), and data retention and deletion (Prompt 27).

## What was built

| Area        | Details                                                                                                                                                                                                                                    |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data        | `vehicles`, `vehicle_assignments`, `service_records` (no verified column), `maintenance_schedules`, `vehicle_documents` (encrypted), `vehicle_document_shares` (hashed tokens); `service_requests.vehicle_id`. Migrations `0029`, `0030`   |
| Vehicles    | Personal and fleet creation; branch rules; duplicate registration check; edit; archive; odometer readings only go up                                                                                                                       |
| Drivers     | One current driver; must be a fleet member in the right branch; unassign or archive ends access                                                                                                                                            |
| History     | Source derived by the server; labels; notice on every list; strict schemas refuse `source` and `verified`; only the author deletes; provider records through accepted requests on linked vehicles                                          |
| Maintenance | Distance and/or time schedules; `ok`, `due_soon`, `overdue`, `unknown`; reset by a service record or `complete`; worker reminders (once per change, weekly while overdue) and document-expiry reminders through the outbox, inbox and push |
| Vault       | Upload pipeline with malware scan, metadata strip, AES-256-GCM envelope encryption, sensitive bucket; driver visibility; audited downloads                                                                                                 |
| Sharing     | Hashed-token links with expiry, view limit and revocation; public open, rate-limited and audited                                                                                                                                           |
| SDK, docs   | 27 vehicle methods; [ADR-0026](../adr/0026-vehicles-history-and-vault.md); [architecture/vehicles.md](../architecture/vehicles.md)                                                                                                         |

## Acceptance criteria

| Criterion                                         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Vehicle access boundaries tested                  | `vehicles.e2e-spec.ts`: strangers 404 on the vehicle, history, schedules, documents, odometer and records; unauthenticated 401. A branch-scoped manager sees only their branch (list and item) and can't create in another branch. An unassigned driver 404s and can't list fleet vehicles (403). An assigned driver reads, reports odometer, adds records and completes maintenance, but can't edit, add schedules, upload documents or assign (403), nor reach other vehicles. Unassigning ends access. Recruiters, outsiders and providers 404. Assignment refuses non-members and the wrong branch. Drivers can't open documents unless marked visible. **Checked that the test catches a regression:** giving every fleet member driver access makes it fail |
| No service record automatically labelled verified | Records from owner, fleet, driver, document and provider each carry the right source and label; forged `source: "provider"`, `verified: true` and `verifiedBy` are refused; history JSON has no `verified` key and no label mentions verification; the notice is on every list; the database has no verified column. **Checked that the test catches a regression:** labelling every record "owner" makes it fail                                                                                                                                                                                                                                                                                                                                                 |
| Maintenance and reminders                         | Distance schedule: ok → due soon → overdue as the odometer rises; one reminder per change, none repeated, weekly while overdue (clock moved forward); inbox "Maintenance due soon" / "Maintenance overdue"; a service record against the schedule resets it; time schedule due soon and reset by `complete`; schedules need an interval; unit tests for the status calculation                                                                                                                                                                                                                                                                                                                                                                                    |
| Vault and sharing                                 | Stored bytes don't contain the plaintext; download decrypts to the original; downloads audited; share links: the token isn't stored (hash only), 2 views then 404, expiry, revocation, view counts and labels listed, each open audited; expiring document → `document_expiring` notification once                                                                                                                                                                                                                                                                                                                                                                                                                                                                |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                             |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **301** (+8 vehicle e2e, +2 schedule unit), types 60, sdk **26** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                |

## Migration notes

- **`0029`** adds six tables and `service_requests.vehicle_id`.
- **`0030`** adds `updated_at` triggers.
- Both are additive, with no backfill.

## Before production (owner)

- **Nothing new to configure.** The vault uses the existing KMS key and sensitive bucket. Reminders need the worker role (already required).

## Next: Prompt 20 — Provider CRM and appointments

Provider inquiry pipeline, tasks, quote management, appointment slots and availability, staff assignment, and provider analytics and response status.

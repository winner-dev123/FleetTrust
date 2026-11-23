# ADR-0026: Vehicles with per-vehicle access, source-attributed service history, schedule reminders, and an encrypted document vault with share links

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 19 builds vehicles (SRS J5, F-070..F-074): records, driver assignment, service history with source attribution, maintenance schedules, mileage and inspection reminders, and a private document vault with controlled sharing.

The acceptance criteria are:

- vehicle access boundaries are tested;
- no service record is automatically labelled verified.

## Decision

1. **Ownership.** A vehicle belongs to exactly one person or one fleet organization (database check).
   - **Fleet vehicles** may belong to a branch.
   - **Registration** is unique per owner while active.
2. **Access per vehicle.** It is decided on every call, like messaging (ADR-0024).

   | Who                                                                                                                  | Role      | Can                                                                                                                 |
   | -------------------------------------------------------------------------------------------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------- |
   | Personal owner                                                                                                       | `owner`   | Everything                                                                                                          |
   | Fleet owner and admin, or a manager with the new `vehicles.manage` permission (branch-scoped managers: their branch) | `manager` | Everything, including drivers, schedules, documents and shares                                                      |
   | The currently assigned driver                                                                                        | `driver`  | Read, report odometer readings, add service records, complete maintenance, open documents marked visible to drivers |

   Everyone else gets 404, including recruiters and providers. A role that's too low for an action gets 403.

3. **One current driver per vehicle** (unique partial index).
   - The driver must be a member of the fleet.
   - A branch-scoped member can only drive a vehicle in their branch.
   - Unassigning (or archiving the vehicle) ends driver access immediately.
4. **Service history carries its source; nothing is ever verified** (SRS J5).
   - **The source is derived by the API,** never sent by the client:

     | Source     | When                                                                        |
     | ---------- | --------------------------------------------------------------------------- |
     | `owner`    | Entered by the personal owner                                               |
     | `fleet`    | Entered by a fleet manager                                                  |
     | `driver`   | Entered by the assigned driver                                              |
     | `provider` | Entered by the accepted provider on a service request linked to the vehicle |
     | `document` | Taken from a vault document                                                 |

   - **No "verified" anywhere:** no verified column or field exists, and strict schemas reject `source`, `verified` and similar fields.
   - **Labels and notice:** every history response carries `SERVICE_RECORD_NOTICE` ("FleetTrust doesn't verify them"), and labels read "Entered by …" or "From document".
   - **Costs** are "as entered", never a verified payment.
   - **Deleting:** only the person who entered a record can delete it.
5. **Service requests can link a vehicle** (`vehicleId`).
   - The requester must be able to use the vehicle; the vehicle's details replace the snapshot.
   - The accepted provider can then add a `provider` record through the inquiry, but gets no access to the vehicle itself.
6. **Maintenance schedules.**
   - Each schedule is by distance and/or time. Whichever is closer decides `ok`, `due_soon` (within `remindBeforeKm` / `remindBeforeDays`) or `overdue`.
   - **Baseline:** without one, a schedule starts counting from now.
   - **Completing:** a service record against a schedule, or `complete`, resets it. Odometer readings only go up (409 `odometer_decreased`); owners and managers correct mistakes with PATCH.
7. **Reminders.**
   - **The job:** a worker job (`VEHICLE_REMINDER_INTERVAL_MS`, hourly) queues `MaintenanceDue` once when a schedule becomes due soon, once when it becomes overdue, then weekly while it stays overdue. It also queues `VehicleDocumentExpiring` once per expiry date for documents expiring within 30 days.
   - **Delivery:** the outbox relay (ADR-0024) turns them into inbox notifications and push (category `pushRequests`). They go to the owner, or to the fleet managers in scope and the assigned driver.
8. **Document vault.**
   - Same protection as verification documents (ADR-0016): quarantine, type sniffing, malware scan, image metadata stripping, AES-256-GCM envelope encryption (Cloud KMS when deployed), and the sensitive bucket.
   - **Driver visibility:** drivers see only documents marked `driverVisible`.
   - **Audit:** every download is audited.
9. **Controlled sharing.**
   - A share link is a random 256-bit token. Only its SHA-256 hash is stored.
   - **Limits:** it expires (1 hour to 7 days), has a view limit (1–20) and can be revoked.
   - **Opening:** links open without sign-in, are rate-limited by IP, and every view is audited with the share's label.

## Consequences

- **Each call queries memberships and assignments.** That is fine at pilot scale.
- **Share links are bearer links:** anyone holding one can open it within its limits. Short expiry, view limits and revocation contain the risk, and the owner sees view counts.
- **Fleet dashboards** (maintenance due, spend summaries) come in Prompt 22. Spend stays "as entered".
- **Retention:** retention and deletion of vehicles, documents and history across storage is part of Prompt 27.

## Alternatives considered

- **A `verified` flag that providers could set:** rejected. SRS J5 says no record is automatically verified, and provider entries are attributed, not certified.
- **Letting clients choose the source:** anyone could claim "provider".
- **Emailing documents:** loses access control, auditing and revocation.

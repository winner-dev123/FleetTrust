# Vehicles, maintenance and the document vault

SRS J5, F-070..F-074. Design: [ADR-0026](../adr/0026-vehicles-history-and-vault.md).

> **Service records are never verified.** Each record shows where it came from ("Entered by owner", "Entered by fleet", "Entered by driver", "Entered by provider · Name", "From document"). Every history response carries the notice: _"Service records are entered by owners, fleets, drivers and providers. FleetTrust doesn't verify them."_

## Who can do what

|                               | Personal owner | Fleet owner, admin, manager (`vehicles.manage`, branch scope) |      Assigned driver      |
| ----------------------------- | :------------: | :-----------------------------------------------------------: | :-----------------------: |
| See the vehicle               |       ✓        |                               ✓                               |             ✓             |
| Edit, archive, assign drivers |       ✓        |                               ✓                               |             —             |
| Report odometer readings      |       ✓        |                               ✓                               |             ✓             |
| Add service records           |   ✓ (owner)    |                           ✓ (fleet)                           |        ✓ (driver)         |
| Manage schedules              |       ✓        |                               ✓                               |       complete only       |
| Documents                     |      all       |                              all                              | marked visible to drivers |
| Share links                   |       ✓        |                               ✓                               |             —             |

Everyone else gets 404. Providers add records only through an accepted service request.

## Routes

**Vehicles:**

| Method & path                                | Notes                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------ |
| `GET /v1/me/vehicles`                        | Your personal vehicles and the fleet vehicles assigned to you                  |
| `POST /v1/me/vehicles`                       | Personal vehicle                                                               |
| `GET /v1/orgs/:orgId/vehicles?archived=true` | `vehicles.manage`                                                              |
| `POST /v1/orgs/:orgId/vehicles`              | `vehicles.manage`. Branch-scoped managers: their branch                        |
| `GET` / `PATCH /v1/vehicles/:id`             |                                                                                |
| `POST /v1/vehicles/:id/archive`              | Ends the driver assignment                                                     |
| `POST /v1/vehicles/:id/odometer`             | `{ odometerKm }`. Readings only go up (409 `odometer_decreased`)               |
| `PUT` / `DELETE /v1/vehicles/:id/driver`     | `{ userId }`: a fleet member, in the vehicle's branch if they're branch-scoped |

**Creating a vehicle:**

```json
{
  "vehicleType": "heavy_truck",
  "make": "Scania",
  "model": "R500",
  "year": 2022,
  "registration": "CA 123-456",
  "vin": null,
  "odometerKm": 120000,
  "nickname": "Big Blue",
  "branchId": null
}
```

**Service history:**

| Method & path                                                | Notes                                                                                                                                                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/vehicles/:id/service-records`                       | `{ items, notice }`                                                                                                                                                                                                 |
| `POST /v1/vehicles/:id/service-records`                      | `{ performedOn, category, title, description?, odometerKm?, cost?: { amount, currency }, providerName?, scheduleId?, fromDocumentId? }`. The source is set by the server; `source` or `verified` fields are refused |
| `DELETE /v1/vehicles/:id/service-records/:recordId`          | The person who entered it only                                                                                                                                                                                      |
| `POST /v1/orgs/:orgId/inquiries/:recipientId/service-record` | The **accepted** provider on a request with a linked `vehicleId` (409 `invalid_transition` before acceptance, 409 `no_vehicle_linked` without a vehicle)                                                            |

**Linking a vehicle to a service request:** add `"vehicleId"` to `POST /v1/me/service-requests` or the fleet route. The vehicle's details replace the snapshot.

**Maintenance:**

| Method & path                                           | Notes                                                                                                                                        |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/vehicles/:id/schedules`                        | With `nextDueKm`, `nextDueOn`, `status` (`ok`, `due_soon`, `overdue`, `unknown`)                                                             |
| `POST /v1/vehicles/:id/schedules`                       | `{ title, kind, intervalKm?, intervalDays?, lastDoneKm?, lastDoneOn?, remindBeforeKm = 1000, remindBeforeDays = 14 }`. At least one interval |
| `PUT` / `DELETE /v1/vehicles/:id/schedules/:scheduleId` |                                                                                                                                              |
| `POST /v1/vehicles/:id/schedules/:scheduleId/complete`  | `{ doneOn, odometerKm? }`. Drivers too                                                                                                       |

**Reminders** (worker, hourly): one when a schedule becomes due soon, one when it becomes overdue, then weekly while overdue; plus one per document expiring within 30 days. They arrive as inbox notifications `maintenance_due` and `document_expiring` (push under `pushRequests`) for the owner, or for fleet managers in scope and the driver.

**Documents:**

| Method & path                                                   | Notes                                                                                                                                              |
| --------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/vehicles/:id/documents`                                | Drivers: only `driverVisible`                                                                                                                      |
| `POST /v1/vehicles/:id/documents`                               | `{ kind, title, expiresOn?, driverVisible = false, contentType: image/jpeg\|png\|webp \| application/pdf, size ≤ 10 MB }` → `{ document, upload }` |
| `POST /v1/vehicles/:id/documents/:documentId/complete`          | Scan, strip metadata, encrypt, store privately                                                                                                     |
| `PATCH` / `DELETE /v1/vehicles/:id/documents/:documentId`       |                                                                                                                                                    |
| `GET /v1/vehicles/:id/documents/:documentId/file`               | Audited; `private, no-store`                                                                                                                       |
| `POST /v1/vehicles/:id/documents/:documentId/shares`            | `{ label, expiresInHours 1–168 (default 48), maxViews 1–20 (default 5) }` → `{ token, path }` (**the token is shown once**)                        |
| `GET /v1/vehicles/:id/documents/:documentId/shares`             | Label, views, expiry, revoked                                                                                                                      |
| `DELETE /v1/vehicles/:id/documents/:documentId/shares/:shareId` | Revoke                                                                                                                                             |
| `GET /v1/shared-documents/:token`                               | **No sign-in.** Within the expiry and view limit, otherwise 404. Every view audited                                                                |

## Configuration

| Variable                       | Default   | Notes                                  |
| ------------------------------ | --------- | -------------------------------------- |
| `VEHICLE_REMINDER_INTERVAL_MS` | 3,600,000 | Worker: how often reminders are queued |

## Data

| Table                         | Notes                                                                                                                                                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vehicles`                    | Owner (person **or** fleet), branch, details, odometer, status. Unique registration per owner while active                                               |
| `vehicle_assignments`         | One current driver per vehicle                                                                                                                           |
| `service_records`             | Source, category, details, cost as entered, provider (organization or name), who entered it, schedule, document, service request. **No verified column** |
| `maintenance_schedules`       | Intervals, last done, reminder thresholds, last reminded status                                                                                          |
| `vehicle_documents`           | Pipeline state, encryption fields (wrapped key, IV, tag), SHA-256, expiry, driver visibility                                                             |
| `vehicle_document_shares`     | SHA-256 of the token, label, expiry, max views, views, revoked                                                                                           |
| `service_requests.vehicle_id` | Linked vehicle (optional)                                                                                                                                |

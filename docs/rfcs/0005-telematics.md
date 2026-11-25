# RFC-0005: Telematics, live vehicle tracking and ELD

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:** SRS §9 ("Telematics, live vehicle tracking, ELD integration"; RFC only)

## Summary

Fleets could connect a telematics provider so that FleetTrust receives **odometer readings and diagnostic trouble codes** from vehicles automatically. That would keep maintenance schedules accurate (the existing `MaintenanceDue` reminders) and could suggest a service request when a fault code appears. Live position tracking and electronic logging devices (ELD, driver hours) are a **separate, later decision** inside this RFC, because they carry far greater privacy and regulatory weight.

## Why it's excluded today, and preconditions

- **Location and driving data about employees** is among the most sensitive workplace data. In Europe it needs a lawful basis, proportionality, works-council consultation in some countries, and transparency to drivers.
- **ELD and tachograph rules differ by jurisdiction** (EU tachograph regulation, US FMCSA ELD). Supporting them is a compliance product in its own right.
- **Vendor diversity:** dozens of telematics APIs exist, each with different data models.
- **Preconditions to start:**
  - fleets in the pilot asking for it;
  - the jurisdiction (OQ-03);
  - a DPIA;
  - an aggregator or vendor chosen;
  - an ADR superseding ADR-0011 for this module.

## Principles and constraints

1. **Start with vehicle health, not people tracking.** Phase 1 ingests the odometer, engine hours and fault codes only, with no positions.
2. **Positions only with a separate decision.** If location tracking is ever added, it needs:
   - an explicit purpose (for example theft recovery or breakdown assistance);
   - an off-duty privacy mode;
   - the shortest retention;
   - visibility for the driver of what is collected;
   - no use for disciplinary scoring.
3. **The emergency feature is unchanged.** Emergency location sharing stays per incident and person-initiated (ADR-0025). Telematics never triggers or fills in an emergency alert automatically.
4. **No driver scores.** There is no "driver behaviour score". This follows the same no-score invariant as the trust model (SRS §8.2).
5. **Fleet-scoped tenancy.** Data belongs to the fleet organisation and follows the existing tenancy rules and tenant penetration tests (Prompt 27).
6. **Vendor-neutral port.** Adapters per vendor or aggregator, with a fake for tests.

## Proposed design

A new module `telematics`, linked to fleet vehicles.

**Data it would own** (described, not created):

| Table (future)            | Purpose                                                                                                                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `telematics_connections`  | Fleet organisation ↔ vendor account: OAuth token reference in Secret Manager (never stored in the database), status, scopes |
| `telematics_device_links` | Vendor device ID ↔ fleet vehicle ID                                                                                         |
| `telematics_readings`     | Odometer, engine hours and fault codes with timestamps. Kept 13 months by default; positions excluded in phase 1            |

**Effect on existing features:** readings update `vehicles.odometer_km` (the column that exists today), and the existing maintenance schedules then raise `MaintenanceDue` as they do now. A fault code can show a suggestion to "request a service for this fault", which the fleet manager confirms. Nothing is created automatically.

## Integration seams

### Consumes (existing events)

| Event                     | Producer (today) | Use                                                                          |
| ------------------------- | ---------------- | ---------------------------------------------------------------------------- |
| `MaintenanceDue`          | Vehicles module  | Shown next to the live odometer, so the reminder is based on real distance   |
| `VehicleDocumentExpiring` | Vehicles module  | Show alongside vehicle health on the same fleet dashboard (no new behaviour) |

**Existing write seam:** the vehicles service already records odometer updates (`vehicles.odometer_km` and `odometer_updated_at`). Telematics would call the same service method a fleet manager's manual update uses, so validation and audit stay in one place.

### Emits (proposed events; schemas in [events/](events/))

| Event                       | When                                                                          |
| --------------------------- | ----------------------------------------------------------------------------- |
| `TelematicsReadingReceived` | A validated reading was stored for a linked vehicle                           |
| `VehicleFaultDetected`      | A new diagnostic trouble code appeared (the fleet manager decides what to do) |

### Ports (future)

- `TelematicsProvider.connect(orgId)` (OAuth), `.devices()`, `.readingsSince(cursor)`, and webhook verification.
- **Ingestion:** a worker job polling or receiving webhooks, idempotent per (device, timestamp).

### Touch points in existing code

- **Fleet vehicle page:** a "Connected" status, the latest reading and fault codes.
- **Privacy:** readings are fleet data. Driver-related data (if positions are ever added) is included in the driver's export and covered by their consent and notice.

## Event schemas

- [`TelematicsReadingReceived`](events/TelematicsReadingReceived.schema.json)
- [`VehicleFaultDetected`](events/VehicleFaultDetected.schema.json)

## Migration path

1. **Decide.** Pilot fleets' demand, vendor or aggregator, DPIA (phase 1 without positions), and a new ADR. The guard's telematics stems are narrowed to the module's tables.
2. **Expand.** Add the tables, adapters (sandbox) and an ingestion worker. Readings are stored but not yet applied.
3. **Shadow.** Compare telematics odometer values with the manual entries for a few fleets, and tune validation (reject decreasing odometers and implausible jumps).
4. **Apply readings** to the odometer, and show fault codes.
5. **Phase 2 (positions or ELD):** only through a new RFC section, DPIA and ADR.
6. **Withdraw path.** Disconnect the vendors, keep the manual odometer, delete readings after the retention period.

## Risks

| Risk                                             | Mitigation                                                |
| ------------------------------------------------ | --------------------------------------------------------- |
| Workplace surveillance concerns                  | Phase 1 without positions; driver transparency; no scores |
| Wrong odometer readings moving maintenance dates | Validation; the manual override wins; changes are audited |
| Vendor lock-in                                   | Port and adapters; store only normalised readings         |
| Token leakage                                    | Tokens in Secret Manager, scoped, revocable per fleet     |

## Open questions

- Use an aggregator (one API, many vendors) or direct integrations?
- Are fault-code suggestions useful without a maintenance knowledge base?

## Exit criteria (to leave Draft)

- At least two pilot fleets request it.
- Vendor and DPIA recorded.
- The ADR and guard change drafted with the first migration.

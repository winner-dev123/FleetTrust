# RFCs: future modules (specification only)

These modules are **out of scope** for the current product ([SRS §9](../product/SRS.md#9-explicit-non-goals)). By [ADR-0011](../adr/0011-future-modules-spec-only.md) they exist **only** as these documents: no tables, migrations, routes, UI, workers, queues, feature flags or SDKs. A CI guard enforces this ([architecture review](architecture-review.md)).

| RFC                                              | Module                                              | Status | Main seam                                                                                   |
| ------------------------------------------------ | --------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------- |
| [0001](0001-rewards-check-ins-streaks-ledger.md) | Daily rewards, check-ins, streaks, points ledger    | Draft  | Outbox events from existing activity; a new `engagement` module consuming them              |
| [0002](0002-payments-and-escrow.md)              | Customer-to-provider payments and escrow            | Draft  | Service request lifecycle events (`ServiceRequestQuoteAccepted`, `ServiceRequestCompleted`) |
| [0003](0003-transaction-backed-reviews.md)       | Transaction-backed reviews                          | Draft  | `ServiceRequestCompleted` as proof of a real transaction; moderation pipeline               |
| [0004](0004-ai-features.md)                      | AI assistance (request drafting, moderation triage) | Draft  | Ports beside existing services, advisory only; `ContentReported` for triage                 |
| [0005](0005-telematics.md)                       | Telematics, live tracking, ELD                      | Draft  | Vehicle module (odometer, maintenance, documents) and `MaintenanceDue`                      |
| [0006](0006-multilingual.md)                     | Multilingual UI and content                         | Draft  | Externalised strings, locale-aware formatting, the `Accept-Language` seam                   |

## What "integration seam" means here

A seam is a place where a future module can attach **without changing the behaviour of today's code**:

- **Existing domain events.** These are written to the transactional outbox today (ADR-0007) for current features. A future module subscribes to them; nothing subscribes for that purpose now. Each RFC lists the ones it would consume, and a test checks that they really exist in the code.
- **Proposed events.** Defined here as JSON Schema files in [events/](events/), never loaded by the application. A test checks that **none of them exist in the code yet**.
- **Ports.** Interfaces the future module would provide or need, described in prose. None are declared in code.

## Lifecycle of an RFC

1. **Draft** (all of them today): reviewed for direction, risks and seams.
2. **Accepted:** the owner decides to build it. A new ADR supersedes the relevant part of ADR-0011, the guard's word list is updated in the same pull request, and legal or compliance preconditions are met.
3. **Implemented:** shipped behind the normal release process. Migrations are expand-only ([release-and-rollback.md](../operations/release-and-rollback.md)).
4. **Withdrawn:** not pursued; the document stays for the record.

Every RFC ends with exit criteria for leaving Draft.

## Shared constraints (apply to every RFC)

- **The trust model is not for sale** ([SRS §8](../product/SRS.md#8-trust-model)). No plan tier, payment, points or AI output may affect verification, Power User status or search ranking, and there must never be a numeric reputation or trust score.
- **Emergency features stay free and unconditional** (ADR-0010). No module may gate, rank or delay them.
- **Privacy by design:** data minimisation, consent per purpose (Prompt 27 consents), export and erasure extended to every new table.
- **Expand-only rollout:** new modules add tables and events; they never rewrite existing ones in the same release.

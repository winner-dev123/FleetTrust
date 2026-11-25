# ADR-0011: Future modules are specification-only

- Status: Accepted
- Date: 2026-11-19

## Context

Several modules are planned for later:

- Rewards and streaks.
- Payments and escrow.
- Transaction-backed reviews.
- AI.
- Telematics.
- Multilingual support.

Half-built versions behind feature flags tend to leak through configuration mistakes, and they create legal exposure, for example a hidden payment endpoint.

## Decision

- These modules exist **only** as RFC documents (`docs/rfcs/`, Prompt 30). The RFCs define integration seams and event schemas.
- For these modules, the codebase **must not** contain:
  - Database tables or migrations.
  - API routes.
  - UI screens or navigation entries.
  - Workers or queues.
  - Feature flags or Remote Config keys.
- Allowed: domain events that already exist for current features (for example `ServiceRequestCompleted`). A future module could consume them; nothing consumes them for that purpose now.
- CI adds a guard (Prompt 05/27) that fails on forbidden identifiers in routes, migrations and UI. Examples: `escrow`, `payout`, `rating`, `stars`, `streak`, `reward_points`.

## Consequences

- Future work starts from an RFC review and a new ADR, not from dormant code.
- The guard's word list may need tuning to avoid false positives, such as "rating" in "operating".

## Alternatives considered

- **Feature-flagged stubs**: rejected by the business rule.

## Update (Prompt 30, 2026-11-25)

- The RFCs exist: [docs/rfcs](../rfcs/README.md), RFC-0001 to RFC-0006, all Draft. Each defines integration seams on existing events, proposed event schemas ([docs/rfcs/events](../rfcs/events/)), a migration path and exit criteria.
- The guard now also covers AI (model SDKs, `llm`, `embedding`), telematics (SDKs, `telematics`, `geofence`) and translated content (i18n frameworks, `translation`).
- New tests keep the RFCs honest: every consumed event must exist in the API, and no proposed event or future table may appear in code or migrations ([architecture review](../rfcs/architecture-review.md)).
- Accepting an RFC means a new ADR superseding this one for that module only, with the guard change in the same pull request.

# ADR-0015: Entitlements model — daily counters, capacity limits, per-assignment grace

- Status: Accepted
- Date: 2026-11-19
- Refines: [ADR-0008](0008-manual-plan-activation.md) (manual plan activation)

## Context

Prompt 08 needs versioned plans, quotas that can't be bypassed by concurrency or retries (SRS FR-03, AB-18), daily resets, safe downgrades, staff overrides and grace periods. The limits come in two shapes:

- **Rates**, such as friend requests or articles per day. Usage is an event count that resets.
- **Sizes**, such as staff seats or branches. Usage is how much exists right now.

## Decision

1. **Catalog as code.** Plans and their limits are defined in `packages/db/src/seed/plans.data.ts` and seeded. Re-seeding with changed terms publishes a new version and retires the old one. A database trigger makes published versions and their limits immutable, so an assignment always means what it meant when it was made. A missing key means "not included" (0), and `NULL` means unlimited.
2. **Two kinds of capability** (`CAPABILITIES` in `@fleettrust/types`):
   - **daily:** a counter row per (subject, key, local day). It is consumed by one conditional upsert (`INSERT … ON CONFLICT DO UPDATE … WHERE used + n <= limit`). Postgres serialises concurrent upserts on the row, so the limit can't be overshot. Optional idempotency keys go to a ledger in the same savepoint, so a retry is counted once and a refusal leaves no record. Callers consume **inside the transaction that creates the counted thing**, so a failed creation releases the unit.
   - **capacity:** counted from live data (members plus pending invitations; branches) under the organization row lock that already serialises membership changes. No counter can drift from reality.
3. **Daily reset at local midnight** in the subject's timezone: the organization's for org quotas, the user's for personal ones, UTC by default (OQ-08). Both have a `timezone` column, validated as an IANA name. Periods are computed from an injectable clock, so tests can cross midnight and grace periods.
4. **Resolution order:** the active assignment, else the audience's default plan (`provider-free`, `fleet-free`, `personal-free`). Then any ended assignment still within **its own** grace period lifts a limit if it's more generous. Then an open staff override replaces the limit for that key.
5. **Grace belongs to the assignment being left.** Each assignment records `grace_days` (default 14). When it is superseded or cancelled, its limits keep applying for that long. A downgrade therefore never cuts capacity the moment it's recorded.
6. **Downgrades never delete.** Above-limit data stays readable, editable and deletable. Only creation above the limit is refused (403 `quota_exceeded` with `key`, `limit` and `used`). Usage meters show `overLimit`.
7. **Staff roles in the database, granted from the CLI.** `platform_staff` (`billing_operator` for now) gates `/v1/admin/billing/*`. Non-staff get 404. Grants and revocations go through `pnpm db:staff` and are audited, until the admin console adds MFA-protected management (Prompt 26).
8. **No emergency capability exists.** Emergency code can't be quota-gated by mistake: the catalog has no key for it, `consume()` refuses unknown keys, and lint forbids the emergency module from importing entitlements (ADR-0010).

## Consequences

- Counter rows accumulate, one per subject, key and day used. A scheduled purge job (ADR-0007) can drop periods older than a few weeks; nothing reads them.
- Changing the catalog is a code review plus `pnpm db:seed`, not an admin form. The admin console may add a draft-and-publish UI later on the same tables.
- Quota-consuming features (friend requests 16, service requests 14, articles 15, groups 16) call `EntitlementsService.consume()` in their own prompts. This stage proves the mechanism with service-level and real-Postgres concurrency tests.

## Alternatives considered

- **Redis counters:** fast, but a second source of truth that can't share a transaction with the row being created. A crash between the two would leak or lose units. Rejected while volumes are modest.
- **`SELECT … FOR UPDATE` then increment:** correct, but two round trips per check, and the first insert of a day needs extra care. The single upsert is simpler.
- **Grace defined on the new (lower) assignment:** ambiguous with several transitions in a row. Keeping it on the assignment being left makes "how long do they keep Pro limits" a property of their Pro agreement.

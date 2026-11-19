# ADR-0009: Trust signals and ranking are independent of payment

- Status: Accepted
- Date: 2026-11-19

## Context

If paying customers could get badges, Power User status or better search placement, the platform's trust labels would become meaningless. They would also be misleading to consumers.

## Decision

- **The verification module and the Power User module never read plan or entitlement data.** This is enforced by a module-boundary lint rule: neither module may import the entitlements module.
- **The search ranking function takes no plan or tier input.** Ranking signals are:
  - Category/text match.
  - Distance and service-radius coverage.
  - Open now.
  - Vehicle support.

  Verification is a **filter** the user chooses and a displayed label, not a hidden boost.

- No "featured", "sponsored" or "promoted" placement exists. Adding any of these requires a new ADR with clear labelling.
- Tests assert that two identical providers on different plans get identical ranking and identical badge eligibility.

## Consequences

- Revenue levers are limited to capacity: quotas, seats, branches, CRM features.
- Sponsored placement can't be introduced quietly.

## Alternatives considered

- **Verification as a ranking boost**: rejected for the initial version. It is evidence-based, so it would be allowed, but it adds bias against new providers. Can be revisited with data.

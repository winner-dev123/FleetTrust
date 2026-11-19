# ADR-0008: Manual plan activation after external billing

- Status: Accepted
- Date: 2026-11-19

## Context

Business rule: the platform doesn't process payments of any kind in the initial implementation. Organizations still need paid SaaS plans with higher quotas, more staff seats and more branches.

## Decision

- Plans are **versioned**. A plan version is immutable once assigned. Changes create a new version.
- A **billing operator** (an admin sub-role) assigns a plan version to an organization or user after confirming payment through an external channel ([OQ-05](../product/open-questions.md)).
- Each assignment records:
  - The operator.
  - The external reference.
  - Effective dates.
  - The grace period.
  - A free-text note.

  It is written to the audit log.

- **UI wording:**
  - Allowed: "Activated by FleetTrust staff on <date>".
  - Forbidden: "payment verified", "paid", "payment received". A copy lint check enforces this (Prompt 24).
- **Downgrade and expiry:** existing data is never deleted. Creation above the new limit is blocked after the grace period ends, and users see clear usage meters.
- No payment-provider SDKs, webhooks or checkout endpoints exist in the codebase.

## Consequences

- Plan activation needs manual operator work. That is acceptable at pilot scale.
- A future billing integration must come through an RFC (Prompt 30) and a new ADR.

## Alternatives considered

- **Stripe Billing integration for SaaS fees**: deferred. It doesn't violate the customer-to-provider rule, but it is explicitly outside the pack's initial scope ("provisioned by administrators after external billing confirmation").

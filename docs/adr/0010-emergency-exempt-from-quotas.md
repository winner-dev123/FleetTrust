# ADR-0010: Emergency functionality is exempt from ordinary quotas

- Status: Accepted. Implemented in Prompt 18 ([ADR-0025](0025-emergency-incidents-and-dispatch.md))
- Date: 2026-11-19

## Context

A user stranded on the road must be able to alert their trusted contacts even if they are on a free plan or have used up their daily quotas. At the same time, emergency alerts can be abused for harassment ([SRS AB-03](../product/SRS.md#10-abuse-cases)).

## Decision

- The emergency module **never calls the entitlements module**. A lint boundary rule forbids the import, and a test asserts that incident creation succeeds with all quotas exhausted.
- Safety-oriented abuse controls apply instead:
  - Trusted contacts require **mutual consent**. You can only alert people who agreed to be your contacts.
  - Per-user emergency rate limiting uses a **soft** threshold. Exceeding it flags the account for review and slows repeated _non-first_ alerts. It **never blocks the first incident** in a window.
  - Contacts can mute a requester or report abuse. Proven abuse leads to moderation action, not a quota.
- **Reliability:**
  - A dedicated job queue ([ADR-0007](0007-jobs-and-realtime.md)).
  - FCM first, email fallback.
  - Idempotent retries.
  - Alerting on dispatch failures.
- **Copy rules:** the first screen always shows official emergency service guidance. Wording such as "help is on the way" or "guaranteed" is forbidden (copy lint, Prompt 24).

## Consequences

- An abusive user can send some alerts before moderation catches up. This risk is accepted in favour of never blocking a genuine emergency.
- Emergency notification volume isn't bounded by the plan, so cost monitoring is needed on push and email.

## Alternatives considered

- **A separate emergency quota**: rejected. Any hard cap could block a genuine emergency.

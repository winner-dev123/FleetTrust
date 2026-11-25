# RFC-0003: Transaction-backed reviews

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:** SRS §9 ("Reviews, star ratings, reputation scores, trust scores"; business rule. Transaction-backed reviews are RFC only.)

## Summary

Customers who **completed a real service request** with a provider could leave a short written account of what happened: what was done, whether it matched the quote, and whether they would use the provider again. Each account is tied to that one transaction. **There would be no stars, no numeric scores and no averages**: the trust model forbids any reputation score (SRS §8.2.5).

## Why it's excluded today, and preconditions

- **Reviews are the main vector for fake reputation** (purchased, competitor-written or coerced), and the main source of defamation complaints. Doing them badly would undermine the verification model, which is FleetTrust's core.
- **Consumer law** (for example the EU Omnibus Directive) requires disclosing whether and how reviews are verified, and forbids fake or selectively suppressed reviews.
- **Preconditions to start:**
  - moderation capacity proven in the pilot;
  - a legal review of the review terms and takedown process;
  - an ADR superseding ADR-0011 for this module, explicitly keeping the "no score" invariant.

## Principles and constraints

1. **Only from a completed transaction.** One review per completed service request per requester side, written by someone who was part of the request. The proof is the existing `ServiceRequestCompleted` event; no other path can create a review.
2. **No scores, ever.** No stars, ratings, percentages, averages, badges derived from reviews, or sorting by "best reviewed". Reviews are text plus at most two factual yes/no answers ("Did the final price match the quote?", "Was the work done when agreed?"). Answers are shown per review, never aggregated into a number.
3. **No effect on trust or ranking** (SRS §8.2). Reviews never change verification, Power User status or search ranking.
4. **The provider can respond** once, publicly, under each review.
5. **Moderation, not deletion by request.** Providers can report a review (existing moderation pipeline). Removal happens only for policy reasons (abuse, personal data, off-topic, proven conflict of interest), never because a review is negative.
6. **Disclosed verification.** Each review says "Written after a completed FleetTrust service request on {date}".

## Proposed design

A new module `accounts` (working name, so it doesn't collide with the guard's `review` stem; final name decided in the ADR), consuming request events and reusing moderation.

**Data it would own** (described, not created):

| Table (future)                  | Purpose                                                                                                                                                                                                                                         |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `transaction_accounts`          | One per (completed request, requester side): text (≤ 2,000 characters, `safeText`), two optional yes/no answers, status (`published`, `hidden_pending_review`, `removed`), timestamps. A unique key on the request makes it one per transaction |
| `transaction_account_responses` | At most one provider response per account                                                                                                                                                                                                       |

**Eligibility window:** from `ServiceRequestCompleted` for 60 days. The requester is notified once, through the existing inbox, with no reminders.

## Integration seams

### Consumes (existing events)

| Event                     | Producer (today)  | Use                                                                        |
| ------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `ServiceRequestCompleted` | Requests module   | Proof of transaction; opens the eligibility window                         |
| `ContentReported`         | Moderation module | Reports on a review use the existing report flow and auto-hide threshold   |
| `MemberSanctioned`        | Moderation module | Hide reviews written by sanctioned accounts while the sanction is reviewed |

### Emits (proposed events; schemas in [events/](events/))

| Event                         | When                                                 |
| ----------------------------- | ---------------------------------------------------- |
| `TransactionAccountPublished` | A review was published (after automatic checks)      |
| `TransactionAccountRemoved`   | A moderator removed a review, with the policy reason |

### Ports (future)

- `TransactionAccounts.forProvider(orgId, cursor)`: a paginated list, newest first. Never sorted by "positivity".
- **Moderation:** reuse `ModerationService` with a new target type. Moderators' decisions are audited and appealable (the existing appeals flow, ADR-0030).

### Touch points in existing code

- **Provider profile:** a "Customer accounts" section listing reviews chronologically, with the disclosure line. No summary number anywhere.
- **Request page (requester):** a "Write an account" action during the window.
- **Privacy:** export includes the person's reviews. On erasure, the text is kept but shown as "a former customer", like messages.

## Event schemas

- [`TransactionAccountPublished`](events/TransactionAccountPublished.schema.json)
- [`TransactionAccountRemoved`](events/TransactionAccountRemoved.schema.json)

## Migration path

1. **Decide.** Owner decision, legal review of the terms and takedown policy, and an ADR that keeps the no-score invariant in writing. The guard's `review` pattern stays; the module's name avoids it, and a guard test asserts **no aggregate** (no `avg`, `score` or `rating` columns) in its tables.
2. **Expand.** Add the tables and the moderation target type. Nothing is visible yet.
3. **Collect quietly.** Invite accounts for requests completed after launch (no backfill), visible only to the provider for 4 weeks, so policy and moderation load can be tuned.
4. **Publish** on provider profiles with the disclosure line.
5. **Withdraw path.** Hide the section, export to the authors on request, then delete in a contract release.

## Risks

| Risk                                 | Mitigation                                                                                                                            |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| Fake reviews                         | Only from completed requests between distinct verified accounts; collusion signals (same device or IP history) flagged for moderators |
| Retaliation or coercion by providers | Reviews are visible to the provider only after publication; reports of coercion go to trust & safety                                  |
| Defamation claims                    | Clear policy, a provider response, takedown for policy breaches only, audit trail                                                     |
| A score creeping in later            | ADR invariant, guard test for aggregate columns, design review                                                                        |

## Open questions

- Can fleets (organisations) write accounts, or only the individual who managed the request?
- Should providers be able to account for customers (two-sided), or stay one-sided?

## Exit criteria (to leave Draft)

- Legal review, moderation capacity plan and the ADR with the invariant recorded.
- Guard tests for aggregates drafted.

# RFC-0001: Daily rewards, check-ins, streaks and a points ledger

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:** SRS §9 ("Daily rewards, check-ins, streaks, points ledger"; business rule, RFC only)

## Summary

An optional engagement layer would recognise useful, repeated activity: completing service requests, keeping vehicle documents current, answering community questions. It would use non-monetary points, check-ins and streaks, recorded in an append-only ledger. Points never buy trust, ranking or emergency features, and they are never money.

## Why it's excluded today, and preconditions

- **Gamification can distort a trust product.** Fake activity to keep a streak alive is a well-known pattern. Until the pilot shows real usage patterns and abuse rates, rewards would be guesswork.
- **Points that can be redeemed for anything of value become a regulated instrument** in many jurisdictions (OQ-03): stored value, consumer law, tax.
- **Preconditions to start:**
  - pilot data on active use and abuse;
  - a legal opinion on whether points stay purely symbolic;
  - an ADR superseding ADR-0011 for this module.

## Principles and constraints

1. **Points are symbolic.** They are not money: never redeemable, transferable, purchasable or convertible. Any redemption scheme would need its own RFC and legal review.
2. **No influence on trust** (SRS §8.2). Points, streaks and badges never affect verification, Power User status, search ranking, quotas or visibility. They are never shown on provider listings as a quality signal, and there is no leaderboard of providers.
3. **No pressure.** Missing a day costs nothing beyond the streak counter, and there are no loss-aversion notifications ("your streak is about to break!"). Opt-in, off by default, with a consent purpose `engagement`.
4. **Abuse-resistant by construction.** Points come only from events that already passed the product's own checks (a completed service request, an accepted answer). Never from raw clicks, sign-ins or self-reported actions.
5. **Append-only, auditable ledger.** Balances are derived from entries. Corrections are new entries (reversals), never edits.
6. **Emergency use is never rewarded or counted** (ADR-0010). Raising an alert must not be incentivised in any way.

## Proposed design

A new module `engagement` (API) with its own tables, consuming outbox events. Nothing in existing modules changes, apart from a consent purpose and, later, a profile panel.

**Data it would own** (described here, not created):

| Table (future)         | Purpose                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `engagement_rules`     | Versioned rule set: which event earns how many points, and daily caps                                                |
| `engagement_ledger`    | Append-only entries: user, points (+/−), rule version, source event ID (unique, for idempotency), reason, created at |
| `engagement_streaks`   | Per user and kind: current length, longest, last qualifying local date                                               |
| `engagement_check_ins` | One row per user per local day, written only by qualifying activity, never by a button                               |

**Rules (initial proposal):**

| Source event (existing)                                                   | Points                                             | Cap         |
| ------------------------------------------------------------------------- | -------------------------------------------------- | ----------- |
| `ServiceRequestCompleted` (requester or provider side)                    | 10                                                 | 3 per day   |
| `ArticleCommentCreated` (later accepted as helpful by the article author) | 2                                                  | 5 per day   |
| Vehicle documents all current at the monthly check                        | 5                                                  | 1 per month |
| `MemberSanctioned`, `ContentReported` upheld against the user             | Reverses points earned from the sanctioned content | —           |

## Integration seams

### Consumes (existing events)

| Event                     | Producer (today)  | Use                                                                        |
| ------------------------- | ----------------- | -------------------------------------------------------------------------- |
| `ServiceRequestCompleted` | Requests module   | Earn points; qualifying day for the "active" streak                        |
| `ArticleCommentCreated`   | Articles module   | Candidate for "helpful answer" points (only once marked helpful)           |
| `MemberSanctioned`        | Moderation module | Reverse points tied to sanctioned content; pause earning during a sanction |
| `ContentReported`         | Moderation module | Hold pending points on reported content until a decision                   |
| `VehicleDocumentExpiring` | Vehicles module   | Monthly "documents current" check (the absence of expiring documents)      |

### Emits (proposed events; schemas in [events/](events/))

| Event                      | When                                                  |
| -------------------------- | ----------------------------------------------------- |
| `EngagementPointsGranted`  | A ledger entry with positive points was written       |
| `EngagementPointsReversed` | A reversal entry was written (sanction or correction) |
| `EngagementStreakUpdated`  | A streak grew, or reset because a day was missed      |

### Ports (future)

- `EngagementReader.balance(userId)` and `.streaks(userId)`: read-only, for the profile panel.
- **No port into search, verification, entitlements or emergency.** A dependency rule (eslint module boundaries, as today) would forbid those imports.

### Touch points in existing code

- **Privacy:**
  - add the consent purpose `engagement`;
  - add the ledger to `GET /v1/me/export`;
  - erase on `DELETE /v1/me` (pseudonymise ledger rows to the tombstone, as for messages).
- **UI:** an "Activity" panel on the person's own account page only. Never on public profiles or listings.

## Event schemas

- [`EngagementPointsGranted`](events/EngagementPointsGranted.schema.json)
- [`EngagementPointsReversed`](events/EngagementPointsReversed.schema.json)
- [`EngagementStreakUpdated`](events/EngagementStreakUpdated.schema.json)

## Migration path

1. **Decide.** Owner accepts this RFC, legal confirms points stay symbolic, and a new ADR supersedes ADR-0011 for `engagement`. The guard stems `reward`, `streak` and `ledger` are narrowed to allow the `engagement_*` tables only.
2. **Expand.** Migration adds the `engagement_*` tables and the consent purpose (expand-only). The module subscribes to existing events. No backfill: points start from the launch date, so there is no retroactive scoring.
3. **Shadow (2–4 weeks).** Rules run and write ledger entries, but nothing is shown to users. Review abuse signals (bursts, circular request–complete patterns between the same accounts).
4. **Opt-in pilot.** Users who consent see their own panel. Measure retention without dark patterns.
5. **General availability**, or withdraw. Withdrawal is clean: drop the panel, stop consuming events, export and then delete the tables in a contract release.

## Risks

| Risk                                       | Mitigation                                                                                                                    |
| ------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Fake transactions to farm points           | Points only from completed requests between distinct, verified-email accounts; daily caps; collusion detection in shadow mode |
| Points perceived as a quality signal       | Never shown publicly; copy says "your activity", not "rating"                                                                 |
| Regulatory reclassification (stored value) | No redemption; legal sign-off before launch                                                                                   |
| Notification fatigue                       | No streak-break reminders; the emergency channel is never used                                                                |

## Open questions

- Do providers earn points at all, or only drivers (to avoid any link with listings)?
- What, if anything, do points unlock, with no trust or ranking effect? (Cosmetic profile themes only?)

## Exit criteria (to leave Draft)

- Owner decision and legal opinion recorded.
- The rule set reviewed against the abuse cases above.
- The ADR and guard change drafted in the same pull request as the first migration.

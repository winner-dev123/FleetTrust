# ADR-0028: Parts as live, time-stamped listings with inquiry-only availability, and provider referrals that need customer consent

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 21 adds parts and provider referrals (SRS F-140..F-142):

- parts listings, compatibility, indicative prices and stock freshness timestamps;
- availability inquiries;
- provider-to-provider referrals with explicit consent and visibility controls.

The acceptance criteria are:

- no checkout;
- stale stock clearly labelled;
- referrals auditable.

SRS §8 excludes parts checkout and reservations ("inquiry only"). Abuse case AB-17 is undisclosed referral kickbacks.

## Decision

1. **Parts are live data, not part of the published profile snapshot.**
   - **Why live:** stock changes daily, and a snapshot would be stale by design. Hours are live for the same reason.
   - **Listing contents:**
     - name, brand and part number (normalised to letters and digits for search);
     - category and condition;
     - an indicative price (the catalog's price shape, decimals checked against the currency);
     - compatibility ranges;
     - stock status and an optional count;
     - an optional branch (where the stock is).
   - **Public visibility.** A listing is public while:
     - the provider is published and active;
     - the listing is active;
     - its branch is published (when it has one);
     - its stock was confirmed within 90 days.
   - **Search:**
     - text and part number;
     - category and condition;
     - vehicle compatibility, or one of your own vehicles when signed in;
     - distance (visitors get approximate distances only, OQ-11).
2. **Stock is a claim with a timestamp, and its age is always shown.**
   - **Who sets the time:** every stock update sets `stock_confirmed_at` to server time. "Still in stock" counts as an update.
   - **Ages:**

     | Age       | Freshness | What clients show                                                                                   |
     | --------- | --------- | --------------------------------------------------------------------------------------------------- |
     | ≤ 3 days  | `fresh`   | "In stock · confirmed today"                                                                        |
     | ≤ 14 days | `aging`   | "In stock · confirmed 9 days ago"                                                                   |
     | ≤ 90 days | `stale`   | "Stock not confirmed for 20 days (last reported: in stock). It may have changed: ask the provider." |
     | > 90 days | `expired` | Not in public search; the provider sees it in a "needs a check" list                                |

   - **One label for everyone:** the API returns the label, so web, mobile and visitors all show the same text.
   - **Stale counts:** a stale listing never shows a count publicly, and the "in stock only" filter leaves it out.
   - **Answers confirm stock:** answering an availability inquiry is a shelf check, so it also refreshes the confirmation.
3. **Availability inquiries are information only. There is no checkout.**
   - **The question:** a person (or a fleet member for the fleet) asks "do you have this?", with a quantity, a message and optionally a vehicle.
   - **The answer:** the provider answers `available` (with a quantity), `not_available` or `can_order` (with days until it arrives).
   - **What doesn't exist:** price, hold, reservation, order and payment fields. Every part and inquiry carries `PARTS_DISCLAIMER`.
   - **Guard:** the repository guard (ADR-0011) now also rejects `cart`, `basket`, `reservation` and `commission` identifiers and routes.
   - **Limits:**
     - one open question per person per part;
     - 30 questions per hour per user;
     - unanswered questions expire after 14 days;
     - members can't ask their own business.
4. **A referral shares nothing until the customer consents.**
   - **The flow:**
     1. A provider that received a request suggests another provider. It gives a reason and a **declared relationship**: `none`, `partner`, `same_owner` or `referral_fee`. Anything other than `none` must be described, e.g. "5% of the invoice".
     2. The other provider learns nothing yet: no inquiry, no notification, no referral in its lists.
     3. The customer sees the suggestion, the reason and the relationship in plain words.
     4. The customer consents (`consent: true` is required; it's never a default) or declines.
     5. On consent the other provider gets the request as a normal inquiry, marked "referred by", through the usual matching rules (its nearest published branch with the category and vehicle type).
   - **Visibility controls:**
     - **Customer chooses:**
       - whether their photos are shared (default no);
       - whether the referrer may see the outcome, i.e. quoted, declined or accepted (default no).
     - **Same limits as any provider:** the receiver sees what any chosen provider sees (approximate location, no registration until accepted).
     - **Receiver's view:** the receiver sees the referrer's reason and relationship, exactly as the customer saw them.
   - **Limits:**
     - no self-referrals;
     - targets must match the request;
     - one open referral per target per request;
     - at most three open referrals per inquiry;
     - referrals end with the request: a pending one shows as `expired`.
5. **Referrals are auditable in three places.**
   - **Audit log:** `audit_events` records `referral.proposed`, `referral.withdrawn`, `referral.consented` and `referral.declined`. The metadata holds the relationship, its details and the sharing choices.
   - **Request history:** the append-only request history records the same steps, so the customer sees them.
   - **The referral row:**
     - It keeps the exact consent text and its version, who decided and when.
     - A database trigger stops the disclosure (target, reason, relationship) from changing after creation.
     - A decision is final, and rows can't be deleted while their request exists.
   - **History in the DTO:** each referral DTO carries its history from the audit log.

## Consequences

- **Search cost:** parts search is a straightforward SQL query (ILIKE on name, brand and part number; an `EXISTS` on compatibility). That's fine at pilot scale; full-text or trigram indexes can come later.
- **Referral fees are disclosed, not processed.** FleetTrust doesn't know whether a fee was paid. The disclosure is the control (AB-17); moderation (Prompt 23) can act on reports of undisclosed fees.
- **Branch-scoped members:**
  - Branch-scoped staff confirm and answer for their branch's stock only.
  - Organization-wide listings are answered by organization-wide members.
- **Not built:**
  - bulk import of parts (CSV);
  - stock feeds from inventory systems;
  - provider opt-out from receiving referrals;
  - an admin referral view (Prompt 26 reads the audit log);
  - the UI (Prompts 24 and 25).

## Alternatives considered

- **Parts in the published snapshot:** stock would be frozen at publication, the opposite of what's needed.
- **Hiding stale stock immediately:** customers lose a useful lead ("they had it two weeks ago"). Labelling it, and hiding only after 90 days, keeps the lead and is honest.
- **Reservations or "hold for me":** they need stock accounting and dispute handling, and SRS §8 excludes them.
- **Sending the referral straight to the other provider:** it shares the customer's request without consent.
- **Letting the referrer pass a private note to the receiver:** the customer couldn't see everything that was said about them. The single message is shown to both.

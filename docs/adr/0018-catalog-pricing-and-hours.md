# ADR-0018: Service catalog in the snapshot, indicative prices as exact decimals, live opening hours

- Status: Accepted
- Date: 2026-11-19

## Context

Prompt 11 adds service offerings, indicative prices, opening hours, holiday exceptions and timezones to provider profiles (SRS F-033..F-035, FR-07). Business rule 2 says no money moves through the platform: prices are guidance, never a payable amount, and there is no checkout. ADR-0017 publishes the profile as a frozen snapshot. It expected hours and prices to follow the same pattern. Several questions needed a decision:

- **Prices:** how to store amounts, and how to keep them from looking like a checkout.
- **Hours:** whether an opening-hours change, such as an emergency closure, should wait for a republish.
- **Branch-scoped managers:** they manage the catalog and hours for their branch (SRS §2.2).

## Decision

1. **Offerings are part of the draft and the snapshot.**
   - Each offering has:
     - one of the provider's categories;
     - vehicle compatibility;
     - where the work happens (`at_premises` or `at_customer`);
     - optionally, a list of branches;
     - one indicative price.
   - An offering is validated in full when it's saved. It's a single form, so there's no partial state.
   - At publish time the `catalog` wizard step checks how each offering fits the rest of the profile, and any issue blocks publication:
     - its category is one the provider offers;
     - its vehicle types are among those the provider serves;
     - at least one of its branches is publishable;
     - `at_customer` services have a service radius on every branch that offers them.
   - The catalog itself is optional; an empty one doesn't block publishing.
2. **There are four price types:** `fixed`, `from`, `range` and `quote_required`.
   - Every type except `quote_required` carries an ISO 4217 currency and a unit (per job, per hour, per tyre, and so on).
   - **Amounts are exact decimal strings** (`"450.50"`), stored as `numeric(14,4)`. Floats are never used.
   - An amount may have at most as many decimals as the currency's display precision (JPY 0, ZAR 2, KWD 3). This doesn't depend on ISO minor units, which the currency table doesn't hold.
   - A database check gives each price type exactly its own fields.
   - No FX conversion: several currencies are allowed (SRS A-05).
3. **Prices are always labelled as indicative.**
   - Public offerings carry `indicative: true` and a `label` built by the shared `formatIndicativePrice()`, for example "From ZAR 450.00 per hour" or "Price on request (quote required)".
   - The public catalog always includes `INDICATIVE_PRICE_DISCLAIMER`.
   - No checkout, payment, cart or order fields or routes exist. The ADR-0011 repo guards keep it that way.
4. **Opening hours are live, not frozen.**
   - Hours and exceptions are validated in full when saved, and the public profile reads them directly.
   - A closure or holiday change therefore shows immediately, the same way verification labels and media do (ADR-0017).
   - This amends ADR-0017's expectation that hours would join the snapshot.
   - Times are local wall-clock times in the branch's IANA timezone, falling back to the organization's.
   - Weekly intervals are stored as minutes after local midnight, so search (Prompt 12) can filter "open now" in SQL. Intervals past midnight (22:00–06:00) are supported.
   - Holiday exceptions are per local date. They either close the branch or replace that date's hours. Dates run from the branch's local today to two years ahead.
   - "Hours not provided" (`known: false`) is distinct from "closed".
5. **"Open now" is one pure function, `openingStatus()`,** in `@fleettrust/types`, shared by API, web and mobile.
   - It converts the instant to local time with `Intl`, so DST changes are handled.
   - It applies the date's exception, carries the previous night's interval past midnight, and merges contiguous intervals, so the reported closing time is the real one.
   - It returns local `closesAt` and `opensAt` times, never computed UTC instants, which avoids the ambiguity of DST gaps and overlaps.
6. **Permissions:**
   - `catalog.manage` and `hours.manage` go to owners, admins and managers.
   - A branch-scoped manager edits hours only for their branch; other branches return 404.
   - They create, edit and delete only offerings limited to exactly their branch; anything else returns 403 `outside_branch_scope`.
   - Publishing stays with `profile.manage` (owner and admin), so a manager's catalog changes go public only when an owner or admin republishes.
7. **Clock:** a global platform `ClockModule` provides `CLOCK`, which used to live in the entitlements module. Providers and search read the time without depending on entitlements (ADR-0009).

## Consequences

- **Live hours are not reviewed at publication.** That's accepted: they're operational, and a stale "open" is worse than an unreviewed one.
- **Older snapshots have no catalog.** Profiles published before this stage show an empty catalog and `hasUnpublishedChanges: true` until republished.
- **Price labels are English for now.** `formatIndicativePrice` takes a locale and defaults to `en`; translated copy comes with i18n.
- **The catalog is capped** at 200 offerings per provider. If plans should limit catalog size, a capacity capability can be added later. Plans buy capacity only (ADR-0009).

## Alternatives considered

- **Minor-unit integers (as for plan prices):** these need each currency's ISO minor unit, which the CLDR-based currency table doesn't have. Exact decimals avoid the question, and indicative prices are never charged.
- **Hours in the snapshot:** consistent with ADR-0017, but a provider couldn't close for a holiday or an emergency without an owner republishing the whole profile.
- **Opening hours as one JSON document per branch:** simpler to write, but harder to query for "open now" in search.

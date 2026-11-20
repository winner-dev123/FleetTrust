# Service catalog, indicative prices and opening hours

SRS F-033..F-035 and FR-07. Design: [ADR-0018](../adr/0018-catalog-pricing-and-hours.md). Builds on [provider profiles](provider-profiles.md).

> Prices are **indicative**. They are not a binding offer, and the platform has no checkout or payment flow. Every public catalog carries `INDICATIVE_PRICE_DISCLAIMER`, and every public price carries `indicative: true` and a `label`.

## Offerings

| Field             | Rules                                                                                                      |
| ----------------- | ---------------------------------------------------------------------------------------------------------- |
| `category`        | One of the provider categories. It must be among the profile's categories to publish                       |
| `name`            | 2–120 characters                                                                                           |
| `description`     | Optional, up to 1000 characters                                                                            |
| `vehicleTypes`    | At least one (compatibility). To publish, they must be among the profile's vehicle types                   |
| `serviceLocation` | `at_premises` (default) or `at_customer`. `at_customer` needs a service radius on every branch offering it |
| `branchIds`       | Empty = every branch. Must be this organization's branches                                                 |
| `price`           | See below                                                                                                  |
| `sortOrder`       | 0–999, ascending                                                                                           |

Up to 200 offerings per provider.

### Price types

| `type`           | Fields                                       | Example label                       |
| ---------------- | -------------------------------------------- | ----------------------------------- |
| `fixed`          | `currency`, `amount`, `unit`                 | `£95.00 per vehicle`                |
| `from`           | `currency`, `amount`, `unit`                 | `From ZAR 450.00 per hour`          |
| `range`          | `currency`, `min`, `max` (max > min), `unit` | `$80.00–$120.00 per tyre`           |
| `quote_required` | none                                         | `Price on request (quote required)` |

- **Amounts:** decimal strings such as `"450"` or `"450.50"`, greater than zero, with up to 10 integer digits. Fraction digits may not exceed the currency's display precision (JPY 0, GBP 2, KWD 3), otherwise 400 `too_many_decimals`.
- **Currency:** an active ISO 4217 code from the `currencies` table, otherwise 400 `unknown_currency`.
- **Units:** `job`, `hour`, `day`, `night`, `km`, `litre`, `kwh`, `item`, `tyre`, `vehicle`.

## Opening hours

- **Timezone:** times are local wall-clock times in the branch's IANA timezone (`timeZone`), or the organization's when the branch has none.
- **Weekly hours:** a missing or empty day means closed.
- **Intervals:** up to four per day, non-overlapping.
  - `closes` at or before `opens` runs past midnight: `22:00`–`06:00`.
  - `00:00`–`24:00` is all day.
- **Exceptions:** per local date. Either `{ closed: true, label? }`, or `{ closed: false, label?, intervals }`, which replaces that date's hours. Dates run from the branch's local today to two years ahead; otherwise 400 `date_out_of_range`.
- **Status:** `{ known, isOpen, localTime, closesAt, opensAt, exception }`.
  - `known: false` means hours were never provided. Show "Hours not provided", not "Closed".
  - Times are local `YYYY-MM-DDTHH:MM`.
  - `closesAt` is null when the branch is open around the clock.
- **Live:** saving hours or exceptions updates the public profile immediately; no republish is needed.

## API

All routes are under `/v1/orgs/:orgId/provider-profile`. Provider organizations only; fleets get 400 `not_a_provider`.

| Method & path                                       | Permission       | Notes                                                      |
| --------------------------------------------------- | ---------------- | ---------------------------------------------------------- |
| `GET /offerings`                                    | `org.read`       | Draft catalog, sorted                                      |
| `POST /offerings`                                   | `catalog.manage` | 201. 409 `too_many_offerings`, 400 `unknown_branch`        |
| `PUT /offerings/:offeringId`                        | `catalog.manage` | Replaces the offering                                      |
| `DELETE /offerings/:offeringId`                     | `catalog.manage` | 204                                                        |
| `GET /branches/:branchId/hours`                     | `org.read`       | `{ timeZone, timeZoneSource, weekly, exceptions, status }` |
| `PUT /branches/:branchId/hours`                     | `hours.manage`   | `{ timeZone: string \| null, weekly }`. Replaces the week  |
| `PUT /branches/:branchId/hours/exceptions/:date`    | `hours.manage`   | Add or replace the exception for `YYYY-MM-DD`              |
| `DELETE /branches/:branchId/hours/exceptions/:date` | `hours.manage`   | 204; 404 if there's none                                   |

**Branch-scoped managers:**

- Hours of other branches return 404.
- Offerings must be limited to exactly their branch, otherwise 403 `outside_branch_scope`.
- They can't publish. Publishing needs `profile.manage`.

**Public profile additions** (`GET /v1/providers/:slug`, same for `/full`):

- `catalog: { disclaimer, offerings[] }` from the snapshot.
- Each branch gains `timeZone` and `hours: { weekly, exceptions (next 60 days), status }`, read live.

### Example

```http
POST /v1/orgs/{orgId}/provider-profile/offerings
{ "category": "workshop", "name": "Brake inspection", "vehicleTypes": ["heavy_truck"],
  "price": { "type": "from", "currency": "ZAR", "amount": "1800", "unit": "job" } }

PUT /v1/orgs/{orgId}/provider-profile/branches/{branchId}/hours
{ "timeZone": "Africa/Johannesburg",
  "weekly": { "mon": [{ "opens": "07:30", "closes": "17:00" }], "sat": [{ "opens": "08:00", "closes": "12:00" }] } }

PUT /v1/orgs/{orgId}/provider-profile/branches/{branchId}/hours/exceptions/2026-12-25
{ "closed": true, "label": "Christmas Day" }
```

## Data

| Table                        | Notes                                                                                                                                                  |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `provider_offerings`         | FK to `provider_profiles` (so providers only). `numeric(14,4)` amounts; a check gives each price type exactly its own fields; currency FK              |
| `provider_offering_branches` | Composite FKs `(offering_id, organization_id)` and `(branch_id, organization_id)`: only same-tenant branches; rows cascade when either side is deleted |
| `branch_opening_hours`       | `weekday` 1–7 (ISO), `opens_minute` 0–1439, `closes_minute` up to `opens + 1440`. Composite tenant FK; cascades with the branch                        |
| `branch_hours_exceptions`    | Unique `(branch_id, date)`; closed means no intervals, otherwise 1–4                                                                                   |
| `branches.time_zone`         | IANA name or null (use the organization's)                                                                                                             |
| `branches.hours_updated_at`  | Null = hours never provided                                                                                                                            |

## Audit events

- `catalog.offering_created`, `catalog.offering_updated`, `catalog.offering_deleted`
- `branch.hours_saved`, `branch.hours_exception_saved`, `branch.hours_exception_removed`

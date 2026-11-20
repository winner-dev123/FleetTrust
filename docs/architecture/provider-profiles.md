# Provider profiles

The provider setup wizard and public profile (SRS J4, F-030..F-032). Design: [ADR-0017](../adr/0017-provider-profile-publication.md). Verification labels come from [verification](verification.md). Offerings, prices and opening hours: [catalog-and-hours.md](catalog-and-hours.md).

## Wizard steps

| Step         | Required to publish                                                                                                                                                            |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `basics`     | `slug` (3–60 chars, a–z 0–9 -, unique), `legalName`, `tradingName`. `description` is optional                                                                                  |
| `categories` | At least one category, and every chosen category's fields (below)                                                                                                              |
| `vehicles`   | At least one vehicle type: `car`, `van`, `light_truck`, `heavy_truck`, `trailer`, `bus`, `motorcycle`, `agricultural`                                                          |
| `contact`    | A phone (`+27 21 555 0100` format), email or https website                                                                                                                     |
| `branches`   | At least one branch with town, country, map location, plus street address (unless the provider only travels: mobile mechanic) and service radius (towing, mobile mechanic)     |
| `catalog`    | Optional. Every offering must fit the profile: category chosen, vehicle types served, a publishable branch, service radius for `at_customer` ([catalog](catalog-and-hours.md)) |
| `hours`      | Optional. Opening hours are live and never block publishing ([hours](catalog-and-hours.md#opening-hours))                                                                      |
| `media`      | Optional: logo, cover, up to 12 gallery images                                                                                                                                 |

Every `GET` returns `steps[]` with `complete` and `issues` (`path` and `message`) plus `canPublish`. Saving never fails for incompleteness, only for malformed values.

## Category-specific fields

| Category          | Fields (all required at publish)                                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `workshop`        | `specialities[]` (engine, electrical, brakes, suspension, bodywork, diagnostics, air_conditioning, transmission, inspections), `bays` |
| `fuel_station`    | `fuelTypes[]` (diesel, petrol, adblue, lpg, cng, lng, hvo, ev_charging), `heavyVehicleAccess`                                         |
| `towing`          | `maxTowWeightKg` (500–60 000), `recoveryTypes[]`, `operates24h`                                                                       |
| `tyres`           | `tyreSegments[]` (car, van, truck, agricultural, motorcycle), `mobileFitting`                                                         |
| `parts`           | `partsSegments[]`, `delivery`                                                                                                         |
| `parking`         | `truckSpaces` (1–2000), `security[]` (may be empty), `overnight`                                                                      |
| `mobile_mechanic` | `services[]` (roadside_repair, diagnostics, battery, tyres, servicing)                                                                |

Defined in `CATEGORY_DETAIL_SCHEMAS` (`@fleettrust/types`). In drafts, lists may be empty and fields missing.

## API

| Method & path                                                   | Permission                      | Notes                                                                                                        |
| --------------------------------------------------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `GET /v1/orgs/:orgId/provider-profile`                          | `org.read`                      | Draft, steps, `canPublish`, `hasUnpublishedChanges`, `status` (`draft`/`published`/`hidden`)                 |
| `PATCH /v1/orgs/:orgId/provider-profile`                        | `profile.manage` (owner, admin) | Any subset. `categoryDetails.<category>` objects are replaced whole. 409 `slug_taken`                        |
| `PATCH /v1/orgs/:orgId/provider-profile/branches/:branchId`     | `profile.manage`                | Address lines, locality, region, postal code, `countryCode`, `location {lng, lat}`, `serviceRadiusKm`, phone |
| `GET /v1/orgs/:orgId/provider-profile/preview`                  | `org.read`                      | `{ visitor, signedIn, issues }`: both public views of the current draft                                      |
| `POST /v1/orgs/:orgId/provider-profile/publish`                 | `profile.manage`                | 422 `profile_incomplete` with `issues[]`                                                                     |
| `POST /v1/orgs/:orgId/provider-profile/unpublish`               | `profile.manage`                | Takes it offline (status `hidden`); publish again anytime                                                    |
| `POST /v1/orgs/:orgId/provider-profile/media`                   | `profile.manage`                | `{ kind: logo\|cover\|gallery, contentType: image/jpeg\|png\|webp, size ≤ 5 MB, altText? }` → upload URL     |
| `POST /v1/orgs/:orgId/provider-profile/media/:mediaId/complete` | `profile.manage`                | Scans, strips metadata, publishes → `{ id, url }`                                                            |
| `DELETE /v1/orgs/:orgId/provider-profile/media/:mediaId`        | `profile.manage`                | Removed from the live profile at once                                                                        |
| `GET /v1/providers/:slug`                                       | public (rate-limited per IP)    | Visitor view: approximate location, no contact or street address                                             |
| `GET /v1/providers/:slug/full`                                  | signed in                       | Full view                                                                                                    |

Only provider organizations have profiles; fleets get 400 `not_a_provider`.

## Audit events

`provider_profile.draft_saved` (field names only), `branch_location_saved`, `published`, `unpublished`, `media_added`, `media_removed`.

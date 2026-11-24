# Parts and provider referrals

SRS F-140..F-142. Design: [ADR-0028](../adr/0028-parts-and-referrals.md).

FleetTrust shows parts and lets people ask about them. **It never sells, reserves or takes payment for a part.** Every part and inquiry carries `PARTS_DISCLAIMER`.

## Who can do what

|                                                |    Staff (`requests.respond`)    | Owner, admin, manager (`parts.manage`) | Customer / fleet (`requests.create`) | Visitor |
| ---------------------------------------------- | :------------------------------: | :------------------------------------: | :----------------------------------: | :-----: |
| See the organization's listings                | their branch + organization-wide |        ✓ (branch-scoped: same)         |                  —                   |    —    |
| Create, edit, archive, delete listings         |                —                 |  ✓ (branch-scoped: their branch only)  |                  —                   |    —    |
| Confirm stock                                  |       their branch's stock       |                   ✓                    |                  —                   |    —    |
| Search public listings                         |                ✓                 |                   ✓                    |                  ✓                   |    ✓    |
| Ask about availability                         |      not their own business      |         not their own business         |                  ✓                   |    —    |
| Answer availability inquiries                  |          their branch's          |                   ✓                    |                  —                   |    —    |
| Refer a customer's request to another provider |      inquiries they can see      |                   ✓                    |                  —                   |    —    |
| Consent to or decline a referral               |                —                 |                   —                    |     the request's requester side     |    —    |

Outsiders get 404 on organization routes, and fleets get 400 `not_a_provider` on parts routes.

## Listings

| Method & path                                               | Notes                                                                                     |
| ----------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /v1/orgs/:orgId/parts?status=&branchId=&stale=true&q=` | `stale=true`: unconfirmed for 14+ days, oldest first (the "needs a check" list)           |
| `POST /v1/orgs/:orgId/parts`                                | See below. Sets the stock confirmation time                                               |
| `GET` / `PUT` / `DELETE …/parts/:partId`                    | `PUT` replaces everything except stock                                                    |
| `PUT …/parts/:partId/stock`                                 | `{ status, quantity? }`. Also for "still in stock": every call refreshes the confirmation |

**A listing:**

```json
{
  "name": "Brake pad set, rear axle",
  "brand": "Bosch",
  "partNumber": "0 986 494 104",
  "category": "brakes",
  "condition": "new",
  "branchId": "…",
  "price": { "type": "fixed", "currency": "ZAR", "amount": "1450", "unit": "item" },
  "compatibility": [
    {
      "vehicleType": "heavy_truck",
      "make": "Mercedes-Benz",
      "model": "Actros",
      "yearFrom": 2012,
      "yearTo": 2020
    }
  ],
  "stock": { "status": "in_stock", "quantity": 4 }
}
```

- **Categories:** `engine`, `brakes`, `suspension_steering`, `electrical`, `filters`, `tyres_wheels`, `body`, `transmission`, `cooling`, `exhaust`, `lighting`, `fluids`, `accessories`, `other`.
- **Conditions:** `new`, `used`, `refurbished`.
- **Stock:** `in_stock`, `low_stock`, `out_of_stock`, `on_order`. Only the first two carry a quantity.
- **Compatibility:** each range names a vehicle type, and optionally a make, a model (needs a make) and years (inclusive). No ranges means no compatibility data.
- **Branch:** `branchId: null` means stock held for the whole organization.
- **Limits:** 2,000 listings per organization; 50 compatibility ranges per listing.
- **Errors:** `invalid_branch`, `too_many_parts`, `unknown_currency`, `too_many_decimals`, `not_allowed` (403).

## Stock freshness

Every response has a `stock` object:

```json
{
  "status": "in_stock",
  "quantity": null,
  "confirmedAt": "…",
  "freshness": "stale",
  "label": "Stock not confirmed for 20 days (last reported: in stock). It may have changed: ask the provider."
}
```

| Freshness | Age since confirmation | Public behaviour                                                        |
| --------- | ---------------------- | ----------------------------------------------------------------------- |
| `fresh`   | ≤ 3 days               | "In stock · confirmed today"                                            |
| `aging`   | ≤ 14 days              | "In stock · confirmed 9 days ago"                                       |
| `stale`   | ≤ 90 days              | Labelled as unconfirmed; no count; left out of `inStockOnly`            |
| `expired` | > 90 days              | Not in public search or `GET /v1/parts/:id` until the provider confirms |

Show `label` as it is: every client says the same thing.

## Public search

| Method & path           | Notes                                                |
| ----------------------- | ---------------------------------------------------- |
| `GET /v1/parts`         | **No sign-in.** Distances from approximate locations |
| `GET /v1/parts/full`    | Signed in. Exact distances; `vehicleId` allowed      |
| `GET /v1/parts/:partId` | **No sign-in.** One listing                          |

**Query parameters:**

| Parameter                              | Meaning                                                               |
| -------------------------------------- | --------------------------------------------------------------------- |
| `q`                                    | Name, brand or part number                                            |
| `partNumber`                           | Any format: `0986-494104` matches `0 986 494 104`                     |
| `category`, `condition`                |                                                                       |
| `vehicleType`, `make`, `model`, `year` | Compatibility. A range fits when every field it names matches         |
| `vehicleId`                            | One of your vehicles (signed in only; visitors get 403 `not_allowed`) |
| `provider`                             | A provider's slug                                                     |
| `lat`, `lng`, `radiusKm`               | Near a point (default 50 km)                                          |
| `inStockOnly=true`                     | In or low stock, confirmed within 14 days                             |
| `limit`, `offset`                      | Up to 50 per page; `nextOffset` in the result                         |

Results are sorted by distance when searching near a point, then by most recently confirmed.

## Availability inquiries

| Method & path                                                      | Who                                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------------------- |
| `POST /v1/me/part-inquiries`                                       | A person                                                                     |
| `POST /v1/orgs/:orgId/part-inquiries`                              | A fleet member (`requests.create`)                                           |
| `GET …/part-inquiries?status=`, `GET …/:id`, `POST …/:id/close`    | The asker (fleet managers for the whole organization see all of the fleet's) |
| `GET /v1/orgs/:orgId/received-part-inquiries?status=`, `GET …/:id` | The provider (`requests.respond`, branch scope)                              |
| `POST /v1/orgs/:orgId/received-part-inquiries/:id/answer`          | The provider                                                                 |

- **Ask:** `{ partId, quantity?, message?, vehicleId? | vehicle? }`.
- **Answer:** `{ availability: "available" | "not_available" | "can_order", quantityAvailable?, etaDays?, message? }`.
  - `quantityAvailable` goes only with `available`, and `etaDays` only with `can_order`.
  - Answering again corrects the answer.
  - **Answering also confirms the listing's stock:** `available` → in stock (with the quantity, if given); `can_order` → on order; `not_available` → out of stock.
- **Statuses:** `open` → `answered` → `closed`. An unanswered question becomes `expired` after 14 days.
- **Errors:**

  | Reason               | Status | When                                      |
  | -------------------- | ------ | ----------------------------------------- |
  | `part_unavailable`   | 409    | The listing isn't public                  |
  | `already_asked`      | 409    | You have an open question about this part |
  | `own_part`           | 400    | You're a member of the provider           |
  | `invalid_transition` | 409    | Answering a closed or expired question    |

- **Notifications:** `part_inquiry` goes to provider members who can answer at the part's branch; `part_inquiry_answered` goes to the asker.

## Referrals

| Method & path                                                      | Who                                                         |
| ------------------------------------------------------------------ | ----------------------------------------------------------- |
| `POST /v1/orgs/:orgId/inquiries/:recipientId/referrals`            | The referring provider                                      |
| `GET /v1/orgs/:orgId/referrals?direction=sent\|received&status=`   | Providers (received: only after consent)                    |
| `GET /v1/orgs/:orgId/referrals/:id`, `POST …/:id/withdraw`         | Providers (withdraw: referrer, before the customer decides) |
| `GET /v1/me/service-requests/:requestId/referrals`                 | The customer                                                |
| `POST …/referrals/:id/consent`, `POST …/referrals/:id/decline`     | The customer                                                |
| Same under `/v1/orgs/:orgId/service-requests/:requestId/referrals` | A fleet's requests                                          |

**Referring:**

```json
{
  "toProvider": "gearbox-pros",
  "message": "They rebuild gearboxes; we don't.",
  "relationship": "referral_fee",
  "relationshipDetails": "We receive 5% of their invoice."
}
```

- **Relationships:** `none`, `partner`, `same_owner`, `referral_fee`. Anything other than `none` needs `relationshipDetails`.
- **Who sees the message:** the customer sees it, and the receiving provider sees it only after consent. There's no private note.

**Consenting:**

```json
{ "consent": true, "sharePhotos": false, "shareOutcomeWithReferrer": false }
```

- **`consent` must be `true`.** The response's `sharing.consentText` is the exact statement agreed to, which is stored with the decision.
- **On consent** the other provider receives the request as a normal inquiry. `InquiryDto.referredBy` carries the referrer, the message, the relationship and whether photos were shared.
- **Before consent** the other provider sees nothing: no inquiry, no notification, no referral.
- **Statuses:** `pending_consent` → `consented` | `declined` | `withdrawn`. A pending referral becomes `expired` when its request closes.
- **`outcome`:**
  - **Customer:** sees what the receiver's inquiry became (quoted, declined, accepted…).
  - **Referrer:** sees it only if the customer allowed it.
- **`history`:** proposed, consented, declined and withdrawn, with times, read from the audit log.
- **Errors:**

  | Reason                  | Status  | When                                                     |
  | ----------------------- | ------- | -------------------------------------------------------- |
  | `provider_not_found`    | 400     | No published, active provider with that slug             |
  | `self_referral`         | 400     |                                                          |
  | `provider_not_matching` | 400/409 | It doesn't offer the request's category and vehicle type |
  | `already_recipient`     | 409     | It already has the request                               |
  | `already_referred`      | 409     | An open referral to it exists                            |
  | `too_many_referrals`    | 409     | Three open referrals from this inquiry                   |
  | `invalid_transition`    | 409     | The request or referral is no longer open                |

- **Notifications:**
  - `referral_proposed` goes to the customer ("Nothing is shared with them unless you agree").
  - `referral_decided` goes to the referrer.
  - The receiver gets the usual `service_request` notification on consent.

## Audit

| Where                    | What                                                                                                                                                                            |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `audit_events`           | `part.created`, `part.updated`, `part.deleted`; `referral.proposed`, `referral.withdrawn`, `referral.consented` (with sharing choices and consent version), `referral.declined` |
| `service_request_events` | `referral_proposed`, `referral_withdrawn`, `referral_consented`, `referral_declined`, and `sent` for the receiver                                                               |
| `provider_referrals`     | The disclosure, consent text and version, decider and time. A trigger blocks changes to the disclosure, changes to a decision, and deletion while the request exists            |

## Data

| Table                | Notes                                                                                                                 |
| -------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `parts`              | Listing, indicative price columns (same checks as offerings), stock status, quantity, `stock_confirmed_at`            |
| `part_compatibility` | Vehicle type, make, model, year range                                                                                 |
| `part_inquiries`     | Asker (person or fleet), copies of the part name and number, quantity, vehicle, answer. No price or hold columns      |
| `provider_referrals` | Request, referrer's inquiry, target, message, relationship, status, sharing choices, consent text, receiver's inquiry |

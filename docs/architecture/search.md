# Provider search

SRS F-040..F-042, FR-06. Route-corridor search builds on this: [routes-and-lists.md](routes-and-lists.md). Design: [ADR-0019](../adr/0019-search-projection-and-ranking.md). Ranking rules: [ADR-0009](../adr/0009-trust-independent-of-payment.md).

## API

| Route                                    | Auth                  | Notes                                                           |
| ---------------------------------------- | --------------------- | --------------------------------------------------------------- |
| `GET /v1/search/providers`               | public, 60/min per IP | Visitor view: approximate locations and distances               |
| `GET /v1/search/providers/full`          | signed in, 120/min    | Exact locations and distances                                   |
| `GET /v1/geo/geocode?q=&country=&limit=` | public, 30/min per IP | Place name → `[{ label, location, countryCode }]` (map adapter) |
| `GET /v1/geo/map-config`                 | public                | `{ provider, tileUrl, attribution }` for client maps            |

### Search parameters

Search either near a point (`lat` and `lng`) or inside a map viewport (`bbox`).

| Parameter        | Notes                                                                                 |
| ---------------- | ------------------------------------------------------------------------------------- |
| `lat`, `lng`     | Search point                                                                          |
| `radiusKm`       | 0.5–200, default 25                                                                   |
| `bbox`           | `west,south,east,north`; at most 10° per side. `west > east` crosses the antimeridian |
| `category`       | Comma-separated; matches any                                                          |
| `vehicleType`    | One vehicle type the provider must serve                                              |
| `verified`       | Comma-separated `business`, `location`: badges the provider must currently hold (all) |
| `openNow`        | `true`: open at the time of the search, in each branch's local time                   |
| `coversLocation` | `true`: only branches whose service radius reaches the point (they travel to you)     |
| `q`              | Up to 100 characters. Letters and digits only, up to five prefix-matched terms        |
| `limit`          | 1–50, default 20                                                                      |
| `cursor`         | The `nextCursor` from the previous page, sent with the **same** query                 |

Unknown parameters such as `sponsored` get 400.

### Response

```json
{
  "results": [
    {
      "branchId": "…",
      "organizationId": "…",
      "slug": "rapid-recovery",
      "tradingName": "Rapid Recovery",
      "branchName": "Depot",
      "locality": "Cape Town",
      "countryCode": "ZA",
      "categories": ["towing"],
      "vehicleTypes": ["heavy_truck"],
      "location": { "lng": 18.42, "lat": -33.92, "approximate": true },
      "distanceKm": 3.4,
      "serviceRadiusKm": 150,
      "coversSearchLocation": true,
      "hours": {
        "known": true,
        "isOpen": true,
        "localTime": "2026-11-20T12:00",
        "closesAt": "2026-11-20T17:00",
        "opensAt": null,
        "exception": null
      },
      "verification": [
        { "badgeType": "business", "status": "verified" },
        { "badgeType": "location", "status": "unverified" }
      ],
      "priceHighlights": [{ "name": "Heavy recovery", "label": "From ZAR 4,500.00 per job" }],
      "logoUrl": "https://…"
    }
  ],
  "nextCursor": "eyJ2IjoxLC…",
  "ranking": "relevance",
  "priceDisclaimer": "Prices are indicative and are not a binding offer. …"
}
```

- **One result per branch.** A provider with three nearby branches shows three map pins.
- **Never in results:** contact details and street addresses.

## Ranking

`score = 0.35·text + 0.35·distance + 0.15·coverage + 0.15·openNow`, rounded to six decimals. Ties go to the nearer branch, then the lower branch ID.

| Signal   | Value                                                                                                                             |
| -------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Text     | `min(ts_rank · 10, 1)` over name and categories (A), offering names (B), branch name and town (C), description (D). 0 without `q` |
| Distance | `1 / (1 + km / 10)`: 1 at the point, 0.5 at 10 km                                                                                 |
| Coverage | 1 if the branch's service radius reaches the search point                                                                         |
| Open now | 1 if `branch_is_open()` at the evaluation instant                                                                                 |

Plans, payments and verification never change the score. Verification and vehicle type are filters.

## Privacy

| Visitor                                                                                        | Signed in                              |
| ---------------------------------------------------------------------------------------------- | -------------------------------------- |
| Served from `approx_location` (rounded to 0.01°): filter, distance, ranking and returned point | Exact location                         |
| `distanceKm` to 0.1 km, from the rounded point                                                 | To 0.01 km                             |
| No contacts, street or postcode                                                                | Same (search cards never include them) |

Search points are never stored, and the request logger drops query strings.

## Data and indexes

- **`provider_search_entries`:** one row per published branch, built only by `refresh_provider_search(org)` from the published snapshot. It runs on publish and unpublish, and rows cascade when a branch is deleted.
- **Joined live at query time:** organization status, badges and hours.
- **GiST indexes:**
  - `provider_search_entries_location_gist` (exact) and `provider_search_entries_approx_gist` (visitor): radius queries.
  - `…_location_geom_gist` and `…_approx_geom_gist`: viewport boxes.
- **GIN indexes:** categories, vehicle types, search document.

Sample plan for a visitor radius search with a category filter (PGlite with `enable_seqscan = off`; tests assert the index name on PGlite and on PostgreSQL 17 with real statistics and no hints):

```text
Limit
  ->  Sort  (Sort Key: score DESC, distance_m, branch_id)
        ->  Nested Loop
              ->  Index Scan using provider_search_entries_approx_gist on provider_search_entries e
                    Index Cond: (approx_location && _st_expand(<point>, 25000))
                    Filter: ((categories && '{workshop}') AND st_dwithin(approx_location, <point>, 25000))
              ->  Index Scan using … on branches b
              ->  Index Scan using organizations_id_kind_key on organizations o  (Filter: status = 'active')
```

## Map adapter

| Variable          | Default | Notes                                                                                       |
| ----------------- | ------- | ------------------------------------------------------------------------------------------- |
| `MAP_PROVIDER`    | `stub`  | Only `stub` until the vendor is chosen (OQ-13). It geocodes a small built-in list of cities |
| `MAP_TILE_URL`    | none    | https XYZ template given to clients. **Required in production**                             |
| `MAP_ATTRIBUTION` | none    | Attribution text the vendor requires                                                        |

Example: `MAP_TILE_URL=https://tiles.example.com/{z}/{x}/{y}.png`, `MAP_ATTRIBUTION=© Example Maps`.

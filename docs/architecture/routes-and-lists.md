# Route discovery and saved lists

SRS J8, F-100, F-101. Design: [ADR-0020](../adr/0020-route-discovery-and-saved-lists.md). Builds on [search](search.md).

> Every route response carries: **"Road and truck restrictions aren't verified by FleetTrust."** Clients must show it with the results.

## Route search

`POST /v1/search/route` (signed in, 30 per minute per user). Coordinates go in the body.

```json
{
  "origin": { "lng": 18.42, "lat": -33.92 },
  "destination": { "lng": 19.45, "lat": -33.64 },
  "waypoints": [],
  "profile": "truck",
  "corridorKm": 5,
  "category": ["towing", "workshop"],
  "vehicleType": "heavy_truck",
  "verified": ["business"],
  "openNow": true,
  "q": "brake",
  "limit": 50
}
```

| Field        | Notes                                                                           |
| ------------ | ------------------------------------------------------------------------------- |
| `waypoints`  | Up to 5 intermediate stops                                                      |
| `profile`    | `car` (default) or `truck`. Sent to the routing vendor only                     |
| `corridorKm` | 0.5–25, default 5. Distance either side of the route                            |
| Filters      | As in [search](search.md#search-parameters), with arrays instead of comma lists |
| `limit`      | 1–100, default 50. `truncated: true` when more matched                          |

### Response

```json
{
  "mode": "corridor",
  "route": {
    "distanceKm": 98.6,
    "durationMinutes": 85,
    "source": "vendor-x",
    "approximate": false,
    "truckProfileApplied": true,
    "vendorNotices": ["…verbatim vendor text…"],
    "geometry": [{ "lng": 18.42, "lat": -33.92 }, "…"]
  },
  "degradedReason": null,
  "disclaimer": "Road and truck restrictions aren't verified by FleetTrust.",
  "results": [{ "…search result card…": "", "routeFraction": 0.21, "nearStop": null }],
  "truncated": false,
  "priceDisclaimer": "Prices are indicative …"
}
```

- **`mode: "corridor"`:** results are in driving order (`routeFraction` runs from 0 to 1) and `distanceKm` is measured from the route.
- **`mode: "waypoints"`:** routing was unavailable, and `degradedReason` says why (`not_configured`, `timeout`, `error` or `no_route`). `route` is null. Results come from 25 km point searches around each stop, in stop order, and `nearStop` is the stop index: origin 0, then the waypoints, then the destination. Clients should say "Showing providers near your stops".
- **`truckProfileApplied` and `vendorNotices`:** only what the vendor reported. FleetTrust never adds restriction data or claims a route suits trucks.

### Configuration

| Variable                    | Default | Notes                                                                                                                                              |
| --------------------------- | ------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ROUTING_PROVIDER`          | `none`  | `none` means waypoint mode always. `straight-line` is for development only (approximate geometry) and refused in production. Vendor adapter: OQ-13 |
| `ROUTING_TIMEOUT_MS`        | `4000`  | 200–20,000. The request falls back to waypoint mode after this                                                                                     |
| `ROUTING_CACHE_TTL_SECONDS` | `3600`  | 0–86,400. 0 disables caching (check the vendor's terms)                                                                                            |

Local example: `ROUTING_PROVIDER=straight-line ROUTING_CACHE_TTL_SECONDS=0`.

The cache uses Redis when `REDIS_URL` is set, otherwise memory. Keys are `route:<adapter>:<sha256(profile, points rounded to 0.01°)>`, with no user ID. Points are rounded before they are sent to the vendor.

## Saved lists

| Method & path                                       | Who            | Notes                                                                                       |
| --------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------- |
| `GET /v1/me/favorites`                              | self           | Created on first use                                                                        |
| `PUT /v1/me/favorites/:organizationId`              | self           | Idempotent. 400 `provider_unavailable` unless published and active                          |
| `DELETE /v1/me/favorites/:organizationId`           | self           | 204                                                                                         |
| `GET /v1/me/lists`                                  | self           | Favorites, own lists, then shared lists, each with `role`, `itemCount`, `memberCount`       |
| `POST /v1/me/lists`                                 | self           | `{ name (1–80), description? }`. 409 `too_many_lists` above 50                              |
| `GET /v1/me/lists/:listId`                          | members        | Items with live provider details. `members` is shown to the owner only                      |
| `PATCH /v1/me/lists/:listId`                        | owner          | Name, description                                                                           |
| `DELETE /v1/me/lists/:listId`                       | owner          | 204                                                                                         |
| `PUT /v1/me/lists/:listId/items/:organizationId`    | owner, editor  | `{ note? }`. Adds, or updates the note. 409 `list_full` above 500                           |
| `DELETE /v1/me/lists/:listId/items/:organizationId` | owner, editor  | 204                                                                                         |
| `POST /v1/me/lists/:listId/share-links`             | owner          | `{ role: viewer\|editor, expiresInDays 1–30 }` → `{ link, token, joinPath }`, returned once |
| `GET /v1/me/lists/:listId/share-links`              | owner          | Never includes tokens                                                                       |
| `DELETE /v1/me/lists/:listId/share-links/:linkId`   | owner          | Revokes the link                                                                            |
| `POST /v1/lists/join`                               | signed in      | `{ token }`. 410 `link_invalid` (expired, revoked, unknown); 409 `owner_cannot_join`        |
| `PATCH /v1/me/lists/:listId/members/:userId`        | owner          | `{ role }`                                                                                  |
| `DELETE /v1/me/lists/:listId/members/:userId`       | owner, or self | Remove a member, or leave                                                                   |

**Errors:**

- **Non-members:** 404 on every list route, so list IDs can't be probed.
- **Members without the needed role:** 403 `insufficient_role`.
- **Favorites:** renaming, deleting or sharing returns 400 `favorites_locked`.

**Items:**

- **Unavailable providers:** if a provider unpublishes or is suspended, its item stays with `available: false` and only the organization ID, note and date.
- **Members' privacy:** display names only, never emails.

### Data

| Table                    | Notes                                                                                  |
| ------------------------ | -------------------------------------------------------------------------------------- |
| `saved_lists`            | `owner_user_id`, `kind` (`favorites` unique per owner, or `custom`), name, description |
| `saved_list_items`       | PK `(list_id, provider_organization_id)`; FK to `provider_profiles`; note; `added_by`  |
| `saved_list_members`     | PK `(list_id, user_id)`; role `viewer` or `editor`                                     |
| `saved_list_share_links` | `token_hash` (SHA-256, unique), role, `expires_at`, `revoked_at`                       |

All of them cascade when the list (or user) is deleted.

### Audit events

`list.created`, `list.deleted`, `list.share_link_created`, `list.share_link_revoked`, `list.joined`, `list.member_role_changed`, `list.member_removed`, `list.left`.

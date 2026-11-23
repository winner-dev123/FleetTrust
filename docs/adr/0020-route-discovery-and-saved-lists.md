# ADR-0020: Route-corridor search with graceful degradation, no fabricated restrictions, and link-shared personal lists

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 13 adds route-aware discovery and saved lists (SRS J8, F-100, F-101):

- **Route search:** given an origin and destination, list providers along the route, with the disclaimer _"Road and truck restrictions aren't verified by FleetTrust."_ If routing is unavailable, fall back to point search around the waypoints.
- **Saved lists:** favorites and named lists, with sharing permissions.

Constraints:

- **No routing vendor yet (OQ-13).** Vendors' terms may restrict caching their results.
- **Privacy (AB-04):** no persistent location history.
- **No fabricated restrictions:** FleetTrust must never claim a road suits trucks or invent restrictions (SRS §7).

## Decision

1. **Routing is a port, `RoutingProvider`.** Adapters:
   - **`none` (default):** always unavailable.
   - **`straight-line` (development):** great-circle segments marked `approximate`; refused in production.
   - **A vendor adapter:** added when OQ-13 is decided.

   The API calls the vendor with a timeout (`ROUTING_TIMEOUT_MS`, default 4 s) and an abort signal.

2. **Corridor search reuses the search projection (ADR-0019).** A third area kind, `corridor`:
   - It matches branches within `corridorKm` (0.5–25) of the route line using `ST_DWithin` on geography, so the GiST index applies.
   - Results come back **in driving order** (`ST_LineLocatePoint`), then by distance from the route.
   - It accepts the same filters as point search.
   - Long routes are thinned evenly to at most 2,000 vertices.
   - Route search is signed-in only (feature matrix), so exact locations are used.
3. **Graceful degradation.** Four cases make the response degrade instead of failing:
   - **`not_configured`:** no routing vendor.
   - **`timeout`:** the vendor didn't answer in time.
   - **`error`:** the vendor call failed.
   - **`no_route`:** the vendor returned an empty route.

   The response then has `mode: "waypoints"` and `degradedReason`, and holds point searches (25 km) around the origin, each waypoint and the destination. Results are merged in stop order without duplicates, each tagged with `nearStop`. The request still returns 200.

4. **No fabricated restrictions.**
   - Every route response carries `ROUTE_DISCLAIMER`.
   - `truckProfileApplied` and `vendorNotices` only ever repeat what the vendor reported, verbatim. The straight-line and `none` adapters report `false` and `[]`.
   - FleetTrust has no restriction fields of its own: no height, weight, hazmat or "suitable".
   - Choosing the truck profile only changes what is sent to the vendor.
5. **Privacy and caching.**
   - **Rounding:** points are rounded to 0.01° (about 1 km) before they are sent to the vendor or used as a cache key.
   - **Cache key:** a SHA-256 of the adapter name, the profile and the rounded points. No user ID.
   - **TTL:** routes are cached for `ROUTING_CACHE_TTL_SECONDS` (default 1 h; 0 disables it, for vendors whose terms forbid caching).
   - **Where:** the cache is Redis when configured (shared), otherwise memory. It is best effort; failures count as misses.
   - **No URLs:** coordinates travel in the POST body, never in URLs, and are never logged.
6. **Lists are personal.**
   - Each user has one undeletable `favorites` list, created on first use, plus up to 50 named lists of up to 500 providers each.
   - Only providers with a live published profile can be added. Items whose provider later unpublishes or is suspended stay, but show as `available: false` with their details hidden.
   - Organization lists (fleet preferred providers) are Prompt 22.
7. **Sharing is by invitation link, not by email lookup.** Looking people up by email would reveal which emails have accounts.
   - **Links:** the owner creates viewer or editor links (expiring in 1–30 days, revocable, at most 10 active). Only a SHA-256 hash of the token is stored, and the join path puts the token in the URL fragment.
   - **Joining:** a signed-in user joins with `POST /v1/lists/join`. Re-joining never lowers a role.

   Permissions:

   | Action                                                           | Owner | Editor | Viewer | Others |
   | ---------------------------------------------------------------- | :---: | :----: | :----: | :----: |
   | Read the list                                                    |   ✓   |   ✓    |   ✓    |  404   |
   | Add or remove providers, edit notes                              |   ✓   |   ✓    |  403   |  404   |
   | Rename, delete, share, see members, change roles, remove members |   ✓   |  403   |  403   |  404   |
   | Leave                                                            |   —   |   ✓    |   ✓    |  404   |

   Favorites can't be renamed, deleted or shared.

## Consequences

- **Without a vendor, route search always runs in waypoint mode.** That is the designed degradation, not an outage. Choosing a vendor (OQ-13) unlocks real corridors.
- **The corridor uses routes for points rounded to about 1 km.** That is accurate enough for a corridor at least 0.5 km wide, and the vendor never receives precise trip endpoints.
- **The straight-line adapter is visibly approximate.** It's useful in development, but must not reach production (enforced by env validation).
- **Link sharing means anyone holding a valid link can join.** Links therefore expire and can be revoked, and the owner can remove members.

## Alternatives considered

- **Sharing by email address:** convenient, but it enables account enumeration, and friends arrive only in Prompt 16. It can be added later on top of friendships.
- **Failing route search when routing is down:** contradicts SRS J8 step 3.
- **Caching by exact coordinates or per user:** that would amount to a location history (AB-04).

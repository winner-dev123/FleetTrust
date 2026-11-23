# Handoff — Prompt 13: Route-aware discovery and saved lists

- Date: 2026-11-23
- Status: **awaiting owner approval** · branch `feat/prompt-13-routes`
- Prompt 12 approved and merged (PR #13 → `b0c1ee1`).

## Assumptions

- **No routing vendor yet (OQ-13).** The default adapter is `none`, so route search runs in waypoint mode, which is the designed degradation (SRS J8 step 3). A `straight-line` adapter (approximate, development only, refused in production) exercises corridor mode locally.
- **Route search is for signed-in users only** (feature matrix F-100: individuals and fleets). It isn't quota-limited; it is rate-limited at 30 per minute.
- **Lists are personal** (owned by a user). Organization or fleet preferred-provider lists are Prompt 22.
- **Sharing uses expiring invitation links, not email lookups,** so accounts can't be enumerated. Friend-based sharing could follow Prompt 16.
- **No UI yet** (web Prompt 24, mobile Prompt 25). The API and SDK are complete.

## What was built

| Area                | Details                                                                                                                                                                                                                                                         |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Routing adapter     | `RoutingProvider` port (`platform/routing`): `none` (default) and `straight-line` (development). Timeout and abort signal. Env `ROUTING_PROVIDER`, `ROUTING_TIMEOUT_MS`, `ROUTING_CACHE_TTL_SECONDS`                                                            |
| Corridor search     | `POST /v1/search/route`: providers within 0.5–25 km of the route, in driving order (`routeFraction`), with the same filters as search; up to 5 waypoints; car or truck profile; GiST index (corridor area in `searchProviders`)                                 |
| Degradation         | `not_configured`, `timeout`, `error` and `no_route` all return 200 with `mode: "waypoints"`: point searches around each stop, merged in stop order (`nearStop`)                                                                                                 |
| Truck restrictions  | Every response carries the disclaimer. `truckProfileApplied` and `vendorNotices` only repeat the vendor, verbatim. FleetTrust has no restriction fields of its own                                                                                              |
| Caching             | Shared `CACHE` (Redis when configured, otherwise memory; best effort), on the rate limiter's Redis connection. Route key = SHA-256 of adapter, profile and points rounded to 0.01°; no user ID; configurable TTL. Points are rounded before reaching the vendor |
| Favorites and lists | Favorites (created on first use, locked) plus up to 50 named lists of up to 500 providers; notes; only live published providers can be added; unpublished or suspended ones shown as unavailable                                                                |
| Sharing             | Viewer and editor invitation links (hashed, expiring 1–30 days, revocable, at most 10 active); join, leave, role changes, removal; non-members 404, insufficient role 403; members see each other's display names only (no emails)                              |
| Data                | `saved_lists`, `saved_list_items`, `saved_list_members`, `saved_list_share_links`. Migrations `0017`, `0018`                                                                                                                                                    |
| SDK and docs        | `searchRoute`, favorites, list and sharing methods; [ADR-0020](../adr/0020-route-discovery-and-saved-lists.md); [architecture/routes-and-lists.md](../architecture/routes-and-lists.md) (API, configuration, examples)                                          |

## Acceptance criteria

| Criterion                        | Evidence                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Route search gracefully degrades | `routes.e2e-spec.ts`: a vendor that is not configured, throws, is slower than the timeout (answered in under 3 s with a 300 ms timeout) or returns an empty route → 200, `mode: "waypoints"`, the right `degradedReason`, results grouped by stop, and a provider between the stops correctly not included                                                             |
| No fabricated truck restrictions | Car and truck profiles both report `truckProfileApplied: false` and `vendorNotices: []` from non-vendor adapters. The route object has exactly the documented keys, with no height, weight, hazmat or "suitable" fields. Vendor notices pass through verbatim. The disclaimer is in every response, degraded ones included                                             |
| Permissions tested               | `lists.e2e-spec.ts`: viewer read-only (403 on items, rename, share); editor manages items but not the list, links or members; outsiders 404 everywhere; owner-only members view; leave and removal revoke access; deleting the list revokes everyone; favorites locked; links hashed, expiring, revocable; rejoining never downgrades; owner can't join their own list |
| Corridor accuracy                | `db/test/search.test.ts`: on-route and 4.9 km points found, 5.1 km excluded; driving order and fractions (0.1, 0.5, 0.8); distance measured from the line; same filters; even thinning; GiST plan                                                                                                                                                                      |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                                 |
| ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **218** (+23: 9 route e2e, 8 list e2e, 6 cache/routing unit), db **86** (+4 corridor) + 5 PG-only skipped locally (run in CI), sdk **20** (+1), types 43, web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                                    |

## Migration notes

- **`0017`** adds four tables; **`0018`** adds `updated_at` triggers. Both are additive, with no backfill. No hand edits were needed.

## Before production (owner)

- **Decide OQ-13 (routing vendor, including truck routing and caching terms).** Until then, route search uses waypoint mode in every environment.
- **If the vendor forbids caching,** set `ROUTING_CACHE_TTL_SECONDS=0`.

## Next: Prompt 14 — Service requests and quotations

Requests from individuals and fleets to providers, quotes as indicative offers with no checkout, status lifecycle and events, quotas on outgoing requests.

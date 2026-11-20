# Handoff — Prompt 12: Geospatial provider search

- Date: 2026-11-19
- Status: **awaiting owner approval** · branch `feat/prompt-12-search`
- Prompt 11 approved and merged (PR #12 → `b44b077`).

## Assumptions

- **Published data only.** Search covers published profiles. Drafts are never searchable (ADR-0017).
- **Live signals.** Hours, badges and organization status are read at query time.
- **One result per branch.** A provider with several branches has several map pins.
- **Availability means "open now"** at the moment of the search, in each branch's own timezone. Booking slots come with appointments (Prompt 17).
- **Vehicle support and verification are filters, not ranking boosts.** FR-06 lists vehicle support as a relevance signal; it is applied as a filter the user chooses. Verification is a filter by ADR-0009.
- **Map vendor (OQ-13) is still open.**
  - A `MapProvider` port has a `stub` adapter that geocodes a small built-in list of cities.
  - Search runs on PostGIS and never calls the vendor.
  - Production requires a tile URL, and choosing the vendor is a launch blocker.
- **Text search uses the `simple` configuration** (language-neutral, prefix matching, no stemming).
- **Not built yet:** the search and map UI (web Prompt 24, mobile Prompt 25), and route-corridor search (Prompt 13).

## What was built

| Area        | Details                                                                                                                                                                                                                                                                         |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Projection  | `provider_search_entries`, one row per published branch, written only by `refresh_provider_search(org)` from the published snapshot. Refreshed on publish and unpublish in the same transaction; backfilled by the migration; cascades with branches. Migrations `0015`, `0016` |
| Indexes     | GiST on the exact and rounded locations (geography for radius search, a `::geometry` expression for viewports); GIN on categories, vehicle types and the tsvector                                                                                                               |
| Search      | Radius search (`ST_DWithin` on the spheroid, at most 200 km) and viewport search (at most 10° per side, with antimeridian splitting)                                                                                                                                            |
| Filters     | Category (any of), vehicle type, current verification badges (all requested), open now, service-radius coverage ("travels to you"), text                                                                                                                                        |
| Ranking     | Relevance only: 0.35 text + 0.35 distance + 0.15 coverage + 0.15 open now, then distance, then ID. No plan or payment input (the boundary lint rule keeps entitlements out of the search module)                                                                                |
| Open now    | SQL `branch_is_open()` mirrors the shared `openingStatus()`; cards show the full local status (closes at, opens at, exception)                                                                                                                                                  |
| Pagination  | Keyset cursor with the evaluation instant and a query/audience fingerprint; 400 `invalid_cursor` on replay or tampering                                                                                                                                                         |
| Privacy     | Visitors are served only from the rounded location (filter, distance, ranking and returned point); distances to 0.1 km; no contacts or street details; query strings never logged                                                                                               |
| Cards       | Live hours status, verification labels ("unverified" shown explicitly), up to 3 indicative price labels (searched categories first), logo                                                                                                                                       |
| Map adapter | `GET /v1/geo/geocode`, `GET /v1/geo/map-config`; env `MAP_PROVIDER`, `MAP_TILE_URL` (required in production), `MAP_ATTRIBUTION`                                                                                                                                                 |
| SDK / docs  | `searchProviders`, `geocode`, `mapConfig`; [ADR-0019](../adr/0019-search-projection-and-ranking.md); [architecture/search.md](../architecture/search.md) (API, ranking, privacy, indexes, sample plan, configuration)                                                           |

## Acceptance criteria

| Criterion                         | Evidence                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Geospatial accuracy tests         | `db/test/search.test.ts`: PostGIS-projected points at 9.99 km (in) and 10.01 km (out) of a 10 km radius, distance reported to the metre; London–Paris within 0.5% of an independent haversine; antimeridian neighbours found by radius and viewport; viewport edges inclusive, 0.0001° outside excluded; service-radius coverage                                |
| Index query plan                  | `EXPLAIN` of the real statement shows `provider_search_entries_location_gist` (exact), `…_approx_gist` (visitor) and the geometry indexes for viewports (PGlite). On **PostgreSQL 17 in CI** with 4,000 rows, `ANALYZE` and no planner hints, the plan uses the GiST index (`postgres.integration.test.ts`)                                                     |
| Privacy tests                     | **db:** visitor filtering uses only the rounded point (a branch 4.99 km away exactly but 4.45 km rounded appears for visitors at 4.7 km and not for precise search); drafts, hidden and suspended providers absent; draft edits invisible; branch deletion removes rows. **API:** no street, postcode, phone or email in visitor results; `/full` needs sign-in |
| Pagination tests                  | **db:** 23 providers including ties, keyset pages equal the full ordering with no duplicates. **API:** 12 providers over 3 pages via `nextCursor`; cursors rejected for another query, tampering or another audience                                                                                                                                            |
| Ranking independent of paid trust | Identical providers on free and `provider-pro` (assigned through the billing API) tie and are ordered by ID only; open-now and text relevance change the order                                                                                                                                                                                                  |
| Open-now correctness              | SQL and TypeScript agree every 15 minutes across the 2026 UK DST week (with closures, special hours and overnight exceptions) in London, Auckland, New York and Kolkata                                                                                                                                                                                         |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                                                   |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **195** (+9 search e2e), db **82** (+19 search) + 5 PG-only skipped locally (the new PG17 plan test runs in CI), sdk **19** (+1), types 43, web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                                                      |

## Migration notes

- **`0015`:** the projection table and its indexes. **drizzle-kit quoted the geography type in `CREATE TABLE` too**, so it was unquoted by hand ([database.md](../development/database.md)).
- **`0016`:** the `branch_is_open` and `refresh_provider_search` functions, plus a backfill of published profiles. It is additive and safe to rerun on an empty table.

## Before production (owner)

- **Decide OQ-13 (map tiles and geocoding vendor).** Set `MAP_TILE_URL` (required in production) and `MAP_ATTRIBUTION`. A vendor geocoding adapter replaces the stub.
- **Staging needs nothing new.** It runs the stub with no tiles.

## Next: Prompt 13 — Route discovery and lists

Route-corridor search through a routing adapter (OQ-13), point-search fallback around waypoints, and saved lists. Truck restrictions are never fabricated.

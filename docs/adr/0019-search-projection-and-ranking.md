# ADR-0019: Provider search on a published-snapshot projection, relevance-only ranking, privacy by rounding

- Status: Accepted
- Date: 2026-11-19

## Context

Prompt 12 adds nearby search, map-viewport search and filters (SRS F-040..F-042):

- **Filters:** category, availability (open now), verification, vehicle support, distance and service radius.
- **Ranking (FR-06, ADR-0009):** relevance signals only; plans never buy placement.
- **Privacy (OQ-11, AB-04):** visitors see approximate areas only, and searchers' locations must not be kept.
- **Performance:** nearby search p95 ≤ 400 ms server-side at pilot volume.
- **Map vendor (OQ-13):** not chosen yet.

Published profiles live as JSON snapshots (ADR-0017), which PostGIS can't index.

## Decision

1. **Search reads a projection table, `provider_search_entries`: one row per published branch.**
   - **Only writer:** the SQL function `refresh_provider_search(org)`. It derives every row from `published_snapshot` and nothing else, so drafts can never be searched.
   - **When it runs:** publish and unpublish call it in the same transaction. The migration backfills profiles that are already published.
   - **Branch deletion:** rows cascade when a branch is deleted.
   - **Joined live at query time:** organization status (suspension hides a provider at once), current badges, and opening hours.
2. **Indexes and query shape.**
   - **GiST indexes** on both the exact `location` and the rounded `approx_location`: geography for radius queries, plus a `::geometry` expression index each for viewport boxes.
   - **GIN indexes** for categories, vehicle types and the `simple` tsvector.
   - **Radius search** uses `ST_DWithin` on the spheroid.
   - **Viewports** use `&&` against `ST_MakeEnvelope`. A viewport that crosses the antimeridian is split into two envelopes.
   - **Limits:** radius at most 200 km; viewport at most 10° per side.
3. **Ranking** is a fixed weighted sum of relevance signals, rounded to six decimals:

   | Signal     | Weight | Value                                                                                                              |
   | ---------- | -----: | ------------------------------------------------------------------------------------------------------------------ |
   | Text match |   0.35 | `ts_rank`, prefix terms, capped at 1. Weights: name and categories (A), offerings (B), branch (C), description (D) |
   | Distance   |   0.35 | `1 / (1 + km / 10)`                                                                                                |
   | Coverage   |   0.15 | The branch's service radius reaches the searcher                                                                   |
   | Open now   |   0.15 | `branch_is_open()` at the evaluation instant                                                                       |
   - **Ties:** broken by distance, then branch ID.
   - **No commercial inputs:** the ranking function has no plan, tier or payment input. A test asserts that identical providers on free and paid plans tie and are ordered by ID only.
   - **Filters, not signals:** verification and vehicle support are filters the user chooses. Verification is not a boost (ADR-0009).
   - **No paid placement:** there's no "featured" or "sponsored" placement.

4. **"Open now" in SQL.** `branch_is_open(branch, tz, at)` mirrors `openingStatus()`:
   - it works in local time;
   - a date's exception replaces that date's weekly hours;
   - the previous night's interval still counts after midnight;
   - a branch whose hours are unknown is not open.

   A test compares the two every 15 minutes across a week that includes a DST change, in four timezones.

5. **Pagination** is keyset on `(score, distance, branch id)`.
   - **Cursor contents:** the evaluation instant (so "open now" and the ranking stay stable across pages) and a fingerprint of the query and audience.
   - **Rejected cursors:** a cursor replayed against a different query, a different audience or tampered values gets 400 `invalid_cursor`.
6. **Privacy.**
   - **Visitors** (`GET /v1/search/providers`) are served only from `approx_location`, rounded to 0.01° (about 1 km): filtering, distance, ranking and the returned point. Distances come back to 0.1 km and are measured from the rounded point, so results can't be used to triangulate a branch.
   - **Signed-in users** (`/full`) get exact values.
   - **No contact or street details** appear in any search result.
   - **Search points are never stored or logged:** the request logger drops query strings.
7. **Map vendor.** A `MapProvider` port covers geocoding and the client tile configuration.
   - The only adapter for now is `stub`, which geocodes a small built-in list of cities.
   - Search never calls the vendor: clients geocode a place name, then search near it.
   - Production requires `MAP_TILE_URL`. Choosing a vendor (OQ-13) is a launch blocker.

## Consequences

- **Republishing rebuilds an organization's search rows.** That's cheap: one statement per organization.
- **Live joins** for "open now" and badges keep results accurate, at the cost of evaluating `branch_is_open` for each candidate. Candidates are first narrowed by the GiST index.
- **Text search uses the `simple` configuration** (no stemming). It is language-neutral, but "brakes" won't match "braking". This can be revisited with i18n.
- **Different weights or new signals need a new ADR.** The weights are constants (`RANKING_WEIGHTS`), documented in [search.md](../architecture/search.md).

## Alternatives considered

- **Querying the JSON snapshots directly:** no spatial index, so every search would scan all profiles.
- **An external search engine (Elasticsearch, Algolia, …):** another system to run and sync. PostGIS meets pilot volume (ADR-0003).
- **Offset pagination:** pages shift as data changes, and deep offsets get slow.

# ADR-0017: Provider profiles — editable draft, frozen published snapshot, tiered public view

- Status: Accepted
- Date: 2026-11-19

## Context

Prompt 10 builds the provider setup wizard (SRS J4, F-030..F-032). Providers fill in a lot over several sessions: names, categories with category-specific fields, branches with locations, contacts, vehicle types and photos. They need to preview the result before publishing. Once live, edits must not leak half-finished changes to the public. OQ-11's default lets visitors browse without signing in, but with approximate locations and no contact details.

## Decision

1. **The draft lives in normal columns and saves freely.** `PATCH` accepts any subset of fields, checked for shape only (enum values, formats, ranges). Required-ness is evaluated per wizard step (`basics`, `categories`, `vehicles`, `contact`, `branches`, `media`) and returned with every read as `steps[].issues`. Saving never fails because something is incomplete; that is what makes the wizard resumable.
2. **Publishing freezes a snapshot.** `POST …/publish` re-checks every step under the organization lock. It refuses with 422 `profile_incomplete`, listing each issue's path, or stores a JSON snapshot. Public reads serve only the snapshot, so later draft edits stay invisible until republished. `hasUnpublishedChanges` compares draft and snapshot.
3. **Category rules are data:** `CATEGORY_DETAIL_SCHEMAS` in `@fleettrust/types` defines one zod schema per category. Drafts use a relaxed version: all fields optional, and multi-choice lists may be empty. Publishing uses the full one. Categories that travel to customers (towing, mobile mechanic) require a branch service radius. A provider that _only_ travels (mobile mechanic) doesn't need a street address. Incomplete branches are left out of the snapshot; at least one complete branch is required.
4. **Two public views of one snapshot:**
   - **Visitors** (`GET /v1/providers/:slug`, no sign-in, rate-limited by IP) get coordinates rounded to two decimals (about 1 km) marked `approximate`, no street lines or postcode, and no phone, email or website.
   - **Signed-in users** (`/full`) get everything.

   Verification labels are added live (never frozen), so an expiring or revoked badge shows at once. Unpublishing, or suspending the organization, takes the profile offline immediately.

5. **Images:** logo, cover and up to 12 gallery images go through the ADR-0006 pipeline (quarantine, size and type checks, malware scan). Then **embedded metadata is stripped** (EXIF/XMP/IPTC/comments for JPEG; eXIf/text/time chunks for PNG; EXIF/XMP for WebP) by a small pure-TypeScript parser, before the file is written to the public-media bucket with immutable caching. The parser refuses malformed files rather than passing them through. A new logo or cover replaces the old one. Images are resolved live, so a removed image disappears without republishing.

## Consequences

- The snapshot duplicates some data (names, branches). That is accepted for the guarantee that what's public is exactly what was reviewed at publish time. Search (Prompt 12) indexes the snapshot, not the draft.
- The metadata stripper doesn't re-encode, so pixel data and ICC profiles are untouched and no native image library is needed (the repo denies native build scripts). If thumbnails are needed later, a re-encoding step (sharp in a worker) can replace it.
- Opening hours, services and indicative prices belong to Prompt 11. Services and prices joined the draft and snapshot; opening hours are live instead ([ADR-0018](0018-catalog-pricing-and-hours.md)).

## Alternatives considered

- **Publishing by flipping a status flag on live columns:** simpler, but every later edit goes live immediately, including broken ones.
- **Separate draft and published tables:** a schema duplicated per field. The JSON snapshot is enough because published data is read-only.

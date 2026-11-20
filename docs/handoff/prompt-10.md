# Handoff — Prompt 10: Provider profile onboarding

- Date: 2026-11-19
- Status: **approved** · PR **#11** squash-merged as `ddb185e` (CI 5/5 green on `17ce17f`)
- Prompt 09 approved and merged (PR #10 → `d0d45d6`).

## Assumptions

- **Categories** are workshop, fuel station, towing, tyres, parts, parking and mobile mechanic (SRS F-033). Their services, offerings and prices are Prompt 11; this stage adds the category-dependent _profile_ fields.
- **OQ-11 default:** visitors can view published profiles without signing in, with approximate locations and no contact details; signed-in users see everything.
- **Opening hours** belong to Prompt 11 (F-035). Map pickers and geocoding are UI/adapter work (Prompts 12/24); the API takes coordinates.
- No wizard UI yet (web Prompt 24, mobile Prompt 25). The API and SDK are complete.

## What was built

| Area         | Details                                                                                                                                                                                                                                                         |
| ------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data         | `provider_profiles` (one per provider org, enforced by a composite FK on kind; unique slug; JSON snapshot when published); `provider_media`; branches gain address, country, PostGIS location (GiST index), service radius and phone. Migrations `0011`, `0012` |
| Wizard       | Save any subset (shape-checked only) and resume; six steps with `complete` and `issues[]`; `canPublish`; `hasUnpublishedChanges`                                                                                                                                |
| Categories   | One zod schema per category (relaxed for drafts, strict at publish); service radius for towing and mobile mechanics; no street address needed for travel-only providers                                                                                         |
| Publication  | Re-validated under the organization lock; 422 `profile_incomplete` with every issue path; frozen snapshot; incomplete branches excluded; unpublish; suspended organizations disappear; preview of both public views                                             |
| Public views | `GET /v1/providers/:slug` (visitors: about 1 km rounding, no street, postcode or contacts; IP rate limit) and `/full` (signed in). Live verification labels ("unverified" until a badge exists)                                                                 |
| Media        | Logo, cover and 12 gallery images through quarantine, type check and malware scan, then **metadata stripping** (EXIF/XMP/IPTC/text chunks, pure TypeScript), then the public-media bucket with immutable caching; replacement and removal take effect live      |
| Platform     | `public_media` bucket class, `publicUrl()`, local public-media route; `STORAGE_PUBLIC_MEDIA_BUCKET` (required with `gcs`), optional `PUBLIC_MEDIA_BASE_URL` (CDN). The Cloud Run template, staging workflow and ops doc were updated                            |
| Permissions  | New `profile.manage` (owner, admin); members can read the draft                                                                                                                                                                                                 |
| SDK / docs   | 10 profile methods; [ADR-0017](../adr/0017-provider-profile-publication.md); [architecture/provider-profiles.md](../architecture/provider-profiles.md) (steps, category fields, API)                                                                            |

## Acceptance criteria

| Criterion                        | Evidence                                                                                                                                                                                                                                                                                                                                                                    |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Provider can save and resume     | `providers.e2e-spec.ts`: basics saved in one session and read back in another (new token); partial category details kept; steps show exactly what's left                                                                                                                                                                                                                    |
| Category-specific validation     | Fuel station plus parking report their own missing fields by path; empty required lists flagged at publish but allowed in drafts; towing and mobile mechanic need a radius; mobile-only needs no street address, and adding tyres makes it required; malformed values rejected even in drafts (unknown category, fuel type, weight out of range, http website, slug, phone) |
| Profile publication rules tested | Incomplete → 422 with paths; complete → published snapshot; draft edits invisible until republished; a broken draft can't be published and doesn't affect the live profile; incomplete branches excluded; unpublish and suspension → 404; preview; staff can't edit or publish (403); outsiders 404; fleets 400; unique slug 409; audit events                              |
| Privacy                          | Visitor view has no phone, email, street or postcode and a rounded location; image GPS metadata stripped (bytes served equal the clean image); removed images vanish immediately; non-images and malware rejected; gallery capped at 12                                                                                                                                     |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                        |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **172** (+19: 15 profile e2e, 4 metadata-stripping unit), db 63, sdk **17** (+1), web 18, local-infra 44, repo-guards 22, ui 22, env 5, types 3 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                           |

## Decisions and notes

- **Migration note:** drizzle-kit quoted the PostGIS type (`"geography(Point, 4326)"`) in `ALTER TABLE branches ADD COLUMN`. The generated SQL was corrected by hand and the gotcha documented in [database.md](../development/database.md). `0011` only adds nullable columns to `branches`, so it is safe on existing rows.
- `BranchDto` now includes the location fields (`GET /v1/orgs/:orgId/branches`).
- Metadata stripping doesn't re-encode images (no native dependency). Thumbnails, if needed, come later with a worker.

## Before production (owner)

- Answer OQ-11 if the default (public browsing with hidden contacts) isn't right.
- Create the public-media bucket and set `STAGING_PUBLIC_MEDIA_BUCKET` ([ops](../operations/verification.md#one-time-google-cloud-setup-per-environment)); optionally put a CDN in front of it and set `PUBLIC_MEDIA_BASE_URL`.

## Next: Prompt 11 — Service catalogs and published pricing

Per-category services and offerings, indicative prices (fixed / from / range / quote-required, with currency), opening hours with holiday exceptions and timezone, added to the draft and snapshot the same way.

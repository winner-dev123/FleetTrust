# Feature matrix — phase × role × prompt

Every approved feature appears exactly once. Phases are defined in [SRS §5](SRS.md#5-release-phases).

**Legend:** ● acts on / owns the feature · ○ sees or receives it · — not applicable
**Roles:** Ind = individual user · Prov = provider org member · Fleet = fleet org member · Adm = platform admin · Vis = visitor (not signed in)

## R0 — Foundation

| ID    | Feature                                                                                         | Ind | Prov | Fleet | Adm | Vis | Prompt |
| ----- | ----------------------------------------------------------------------------------------------- | --- | ---- | ----- | --- | --- | ------ |
| F-001 | Email-link sign-in (Firebase Auth)                                                              | ●   | ●    | ●     | ●   | —   | 06     |
| F-002 | Google / Apple sign-in                                                                          | ●   | ●    | ●     | —   | —   | 06     |
| F-003 | Session list, logout everywhere, token revocation                                               | ●   | ●    | ●     | ●   | —   | 06     |
| F-004 | Account recovery                                                                                | ●   | ●    | ●     | ○   | —   | 06     |
| F-005 | User profile, display name optional until first contribution                                    | ●   | ●    | ●     | ○   | —   | 07     |
| F-006 | Create provider / fleet organization                                                            | —   | ●    | ●     | ○   | —   | 07     |
| F-007 | Member invitations with expiry and revocation                                                   | ○   | ●    | ●     | —   | —   | 07     |
| F-008 | Org roles and branch-scoped permissions                                                         | —   | ●    | ●     | ○   | —   | 07     |
| F-009 | Multi-organization switching                                                                    | —   | ●    | ●     | —   | —   | 07     |
| F-010 | Versioned plan catalog and capabilities                                                         | ○   | ○    | ○     | ●   | —   | 08     |
| F-011 | Plan assignment after external billing confirmation                                             | —   | ○    | ○     | ●   | —   | 08     |
| F-012 | Quotas and usage display (friend requests, service requests, articles, groups, staff, branches) | ○   | ○    | ○     | ○   | —   | 08     |
| F-013 | Quota overrides, grace periods, override audit                                                  | —   | ○    | ○     | ●   | —   | 08     |
| F-014 | Audit event log (write path)                                                                    | —   | —    | —     | ○   | —   | 04, 07 |

## R1 — Pilot MVP

| ID    | Feature                                                                                           | Ind | Prov | Fleet | Adm | Vis | Prompt |
| ----- | ------------------------------------------------------------------------------------------------- | --- | ---- | ----- | --- | --- | ------ |
| F-020 | Private, encrypted document upload with malware scan                                              | ●   | ●    | ●     | ○   | —   | 09     |
| F-021 | Verification cases and admin review                                                               | ○   | ○    | ○     | ●   | —   | 09     |
| F-022 | Badges: driver, business, location; expiry and reverification                                     | ●   | ●    | ●     | ●   | ○   | 09     |
| F-023 | Verification appeals                                                                              | ●   | ●    | ●     | ●   | —   | 09     |
| F-030 | Resumable provider setup wizard with category-dependent fields                                    | —   | ●    | —     | —   | —   | 10     |
| F-031 | Branches, contacts, location, service areas, vehicle types, media                                 | —   | ●    | —     | —   | —   | 10     |
| F-032 | Draft → preview → published provider profile                                                      | ○   | ●    | ○     | ○   | ○   | 10     |
| F-033 | Service categories (workshop, fuel, towing, tyres, parts, parking, mobile mechanic) and offerings | ○   | ●    | ○     | ●   | ○   | 11     |
| F-034 | Indicative pricing (fixed / from / range / quote-required, currency)                              | ○   | ●    | ○     | —   | ○   | 11     |
| F-035 | Opening hours, holiday exceptions, service radius, timezone                                       | ○   | ●    | ○     | —   | ○   | 11     |
| F-040 | Nearby search with map (visitors get approximate area only)                                       | ●   | ○    | ●     | —   | ●   | 12     |
| F-041 | Bounding-box map search and pagination                                                            | ●   | —    | ●     | —   | ●   | 12     |
| F-042 | Filters: category, open now, verification, vehicle type, distance, service radius                 | ●   | —    | ●     | —   | ●   | 12     |
| F-050 | Service request with photos, category, vehicle, location                                          | ●   | ○    | ●     | —   | —   | 14     |
| F-051 | Quote exchange (informational only)                                                               | ●   | ●    | ●     | —   | —   | 14     |
| F-052 | Request cancellation, evidence, event history                                                     | ●   | ●    | ●     | ○   | —   | 14     |
| F-053 | Direct (1:1) and request-linked messaging, WebSocket delivery, durable history                    | ●   | ●    | ●     | —   | —   | 17     |
| F-054 | Read receipts, inbox notifications (FCM), opt-out controls                                        | ●   | ●    | ●     | —   | —   | 17     |
| F-055 | Message abuse reporting                                                                           | ●   | ●    | ●     | ●   | —   | 17     |
| F-060 | Emergency incident with one-tap official emergency services guidance                              | ●   | —    | ●     | ○   | —   | 18     |
| F-061 | Trusted contacts with mutual consent                                                              | ●   | —    | ●     | —   | —   | 18     |
| F-062 | Push with email fallback, acknowledgement, escalation, retries                                    | ●   | ○    | ●     | ○   | —   | 18     |
| F-063 | Nearby opted-in provider matching for incidents                                                   | ○   | ●    | ○     | —   | —   | 18     |
| F-064 | Incident room, expiry, audit                                                                      | ●   | ○    | ●     | ○   | —   | 18     |
| F-070 | Vehicle records                                                                                   | ●   | —    | ●     | —   | —   | 19     |
| F-071 | Driver assignment                                                                                 | ○   | —    | ●     | —   | —   | 19     |
| F-072 | Service history with source attribution (never auto-verified)                                     | ●   | ●    | ●     | —   | —   | 19     |
| F-073 | Maintenance schedules, mileage and inspection reminders                                           | ●   | —    | ●     | —   | —   | 19     |
| F-074 | Private vehicle document vault and controlled sharing                                             | ●   | ○    | ●     | —   | —   | 19     |
| F-080 | Admin verification queue                                                                          | —   | —    | —     | ●   | —   | 26     |
| F-081 | Admin subscription activation and quota overrides                                                 | —   | ○    | ○     | ●   | —   | 26     |
| F-082 | Admin abuse moderation and enforcement                                                            | ○   | ○    | ○     | ●   | —   | 26     |
| F-083 | Admin service taxonomy and feature configuration                                                  | —   | ○    | —     | ●   | —   | 26     |
| F-084 | Admin audit search and support operations                                                         | —   | —    | —     | ●   | —   | 26     |
| F-085 | Admin MFA and least-privilege sub-roles                                                           | —   | —    | —     | ●   | —   | 26     |
| F-090 | Account data export and deletion                                                                  | ●   | ●    | ●     | ○   | —   | 27     |
| F-091 | Consent management (location, analytics, notifications)                                           | ●   | ●    | ●     | —   | ○   | 27     |
| F-092 | Responsive web app and accessible design system                                                   | ●   | ●    | ●     | ●   | ●   | 24     |
| F-093 | iOS/Android app                                                                                   | ●   | ●    | ●     | —   | —   | 25     |
| F-094 | Mobile offline drafts and degraded-network handling                                               | ●   | ●    | ●     | —   | —   | 25     |

## R2 — Community & fleet growth

| ID    | Feature                                                                  | Ind | Prov | Fleet | Adm | Vis | Prompt |
| ----- | ------------------------------------------------------------------------ | --- | ---- | ----- | --- | --- | ------ |
| F-100 | Route corridor search via routing adapter, truck-suitability disclaimer  | ●   | —    | ●     | —   | —   | 13     |
| F-101 | Favorites, named lists, list sharing permissions                         | ●   | —    | ●     | —   | —   | 13     |
| F-110 | Article drafts, sanitised rich text, publishing, categories/tags, images | ●   | ●    | ●     | ○   | ○   | 15     |
| F-111 | Article bookmarks, comments, search                                      | ●   | ●    | ●     | —   | ○   | 15     |
| F-112 | Article reporting and moderation                                         | ●   | ●    | ●     | ●   | —   | 15     |
| F-120 | Friend requests, accept/decline/cancel, block, mutual friends            | ●   | —    | —     | —   | —   | 16     |
| F-121 | Social privacy settings                                                  | ●   | —    | —     | —   | —   | 16     |
| F-122 | Groups by region / route / specialty, memberships, group moderation      | ●   | ●    | ●     | ○   | —   | 16     |
| F-123 | Group messaging                                                          | ●   | ●    | ●     | —   | —   | 17     |
| F-130 | Provider CRM: inquiry pipeline, tasks, quote management                  | —   | ●    | —     | —   | —   | 20     |
| F-131 | Appointment slots, availability, staff assignment                        | ○   | ●    | ○     | —   | —   | 20     |
| F-132 | Provider analytics and response status                                   | —   | ●    | —     | —   | —   | 20     |
| F-140 | Parts listings, compatibility, indicative prices, stock freshness        | ○   | ●    | ○     | —   | ○   | 21     |
| F-141 | Parts availability inquiries (no checkout)                               | ●   | ○    | ●     | —   | —   | 21     |
| F-142 | Provider-to-provider referrals with consent and visibility               | ○   | ●    | ○     | ○   | —   | 21     |
| F-150 | Fleet maintenance and incident dashboards                                | —   | —    | ●     | —   | —   | 22     |
| F-151 | Fleet preferred provider lists                                           | —   | ○    | ●     | —   | —   | 22     |
| F-152 | User-entered spending records (not verified payments)                    | —   | —    | ●     | —   | —   | 22     |
| F-153 | Job listings and applications                                            | ●   | —    | ●     | —   | ○   | 22     |
| F-154 | Employer verification, recruiter permissions, job posting moderation     | ○   | —    | ●     | ●   | —   | 22     |
| F-160 | Power User eligibility, badge, revocation, appeals                       | ●   | ●    | ●     | ●   | ○   | 23     |
| F-161 | Shared trust & safety dashboard                                          | —   | —    | —     | ●   | —   | 23     |

## F — Future (specification only, Prompt 30)

These have **no** runtime, tables, endpoints, UI, workers or feature flags.

| ID    | Module                                    | Deliverable |
| ----- | ----------------------------------------- | ----------- |
| F-900 | Daily rewards, check-ins, streaks, ledger | RFC         |
| F-901 | Payments and escrow                       | RFC         |
| F-902 | Transaction-backed reviews                | RFC         |
| F-903 | AI features                               | RFC         |
| F-904 | Telematics                                | RFC         |
| F-905 | Multilingual support                      | RFC         |

# Handoff — Prompt 14: Service requests and quotations

- Date: 2026-11-23
- Status: **approved** · PR **#16** squash-merged as `3df0759` (CI 5/5 green on `f512510`)
- Prompt 13 approved and merged (PR #15 → `42f9c8c`).

## Assumptions

- **Requesters:** individuals use their own quota; fleets (drivers, managers, admins, owners) use the fleet's.
- **Recipients:** chosen providers (up to 5), or matched providers (up to 10 nearby, by relevance).
- **Messaging comes in Prompt 17.** Each request–provider pairing has an ID that the conversation thread will attach to. Until then, requester contact details aren't shared.
- **Vehicle records come in Prompt 19.** Requests carry a vehicle snapshot (type, make, model, year, registration).
- **Staged disclosure:** recipients see an approximate location until their quote is accepted, then the exact location, address note and registration.
- **"Urgent" is not an emergency.** Emergencies (no quota, trusted contacts) are Prompt 18.
- **Not built yet:** the UI (Prompts 24 and 25) and push notifications (events already go to the outbox).

## What was built

| Area         | Details                                                                                                                                                                                                                  |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Data         | `service_requests`, `service_request_recipients`, `service_quotes`, `service_request_attachments`, `service_request_events` (append-only trigger). Migrations `0019`, `0020`                                             |
| Creating     | Category, vehicle, location, description, urgency, photos; direct or matched recipients; quota consumed in the same transaction, idempotent by `clientRequestId`; no match uses no quota                                 |
| Quotes       | Indicative price types with currency and precision checks, message, availability, validity; revise, withdraw, decline; disclaimer and scam warning on every quote                                                        |
| Lifecycle    | open → accepted → completed, cancelled, expired (14 days); accepted provider cancelling reopens the request and revives still-valid quotes                                                                               |
| Agreement    | The accepted quote recorded as `agreement` with `informational: true`. No payment routes or fields                                                                                                                       |
| Privacy      | Approximate location, no registration or address note before acceptance; private photos (scanned, GPS stripped, sensitive bucket, access-checked downloads); providers never see each other's quotes, events or evidence |
| Permissions  | `requests.create` (fleet owner, admin, manager, driver), `requests.manage` (whole fleet; branch-scoped: branch), `requests.respond` (provider owner, admin, manager, staff; branch-scoped inbox)                         |
| Outbox       | Every event enqueued as `ServiceRequest<Type>` for notifications later                                                                                                                                                   |
| SDK and docs | 17 methods; [ADR-0021](../adr/0021-service-requests-and-quotes.md); [architecture/service-requests.md](../architecture/service-requests.md) (flow, routes, visibility, examples)                                         |

## Acceptance criteria

| Criterion                 | Evidence                                                                                                                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Quota enforced atomically | `requests.e2e-spec.ts`: 6 concurrent creates against a limit of 3 → exactly 3 created and 3 `quota_exceeded`, usage 3, 3 rows. A retry with the same `clientRequestId` returns the same request and usage stays 1. A failed match uses no quota. Fleet requests use the fleet's quota, not the driver's                                          |
| Lifecycle tested          | Full flow (view, quote, revise, accept, complete) with the exact event sequence; invalid transitions (quote after acceptance, cancel after completion) → 409; quote and request expiry (clock moved forward); decline; cancel with required reason; provider cancel reopens and revives the other quote; DB refuses edits and deletes of history |
| Tenant permissions tested | Non-recipient providers 404; branch-scoped staff see only their branch's inquiries; staff can quote; other individuals 404; fleet drivers see only their own and owners see all; recruiters 403; providers can't use fleet routes (`not_a_fleet`); fleet requests invisible through personal routes                                              |
| No payment endpoints      | `/pay`, `/payment`, `/checkout`, `/deposit` → 404; `paymentLink` and `depositAmount` rejected by strict schemas; no payment-like fields in responses; disclaimers present; repo guards pass                                                                                                                                                      |
| Photos and evidence       | GPS stripped (served bytes equal the clean image); requester and recipients can download, others 404, unauthenticated 401; a photo can't be reused; a provider's evidence is hidden from other providers                                                                                                                                         |

## Evidence (actual results)

| Check                           | Result                                                                                                                                                                                                                                     |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Local, whole repo: `pnpm check` | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **231** (+13 request e2e), types **48** (+5), sdk **21** (+1), db 86 + 5 PG-only skipped locally (run in CI), web 18, local-infra 44, repo-guards 22, ui 22, env 5, mobile 5 |
| Schema drift                    | "No schema changes"                                                                                                                                                                                                                        |

## Migration notes

- **`0019`** adds five tables. **drizzle-kit quoted the geography type again**, so it was unquoted by hand (documented in [database.md](../development/database.md)).
- **`0020`** adds `updated_at` triggers and the append-only trigger on `service_request_events`.
- Both are additive, with no backfill.

## Before production (owner)

- **Nothing new to configure.** Photos use the existing quarantine and sensitive buckets.
- **Optional:** review the request limits in the plan catalog (personal-free 3 per day, fleet-free 10 per day, still sample values from OQ-09).

## Next: Prompt 15 — Article publishing and knowledge hub

Articles with sanitisation, daily article quotas and a moderation queue (SRS AB-06).

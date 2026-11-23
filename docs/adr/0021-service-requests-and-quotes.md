# ADR-0021: Service requests with atomic quota, informational quotes, staged location disclosure and an append-only history

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 14 builds the core request loop (SRS J2, F-050..F-052): a customer sends a request with category, vehicle, location, description and photos; providers quote; the customer records which quote they accepted; either side can cancel; evidence and every status change are kept.

Constraints:

- **No money moves through the platform** (SRS §1 rule 2, ADR-0008). Agreements are informational.
- **Quotas:** each request consumes a `service_requests.daily` unit atomically and idempotently (FR-03, AB-18).
- **Requesters:** individuals and fleets. Fleet drivers raise requests for their fleet (SRS §2.2).
- **Scams:** off-platform payment scams are a known abuse (AB-07).
- **Not built yet:** messaging (Prompt 17) and the vehicle registry (Prompt 19).

## Decision

1. **Requesters.**
   - **Personal requests** use the user's quota.
   - **Fleet requests** (`/v1/orgs/:orgId/service-requests`, `requests.create`) use the fleet's quota. A composite FK on `(organization_id, kind = 'fleet')` stops providers from raising requests.
   - **Fleet visibility:** drivers see their own requests. Members with `requests.manage` see the whole fleet's; a branch-scoped manager sees their branch's plus their own. A branch-scoped driver's requests are filed under their branch.
2. **Recipients.** Two ways to choose them:
   - **Direct:** 1–5 chosen providers, each published, active, offering the category and serving the vehicle type (otherwise 400 `provider_not_matching`).
   - **Match:** up to 10 providers from the search projection near the location, filtered by category and vehicle type and ordered by relevance (ADR-0019, so plans never affect who receives a request).

   Each recipient row records the nearest published branch (it drives branch-scoped inboxes) and the distance. **Its ID is the conversation anchor that Prompt 17's request-linked messaging will attach to.**

3. **Quota and retries.**
   - The request, its recipients, its photos and the quota unit commit in **one transaction**.
   - **Retries:** the client sends a `clientRequestId` (unique per requester). A retry returns the original request; a concurrent duplicate loses the unique-index race and is answered with the winner. The quota idempotency key is the same ID.
   - **No match, no quota:** if nothing matches, the request fails with 422 and no quota is used.
4. **Lifecycle.**

   | Request status | Meaning                                                                       |
   | -------------- | ----------------------------------------------------------------------------- |
   | `open`         | Accepting quotes until `expires_at` (14 days), after which it reads `expired` |
   | `accepted`     | The requester recorded one quote as agreed                                    |
   | `completed`    | Either side marked the work done                                              |
   | `cancelled`    | The requester cancelled, with a reason                                        |

   Moves:
   - **Providers** quote, revise (the new quote supersedes the old; at most 10 per provider), withdraw, or decline while the request is open.
   - **Accepting** marks that quote accepted and every other active quote and recipient `not_selected`.
   - **If the accepted provider cancels** (with a reason), the request **reopens**: other providers' still-valid quotes become active again, and the requester gets at least 3 more days to choose.
   - **Invalid moves** return 409 `invalid_transition` or `quote_not_active`.

5. **Quotes are informational.**
   - A quote uses the indicative price types (ADR-0018), with the same currency and precision checks.
   - Every quote carries `PAYMENT_DISCLAIMER` and `QUOTE_SCAM_WARNING`.
   - The accepted quote becomes an `agreement` marked `informational: true`.
   - There are no payment, deposit or checkout fields or routes. Strict schemas reject such fields, and the repo guards (ADR-0011) still apply.
6. **Staged disclosure** protects the requester:
   - **Before acceptance:** recipients see the location rounded to about 1 km, no address note and no registration.
   - **After acceptance:** only the accepted provider sees the exact location, the address note and the registration.
   - **Always private:** the requester's identity and contact details aren't exposed. Contact happens through messaging (Prompt 17).
7. **Photos and evidence are private.**
   - **Processing:** the profile-image pipeline (quarantine, type check, malware scan, metadata stripping that removes GPS), then the **sensitive (private) bucket**.
   - **Access:** downloads go through an access check: the requester side, or members of a recipient provider within their branch scope. Responses are `no-store`.
   - **Evidence:** a note and/or photos added to the history by either side. A provider's evidence is visible to the requester, never to other providers. After acceptance, the requester's evidence goes only to the accepted provider.
   - Photos aren't envelope-encrypted like identity documents (ADR-0016). They are less sensitive, and that can be added if a review asks for it.
8. **History is append-only.**
   - `service_request_events` rows are never updated or deleted; a trigger enforces it, except the cascade when a whole request is purged.
   - Each event names its side (`requester`, `provider`, `system`) and, when it concerns one provider, that provider: providers only see request-wide events and their own.
   - Every event also goes to the transactional outbox (`ServiceRequest<Type>`), ready for notifications (Prompt 17).

## Consequences

- **Fleet requests don't link to vehicle records yet.** Vehicle details are a snapshot on the request; Prompt 19 can add a `vehicle_id`.
- **Lists are capped at 50, not paginated.** That is enough for the pilot; pagination can follow ADR-0019's keyset approach.
- **Reopening on provider cancellation keeps the requester's quota and quotes,** at the cost of slightly more complex state handling (tested).
- **Retention of closed requests and their photos isn't automated yet.** The cascade is ready for a purge job (Prompt 27, privacy).

## Alternatives considered

- **Broadcasting to every matching provider:** spam risk and lead harvesting (AB-01). It is capped at 10, by relevance.
- **Showing the exact location to every recipient:** unnecessary for quoting, and riskier for the requester.
- **Provider cancellation ending the request:** the requester would have to start over and use another quota unit.

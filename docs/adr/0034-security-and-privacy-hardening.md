# ADR-0034: Security and privacy hardening — erasure by anonymisation, versioned consent, retention job, route-driven tenant penetration test, security headers everywhere

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 27 asks for:

- a threat model;
- tenant penetration tests;
- OWASP controls;
- signed uploads and malware scanning;
- PII encryption;
- consent;
- data retention;
- account deletion and export;
- abuse defences;
- secrets management;
- incident response runbooks.

The acceptance criteria: critical and high vulnerabilities are addressed or explicitly risk-accepted, and the privacy flows are tested.

Already in place before this prompt:

- **Uploads:** signed upload URLs, quarantine, ClamAV and metadata stripping (ADR-0006).
- **Encryption:** KMS envelope encryption for identity and vehicle documents.
- **Abuse controls:** rate limits, App Check, staff MFA and audit (ADR-0033).

Open items carried in:

- the Prompt 09 checks that let NULL through;
- privacy rights;
- retention beyond the document purge;
- global security headers.

## Decision

1. **Threat model and risk register** (`docs/security/threat-model.md`).
   - The model is STRIDE per component.
   - **Critical and high threats:** each one names its mitigation and evidence.
   - **Residual risks:** each has an owner and a reason. These are no database RLS, CSP `'unsafe-inline'`, a build-time `minimatch` advisory, legal review pending, no edge WAF yet, no MFA self-recovery, no email provider, and no CMEK.
2. **A tenant penetration test driven by the route table.** `test/security/tenant-pentest.e2e-spec.ts` reads every route from Nest's controller metadata.
   - **The victim:** a person with a vehicle, list, service request, quote, conversation, message and alert, plus a provider and a fleet organization.
   - **The attackers:** a stranger, and an insider who owns other organizations.
   - **The sweep:** the attackers call every private route that takes an ID with the victim's real IDs, every organization and vehicle variant included. Any 2xx fails, and so does a 429 that would hide the result.
   - **Anonymous callers** must get 401 on every private route.
   - **Allowlist:** routes that are cross-tenant by design are listed with reasons (seven: public cards, labels, a member's own block and bookmark lists, own-scoped notification updates).
   - **Coverage:** new routes are included automatically.
3. **Security headers everywhere.**
   - **API:** strict headers on every response: `default-src 'none'`, no framing, `nosniff`, `no-referrer`, `no-store`, HSTS when deployed, no `X-Powered-By`. Download routes keep their narrower CSP.
   - **Web:** a Content-Security-Policy built from the configured API and Firebase hosts. Scripts load only from the site; connections go only to the API and Firebase Auth; there is no framing. Plus HSTS, `nosniff`, Referrer-Policy and Permissions-Policy.
4. **Private photos are encrypted too.** Chat and request photos now use the same per-file AES-256-GCM envelope as documents, with the key wrapped by KMS when deployed. Older rows without a wrapped key still read as before.
5. **Account deletion is erasure by anonymisation.**
   - **Why not delete the row:** the user row is referenced by 56 restricting foreign keys and the audit log, so it becomes a tombstone: `status = deleted`, `deleted_at`, no email, name or activity, and the Firebase UID replaced. A database check enforces that a tombstone holds no personal data.
   - **What is removed:**
     - personal-only records are deleted;
     - personal vehicles and document files are removed;
     - articles are withdrawn and comments marked deleted.
   - **What is kept:** records shared with others (messages, requests, sanctions, audit) are kept, linked to the tombstone.
   - **Guards:**
     - refused while the person is an organization's only owner (409 `sole_owner`);
     - needs a recent sign-in plus `X-Confirm-Action: account.delete`;
     - suspended members may delete and export.
   - **After the database commit:** the Firebase account and stored files are deleted. Failures there are logged; the tombstone already blocks access.
6. **Export:** `GET /v1/me/export` returns one JSON document of the person's own records, with internal keys (storage keys, wrapped keys, the Firebase UID) removed. It is audited and limited to 5 a day.
7. **Consent: append-only and versioned.**
   - **Purposes:** `terms` and `privacy` are required; `analytics` and `marketing_email` are optional and off by default.
   - **Versions:** each purpose has a current version. The web and mobile gates ask until the required ones are accepted for the current version.
   - **The API refuses:** stale versions, and withdrawing a required consent (deleting the account is the way out).
   - **Audit:** every choice is audited.
   - **Legal pages:** draft terms and privacy-notice pages describe how the product actually works (OQ-17).
8. **Retention:** a daily worker job deletes delivered outbox events, old notifications, expired document links, old quota usage and stale push registrations, and runs the document purge. Each run is audited with counts. The full policy, including what is kept and why, is in `docs/security/data-retention.md`.
9. **Database fixes:** the two Prompt 09 checks now use `COALESCE`, so a missing note is refused (migration 0041, with a database test that checks the right constraint).
10. **Runbooks:** `docs/operations/incident-response.md` covers severity, roles, containment levers (pause sign-ups, auto-hide, site notice, sign out everywhere, staff role revocation), playbooks and breach notification. `docs/security/secrets-management.md` covers secrets.

## Consequences

- **Deletion maintenance:** every new table that references `users` must be added to the deletion and export lists (deleted, anonymised or kept, with a reason). A future guard test could enumerate foreign keys to enforce it.
- **Mock API in browser tests:** it treats existing test users as having accepted the terms; `fresh-…` accounts see the gate.
- **CSP and vendors:** the web CSP must be updated when a new vendor is added (map SDK, analytics). The unit tests describe the expected policy.

## Alternatives considered

- **Hard deletion with cascades:** it would erase other people's conversations and the audit trail, and breaks restricting keys.
- **Soft delete with a flag only:** it keeps personal data; that isn't erasure.
- **Nonce-based CSP:** it makes every page dynamic. Risk-accepted for now (R-02).
- **Hand-written IDOR cases per module:** they miss new routes. The route-driven sweep can't forget one.

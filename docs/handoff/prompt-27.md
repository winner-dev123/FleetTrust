# Handoff — Prompt 27: Security and privacy hardening

- Date: 2026-11-24
- Status: **approved** · merged as PR #29 → `ad7fc0d` (CI 6/6 green on `a212cba`)
- Prompt 26 approved and merged (PR #28 → `c5338d6`).

## Assumptions

- **Account deletion means erasure by anonymisation, not dropping the user row.** The row is referenced by 56 restricting keys and the audit log.
  - **Erased:** personal data.
  - **Kept, linked to an anonymous tombstone:** records shared with others (messages, provider requests, sanctions, audit).
- **Jurisdiction isn't decided (OQ-03).** Breach deadlines and retention periods follow GDPR and POPIA defaults until the owner decides.
- **Legal texts:** the terms and privacy notice are drafts that describe how the product actually works. Legal review stays an owner item (OQ-17).
- **Already in place and documented here:** signed uploads, malware scanning and document encryption (Prompt 09 / ADR-0006).

## What was built

| Area                    | Details                                                                                                                                                                                                                                                                                                                                                                                                |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Threat model            | [docs/security/threat-model.md](../security/threat-model.md): assets, trust boundaries, STRIDE, risk register (25 threats; every critical and high one mitigated with evidence), 8 accepted risks with owners, OWASP Top 10 mapping                                                                                                                                                                    |
| Tenant penetration test | `test/security/tenant-pentest.e2e-spec.ts` reads every route from the app. A stranger and an insider from other organizations call every private route that takes an ID (over 270) with a victim tenant's real IDs (person, provider, fleet; both vehicles and both organizations). Anonymous callers must get 401 on every private route. Seven cross-tenant-by-design routes are listed with reasons |
| Security headers        | API: strict headers on every response (no framing, `nosniff`, `no-referrer`, `no-store`, CSP `default-src 'none'`, HSTS when deployed, no `X-Powered-By`). Web: CSP from the configured API and Firebase hosts, plus HSTS, Referrer-Policy and Permissions-Policy                                                                                                                                      |
| Encryption              | Chat and request photos now use per-file envelope encryption (KMS when deployed), like documents                                                                                                                                                                                                                                                                                                       |
| Account deletion        | `DELETE /v1/me` (recent sign-in plus `X-Confirm-Action: account.delete`; 409 `sole_owner`): tombstone with a database check, personal records deleted, files removed, articles withdrawn, comments deleted, Firebase account deleted, audited. Web and mobile (typed DELETE; app store policy)                                                                                                         |
| Data export             | `GET /v1/me/export`: a JSON file of the person's records without internal keys; audited; 5 a day. Web download; mobile links to the web                                                                                                                                                                                                                                                                |
| Consent                 | Append-only `consents` with versions: terms and privacy required, analytics and marketing optional and off. Web and mobile gates; draft [terms](/legal/terms) and [privacy notice](/legal/privacy) pages                                                                                                                                                                                               |
| Retention               | Daily worker job (`RETENTION_INTERVAL_MS`): outbox, notifications, document links, quota usage, stale push devices, and the document purge; audited counts. [Policy](../security/data-retention.md)                                                                                                                                                                                                    |
| Database fixes          | The two Prompt 09 checks that let NULL through now use `COALESCE`, with a database test (migration 0041)                                                                                                                                                                                                                                                                                               |
| Runbooks                | [incident-response.md](../operations/incident-response.md) (severity, roles, containment levers, playbooks, breach notification) and [secrets-management.md](../security/secrets-management.md)                                                                                                                                                                                                        |
| Docs                    | [ADR-0034](../adr/0034-security-and-privacy-hardening.md), [privacy.md](../security/privacy.md) (data inventory, rights, consent)                                                                                                                                                                                                                                                                      |

## Acceptance criteria

| Criterion                                                               | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| ----------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Critical and high vulnerabilities addressed or explicitly risk-accepted | **Risk register:** every critical and high threat names its mitigation and the test or control that shows it (for example T-01 cross-tenant access → the route-driven penetration test; T-05 documents → KMS envelope encryption and single-use links). The one high item not fully closed, legal review of the texts (R-04), is risk-accepted with the owner and blocks launch. **Dependency audit:** no high or critical findings (CI gate); one moderate build-time advisory risk-accepted (R-03). **Database:** the NULL-unsafe checks are fixed.                     |
| Privacy flows tested                                                    | **API** (`test/privacy.e2e-spec.ts`, 11 tests): consent history, version and required-consent rules; export contents, no internal keys or other people's data, rate limit; deletion guards (confirmation, recent sign-in, sole owner); what is erased, withdrawn and kept; the old session dies; the same email can sign up again; photo encryption at rest; retention; headers. **Database:** tombstone and consent constraints. **Web:** consent gate, download and deletion journey (desktop and phone); CSP unit tests. **Mobile:** consent gate and in-app deletion. |

## Evidence (actual results)

- **`pnpm check`:** passes locally (prettier, module guard: 874 files, 39/39 turbo tasks).
- **Tests:**
  - API **362** (was 348): privacy 11, tenant penetration test 2, and an adapter test;
  - web 67; mobile 83; db 99 + 6 skipped; sdk 34; types 84.
- **Browser tests:** **32** pass locally (was 26): the consent, download and deletion journey, a security-headers check, and accessibility checks on the legal pages, at desktop size and on a 320 px phone. Every existing journey still passes under the new Content-Security-Policy.
- **Drift check:** no schema changes after migration 0041.
- **Checked that the tests catch regressions** (each broke the tests, then was restored):
  - **penetration test:**
    - personal vehicles open to anyone;
    - fleet vehicles open to non-members;
    - conversations open to anyone;
  - **privacy:**
    - no sole-owner check;
    - trusted contacts kept after deletion;
    - the export leaking the Firebase UID;
    - stale consent versions accepted;
    - the Firebase account not deleted;
    - read notifications kept too long;
  - **headers:**
    - no `X-Frame-Options` on the API;
    - no `frame-ancestors` in the web CSP.
- **Found and fixed while testing:**
  - The penetration test first missed fleet vehicles on `/v1/vehicles/*` routes; it now tries every matching victim ID.
  - After deleting their account, a person was sent to the sign-in page instead of home.
  - The membership route used a random ID instead of the victim's real one.

## Not built here (gaps)

- **A guard test for new user references:** check that every table referencing `users` is in the deletion and export lists (today it's a documented rule).
- **Lifecycle rule for abandoned uploads:** deleting abandoned chat, request and vault uploads in quarantine (Prompt 29 Terraform).
- **Audit log archive** after 7 years (Prompt 29).
- **Nonce-based CSP** (accepted risk R-02).
- **Mobile data export file:** the app links to the website.

## Before launch (owner)

- **Legal review** of the terms, privacy notice and emergency wording (OQ-04, OQ-17), and a privacy contact address.
- **Jurisdiction (OQ-03):** breach deadlines, minimum age, retention periods.
- **Email provider (OQ-06):** breach notifications and support email.
- **Incident contacts:** fill in the table in the incident runbook.
- **CMEK** for Cloud SQL if compliance requires it (R-08). Edge DDoS protection and WAF come with Prompt 29 (R-05).

## Next: Prompt 28 — Performance, reliability and end-to-end QA

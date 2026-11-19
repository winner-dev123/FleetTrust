# Handoff — Prompt 09: Document verification workflow

- Date: 2026-11-19
- Status: **approved** · PR **#10** squash-merged as `d0d45d6` (CI 5/5 green on `0b2ff72`)
- Prompt 08 approved and merged (PR #9 → `37ee120`). Dependabot #8 (PGlite 0.5.16, turbo 2.11.11, yaml 2.9.1) was merged after a local run of the db and API suites on top of #9.

## Assumptions

- **Badges:** driver (people); business (any organization); location (providers only). Manual human review. No KYC vendor yet; the adapter point is left open (OQ-14).
- **Evidence retention** is 90 days after the decision (OQ-14 default). Badges and metadata outlive the files.
- The pipeline runs **synchronously** on a "complete" call. It moves to a finalize-event job with the jobs runtime (ADR-0007).
- **Reviewers are platform staff** (`verification_reviewer`), granted by CLI like billing operators. Admin MFA comes in Prompt 26.
- There is no web or mobile UI for uploads yet (Prompts 24/25). The API and SDK are complete.

## What was built

| Area      | Details                                                                                                                                                                                                                                                                                                                                      |
| --------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data      | `verification_cases`, `verification_documents`, `verification_badges`, `verification_appeals`, `document_access_grants`; `verification_reviewer` platform role. DB checks: badge fits subject, one open case and one current badge per subject and type, decision and revocation reasons, one appeal per decision. Migrations `0009`, `0010` |
| Storage   | `ObjectStorage` port: Cloud Storage adapter (V4 signed PUT bound to content type and length range) and an in-memory adapter with a local-only upload route                                                                                                                                                                                   |
| Pipeline  | Quarantine → exact-size check → magic-byte type check → malware scan (ClamAV `zINSTREAM`, fail closed; EICAR-only locally) → AES-256-GCM envelope encryption (per-file key wrapped by Cloud KMS; document ID as AAD) → sensitive bucket → quarantine deleted. Rejected files deleted with the reason                                         |
| Review    | Queue, approve (expiry default 1 year, max 3) / reject / request changes, revoke. Conflict-of-interest blocks (own case, opened it, member of the org)                                                                                                                                                                                       |
| Access    | Reviewers get **one-time, five-minute** links; the API decrypts and streams with `no-store`, `nosniff`, sandbox CSP. Grant and use each audited. Applicants never get documents back; responses carry no keys, hashes or paths                                                                                                               |
| Expiry    | Expired badges vanish from labels; `reverificationDue` within 30 days; renewal cases supersede the old badge                                                                                                                                                                                                                                 |
| Appeals   | Rejected cases and revoked badges, within 30 days, once; decided by a **different** reviewer. Overturn → back to the queue / badge reinstated                                                                                                                                                                                                |
| Labels    | `GET /v1/verification/labels/{users\|organizations}/:id`: verified/unverified per badge type, no reasons                                                                                                                                                                                                                                     |
| Retention | Purge after 90 days (and abandoned uploads after 1 day); on-demand endpoint until jobs exist; quarantine lifecycle rule documented                                                                                                                                                                                                           |
| Config    | New env vars with deployed-environment guards: `gcs` + `kms` + `clamav` required, local key refused. Cloud Run template and staging workflow updated                                                                                                                                                                                         |
| SDK       | Case, document, appeal, badge and label methods; verification error reasons                                                                                                                                                                                                                                                                  |
| Docs      | [ADR-0016](../adr/0016-verification-documents.md), [architecture/verification.md](../architecture/verification.md) (lifecycle, labels, API), [operations/verification.md](../operations/verification.md) (buckets, KMS, ClamAV, IAM, staging checks)                                                                                         |

## Acceptance criteria

| Criterion                              | Evidence                                                                                                                                                                                                                                                                                                                                                             |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unverified vs verified labels accurate | `verification.e2e-spec.ts`: unverified with no case, while pending, after rejection, after expiry and after revocation; verified only after approval and only until expiry; labels never contain reasons. Two identical providers, one on Provider Pro: identical labels, no review shortcut (ADR-0009)                                                              |
| Admin decisions audited                | Changes requested, approval (badge granted), rejection, revocation and appeal decisions are recorded with actor type `admin` and the reviewer's ID; asserted. Rejections and change requests require a reason (400 without)                                                                                                                                          |
| Access tests pass                      | Strangers and org staff → 404 on cases; org cases need `verification.manage` (403 for staff); non-reviewers and billing operators → 404 on the reviewer API; conflict of interest → 403; document links single-use (second fetch 410), expire (410), audited twice (granted + accessed); the applicant view contains no keys, hashes or paths                        |
| Pipeline security                      | Stored bytes ≠ plaintext and don't contain `%PDF`; quarantine emptied; EICAR → `malware_detected`; PDF declared as PNG → `content_type_mismatch`; size mismatch rejected; upload links single-use and content-type bound. Unit tests: GCM tamper/AAD-swap/wrong-key all fail, KMS wrapper fails closed, clamd protocol (clean, found, garbage, dropped, unreachable) |

## Evidence (actual results)

| Check                             | Result                                                                                                                                                                                                                  |
| --------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check`   | **Pass**: format, module guard, 39/39 turbo tasks. Tests: api **153** (+28: 17 verification e2e, 10 crypto/scanning unit, 1 env), db 63, sdk **16** (+1), web 18, local-infra 44, repo-guards 22, ui 22, env 5, types 3 |
| Schema drift                      | "No schema changes"                                                                                                                                                                                                     |
| Cloud Storage adapter vs emulator | New `gcs-storage.int-spec.ts` runs in CI's `local-infra` job (`STORAGE_EMULATOR_HOST` added); not runnable locally without Java                                                                                         |
| Not testable here                 | V4 signature enforcement, real KMS and real clamd. The staging checklist is in [operations/verification.md](../operations/verification.md#checks-after-deploying-to-staging-signed-urls-cant-be-tested-locally)         |

## Decisions and notes

- **Proxy, not signed GET, for reviewer viewing.** The object is ciphertext, so a direct signed URL can't serve it. Proxying also gives single use and per-view audit.
- **Location badge for providers only.** Fleets get `business` (employer verification in Prompt 22 builds on it).
- **After an overturned rejection, the case goes back to the queue.** The original decision is kept in the audit log. Excluding the original reviewer from the re-review is not enforced yet (Prompt 26 four-eyes).
- **Migration notes:** `0009` adds five tables and widens `platform_staff_role_valid` to include `verification_reviewer`. Safe on existing data. `0010` adds `updated_at` triggers.
- New dependencies: `@google-cloud/storage` 8.4.0 and `google-auth-library` 11.3.4, both already in the lockfile via firebase-admin, now explicit.

## Before production (owner)

- Answer OQ-14 (accepted evidence per badge, retention period, KYC vendor) and OQ-15 (ClamAV vs scanning API; the ClamAV adapter is ready).
- Create the buckets, KMS key, ClamAV service and IAM bindings ([setup](../operations/verification.md#one-time-google-cloud-setup-per-environment)), and set the five staging variables.
- Grant reviewers: `pnpm db:staff grant <email> verification_reviewer`.

## Next: Prompt 10 — Provider profile onboarding

Public provider profiles (draft → preview → publish), labelled "Unverified" until a business badge exists, with contact details, hours and photos via the public-media pipeline.

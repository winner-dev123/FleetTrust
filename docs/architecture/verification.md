# Verification and badges

Evidence-based badges (SRS §8, F-020..F-023): **driver** for people, and **business** and **location** for organizations (location for providers only). Design: [ADR-0016](../adr/0016-verification-documents.md), storage [ADR-0006](../adr/0006-object-storage-and-private-documents.md). Plans never affect any of it ([ADR-0009](../adr/0009-trust-independent-of-payment.md)). Lint forbids this module from importing entitlements.

## Case lifecycle

```
draft ──submit──▶ submitted ──approve──▶ approved  (badge granted, expires)
  ▲                 │  │
  │   request_changes│  └──reject──▶ rejected ──appeal──▶ (different reviewer)
  └── changes_requested                                 overturn → submitted again
withdraw: from draft / submitted / changes_requested
```

- One open case per subject and badge type.
- **Renewal:** when a badge has 30 days or fewer left, opening a case links it to the badge (`renewsBadgeId`). Approving it supersedes the old badge. Earlier attempts get 409 `renewal_not_due`.
- **Badges:** default 1 year, at most 3. A reviewer can revoke one with a reason, and the holder can appeal within 30 days. An overturned revocation reinstates the badge until its original expiry.

## What labels mean

| Label      | Shown when                                                                         | Never implies                         |
| ---------- | ---------------------------------------------------------------------------------- | ------------------------------------- |
| Verified   | An unrevoked badge whose expiry is in the future                                   | Safety, insurance, quality (SRS §8.1) |
| Unverified | Everything else: no case, pending, changes requested, rejected, expired or revoked | That the subject is untrustworthy     |

`GET /v1/verification/labels/{users|organizations}/:id` returns only `badgeType`, `status` and `expiresAt`. It never includes reasons, case state or document details.

## Applicant API

| Method & path                                                | Who                                       | Notes                                                                                                                 |
| ------------------------------------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/me/verification/cases`                             | signed in                                 | `{ badgeType: "driver" }`                                                                                             |
| `POST /v1/orgs/:orgId/verification/cases`                    | `verification.manage` (owner, admin)      | `{ badgeType: "business" \| "location" }`                                                                             |
| `GET /v1/me/verification/{cases,badges}`                     | signed in                                 |                                                                                                                       |
| `GET /v1/orgs/:orgId/verification/cases` / `badges`          | `verification.manage` / any member        |                                                                                                                       |
| `GET /v1/verification/cases/:caseId`                         | the person, or `verification.manage`      | Others get 404                                                                                                        |
| `POST /v1/verification/cases/:caseId/documents`              | same                                      | `{ kind, contentType, size }` → `{ document, upload: { url, method: "PUT", headers, expiresAt } }`                    |
| `PUT <upload.url>`                                           | anyone holding the URL (15 min, one file) | Send exactly `upload.headers`                                                                                         |
| `POST /v1/verification/cases/:caseId/documents/:id/complete` | same                                      | Checks size and real type, scans, encrypts. 400 `malware_detected` / `content_type_mismatch` / `upload_size_mismatch` |
| `POST /v1/verification/cases/:caseId/submit` / `withdraw`    | same                                      | Submit needs ≥ 1 available document (409 `no_documents`)                                                              |
| `POST /v1/verification/cases/:caseId/appeal`                 | same                                      | `{ statement }`, within 30 days of a rejection, once                                                                  |
| `POST /v1/verification/badges/:badgeId/appeal`               | same                                      | Within 30 days of a revocation, once                                                                                  |

Accepted files: PDF, JPEG, PNG, WebP, HEIC; up to 10 MB each and 10 per case. Kinds: `identity_document`, `driving_licence`, `business_registration`, `proof_of_address`, `other`. **Applicants can't download documents.**

## Reviewer API (`verification_reviewer` role; 404 for everyone else)

| Method & path                                              | Notes                                                                                                   |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| `GET /v1/admin/verification/cases?status=submitted`        | Queue, oldest first. Includes each document's SHA-256 and scan result                                   |
| `GET /v1/admin/verification/cases/:caseId`                 |                                                                                                         |
| `POST /v1/admin/verification/cases/:caseId/decision`       | `{ decision: "approve", expiresAt? }` · `{ decision: "reject" \| "request_changes", reason }`           |
| `POST /v1/admin/verification/documents/:documentId/access` | → `{ url, expiresAt }`: one-time, 5 minutes, audited. Open it in the browser                            |
| `POST /v1/admin/verification/badges/:badgeId/revoke`       | `{ reason }`                                                                                            |
| `GET /v1/admin/verification/appeals?status=open`           | Includes `originalDecidedBy`                                                                            |
| `POST /v1/admin/verification/appeals/:appealId/decision`   | `{ decision: "uphold" \| "overturn", reason }`. Must be a different reviewer than the original decision |
| `POST /v1/admin/verification/purge`                        | Applies the retention policy now                                                                        |

**Conflict of interest:** 403 `conflict_of_interest` if the reviewer is the applicant, opened the case, or belongs to the organization.

Grant the role with `pnpm db:staff grant <email> verification_reviewer`. Reviewers can't change plans; billing operators can't review.

## Audit events

`verification.case_opened`, `document_added`, `document_available`, `document_rejected`, `case_submitted`, `case_withdrawn`, `changes_requested`, `case_rejected`, `badge_granted`, `badge_revoked`, `appeal_filed`, `appeal_upheld`, `appeal_overturned`, `document_access_granted`, `document_accessed`, `documents_purged`. Reviewer actions use actor type `admin`. No document content, tokens or URLs are ever logged.

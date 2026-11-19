# ADR-0016: Verification documents — pipeline, encryption and reviewer access

- Status: Accepted
- Date: 2026-11-19
- Refines: [ADR-0006](0006-object-storage-and-private-documents.md) (object storage), [ADR-0012](0012-local-storage-emulation.md) (local storage)

## Context

Verification evidence (identity documents, licences, business registrations, proof of address) is the most sensitive data on the platform. SRS FR-08 requires private storage, encryption, short-lived access for authorised reviewers only, and an audit of every access. AB-02 (forged documents) and AB-11 (insider abuse) apply. Prompt 09 has to make ADR-0006's pipeline concrete before the jobs runtime (ADR-0007) exists.

## Decision

1. **Upload pipeline:**
   1. The API registers a document and returns a **15-minute V4 signed PUT URL** into the **quarantine** bucket. The URL is bound to the declared content type and to a `x-goog-content-length-range` of at most the declared size (10 MB cap).
   2. The client uploads, then calls `…/documents/:id/complete`. The API checks that the object exists with exactly the declared size.
   3. It **sniffs the real type** from magic bytes (PDF, JPEG, PNG, WebP, HEIC only). HTML or SVG disguised as a PDF is rejected.
   4. It **scans** through the `MalwareScanner` port (ClamAV `zINSTREAM`, failing closed).
   5. It **encrypts** and writes to the **sensitive** bucket, then deletes the quarantine object. Rejected files are deleted, with the reason recorded (`infected:<signature>`, `type_mismatch`, `size_mismatch`).

   This runs **synchronously** in the complete call. It moves to a job triggered by the storage finalize event when the jobs runtime lands; the stages and their tests stay the same.

2. **Envelope encryption on top of Google's default encryption:** AES-256-GCM with a random 256-bit data key per file. The **document ID is the AAD**, so swapping two objects makes decryption fail. The data key is wrapped by **Cloud KMS** (REST `encrypt`/`decrypt` as the runtime service account). Wrapped key, IV and tag live in the database row; ciphertext lives in the bucket. Neither alone reveals anything.
3. **Applicants never get documents back.** API responses carry metadata only (kind, status, detected type, size). Storage paths, keys and hashes are never returned to them. Object names are random UUIDs, so no personal data appears in paths.
4. **Reviewer access is a one-time, five-minute link.** It is issued only to the `verification_reviewer` platform role, and the token is stored hashed. The API decrypts and streams the file with `Cache-Control: no-store`, `nosniff`, a sandboxing CSP and `no-referrer`. A link can't be replayed after use or expiry. **Issuance and use are each audited.** A signed URL straight to the bucket can't work, because the object is ciphertext; proxying through the API is also what makes single use and audit possible.
5. **Conflict-of-interest rules (AB-11):** reviewers can't act on their own case, a case they opened, or an organization they belong to. **Appeals are decided by a different reviewer** than the one who made the original decision.
6. **Labels come from active badges only.** "Verified" requires an unrevoked, unexpired badge. Pending, rejected, expired and revoked all show as "Unverified", with no reasons exposed. Badges expire (default 1 year, at most 3). Renewal opens within 30 days of expiry, and an approved renewal supersedes the old badge.
7. **Retention:** documents are purged 90 days after the decision (OQ-14 default, `VERIFICATION_DOCUMENT_RETENTION_DAYS`). Abandoned uploads are purged after 1 day. Metadata and badges stay. The purge runs on demand (`POST /v1/admin/verification/purge`) until the jobs runtime schedules it daily. A lifecycle rule on the quarantine bucket deletes objects older than 1 day as a backstop.
8. **Local development** uses an in-memory storage adapter. Its upload URLs point at a local-only `PUT /v1/local-storage/:token` route with the same constraints (one use, exact type, size cap, expiry). The local key wrapper and an EICAR-only scanner complete the stack. Env validation refuses all three in staging and production. The Cloud Storage adapter's read/write/delete is tested against the Firebase Storage emulator in CI. Signed URLs are verified against the staging bucket ([operations/verification.md](../operations/verification.md)).

## Consequences

- A reviewer viewing a document costs one KMS decrypt and one bucket read through the API. That is fine at review volumes.
- The 10 MB cap and synchronous processing keep the complete call within a few seconds. Larger files would need the job-based pipeline.
- Forged-but-clean documents remain a human-review problem (AB-02). Expiry, reverification, revocation and appeals limit the damage. A KYC vendor can plug in later behind an adapter (OQ-14).

## Alternatives considered

- **Client-side upload via Firebase Storage rules:** rejected in ADR-0006.
- **Customer-managed encryption keys (CMEK) on the bucket only:** simpler, but anyone with bucket read access, or a mis-scoped signed URL, would get plaintext. Envelope encryption keeps the database and KMS in the loop for every read.
- **Signed GET URLs to decrypted temporary copies:** writes plaintext to storage, and can't enforce single use. Rejected.

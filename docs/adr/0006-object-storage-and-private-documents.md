# ADR-0006: Object storage and private documents

- Status: Accepted
- Date: 2026-11-19

## Context

The platform stores several kinds of files:

- Public media: provider photos, article images.
- Semi-private files: service request photos, which only the participants should see.
- Highly sensitive files: identity documents and vehicle documents.

The pack asks for S3-compatible storage. The platform decision ([ADR-0004](0004-firebase-hybrid-platform.md)) is Google Cloud / Firebase.

## Decision

- An `ObjectStorage` port in the API with operations such as `createUploadUrl`, `createDownloadUrl`, `head`, `copy` and `delete`. The production adapter uses the **Cloud Storage** client with the service account's IAM identity, so there are no long-lived HMAC keys.
- **Buckets per sensitivity class:**

  | Bucket           | Contents                                 | Client access                                                                                                                             |
  | ---------------- | ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
  | `*-public-media` | Published, scanned, EXIF-stripped images | Read via CDN/public URL after release                                                                                                     |
  | `*-private`      | Request photos, vehicle documents        | Short-lived V4 signed URLs issued by the API after an authorization check                                                                 |
  | `*-sensitive`    | Identity and verification evidence       | Signed URLs for authorised reviewers only; every issuance audited; app-level envelope encryption (Cloud KMS) on top of default encryption |
  | `*-quarantine`   | All uploads land here first              | Upload-only signed URL; moved after the malware scan passes                                                                               |

- **Firebase Storage security rules deny all direct client reads and writes.** Clients use only API-issued signed URLs. This keeps authorization in one place ([ADR-0005](0005-authn-firebase-authz-api.md)).
- Upload pipeline:
  1. Signed upload to quarantine, with content type and size constraints.
  2. A finalize event triggers the job.
  3. Malware scan through a scanner port ([OQ-15](../product/open-questions.md)).
  4. MIME sniffing, EXIF stripping for images.
  5. Move to the destination bucket, then mark the file record available.
- Local development uses the **Firebase Storage emulator** (or `fake-gcs-server` if signed-URL behaviour needs closer parity). This is decided in Prompt 03.

## Consequences

- This deviates from the pack's "S3-compatible" wording. The port abstraction keeps an S3 adapter possible (for example GCS XML interop or MinIO) without changing domain code.
- Signed URLs must have short expiry (minutes) and are never logged.
- The pipeline adds latency before an upload becomes visible; the UI shows a "processing" state.

## Alternatives considered

- **Client SDK uploads governed by Storage rules**: rejected. It duplicates authorization logic in rules language.
- **MinIO in production**: rejected. Self-managed storage conflicts with "prefer managed infrastructure".

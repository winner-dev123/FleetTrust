# ADR-0012: Local object storage uses the Firebase Storage emulator

- Status: Accepted (revisit in Prompt 09)
- Date: 2026-11-19
- Refines: [ADR-0006](0006-object-storage-and-private-documents.md) ("decided in Prompt 03")

## Context

The prompt pack asks for "S3-compatible local object storage" such as MinIO. Production storage is Cloud Storage for Firebase ([ADR-0004](0004-firebase-hybrid-platform.md), [ADR-0006](0006-object-storage-and-private-documents.md)). The local stand-in should behave like production where it matters: the Cloud Storage API shape, and deny-by-default security rules.

Three options:

1. **MinIO** (S3 API). Wrong API: the production adapter uses the Cloud Storage client, so MinIO would need a second adapter that production never exercises.
2. **fake-gcs-server** (a container speaking the Cloud Storage JSON API). Close API parity and can publish object events to a Pub/Sub emulator, but it doesn't evaluate Firebase security rules.
3. **Firebase Storage emulator.** Speaks the Firebase/Cloud Storage APIs used by the Admin SDK, **enforces `storage.rules`**, runs alongside the Auth emulator in one command, and needs no extra container.

## Decision

- Use the **Firebase Storage emulator** (`pnpm emulators`, port 9199) for local development and CI integration tests.
- `infra/firebase/storage.rules` is the same deny-all rules file deployed to production, so rule behaviour is exercised locally.
- No S3-compatible service runs locally. The `ObjectStorage` port keeps an S3 adapter possible later, as ADR-0006 notes.

## Consequences

- **Signed URLs aren't verified locally.** The emulator doesn't check V4 signatures, and generating real signatures needs Google credentials. The local `ObjectStorage` adapter (Prompt 09) will return emulator URLs. Signature behaviour, expiry and IAM signing must be covered by integration tests against the **staging** bucket (Prompt 05/09).
- **Finalize events** (upload → malware scan) aren't emitted to Pub/Sub by the emulator. Prompt 09 must either trigger the scan pipeline explicitly in local mode or switch to fake-gcs-server plus the Pub/Sub emulator. Revisit then.
- Running the emulators requires **Java 21+** (`firebase-tools` 15).

## Alternatives considered

MinIO and fake-gcs-server, as above.

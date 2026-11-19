# ADR-0004: Firebase hybrid platform on Google Cloud

- Status: Accepted (owner decision, 2026-11-19)
- Date: 2026-11-19

## Context

The owner asked to use Firebase because the product includes a mobile app. The prompt pack's global stack is PostgreSQL/PostGIS, Redis, S3-compatible storage, queues and OpenTelemetry. Three options were presented:

- Firebase-only (Firestore and Functions).
- **Hybrid**.
- Firebase for mobile only.

The owner chose **hybrid**. This also settles the previously open "deployment provider" question: **Google Cloud**.

## Decision

| Concern                             | Service                                                                                                                                              |
| ----------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| End-user authentication             | **Firebase Authentication**: email link, Google, Apple. Upgraded to **Identity Platform** for admin MFA ([OQ-12](../product/open-questions.md))      |
| Push notifications                  | **Firebase Cloud Messaging (FCM)** for iOS (via APNs), Android and web                                                                               |
| File storage                        | **Cloud Storage for Firebase** buckets ([ADR-0006](0006-object-storage-and-private-documents.md))                                                    |
| Mobile crash reporting              | **Firebase Crashlytics**                                                                                                                             |
| Client attestation / anti-abuse     | **Firebase App Check**: Play Integrity on Android, App Attest on iOS, reCAPTCHA Enterprise on web. Enforced on the API by verifying App Check tokens |
| Product analytics                   | **Google Analytics for Firebase**, **opt-in only** after consent, with no PII in events                                                              |
| Email-link landing domain           | **Firebase Hosting** (required for email-link sign-in after the Dynamic Links shutdown)                                                              |
| Web hosting (Next.js)               | **Firebase App Hosting** (runs on Cloud Run). Fallback: Cloud Run directly                                                                           |
| API and workers                     | **Cloud Run** ([ADR-0002](0002-modular-monolith-api.md))                                                                                             |
| Database                            | **Cloud SQL for PostgreSQL + PostGIS** ([ADR-0003](0003-postgresql-postgis-system-of-record.md))                                                     |
| Cache, rate limits, pub/sub fan-out | **Memorystore for Redis**                                                                                                                            |
| Jobs                                | **Cloud Tasks / Pub/Sub** ([ADR-0007](0007-jobs-and-realtime.md))                                                                                    |
| Secrets                             | **Secret Manager**                                                                                                                                   |
| Observability                       | OpenTelemetry → **Cloud Trace / Cloud Logging / Cloud Monitoring**. Error monitoring behind an adapter                                               |
| Infrastructure as code              | **Terraform** (Google and Google-beta providers cover Firebase resources)                                                                            |
| Local development                   | **Firebase Local Emulator Suite** (Auth, Storage, Hosting) plus Docker Compose (Postgres/PostGIS, Redis, Mailpit)                                    |

### Firebase products deliberately **not** used

| Product                                          | Why not                                                                                                                                                                                                                               |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Firestore / Realtime Database                    | System of record is Postgres (ADR-0003). Two sources of truth would split authorization                                                                                                                                               |
| Cloud Functions for business logic               | Modular monolith (ADR-0002). Allowed only for Identity Platform blocking functions                                                                                                                                                    |
| Remote Config for entitlements or feature gating | Entitlements and feature config must be server-side, audited and tenant-aware. Remote Config may be used only for non-sensitive client settings such as a minimum supported app version. It must never gate future modules (ADR-0011) |
| Firebase Dynamic Links                           | Shut down                                                                                                                                                                                                                             |

## Consequences

- **Vendor coupling** is concentrated in adapters:
  - `AuthVerifier` (Firebase Admin SDK)
  - `PushSender` (FCM)
  - `ObjectStorage` (GCS)
  - `AppCheckVerifier`

  The domain code depends only on these interfaces, so swapping a vendor touches one adapter.

- The pack's "S3-compatible object storage" is satisfied by an `ObjectStorage` port; the production adapter is GCS. See ADR-0006.
- Mobile uses `@react-native-firebase/*`, which needs native modules. That means Expo **dev builds** (not Expo Go) or bare React Native ([OQ-20](../product/open-questions.md)).
- Two Firebase/GCP projects at minimum: `fleettrust-staging` and `fleettrust-prod`. Local development uses the emulators with a `demo-` project ID so it can never touch live resources.
- Firebase Auth user records aren't region-pinned ([OQ-01](../product/open-questions.md)). Keep only the minimum there.

## Alternatives considered

- **Firebase-only**: rejected. Geospatial corridor search, relational RBAC and atomic cross-entity quotas would be weakened.
- **Firebase for mobile only**: rejected by the owner in favour of a single Google Cloud platform.

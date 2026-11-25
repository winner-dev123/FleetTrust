# Secrets management

## Rules

1. **Secrets live in Google Secret Manager.** Cloud Run mounts them as environment variables, read by the service account of each role (api, worker). They are never stored in the repository, images or build logs.
2. **Prefer no secret at all.** Workload Identity Federation for CI and deploys (no service-account JSON keys); Cloud KMS for document keys (the key never leaves KMS); Firebase Admin uses the runtime service account.
3. **Public values are public.** Anything named `NEXT_PUBLIC_*` or `EXPO_PUBLIC_*` is inlined into client bundles. It must never hold a secret; the Firebase web API key is an identifier, not a secret, and App Check protects the API.
4. **Unsafe configurations are refused when deployed.** API config validation refuses, in staging and production:
   - the Auth emulator;
   - in-memory storage;
   - EICAR-only malware scanning;
   - the local document key;
   - log-only push;
   - App Check not enforced (production);
   - `ADMIN_MFA=off`.
5. **Firebase config files for mobile** (`google-services.json`, `GoogleService-Info.plist`) are EAS file secrets, ignored by git.

## Inventory

| Secret                                                              | Used by         | Where                 | Rotation                                                         |
| ------------------------------------------------------------------- | --------------- | --------------------- | ---------------------------------------------------------------- |
| Database password (`DATABASE_URL`)                                  | api, worker     | Secret Manager        | 90 days, or immediately after a suspected leak                   |
| Redis AUTH (`REDIS_URL`)                                            | api, worker     | Secret Manager        | 90 days                                                          |
| ClamAV host (internal; no secret)                                   | api             | env                   | n/a                                                              |
| Document key (`DOCUMENT_KMS_KEY`, a KMS key name, not key material) | api             | env; key in Cloud KMS | KMS automatic rotation, yearly; old versions kept for decryption |
| Email provider API key (OQ-06)                                      | api, worker     | Secret Manager        | per provider policy                                              |
| App Check debug tokens                                              | dev builds only | Firebase console      | revoke when a developer leaves                                   |

## Detection

- **CI** runs gitleaks over the full history on every push (job "Dependency audit and secret scan").
- **Repository guard:** `.env*` files are git-ignored (except `.env.example`); pushes are checked for staged secrets.
- **Logs** are redacted: tokens, authorization headers and known secret fields (`observability/redact.ts`).

## If a secret leaks

Follow the incident runbook ([incident-response.md](../operations/incident-response.md), playbook "Leaked secret"):

1. Rotate first.
2. Then revoke the old value.
3. Then check the audit log and access logs for use.

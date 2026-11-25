# Operating verification documents

Setup and checks for the document pipeline ([ADR-0016](../adr/0016-verification-documents.md)). The API refuses to start in staging or production unless real storage, Cloud KMS and ClamAV are configured.

## Configuration

| Variable                               | Staging / production                                                         | Local default                         |
| -------------------------------------- | ---------------------------------------------------------------------------- | ------------------------------------- |
| `STORAGE_DRIVER`                       | `gcs` (required)                                                             | `memory`                              |
| `STORAGE_QUARANTINE_BUCKET`            | e.g. `fleettrust-stg-quarantine`                                             | —                                     |
| `STORAGE_PUBLIC_MEDIA_BUCKET`          | e.g. `fleettrust-stg-public-media` (profile images, publicly readable)       | —                                     |
| `PUBLIC_MEDIA_BASE_URL`                | optional CDN origin in front of the public media bucket                      | storage.googleapis.com                |
| `STORAGE_SENSITIVE_BUCKET`             | e.g. `fleettrust-stg-sensitive`                                              | —                                     |
| `DOCUMENT_KEY_PROVIDER`                | `kms` (required)                                                             | `local`                               |
| `DOCUMENT_KMS_KEY`                     | `projects/<p>/locations/<region>/keyRings/documents/cryptoKeys/verification` | —                                     |
| `DOCUMENT_LOCAL_KEK`                   | **must not be set**                                                          | optional; random per process if unset |
| `MALWARE_SCANNER`                      | `clamav` (required)                                                          | `eicar-only`                          |
| `CLAMAV_HOST` / `CLAMAV_PORT`          | internal clamd host, port 3310                                               | —                                     |
| `PUBLIC_API_URL`                       | the API's public origin (reviewer links point here)                          | `http://localhost:8080`               |
| `VERIFICATION_DOCUMENT_RETENTION_DAYS` | 90 until OQ-14 is answered                                                   | 90                                    |

The staging workflow reads these from repository variables: `STAGING_PUBLIC_API_URL`, `STAGING_QUARANTINE_BUCKET`, `STAGING_SENSITIVE_BUCKET`, `STAGING_PUBLIC_MEDIA_BUCKET`, `STAGING_DOCUMENT_KMS_KEY` and `STAGING_CLAMAV_HOST`.

## One-time Google Cloud setup (per environment)

```sh
REGION=europe-west1   # OQ-02
PROJECT=fleettrust-stg
API_SA=fleettrust-api@$PROJECT.iam.gserviceaccount.com

# Buckets: uniform access, public access prevention, no versioning for quarantine.
gcloud storage buckets create gs://$PROJECT-quarantine --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention
gcloud storage buckets create gs://$PROJECT-sensitive --location=$REGION \
  --uniform-bucket-level-access --public-access-prevention
# Backstop: anything left in quarantine for a day is deleted.
gcloud storage buckets update gs://$PROJECT-quarantine --lifecycle-file=- <<'EOF'
{"rule":[{"action":{"type":"Delete"},"condition":{"age":1}}]}
EOF
# Browsers PUT straight to the quarantine bucket.
gcloud storage buckets update gs://$PROJECT-quarantine --cors-file=- <<'EOF'
[{"origin":["https://app.example.com"],"method":["PUT"],"responseHeader":["Content-Type","x-goog-content-length-range"],"maxAgeSeconds":600}]
EOF

# Public media (provider profile images): world-readable objects, no listing.
gcloud storage buckets create gs://$PROJECT-public-media --location=$REGION --uniform-bucket-level-access
gcloud storage buckets add-iam-policy-binding gs://$PROJECT-public-media \
  --member=allUsers --role=roles/storage.legacyObjectReader

# The API may read/write all three buckets and sign URLs as itself.
for b in quarantine sensitive public-media; do
  gcloud storage buckets add-iam-policy-binding gs://$PROJECT-$b \
    --member=serviceAccount:$API_SA --role=roles/storage.objectAdmin
done
gcloud iam service-accounts add-iam-policy-binding $API_SA \
  --member=serviceAccount:$API_SA --role=roles/iam.serviceAccountTokenCreator  # V4 signing via signBlob

# Key-encryption key (HSM-backed), rotated yearly. Old versions stay enabled to unwrap old files.
gcloud kms keyrings create documents --location=$REGION
gcloud kms keys create verification --keyring=documents --location=$REGION \
  --purpose=encryption --protection-level=hsm --rotation-period=365d \
  --next-rotation-time=$(date -u -d '+365 days' +%Y-%m-%dT%H:%M:%SZ)
gcloud kms keys add-iam-policy-binding verification --keyring=documents --location=$REGION \
  --member=serviceAccount:$API_SA --role=roles/cloudkms.cryptoKeyEncrypterDecrypter
```

**ClamAV:** the official `clamav/clamav` image runs on a small internal VM created by Terraform ([clamav.tf](../../infra/terraform/modules/fleettrust/clamav.tf)); the API reaches it over Direct VPC egress. It can't be a Cloud Run service: clamd speaks its own TCP protocol on port 3310, and Cloud Run only serves HTTP, gRPC and WebSockets. It needs about 3 GB of memory for the signature database. `freshclam` keeps signatures current. If clamd is unreachable, uploads stay in quarantine and the complete call fails (fail closed). Monitor its error rate.

## Granting reviewers

```sh
pnpm db:staff grant reviewer@example.com verification_reviewer
```

Keep the group small. Reviewers can't approve their own cases or their organizations' cases, and appeals need a second reviewer. Admin MFA arrives with Prompt 26 (OQ-12).

## Checks after deploying to staging (signed URLs can't be tested locally)

1. Open a driver case, add a PDF, and `curl -X PUT` the file to `upload.url` with the returned headers. Expect 200.
2. PUT the same URL again with a different `Content-Type`. Expect 403 (signature mismatch). PUT a file larger than the declared size. Expect 400 (length range).
3. Complete the upload. In the sensitive bucket, the object must not start with `%PDF` (it is ciphertext). The quarantine object must be gone.
4. Upload the EICAR test file. Expect `malware_detected`, which proves clamd is wired.
5. As a reviewer, request access and open the link: the document displays. Reload: 410. Check that the audit log has `document_access_granted` and `document_accessed`.

## Retention

Until the jobs runtime schedules it, a reviewer runs `POST /v1/admin/verification/purge` daily. It deletes evidence 90 days after a decision and abandoned uploads after 1 day, and records `verification.documents_purged`.

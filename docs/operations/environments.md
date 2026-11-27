# Environments

FleetTrust runs in three kinds of environment. Each deployed environment is a separate Google Cloud project, with its own Firebase project, database, keys and data ([ADR-0036](../adr/0036-staging-production-and-launch.md)).

| Environment | Where                                                          | Data                                                    | Who deploys                                                                                               |
| ----------- | -------------------------------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Local / CI  | Laptop (Docker Compose + Firebase emulators) or GitHub Actions | Generated test data only                                | Anyone                                                                                                    |
| Staging     | Project `fleettrust-staging-eu1`, region `europe-west1`        | Test accounts and test data; **never real users' data** | Automatically on every merge to `main` ([deploy-staging.yml](../../.github/workflows/deploy-staging.yml)) |
| Production  | Project `fleettrust-production`, region `europe-west1`         | Real users                                              | A person, with approval ([deploy-production.yml](../../.github/workflows/deploy-production.yml))          |

**Region:** `europe-west1` (Belgium), the owner's decision for Prompt 29 (OQ-02, GDPR). It is a single Terraform variable.

**How the environments are kept apart:**

- **Projects and accounts:** separate projects, so separate IAM, billing reports, quotas and audit logs. A credential for staging can't touch production.
- **Deploy access:** the Workload Identity Federation condition only lets `main` deploy to staging, and only jobs in the protected GitHub environment `production` deploy to production. Nobody holds a JSON key.
- **Firebase:** separate Firebase projects, so staging accounts don't exist in production.
- **Configuration:** the API refuses to start in staging or production without a database, real storage, KMS and ClamAV. Redis is optional ([ADR-0037](../adr/0037-low-cost-hosting.md)). Production additionally requires App Check `enforce` and a map tile URL ([env.ts](../../apps/api/src/config/env.ts)).
- **Promotion:** production runs the image that was tested on staging (same digest), copied from the staging registry. It is never rebuilt.

## What Terraform manages

[infra/terraform](../../infra/terraform) has one module and two roots, `environments/staging` and `environments/production`. CI checks the formatting and runs `terraform validate` on both, with no cloud credentials. Terraform manages everything except the Cloud Run services, which every release deploys from [deploy/cloudrun](../../deploy/cloudrun) (so releasing never needs a Terraform apply):

| Area       | Resources                                                                                                                                                                                                                                                                                                             |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data       | Only with `database_provider = "cloudsql"`: Cloud SQL PostgreSQL 17 with point-in-time recovery, 14 daily backups and TLS only (highly available in production). Only with `redis_provider = "memorystore"`: Memorystore Redis with AUTH. The low-cost default uses Neon and no Redis, which Terraform doesn't create |
| Secrets    | Secret Manager `fleettrust-database-url` and (with Redis) `fleettrust-redis-url`, readable only by the runtime identity. Terraform writes the values for Cloud SQL and Memorystore; for Neon or Upstash you add them by hand (setup step 5)                                                                           |
| Storage    | Buckets `<project>-quarantine` (abandoned uploads deleted after 1 day), `-sensitive` (versioned, 7-day soft delete) and `-public-media`; KMS key `documents` (rotated every 90 days, protected from deletion)                                                                                                         |
| Network    | VPC and subnet for Cloud Run Direct VPC egress, Cloud NAT, and the ClamAV VM (internal address, port 3310 open to the Cloud Run subnet only)                                                                                                                                                                          |
| Identities | `fleettrust-runtime` (API, worker, migrations), `fleettrust-clamav`, `github-deployer` (keyless from GitHub)                                                                                                                                                                                                          |
| Edge       | With `api_domain`: HTTPS load balancer, managed certificate, TLS 1.2+, HTTP→HTTPS redirect, Cloud Armor ([dns-tls.md](dns-tls.md))                                                                                                                                                                                    |
| Monitoring | Alert email channel; alerts for API 5xx, p95 latency, load shedding, emergency delivery failures, Cloud SQL CPU and disk (with Cloud SQL), uptime; uptime checks; monthly budget alert                                                                                                                                |
| Registry   | Artifact Registry `fleettrust`, keeping the last 20 images (enough to roll back)                                                                                                                                                                                                                                      |

## Sizing and cost (OQ-07)

FleetTrust uses the **low-cost setup** ([ADR-0037](../adr/0037-low-cost-hosting.md)): the owner pays only for Vercel, domains and the Firebase Blaze plan, so nothing may have a fixed monthly fee.

| Item            | Low-cost setup (default, staging and production)                                                         | Cost at pilot size                     |
| --------------- | -------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Website         | Vercel project, root `apps/web` ([vercel.json](../../apps/web/vercel.json)), functions in `cdg1`         | Vercel plan (already paid)             |
| API             | Cloud Run, 0–4 instances (staging), 0–10 (production); scales to zero                                    | Usually within Cloud Run's free tier   |
| Database        | Neon free plan, Postgres with PostGIS, European region                                                   | Free (watch storage and compute hours) |
| Redis           | None; add Upstash's free plan when the API often runs more than one instance                             | Free                                   |
| Storage, KMS    | Cloud Storage buckets, one KMS key, two secrets                                                          | Cents                                  |
| ClamAV          | Still the e2-medium VM and Cloud NAT until ADR-0037 step 2                                               | About USD 30 a month until then        |
| Worker          | Still one instance with CPU always on until ADR-0037 step 3                                              | About USD 45 a month until then        |
| Load balancer   | None: leave `api_domain` empty and map the API domain to Cloud Run                                       | Free                                   |
| Budget alert    | USD 200 a month (alerts at 50, 90 and 100 %)                                                             | Free                                   |
| Budget currency | The billing account's own (`budget_currency`; Google rejects any other). For example, BRL 1100 ≈ USD 200 |                                        |

Once ADR-0037's steps 2 and 3 are done, the cost on top of Vercel, domains and Firebase is close to zero until real usage grows. Until then, the ClamAV VM, NAT and worker are the remaining fixed costs (about USD 70–80 a month): don't apply an environment before then unless the owner accepts that. Free plans have limits, so check them before launch and when usage grows. Creating cloud resources starts billing (owner decision).

**Managed setup (later, if needed):** `database_provider = "cloudsql"` (staging 1 vCPU / 3.75 GB zonal; production 2 vCPU / 7.5 GB regional) and `redis_provider = "memorystore"` (Basic 1 GB / Standard HA 1 GB). It costs about USD 150–200 a month for staging alone, more for production. Then set `CLOUDSQL_CONNECTION_NAME` and `REDIS_SECRET` from `release_variables`.

## One-time setup (owner, per environment)

Do staging first, release to it, then repeat for production.

1. **Project and billing.** Create the project (project IDs are global: `fleettrust-staging` was taken, so staging is `fleettrust-staging-eu1`; check production's ID is free), link the billing account, and install `gcloud` and Terraform 1.17.
2. **State bucket.** Create it by hand: see `backend.hcl.example` in the environment folder. Access is limited to operators, because the state can contain generated passwords (with Cloud SQL or Memorystore).
3. **Variables.** Copy `<env>.tfvars.example` to `<env>.tfvars` and fill in the project ID, alert email, billing account and website origin. These files are not committed.
4. **Apply.**

   ```sh
   cd infra/terraform/environments/staging
   terraform init -backend-config=backend.hcl
   terraform plan -var-file=staging.tfvars    # read the plan
   terraform apply -var-file=staging.tfvars
   terraform output release_variables         # values for step 6
   ```

5. **Firebase.** Add Firebase to the project in the console:
   - **Authentication:** Google and email-link sign-in; authorised domains = the website domain.
   - **App Check:** Play Integrity, App Attest and reCAPTCHA Enterprise.
   - **Web app:** register a web app and note its config (API key, auth domain, app ID) for the Vercel step.
   - **Database (Neon):** create a Neon project in a European region (for example `aws-eu-central-1`, Frankfurt), then run `CREATE EXTENSION postgis; CREATE EXTENSION btree_gist;` once in its SQL editor. Copy the **pooled** connection string and add it to Secret Manager:

     ```sh
     printf %s "postgresql://USER:PASSWORD@HOST/DB?sslmode=require" \
       | gcloud secrets versions add fleettrust-database-url --data-file=- --project <project>
     ```

     The first release's migration job creates the tables. With Upstash, add its `rediss://` URL to `fleettrust-redis-url` the same way (`redis_provider = "external"`).

   - **Website (Vercel):** import the repository in Vercel with root directory `apps/web` (the framework, install and build commands come from [vercel.json](../../apps/web/vercel.json)). Set these environment variables for the environment (Preview for staging, Production for production):
     - `ENABLE_EXPERIMENTAL_COREPACK=1`, so Vercel uses the pnpm version in `package.json`;
     - `NEXT_PUBLIC_APP_ENV` (`staging` or `production`);
     - `NEXT_PUBLIC_API_URL` (the API URL);
     - `NEXT_PUBLIC_FIREBASE_PROJECT_ID`, `NEXT_PUBLIC_FIREBASE_API_KEY`, `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`, `NEXT_PUBLIC_FIREBASE_APP_ID`.

     Add the website domain in Vercel, put the same origin in `web_origins` (tfvars) and `WEB_URL` (GitHub), and add it to Firebase Authentication's authorised domains. The `apphosting.*.yaml` files are only for the earlier App Hosting option.
6. **GitHub environment.** In the repository settings, create the environment `staging` (or `production`) and add the variables below. For production, add **required reviewers** and limit deployments to `main`. Then set the repository variable `STAGING_ENABLED=true` (or `PRODUCTION_ENABLED=true`).
7. **Production only:** in staging's tfvars, add production's deployer and Cloud Run service agent to `image_readers`, and apply staging again, so production can pull the staging images.
8. **First release:** merge to `main` (staging), or run "Deploy to production" with a SHA that's on staging.
9. **Domains:** follow [dns-tls.md](dns-tls.md), then set `api_host` and `web_host` in tfvars and apply again to create the uptime checks.

### GitHub environment variables

Set these on the `staging` and `production` environments. The `terraform output release_variables` key is in brackets.

| Variable                         | Value                                                     |
| -------------------------------- | --------------------------------------------------------- |
| `GCP_PROJECT_ID`                 | `project_id`                                              |
| `GCP_REGION`                     | `region`                                                  |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `workload_identity_provider`                              |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | `deploy_service_account`                                  |
| `GCP_RUNTIME_SERVICE_ACCOUNT`    | `runtime_service_account`                                 |
| `CLOUDSQL_CONNECTION_NAME`       | `cloudsql_connection_name`; leave empty with Neon         |
| `REDIS_SECRET`                   | `redis_secret`; leave empty without Redis                 |
| `VPC_NETWORK` / `VPC_SUBNET`     | `vpc_network` / `vpc_subnet`                              |
| `QUARANTINE_BUCKET`              | `quarantine_bucket`                                       |
| `SENSITIVE_BUCKET`               | `sensitive_bucket`                                        |
| `PUBLIC_MEDIA_BUCKET`            | `public_media_bucket`                                     |
| `DOCUMENT_KMS_KEY`               | `document_kms_key`                                        |
| `CLAMAV_HOST`                    | `clamav_host`                                             |
| `PUBLIC_API_URL`                 | `https://api.<domain>` (or the `run.app` URL before DNS)  |
| `WEB_URL`                        | `https://<website domain>` (also the allowed CORS origin) |
| `APP_HOSTING_BACKEND`            | Leave empty: Vercel deploys the website from Git          |
| `STAGING_REGISTRY`               | Production only: staging's `registry` output              |

**Repository variables** (not per environment): `STAGING_ENABLED` and `PRODUCTION_ENABLED`, each `true` once that environment exists. Until then the deploy and rollback workflows are skipped, not failed.

## Mobile builds

EAS build profiles `staging` and `production` ([eas.json](../../apps/mobile/eas.json)) set `EXPO_PUBLIC_APP_ENV`. Set `EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_WEB_URL` and `EXPO_PUBLIC_LINK_DOMAIN` per profile as EAS environment variables, and add each Firebase project's `google-services.json` and `GoogleService-Info.plist` as EAS file secrets (never committed). Store releases and over-the-air updates are covered in [release-and-rollback.md](release-and-rollback.md#mobile-app).

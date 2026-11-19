# Staging deployment setup

One-time setup to enable `.github/workflows/deploy-staging.yml`. Until it's done, the workflow stops at its first step with a list of the missing variables. Values below are examples: replace the project ID and region (OQ-02).

## 1. Google Cloud resources

```sh
PROJECT=fleettrust-staging       # OQ-19: project + billing account owner
REGION=europe-west1              # OQ-02: pick with the launch jurisdiction
gcloud config set project $PROJECT
gcloud services enable run.googleapis.com artifactregistry.googleapis.com sqladmin.googleapis.com \
  secretmanager.googleapis.com iamcredentials.googleapis.com cloudtrace.googleapis.com

gcloud artifacts repositories create fleettrust --repository-format=docker --location=$REGION

# Cloud SQL Postgres 17 (smallest tier for staging; PITR on)
gcloud sql instances create fleettrust-staging --database-version=POSTGRES_17 --region=$REGION \
  --tier=db-custom-1-3840 --enable-point-in-time-recovery --backup-start-time=02:00
gcloud sql databases create fleettrust --instance=fleettrust-staging
gcloud sql users create fleettrust_app --instance=fleettrust-staging --password="$(openssl rand -base64 32)"
# Store the connection string (Cloud SQL socket path) as a secret: never in the repo or workflow.
printf 'postgresql://fleettrust_app:<password>@/fleettrust?host=/cloudsql/%s' "$PROJECT:$REGION:fleettrust-staging" \
  | gcloud secrets create fleettrust-database-url --data-file=-
```

## 2. Service accounts

```sh
gcloud iam service-accounts create fleettrust-api      # runtime identity of the API
gcloud iam service-accounts create github-deployer     # used by GitHub Actions only

API_SA=fleettrust-api@$PROJECT.iam.gserviceaccount.com
DEPLOY_SA=github-deployer@$PROJECT.iam.gserviceaccount.com

for role in roles/cloudsql.client roles/secretmanager.secretAccessor roles/cloudtrace.agent roles/logging.logWriter; do
  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$API_SA --role=$role
done
for role in roles/run.admin roles/artifactregistry.writer; do
  gcloud projects add-iam-policy-binding $PROJECT --member=serviceAccount:$DEPLOY_SA --role=$role
done
gcloud iam service-accounts add-iam-policy-binding $API_SA --member=serviceAccount:$DEPLOY_SA --role=roles/iam.serviceAccountUser
```

## 3. Workload Identity Federation (no JSON keys)

```sh
gcloud iam workload-identity-pools create github --location=global
gcloud iam workload-identity-pools providers create-oidc fleettrust-repo --location=global \
  --workload-identity-pool=github --issuer-uri=https://token.actions.githubusercontent.com \
  --attribute-mapping=google.subject=assertion.sub,attribute.repository=assertion.repository,attribute.ref=assertion.ref \
  --attribute-condition="assertion.repository=='winner-dev123/FleetTrust' && assertion.ref=='refs/heads/main'"

POOL=$(gcloud iam workload-identity-pools describe github --location=global --format='value(name)')
gcloud iam service-accounts add-iam-policy-binding $DEPLOY_SA --role=roles/iam.workloadIdentityUser \
  --member="principalSet://iam.googleapis.com/$POOL/attribute.repository/winner-dev123/FleetTrust"
```

The attribute condition means only workflows running from `main` of this repository can deploy.

## 4. GitHub repository variables

Settings → Secrets and variables → Actions → **Variables** (not secrets; none of these are sensitive):

| Variable                         | Example                                                                                   |
| -------------------------------- | ----------------------------------------------------------------------------------------- |
| `GCP_PROJECT_ID`                 | `fleettrust-staging`                                                                      |
| `GCP_REGION`                     | `europe-west1`                                                                            |
| `GCP_WORKLOAD_IDENTITY_PROVIDER` | `projects/123456/locations/global/workloadIdentityPools/github/providers/fleettrust-repo` |
| `GCP_DEPLOY_SERVICE_ACCOUNT`     | `github-deployer@fleettrust-staging.iam.gserviceaccount.com`                              |
| `GCP_API_SERVICE_ACCOUNT`        | `fleettrust-api@fleettrust-staging.iam.gserviceaccount.com`                               |
| `GCP_CLOUDSQL_CONNECTION_NAME`   | `fleettrust-staging:europe-west1:fleettrust-staging`                                      |
| `STAGING_CORS_ORIGINS`           | `https://staging.example.com`                                                             |

Then: Actions → **Deploy API to staging** → Run workflow.

## 5. Web (Firebase App Hosting)

Firebase console → App Hosting → Create backend → connect `winner-dev123/FleetTrust`, root directory `apps/web`, live branch `main`. Set `NEXT_PUBLIC_API_URL` in `apps/web/apphosting.yaml` to the API URL printed by the deploy workflow.

## Terraform

Prompt 29 replaces these commands with Terraform (environment separation, staging and production). They're kept as commands here so staging can be stood up before then.

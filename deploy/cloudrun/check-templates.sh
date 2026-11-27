#!/usr/bin/env bash
# CI check (no cloud access): every Cloud Run template renders to valid YAML, both with the
# optional parts (Cloud SQL, Redis, a ClamAV VM) and without them (the low-cost setup), and no
# "# when:" tag or unset variable is left behind.
set -euo pipefail

here="$(cd "$(dirname "$0")" && pwd)"
export GCP_REGION=europe-west1 REVISION=check-1
export API_IMAGE=img SCANNER_IMAGE=img OTEL_COLLECTOR_IMAGE=img APP_ENV=staging APP_VERSION=abc
export GCP_PROJECT_ID=p RUNTIME_SERVICE_ACCOUNT=r@p SCANNER_SERVICE_ACCOUNT=s@p
export VPC_NETWORK=n VPC_SUBNET=s CORS_ORIGINS=https://w PUBLIC_API_URL=https://a
export API_MIN_INSTANCES=0 API_MAX_INSTANCES=4 TRACE_SAMPLE_RATIO=1 FIREBASE_PROJECT_ID=p
export APP_CHECK_MODE=monitor STORAGE_QUARANTINE_BUCKET=q STORAGE_SENSITIVE_BUCKET=s
export STORAGE_PUBLIC_MEDIA_BUCKET=m DOCUMENT_KMS_KEY=k
export JOBS_QUEUE=projects/p/locations/europe-west1/queues/fleettrust-jobs
export WORKER_URL=https://fleettrust-worker-1.europe-west1.run.app JOBS_SERVICE_ACCOUNT=j@p

# Renders are captured into variables before grep: "grep -q" stops reading early, and with
# pipefail the renderer's broken pipe would then count as a failure (a flaky check).
check() {
  local label="$1" rendered
  for template in "$here"/*.service.yaml; do
    rendered="$(bash "$here/deploy.sh" render "$template")"
    if grep -q '# when:' <<< "$rendered"; then
      echo "::error::$template ($label): a '# when:' tag was left in"
      exit 1
    fi
    if grep -Eq '\$\{[A-Z_]+\}' <<< "$rendered"; then
      echo "::error::$template ($label): unset variable"
      exit 1
    fi
    python3 -c 'import sys, yaml; yaml.safe_load(sys.stdin)' <<< "$rendered"
    echo "ok: $(basename "$template") ($label)"
  done
}

export CLOUDSQL_CONNECTION_NAME="" REDIS_SECRET="" CLAMAV_HOST="" MALWARE_SCANNER=clamav-http
export CLAMAV_URL=https://scanner.example.test
check "low cost"
low="$(bash "$here/deploy.sh" render "$here/api.service.yaml")"
if grep -Eq 'cloudsql-instances|REDIS_URL|CLAMAV_HOST' <<< "$low"; then
  echo "::error::the low-cost render still contains Cloud SQL, Redis or a ClamAV VM"
  exit 1
fi

export CLOUDSQL_CONNECTION_NAME=p:r:i REDIS_SECRET=fleettrust-redis-url CLAMAV_HOST=10.0.0.5
export MALWARE_SCANNER=clamav CLAMAV_URL=""
check "managed"
managed="$(bash "$here/deploy.sh" render "$here/api.service.yaml")"
for expected in cloudsql-instances REDIS_URL CLAMAV_HOST; do
  grep -q "$expected" <<< "$managed" || { echo "::error::the managed render lacks $expected"; exit 1; }
done

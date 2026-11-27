#!/usr/bin/env bash
# Chooses the malware scanner for a release (ADR-0037) and tells the API how to reach it.
#
# - CLAMAV_HOST set (a ClamAV VM, the older setup): the API uses clamd over TCP.
# - Otherwise: deploys the scanner service (deploy/cloudrun/scanner.service.yaml, scale to zero),
#   lets only the API's runtime account call it, and passes its URL to the API.
#
# Writes MALWARE_SCANNER and, for the scanner service, CLAMAV_URL to $GITHUB_ENV.
# Needs GCP_REGION and REVISION, plus SCANNER_IMAGE, SCANNER_SERVICE_ACCOUNT and
# RUNTIME_SERVICE_ACCOUNT for the scanner service.
set -euo pipefail

region="${GCP_REGION:?GCP_REGION}"
out="${GITHUB_ENV:-/dev/null}"
here="$(cd "$(dirname "$0")" && pwd)"

if [ -n "${CLAMAV_HOST:-}" ]; then
  echo "MALWARE_SCANNER=clamav" >> "$out"
  echo "Using clamd on ${CLAMAV_HOST}"
  exit 0
fi

: "${SCANNER_IMAGE:?SCANNER_IMAGE}" "${SCANNER_SERVICE_ACCOUNT:?SCANNER_SERVICE_ACCOUNT}"
: "${RUNTIME_SERVICE_ACCOUNT:?RUNTIME_SERVICE_ACCOUNT}"

# deploy.sh also writes PREVIOUS_REVISION/NEW_REVISION for this service; the API's candidate step
# runs afterwards and sets them again for the API.
bash "$here/deploy.sh" direct "$here/scanner.service.yaml" fleettrust-scanner
gcloud run services add-iam-policy-binding fleettrust-scanner --region "$region" \
  --member "serviceAccount:${RUNTIME_SERVICE_ACCOUNT}" --role roles/run.invoker --quiet > /dev/null
url="$(gcloud run services describe fleettrust-scanner --region "$region" --format 'value(status.url)')"
[ -n "$url" ] || { echo "::error::no URL for fleettrust-scanner"; exit 1; }
{
  echo "MALWARE_SCANNER=clamav-http"
  echo "CLAMAV_URL=${url}"
} >> "$out"
echo "Using the scanner service at ${url}"

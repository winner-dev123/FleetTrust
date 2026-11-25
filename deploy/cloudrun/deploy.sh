#!/usr/bin/env bash
# Deploys one Cloud Run service from a template (docs/operations/release-and-rollback.md).
#
#   deploy.sh candidate <template.yaml> <service>  new revision with 0 % traffic, tagged "candidate"
#   deploy.sh direct    <template.yaml> <service>  new revision takes 100 % (the internal worker)
#   deploy.sh promote   <service> <revision> <percent>   move traffic to a revision
#
# Needs GCP_REGION, REVISION and the template's variables in the environment. Writes
# PREVIOUS_REVISION, NEW_REVISION and CANDIDATE_URL to $GITHUB_ENV when it is set.
set -euo pipefail

mode="${1:?mode}"
region="${GCP_REGION:?GCP_REGION}"
out="${GITHUB_ENV:-/dev/null}"

serving_revision() {
  gcloud run services describe "$1" --region "$region" --format=json 2> /dev/null \
    | jq -r '[.status.traffic[]? | select(.percent > 0)] | max_by(.percent) | .revisionName // empty' \
    || true
}

case "$mode" in
  candidate | direct)
    template="${2:?template}"
    service="${3:?service}"
    : "${REVISION:?REVISION}"
    previous="$(serving_revision "$service")"
    rendered="$(mktemp)"
    envsubst < "$template" > "$rendered"
    if [ "$mode" = candidate ] && [ -n "$previous" ]; then
      # The serving revision keeps all traffic until the candidate passes its smoke test.
      cat >> "$rendered" <<EOF
  traffic:
    - revisionName: ${previous}
      percent: 100
    - revisionName: ${REVISION}
      percent: 0
      tag: candidate
EOF
    else
      # First release of this service (nothing to protect), or the internal worker.
      cat >> "$rendered" <<EOF
  traffic:
    - revisionName: ${REVISION}
      percent: 100
      tag: candidate
EOF
    fi
    gcloud run services replace "$rendered" --region "$region" --quiet
    url="$(gcloud run services describe "$service" --region "$region" --format=json \
      | jq -r '.status.traffic[] | select(.tag == "candidate") | .url')"
    {
      echo "PREVIOUS_REVISION=${previous}"
      echo "NEW_REVISION=${REVISION}"
      echo "CANDIDATE_URL=${url}"
    } >> "$out"
    echo "Deployed ${REVISION} (previous: ${previous:-none}); candidate URL: ${url}"
    ;;
  promote)
    service="${2:?service}"
    revision="${3:?revision}"
    percent="${4:?percent}"
    if [ "$percent" = 100 ]; then
      gcloud run services update-traffic "$service" --region "$region" \
        --to-revisions "${revision}=100" --quiet
    else
      previous="$(serving_revision "$service")"
      gcloud run services update-traffic "$service" --region "$region" \
        --to-revisions "${revision}=${percent},${previous}=$((100 - percent))" --quiet
    fi
    echo "${service}: ${revision} now has ${percent} % of traffic"
    ;;
  *)
    echo "unknown mode: $mode" >&2
    exit 2
    ;;
esac

#!/usr/bin/env bash
# Release rehearsal helpers (.github/workflows/release-rehearsal.yml). Runs the API container image
# exactly as Cloud Run would (same image, same migration command), against PostgreSQL + PostGIS.
#
#   rehearsal.sh migrate <image-tag>             apply that release's migrations
#   rehearsal.sh start   <image-tag> <version>   start that release on :8080 and wait for /health
#   rehearsal.sh smoke   <version> [web-url] [skip]  run tools/smoke against it (skip: SMOKE_SKIP)
#   rehearsal.sh stop    <label>                 keep its log as api-<label>.log and remove it
set -euo pipefail

cmd="${1:?command}"
shift

case "$cmd" in
  migrate)
    docker run --rm --network host -e DATABASE_URL "fleettrust-api:$1" \
      node node_modules/@fleettrust/db/dist/cli/migrate.js
    ;;
  start)
    docker run -d --name api --network host \
      -e DATABASE_URL -e APP_ENV=local -e APP_ROLE=api -e PORT=8080 \
      -e FIREBASE_PROJECT_ID=demo-fleettrust -e CORS_ORIGINS=http://localhost:3000 \
      -e "APP_VERSION=$2" "fleettrust-api:$1" > /dev/null
    for _ in $(seq 1 60); do
      if curl -sf http://127.0.0.1:8080/health > /dev/null; then exit 0; fi
      sleep 1
    done
    docker logs api
    exit 1
    ;;
  smoke)
    API_URL=http://127.0.0.1:8080 EXPECT_VERSION="$1" ALLOWED_ORIGIN=http://localhost:3000 \
      WEB_URL="${2:-}" SMOKE_SKIP="${3:-}" node tools/smoke/src/run.ts
    ;;
  stop)
    docker logs api > "api-$1.log" 2>&1 || true
    docker rm -f api > /dev/null
    ;;
  *)
    echo "unknown command: $cmd" >&2
    exit 2
    ;;
esac

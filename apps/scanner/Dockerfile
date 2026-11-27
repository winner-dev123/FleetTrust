# syntax=docker/dockerfile:1.10
# FleetTrust malware scanner: ClamAV (clamd) behind a small HTTP server, for Cloud Run with
# scale to zero (ADR-0037 step 2). Build from the repository root:
#   docker build -f apps/scanner/Dockerfile -t fleettrust-scanner .
#
# The official ClamAV image includes the signature database at build time; the server runs
# freshclam once at start-up for the day's updates.

ARG NODE_IMAGE=node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0
ARG CLAMAV_IMAGE=clamav/clamav:1.5.5-debian@sha256:85f35b3eee903dbd96c5ca250c5aa13d230d97987c0f876f7d46f001f9414239

FROM ${NODE_IMAGE} AS node

FROM ${CLAMAV_IMAGE}
# The Node.js release binary needs only glibc and libstdc++.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libstdc++6 \
  && rm -rf /var/lib/apt/lists/*
COPY --from=node /usr/local/bin/node /usr/local/bin/node
COPY apps/scanner/config/ /etc/fleettrust/
COPY apps/scanner/src/ /app/src/
RUN chown -R clamav:clamav /var/lib/clamav \
  && node --version && clamd --version

USER clamav
ENV PORT=8080 NODE_ENV=production
EXPOSE 8080
ENTRYPOINT ["node", "/app/src/main.mjs"]

# syntax=docker/dockerfile:1.10
# FleetTrust API image (role=api or role=worker, selected by APP_ROLE at runtime).
# Build from the repository root:  docker build -f apps/api/Dockerfile -t fleettrust-api .

ARG NODE_IMAGE=node:24.22.3-trixie-slim@sha256:af02d57b57719b9657a45199a79264a9437940cd55b3c7b3fc99615654f124a0

# ---------- build: install, compile, and assemble a self-contained production bundle ----------
FROM ${NODE_IMAGE} AS build
ENV COREPACK_ENABLE_DOWNLOAD_PROMPT=0 \
    TURBO_TELEMETRY_DISABLED=1 \
    CI=1
RUN corepack enable
WORKDIR /repo

# Manifests first so dependency installation is cached until a lockfile or package.json changes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml turbo.json ./
COPY apps/api/package.json apps/api/
COPY packages/config/package.json packages/config/
COPY packages/env/package.json packages/env/
COPY packages/types/package.json packages/types/
COPY packages/db/package.json packages/db/
RUN --mount=type=cache,id=pnpm-store,target=/root/.local/share/pnpm/store \
    pnpm install --frozen-lockfile --filter "@fleettrust/api..." --filter fleettrust

COPY . .
RUN pnpm turbo run build --filter "@fleettrust/api..." \
 && pnpm --filter @fleettrust/api deploy --prod /out

# ---------- runtime: minimal, non-root ----------
FROM ${NODE_IMAGE} AS runtime
ENV NODE_ENV=production \
    PORT=8080
WORKDIR /app
COPY --from=build --chown=node:node /out ./
USER node
EXPOSE 8080
# instrumentation.js is a no-op unless OTEL_TRACES_EXPORTER is set (docs/operations/observability.md).
CMD ["node", "--import", "./dist/instrumentation.js", "dist/main.js"]

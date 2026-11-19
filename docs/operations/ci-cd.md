# CI/CD

## Pipeline (`.github/workflows/ci.yml`)

Runs on every pull request, on pushes to `main`, and on demand. All jobs run in parallel with read-only repository permissions.

| Job             | What it proves                                                                                                                                                                                                                                                                                                     | Typical time |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------ |
| **quality**     | `format:check`, the ADR-0011 excluded-module guard, lint, typecheck, all unit/integration tests (PGlite), builds of every app (Next.js, Metro bundles, API), **no schema drift** (`db:generate` produces nothing), and the **tracing smoke test** on the built API                                                 | 6–9 min      |
| **database**    | Fresh migration, repeatable seed and the real-PostgreSQL test suite on a **Postgres 17 + PostGIS** service container (same image digest as local)                                                                                                                                                                  | 2–3 min      |
| **local-infra** | `pnpm infra:up:all` brings up Postgres/Redis/Mailpit healthy. Wrong DB password, unauthenticated Redis and an unauthenticated Mailpit UI are all rejected. Migrations, seed and DB tests pass against the Compose Postgres. Firebase emulators start (Java 21), and an unauthenticated Storage upload gets **403** | 6–10 min     |
| **container**   | API image builds from `apps/api/Dockerfile`, runs as non-root, serves `/health` 200 and `/health/ready` 503 without a database                                                                                                                                                                                     | 3–5 min      |
| **security**    | `pnpm audit --prod` fails on high/critical advisories. gitleaks scans the **full history** for secrets (`.gitleaks.toml`)                                                                                                                                                                                          | 1–2 min      |

Supply-chain hygiene:

- Every action and image is pinned to a commit SHA or digest.
- No third-party marketplace actions beyond `actions/*`, `docker/*` and `google-github-actions/*`.
- Installs use `--frozen-lockfile`.
- pnpm's release-age policy and install-script allowlist (`pnpm-workspace.yaml`) apply in CI too.

**Cost note:** private repositories on GitHub Free get 2,000 Actions minutes per month. A full run uses about 20–30 runner-minutes, so roughly 70–100 runs a month. If that gets tight, run `local-infra` and `container` only on pull requests that touch `infra/`, `apps/api/` or `packages/db/` (path filters).

## Dependency updates (`.github/dependabot.yml`)

Weekly PRs for npm (grouped: minor/patch, OpenTelemetry, NestJS, Expo/React Native), GitHub Actions, the API Dockerfile and the Compose images. A **7-day cooldown** matches pnpm's minimum-release-age policy. TypeScript ≥ 6.1 and React minor/major bumps are held back on purpose (see comments in the file). Every Dependabot PR goes through the full pipeline.

## Branch protection (recommended settings)

> **Plan limitation:** GitHub Free doesn't enforce branch protection or rulesets on **private** repositories. They need GitHub Pro/Team, or a public repository. Until then, these are working agreements, not enforced rules.

When available (Settings → Rules → Rulesets → `main`):

- Require a pull request before merging, with 1 approval and stale approvals dismissed on new commits.
- Require status checks: `quality`, `database`, `local-infra`, `container`, `security`, with branches up to date before merging.
- Block force pushes and deletions on `main`.
- Require linear history (squash or rebase merges).
- Restrict who can run `Deploy API to staging` (workflow permissions or a protected `staging` environment).

## Deployments

- **API / worker → Cloud Run:** `.github/workflows/deploy-staging.yml` (manual). Keyless auth via Workload Identity Federation, migrations run as a Cloud Run job _before_ the new revision takes traffic, then a smoke test. Setup: [staging-deployment.md](staging-deployment.md).
- **Web → Firebase App Hosting:** connected to the repo in the Firebase console; settings in `apps/web/apphosting.yaml`.
- **Mobile:** EAS builds arrive with Prompt 25.

## Running the CI checks locally

```sh
pnpm check            # format, guard, lint, typecheck, test, build
pnpm test:db          # real Postgres (needs pnpm infra:up)
pnpm --filter @fleettrust/api smoke:tracing   # Linux/macOS only (needs SIGTERM)
```

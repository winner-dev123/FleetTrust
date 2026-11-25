# Handoff — Prompt 29: Staging, production and launch

- Date: 2026-11-25
- Status: **awaiting approval** · PR #31
- Prompt 28 approved and merged (PR #30 → `467307e`).

## Assumptions and owner decisions

- **Code only (owner decision).** No cloud resources were created, because creating them starts billing and the project owner and budget are open (OQ-19, OQ-07). Everything is written and verified in CI. Applying it is a documented owner task ([environments.md](../operations/environments.md)).
- **Region: Europe, `europe-west1` (owner decision, OQ-02).** It is one Terraform variable.
- **Acceptance criteria without a cloud account:**
  - "Staging smoke tests pass" is proven on a production-like stack: the real container image on PostgreSQL + PostGIS, the real migration command, and the Next.js website.
  - "Rollback rehearsed" is proven by running the previous image on the migrated schema, on every pull request.
  - The go/no-go checklist is ready, with evidence per line; **the owner signs it**. Items that need accounts are marked as owner actions, not ticked.

## What was built

| Area              | Details                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Terraform         | [infra/terraform](../../infra/terraform): module plus `staging` and `production` roots, covering:<br>• Cloud SQL 17 with PITR (HA in production) and Memorystore Redis (HA in production)<br>• generated secrets and buckets with lifecycle rules (abandoned uploads deleted after 1 day, closing a Prompt 27 gap)<br>• KMS key (90-day rotation, protected); VPC, NAT and ClamAV on an internal VM<br>• least-privilege identities; Workload Identity Federation (staging: `main` only; production: protected environment only)<br>• alerts, uptime checks and a budget<br>• optional edge: HTTPS load balancer, managed certificate, TLS 1.2+, Cloud Armor (rate ban, adaptive DDoS, OWASP rules in preview), closing R-05 in code                                                                                        |
| Release workflows | [deploy-staging.yml](../../.github/workflows/deploy-staging.yml): every merge, build once, migrate, **candidate revision with no traffic**, smoke, promote, worker, website, smoke.<br>[deploy-production.yml](../../.github/workflows/deploy-production.yml): approval, **same digest** copied from staging, commit must be on `main`, candidate, smoke, **10 % canary** (smoke every minute plus a 5xx rate check from request logs), 100 %; automatic traffic rollback on failure.<br>[rollback.yml](../../.github/workflows/rollback.yml): one click; API plus the matching worker revision; smoke test.<br>All stay **off** until `STAGING_ENABLED` / `PRODUCTION_ENABLED`. Service templates and [deploy.sh](../../deploy/cloudrun/deploy.sh) in `deploy/cloudrun` (API and a new worker template, Direct VPC egress) |
| Smoke tests       | [tools/smoke](../../tools/smoke): 11 read-only checks (safe in production): release version, readiness, security headers, config, PostGIS search, anonymous refusal, no leaked internals, CORS, realtime refusal, signed-in call (optional), website pages with CSP and HSTS                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| Release rehearsal | [release-rehearsal.yml](../../.github/workflows/release-rehearsal.yml), every PR:<br>1. previous image → smoke<br>2. new image migrates and takes over, plus the website → smoke<br>3. **previous image again on the migrated schema** → smoke<br>4. roll forward → smoke<br>A second run starts from the **Prompt 26 release**, so the rollback crosses a real schema change (migration 0041)                                                                                                                                                                                                                                                                                                                                                                                                                              |
| Rollback guard    | [rollback.ts](../../tools/repo-guards/src/rollback.ts) in `pnpm check`: migrations after 0041 may not drop, rename, retype, `SET NOT NULL`, add required columns without a default, or `TRUNCATE`, unless marked `-- contract: <reason>`                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| Pilot allowlist   | Feature setting `signups.pilot_allowlist`: only verified emails or `@domains` on the list can create accounts (403 `pilot_invite_only`); existing accounts unaffected; audited. The admin editor now uses each setting's own limit and hint                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| CI                | New job "Infrastructure as code": `terraform fmt`, `validate` (both roots), actionlint (all workflows, with shellcheck), shellcheck on the deploy scripts. The workflows' unused loop variables were fixed                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| Website hosting   | `apphosting.yaml` plus `apphosting.staging.yaml` / `apphosting.production.yaml`; automatic rollouts off (the website rolls out after the API)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| Docs              | [environments.md](../operations/environments.md), [release-and-rollback.md](../operations/release-and-rollback.md), [dns-tls.md](../operations/dns-tls.md), [support-playbook.md](../support/support-playbook.md), [pilot-onboarding.md](../support/pilot-onboarding.md), [go-no-go.md](../launch/go-no-go.md), [ADR-0036](../adr/0036-staging-production-and-launch.md). Alerts in [observability.md](../operations/observability.md). Corrected the ClamAV advice in [verification.md](../operations/verification.md) (it can't run on Cloud Run)                                                                                                                                                                                                                                                                         |

## Acceptance criteria

| Criterion                                | Evidence                                                                                                                                                                                                                                                                                                                                                  |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Staging smoke tests pass                 | **Release rehearsal (CI):** the real API image on PostgreSQL + PostGIS with the real migrations passes every smoke check, and with the website, the CSP page checks too. Both rehearsals green. Against real staging: the first "Deploy to staging" run once the project exists (go/no-go 2.3, owner)                                                     |
| Rollback rehearsed                       | **Every PR:** the previous release runs again on the migrated schema and passes the smoke tests, then rolls forward. From the Prompt 26 release, this crosses migration 0041. Staging rollback with the real workflow: logged in [release-and-rollback.md](../operations/release-and-rollback.md#staging-rollback-log) once staging exists (go/no-go 2.5) |
| Production go/no-go checklist signed off | [go-no-go.md](../launch/go-no-go.md) is ready, with evidence per line and a sign-off table. **The owner signs it**; open owner items are listed there                                                                                                                                                                                                     |

## Evidence (actual results)

- **`pnpm check`:** passes locally (prettier, rollback guard: 42 migrations, module guard: 938 files, 45/45 turbo tasks).
- **Tests:**
  - API **373** (was 372): the pilot allowlist e2e test; the feature-settings list test updated;
  - types 87 (+3 allowlist); repo-guards 44 (+19 rollback guard); smoke 4 (new); web 67; mobile 83; db 99 + 6 skipped; sdk 34; perf 4.
- **CI:**
  - Terraform `fmt` and `validate` passed on the first run;
  - release rehearsal: all four steps green from the previous release (merge base) and from the Prompt 26 release across migration 0041;
  - actionlint found 6 small issues (unused loop variables, one redirect style), all fixed.
- **Drift check:** no schema changes.
- **Checked that the new tests catch regressions:**
  - smoke checks fail on a wrong version, a database down, missing headers, an open private endpoint, a leaked stack trace, loose CORS and an open socket;
  - the rollback guard refuses each contract statement;
  - the allowlist test fails without the sign-up check.

## Not built here (gaps)

- **Running in the cloud:** apply Terraform, first staging and production releases, uptime checks, the real staging rollback and PITR drills. All owner actions after the projects exist.
- **Signed-in smoke check in deployed environments:** needs a smoke-test account and, in production, an App Check debug token (optional check, skipped).
- **Cloud Armor WAF enforcement:** preview until tuned on real traffic.
- **Terraform state bootstrap:** the state bucket is created by hand (documented).

## Before launch (owner)

See [go-no-go.md](../launch/go-no-go.md). In short:

- create the projects and billing;
- `terraform apply`;
- set up Firebase;
- set the GitHub environments and reviewers;
- domains;
- first releases;
- the staging rollback and PITR drills;
- legal review;
- jurisdiction;
- email and map vendors;
- store accounts;
- the pilot allowlist;
- sign the checklist.

## Next: Prompt 30 — Future extensibility (specification only)

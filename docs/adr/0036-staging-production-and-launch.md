# ADR-0036: Staging, production and launch: one project per environment, Terraform for everything but releases, candidate revisions with rehearsed rollback, invite-only pilot

- Status: Accepted
- Date: 2026-11-25

## Context

Prompt 29 asks for:

- managed cloud resources via Terraform, and environment separation;
- migrations, monitoring alerts, DNS/TLS and secrets;
- a release strategy and rollback;
- support documentation and limited pilot onboarding.

The acceptance criteria: staging smoke tests pass, rollback is rehearsed, and the production go/no-go checklist is signed off.

The owner decided:

- **Code only:** no cloud resources are created yet, because the project owner and budget are still open (OQ-19, OQ-07).
- **Europe for data residency:** `europe-west1` (OQ-02).

So everything must be complete and verifiable without a cloud account, and applying it later must be a short, documented owner task.

Already in place: the API image, a Cloud Run service template, a manual staging workflow, App Hosting config for the website, EAS build profiles, and the expand/contract migration policy (docs only).

## Decision

1. **One Google Cloud project (and Firebase project) per environment.** Staging and production share nothing: separate IAM, data, keys, billing and quotas.
2. **Terraform manages the environment; releases don't need Terraform.** The module `infra/terraform/modules/fleettrust` creates:
   - Cloud SQL with PITR (HA in production) and Redis;
   - secrets (generated, runtime-only access) and buckets with lifecycle rules (abandoned uploads deleted after a day);
   - the KMS key (rotated, protected from deletion);
   - the VPC and NAT, and ClamAV on an internal VM (clamd speaks raw TCP, which Cloud Run can't serve);
   - least-privilege identities and keyless GitHub deploys (Workload Identity Federation: staging only from `main`, production only from the protected `production` environment);
   - alerts, uptime checks, a budget, and an optional edge (HTTPS load balancer, managed certificate, Cloud Armor).

   Cloud Run services are deployed by the release workflows from `deploy/cloudrun/*.yaml`. CI runs `terraform fmt`, `terraform validate` for both roots, actionlint and shellcheck.

3. **Build once, promote by digest.** Staging builds the image on every merge to `main`. Production copies that exact digest from the staging registry and refuses a commit that isn't on `main`.
4. **Candidate revisions, then traffic.** Every release:
   - migrates first (expand-only);
   - starts a revision with **no traffic**, tagged `candidate`, and smoke-tests it on its own URL;
   - moves traffic: all at once on staging; in production, a 10 % canary for at least 10 minutes, smoke tested every minute with its 5xx rate read from request logs.

   Any failure puts the previous revision back.

5. **Rollback = move traffic to the previous revision.** This is safe because migrations only expand:
   - a **rollback guard** (`tools/repo-guards`) refuses drop, rename, type changes, `SET NOT NULL`, required columns without defaults and `TRUNCATE` in new migrations, unless marked `-- contract: <reason>`;
   - the **release rehearsal** (CI, every PR) runs the previous image, migrates to the new one, **runs the previous image again on the migrated schema**, and rolls forward, with smoke tests at each step. It also starts from an older release across a real schema change.

   A one-click "Roll back" workflow restores the API and the matching worker revision and smoke-tests the result.

6. **Smoke tests are a tool, not a script per workflow.** `tools/smoke` contains read-only checks, safe against production, covering:
   - release version, readiness and security headers;
   - public config and PostGIS search;
   - anonymous refusal, no leaked internals, CORS, realtime refusal;
   - website pages with CSP and HSTS.

   The same tool runs in the rehearsal, on candidates, during the canary, and on public URLs.

7. **Invite-only pilot.** The feature setting `signups.pilot_allowlist` (emails or `@domains`): while it has entries, only verified matching emails can create accounts (403 `pilot_invite_only`). Existing accounts are unaffected; clearing it opens sign-ups.
8. **The website rolls out after the API.** App Hosting automatic rollouts are off; the workflows create a rollout for the same commit once the API is promoted. Per-environment `apphosting.<env>.yaml`.
9. **Go/no-go is a document the owner signs**, with evidence per line. Items needing accounts or decisions are marked as owner actions, never ticked on the owner's behalf.

## Consequences

- Applying an environment is: create the project and state bucket, `terraform apply`, set up Firebase, set the GitHub environment variables, and flip `STAGING_ENABLED`/`PRODUCTION_ENABLED`. Until then the deploy and rollback workflows are skipped, not failed.
- "Staging smoke tests pass" is proven today on a production-like stack: the real image on PostgreSQL + PostGIS, the real migrations, plus the Next.js website. The run against real staging is the first owner release.
- Contract migrations become deliberate, reviewed, separate releases.
- **The Cloud Run URL stays reachable**, so candidates can be smoke-tested before they get traffic. Traffic there bypasses Cloud Armor, but not the API's rate limits, authentication or App Check. Accepted for the pilot; revisit with internal-only ingress plus an LB-routed candidate path if abuse appears.
- **The WAF rules start in preview** and need tuning on real traffic before enforcing (go/no-go 3.2).

## Alternatives considered

- **Terraform also deploys Cloud Run (image as a variable).** Every release would need a Terraform apply with state access, and drift between `gcloud` traffic moves and Terraform. Rejected: Terraform owns the environment, workflows own releases.
- **Rebuild the image for production.** It wouldn't be the artifact that was tested. Rejected for promotion by digest.
- **Down migrations for rollback.** Risky under real data and rarely rehearsed. Expand/contract plus rehearsed image rollback is safer.
- **Cloud Run domain mappings instead of a load balancer.** Simpler and cheaper, but there is no Cloud Armor (R-05) and the feature is limited by region. The load balancer is optional (`api_domain`), so staging can start without it.
- **An invitation-code table for the pilot.** More moving parts (codes, expiry, sharing). An allowlist of verified emails and domains fits pilot onboarding by organisation.

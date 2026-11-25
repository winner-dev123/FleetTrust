# Production go/no-go checklist

Signed off by the owner before production opens to pilot users, and again before the pilot widens. Each line has its evidence. **Status:** ✅ done and verified · ⏳ owner action (needs accounts, decisions or the cloud projects) · ❌ not done.

The code, infrastructure definitions, workflows and runbooks are complete and verified in CI (Prompt 29). The open items are owner decisions and actions that need real accounts. Nothing on this list was ticked on the owner's behalf.

## 1. Product and quality

| #   | Item                                                                                                                        | Evidence                                                                                                   | Status                            |
| --- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- | --------------------------------- |
| 1.1 | All CI checks green on the release commit: checks, tests, browsers, load tests, restore drill, release rehearsal, Terraform | GitHub checks on the commit                                                                                | ✅ (PR #31)                       |
| 1.2 | SLOs met at pilot volume                                                                                                    | [slo.md](../operations/slo.md)                                                                             | ✅ (CI); re-measure on staging ⏳ |
| 1.3 | Accessibility: automated WCAG 2.2 AA checks on every page, 5 browser projects                                               | [device-matrix.md](../qa/device-matrix.md)                                                                 | ✅                                |
| 1.4 | Manual screen-reader passes and the real-device plan                                                                        | [device-matrix.md](../qa/device-matrix.md), [mobile-device-test-plan.md](../qa/mobile-device-test-plan.md) | ⏳                                |
| 1.5 | Tenant isolation penetration test passes                                                                                    | `test/security/tenant-pentest.e2e-spec.ts`                                                                 | ✅                                |

## 2. Infrastructure and release

| #   | Item                                                                                                                                                            | Evidence                                                                           | Status            |
| --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ----------------- |
| 2.1 | Cloud projects and billing for staging and production, region `europe-west1`                                                                                    | [environments.md](../operations/environments.md)                                   | ⏳ (OQ-19, OQ-07) |
| 2.2 | `terraform apply` for staging and production; release variables set                                                                                             | `terraform output release_variables`                                               | ⏳                |
| 2.3 | Staging deploys from `main` and passes its smoke tests                                                                                                          | "Deploy to staging" run                                                            | ⏳                |
| 2.4 | Release and rollback rehearsed: previous release, new release, rollback on the migrated schema, roll forward; also from an older release across a schema change | "Release rehearsal" CI job                                                         | ✅                |
| 2.5 | Rollback rehearsed on staging with the real workflow                                                                                                            | [Staging rollback log](../operations/release-and-rollback.md#staging-rollback-log) | ⏳                |
| 2.6 | Logical backup restore drill                                                                                                                                    | [Drill log](../operations/backup-restore-runbook.md#drill-log)                     | ✅ (every CI run) |
| 2.7 | Cloud SQL point-in-time restore drill on staging (RPO ≤ 15 min, RTO ≤ 4 h)                                                                                      | [Drill log](../operations/backup-restore-runbook.md#drill-log)                     | ⏳                |
| 2.8 | Production environment protected: required reviewers, deployments from `main` only                                                                              | GitHub environment settings                                                        | ⏳                |
| 2.9 | Domains, DNS and certificates; Firebase authorised domains                                                                                                      | [dns-tls.md](../operations/dns-tls.md)                                             | ⏳                |

## 3. Security and privacy

| #   | Item                                                                           | Evidence                                                    | Status                                                |
| --- | ------------------------------------------------------------------------------ | ----------------------------------------------------------- | ----------------------------------------------------- |
| 3.1 | Threat model: critical and high risks mitigated or accepted                    | [threat-model.md](../security/threat-model.md)              | ✅                                                    |
| 3.2 | Edge protection: load balancer, Cloud Armor, TLS 1.2+ (R-05)                   | [edge.tf](../../infra/terraform/modules/fleettrust/edge.tf) | ✅ code; apply ⏳; WAF out of preview after tuning ⏳ |
| 3.3 | App Check enforced in production (the API refuses to start otherwise)          | `apps/api/src/config/env.ts`                                | ✅                                                    |
| 3.4 | Secrets only in Secret Manager; deploys keyless (Workload Identity Federation) | [secrets-management.md](../security/secrets-management.md)  | ✅ code; ⏳ apply                                     |
| 3.5 | Legal review of the terms, privacy notice and emergency wording (OQ-04, OQ-17) | [prompt-27.md](../handoff/prompt-27.md)                     | ⏳                                                    |
| 3.6 | Jurisdiction decided (OQ-03): retention, minimum age, breach deadlines         | [open-questions.md](../product/open-questions.md)           | ⏳ (Europe chosen for data location)                  |
| 3.7 | First super admin bootstrapped; staff have two-step sign-in                    | [admin.md](../architecture/admin.md) and the command below  | ⏳                                                    |

## 4. Operations and support

| #   | Item                                                                                      | Evidence                                                                                     | Status                |
| --- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- | --------------------- |
| 4.1 | Alerts go to a monitored inbox; on-call rota for the pilot                                | `alert_email` in tfvars; [incident-response.md](../operations/incident-response.md) contacts | ⏳                    |
| 4.2 | Budget alerts set (OQ-07)                                                                 | `billing_account` in tfvars                                                                  | ⏳                    |
| 4.3 | Email provider chosen and SPF, DKIM and DMARC set (OQ-06): emergency fallback and support | [dns-tls.md](../operations/dns-tls.md)                                                       | ⏳                    |
| 4.4 | Map tile and routing vendors (OQ-13); production refuses to start without a tile URL      | `MAP_TILE_URL`                                                                               | ⏳                    |
| 4.5 | Support playbook, inbox and staff roles                                                   | [support-playbook.md](../support/support-playbook.md)                                        | ✅ playbook; inbox ⏳ |
| 4.6 | Pilot allowlist filled; invitations sent                                                  | [pilot-onboarding.md](../support/pilot-onboarding.md)                                        | ✅ feature; list ⏳   |
| 4.7 | Mobile: store accounts, signing, TestFlight / internal testing builds (OQ-19)             | [release-and-rollback.md](../operations/release-and-rollback.md#mobile-app)                  | ⏳                    |

## Decision

| Role                 | Name | Decision (go / no-go) | Date | Notes |
| -------------------- | ---- | --------------------- | ---- | ----- |
| Product owner        |      |                       |      |       |
| Engineering          |      |                       |      |       |
| Operations / on-call |      |                       |      |       |

**Go** requires every item ✅, or ⏳ items explicitly accepted in the notes with a date.

## Useful commands

Bootstrap the first super admin in production. That person must have signed in once.

```sh
gcloud run jobs deploy fleettrust-staff --region europe-west1 \
  --image europe-west1-docker.pkg.dev/<project>/fleettrust/api:<release sha> \
  --service-account fleettrust-runtime@<project>.iam.gserviceaccount.com \
  --set-cloudsql-instances <connection name> --set-secrets DATABASE_URL=fleettrust-database-url:latest \
  --command node --args node_modules/@fleettrust/db/dist/cli/staff.js,grant,ops-lead@example.com,super_admin
gcloud run jobs execute fleettrust-staff --region europe-west1 --wait
```

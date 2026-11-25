# Release and rollback

How a change reaches users, and how to undo it ([ADR-0036](../adr/0036-staging-production-and-launch.md)). Environments and one-time setup: [environments.md](environments.md).

## The path of a change

```
pull request ──► CI: checks, tests, load tests, restore drill, release rehearsal
     │ merge
     ▼
main ──► Deploy to staging (automatic) ──► soak on staging ──► Deploy to production (a person + approval)
```

1. **Pull request.** All CI checks must pass, including:
   - "Release rehearsal": the previous release runs, the new release migrates and takes over, the **previous release runs again on the migrated schema**, then the new one returns. Smoke tests run at every step.
   - The rollback guard: migrations may only expand the schema (below).
2. **Staging (automatic on merge).** The image is built once and tagged with the commit. Then:
   - the database is migrated;
   - the new API revision starts **with no traffic** and is smoke-tested on its own URL;
   - traffic moves to it;
   - the worker is updated;
   - the website rolls out;
   - the public URLs are smoke-tested.

   If anything fails after traffic moved, the previous revision gets all traffic back.

3. **Production (manual).** Run "Deploy to production" with the commit SHA. Required reviewers approve. Then:
   - the **same image digest** is copied from staging;
   - the database is migrated;
   - the new revision starts with no traffic and is smoke-tested;
   - it gets **10 % of traffic for at least 10 minutes** (smoke tested every minute, and its 5xx rate watched in the request logs);
   - it goes to 100 %, followed by the worker, the website and the final smoke tests.

   Any failure puts all traffic back on the previous revision.

**Releases are commits on `main`.** `APP_VERSION` is the commit SHA; `/health` reports it, and the smoke tests check it. Release notes are the merged pull requests since the last production SHA.

**When to release to production.** Weekdays during working hours, never right before a weekend or holiday during the pilot, and with someone watching alerts for an hour afterwards.

## Database migrations: expand, then contract

Rollback means running the previous image against the new schema. So every migration must keep the previous release working ([database.md](../development/database.md#rollback-strategy)):

| Allowed in any release (expand)                                                                                                                 | Only in a contract release                                                                                                            |
| ----------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| New tables; nullable columns or columns with a default; indexes (concurrently for large tables); new constraints (`NOT VALID`, then `VALIDATE`) | Dropping or renaming tables, columns or types; changing a column type; `SET NOT NULL`; required columns without a default; `TRUNCATE` |

The **rollback guard** in `pnpm check` and CI ([rollback.ts](../../tools/repo-guards/src/rollback.ts)) refuses contract statements in any migration after 0041, unless the file starts with `-- contract: <reason>`. A contract migration ships on its own, after the release that stopped using the old shape has been in production long enough that you won't roll back past it. It also needs a reviewed plan and a verified backup or PITR window.

Migrations run as the Cloud Run job `fleettrust-migrate` before the new revision starts. A failed migration stops the release, and nothing serves the new code. Fix it with a new corrective migration (roll forward).

## Rolling back

| What                    | How                                                                                                                                                                                                   | Time       |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------- |
| **API and worker**      | Actions → **Roll back** → environment (and optionally a revision). It moves traffic to the previous revision, puts back the matching worker revision, and smoke-tests that the old release is serving | ~1 minute  |
| API by hand             | `gcloud run services update-traffic fleettrust-api --region europe-west1 --to-revisions <revision>=100`                                                                                               | seconds    |
| **Website**             | Firebase console → App Hosting → backend → Rollouts → roll back to the previous rollout (or create a rollout from the previous commit)                                                                | ~5 minutes |
| **Database**            | No schema rollback. For bad data, point-in-time restore to a new instance ([backup-restore-runbook.md](backup-restore-runbook.md))                                                                    | 1–4 hours  |
| **Mobile app (JS)**     | `eas update:republish` the previous update on the `production` channel                                                                                                                                | minutes    |
| **Mobile app (binary)** | Halt the phased release (App Store / Play Console), then ship a fixed build                                                                                                                           | hours–days |

**Decide quickly.** If a release is followed by any of these, roll back first and investigate afterwards:

- new errors;
- the 5xx alert;
- failing smoke tests;
- an emergency-path alert.

Rolling back is cheap and rehearsed on every pull request. To go forward again, run "Roll back" with the newer revision, or release a fix.

**After a rollback:** open an incident ([incident-response.md](incident-response.md)), note the bad SHA, and add a test that would have caught it.

## Rehearsals

| Rehearsal                                   | How often                     | Evidence                                                                                                                      |
| ------------------------------------------- | ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Deploy, smoke test, roll back, roll forward | Every pull request (CI)       | "Release rehearsal" job summary: from the previous release, and from an older release across a schema change (migration 0041) |
| Backup and restore                          | Every pull request (CI)       | "Load tests and restore drill" ([slo.md](slo.md))                                                                             |
| Rollback on staging with the real workflow  | Before launch, then monthly   | Run "Roll back" on staging; record it below                                                                                   |
| Cloud SQL point-in-time restore             | Before launch, then quarterly | [Backup and restore runbook](backup-restore-runbook.md#drill-log)                                                             |

### Staging rollback log

| Date      | From → to revision | Smoke test after | Who | Notes                                        |
| --------- | ------------------ | ---------------- | --- | -------------------------------------------- |
| _pending_ |                    |                  |     | First run once staging exists (owner action) |

## Mobile app

- **Builds:** `eas build --profile staging` (internal distribution) or `--profile production` (store). The version number increments automatically.
- **Store release:** TestFlight / internal testing first. Then a **phased release**: App Store phased release over 7 days, or Play staged rollout 10 % → 50 % → 100 %. Watch crash-free sessions (Crashlytics) before widening.
- **Over-the-air updates (EAS Update)** carry JavaScript-only fixes on the `staging` and `production` channels. They must stay compatible with the API that's live. Native changes need a store build.
- **API compatibility:** old app versions stay in use for months. The API only adds fields and endpoints; removing something a released app uses needs the app to stop using it first, the same as a contract migration.

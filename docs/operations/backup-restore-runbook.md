# Backup and restore runbook

**Targets** ([SRS §7](../product/SRS.md#7-non-functional-requirements)): RPO ≤ 15 minutes, RTO ≤ 4 hours for the pilot. A logical restore drill runs automatically on every CI run (below). The Cloud SQL point-in-time drill must be performed and timed on staging before launch, and then quarterly.

## What is backed up

| Data                                               | Mechanism                                                                                                | Retention                                                                      |
| -------------------------------------------------- | -------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Cloud SQL (all relational data, audit log, outbox) | Automated daily backups + **point-in-time recovery** (write-ahead logs)                                  | 7 days PITR; 30 daily backups (raise for production once OQ-03 sets retention) |
| Cloud Storage buckets (documents, media)           | Object versioning + soft delete (7 days); production adds a dual-region or cross-region copy (Prompt 29) | Per bucket lifecycle policy                                                    |
| Firebase Auth users                                | Exported nightly with `firebase auth:export` to a restricted bucket (Prompt 29 job)                      | 30 days                                                                        |
| Secrets                                            | Secret Manager versions (never deleted, only disabled)                                                   | All versions                                                                   |
| Code, migrations, infrastructure                   | Git (GitHub)                                                                                             | Permanent                                                                      |

**Not** backed up: Redis (cache, rate limits and pub/sub only; rebuildable by design) and the local development stack.

## Decide first

| Situation                                                    | Action                                                                                                                                                                                                                                                                |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bad deploy, schema intact                                    | **Don't restore.** Roll back the Cloud Run revision (`gcloud run services update-traffic fleettrust-api --to-revisions=<previous>=100`). Migrations are expand/contract, so the previous revision works ([database.md](../development/database.md#rollback-strategy)) |
| Bad data change (bug, wrong admin action) affecting few rows | Restore to a **new instance** at a point just before the change, copy the affected rows back, and audit the repair                                                                                                                                                    |
| Database lost or corrupted, or a destructive migration       | Full point-in-time restore to a new instance and cut over (below)                                                                                                                                                                                                     |
| Region outage                                                | Restore the latest backup into another region (cross-region backups enabled in production)                                                                                                                                                                            |

Every restore is an incident: open an incident record, note who decided what, and when.

## Point-in-time restore of Cloud SQL (to a new instance)

Restoring **never overwrites** the live instance. Clone to a new one, verify, then switch.

```sh
PROJECT=fleettrust-staging; REGION=europe-west1; SRC=fleettrust-staging
TARGET=fleettrust-restore-$(date -u +%Y%m%d%H%M)
POINT="2026-11-19T10:15:00Z"   # UTC, just before the incident (from logs or the audit trail)

# 1. Clone at the chosen point in time (minutes to tens of minutes depending on size)
gcloud sql instances clone $SRC $TARGET --point-in-time "$POINT" --project $PROJECT

# 2. Verify: migrations table, row counts of key tables, latest audit event before POINT
gcloud sql connect $TARGET --user=fleettrust_app --database=fleettrust
#   SELECT count(*) FROM drizzle.__drizzle_migrations;
#   SELECT max(occurred_at) FROM audit_events;            -- should be <= POINT
#   SELECT code FROM currencies LIMIT 1;

# 3. Cut over: point the secret at the new instance and redeploy (new revision picks it up)
printf 'postgresql://fleettrust_app:<password>@/fleettrust?host=/cloudsql/%s' "$PROJECT:$REGION:$TARGET" \
  | gcloud secrets versions add fleettrust-database-url --data-file=-
#   Update GCP_CLOUDSQL_CONNECTION_NAME to the new instance, then run "Deploy API to staging".

# 4. Smoke test: /health/ready must report the database ok; spot-check recent records.
# 5. Keep the old instance (stopped) until the incident is closed; then delete it.
```

## Restoring from a daily backup (no PITR available)

```sh
gcloud sql backups list --instance $SRC
gcloud sql instances create $TARGET --database-version=POSTGRES_17 --region=$REGION --tier=db-custom-1-3840
gcloud sql backups restore <BACKUP_ID> --restore-instance=$TARGET --backup-instance=$SRC
```

Then continue from step 2 above. Data after the backup time is lost; record the gap in the incident.

## Cloud Storage objects

```sh
gcloud storage ls --all-versions gs://<bucket>/<path>               # find the generation
gcloud storage cp gs://<bucket>/<path>#<generation> gs://<bucket>/<path>   # restore that version
```

## After any restore

- Re-run `pnpm db:migrate` against the restored instance if it predates a migration that has since shipped.
- Events after the restore point may still sit in queues (outbox relays and Cloud Tasks are idempotent; review the dead-letter queue).
- Write the post-incident review, including actual RPO and RTO versus targets.

## Automated restore drill (every CI run)

The CI job "Load tests and restore drill" ([performance.yml](../../.github/workflows/performance.yml), script [restore-drill.ts](../../tools/perf/src/restore-drill.ts)) rehearses a logical backup and restore on every pull request and every push to `main`. It runs against the database the load test has just filled: about 150,000 rows, including 20,000 provider branches, messages, incidents and the audit log.

1. Stop the API and worker, so nothing writes during the comparison. `pg_dump` alone is consistent anyway, because it reads one MVCC snapshot.
2. `pg_dump -Fc --no-owner` of the database, using the server's own tools (same version).
3. Create a new database and `pg_restore --exit-on-error` into it.
4. Verify:
   - **Row counts:** every table in `public` and `drizzle` matches.
   - **Content:** md5 checksums of users, the audit log, search entries (with geometry), messages and emergency incidents match.
   - **Migrations:** the migration history is identical.
   - **PostGIS:** a geospatial query on the copy returns results.
5. Drop the copy. Any mismatch fails the job.

It proves that backups made with our schema (PostGIS, check constraints, partial indexes, functions such as `branch_is_open`) restore completely and work. It doesn't replace the Cloud SQL point-in-time drill, which tests the managed backups, the time to clone, and the cut-over.

## Drill log

| Date       | Environment                      | Scenario                                              | RPO achieved                | RTO achieved                                            | Notes                                                                                                                                                                                   |
| ---------- | -------------------------------- | ----------------------------------------------------- | --------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2026-11-25 | CI (PostgreSQL 17 + PostGIS 3.6) | Logical backup → restore into a new database → verify | 0 (snapshot at backup time) | Backup 0.7 s + restore 2.4 s for 7.5 MiB / 146,936 rows | **Passed** (PR #30, commit `4bc2c48`): 92 tables, row counts identical, 5 checksums equal, migration history matches, geospatial query returned 4,450 branches. Repeats on every CI run |
| _pending_  | staging                          | Cloud SQL PITR clone + cut-over                       |                             |                                                         | **Owner action before launch** once staging exists (Prompt 29). Time each step; target RPO ≤ 15 min, RTO ≤ 4 h                                                                          |

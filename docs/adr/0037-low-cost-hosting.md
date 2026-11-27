# ADR-0037: Low-cost hosting for the pilot: website on Vercel, database on Neon, optional Redis, no fixed-cost cloud parts

- Status: Accepted (all three steps done: see "Plan")
- Date: 2026-11-27
- Amends: [ADR-0003](0003-postgresql-postgis-system-of-record.md) (where Postgres runs), [ADR-0004](0004-firebase-hybrid-platform.md) (website hosting, Cloud SQL, Memorystore), [ADR-0007](0007-jobs-and-realtime.md) (worker), [ADR-0036](0036-staging-production-and-launch.md) (sizing)

## Context

FleetTrust is an early-stage startup. The owner can pay for only three things:

- a paid Vercel plan;
- domains;
- the Firebase Blaze plan (pay as you go).

The Terraform setup from ADR-0036 has parts that cost money every hour, even with no users. Staging's are estimated at **USD 150–200 a month** (2026-11):

- Cloud SQL;
- Memorystore Redis;
- an e2-medium ClamAV VM and Cloud NAT;
- an always-on worker on Cloud Run;
- with `api_domain`, a global load balancer and Cloud Armor.

Production would cost more. Staging was applied and then paused (billing unlinked on 2026-11-26) partly for this reason.

Firebase Blaze and Google Cloud share one billing account. Cloud Run, Cloud Storage, KMS and Secret Manager are pay per use, with monthly free allowances that a pilot stays within. They can stay.

## Decision

Keep the architecture (modular monolith API, Postgres + PostGIS, Firebase), but host it so that **nothing has a fixed monthly fee**:

| Part                       | Before                                    | Now                                                                                                                                    |
| -------------------------- | ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| Website                    | Firebase App Hosting                      | **Vercel** (already paid), project root `apps/web`, [vercel.json](../../apps/web/vercel.json)                                          |
| Database                   | Cloud SQL (fixed hourly cost)             | **Neon** free plan (Postgres with PostGIS and `btree_gist`), URL in the secret `fleettrust-database-url`                               |
| Redis                      | Memorystore (fixed hourly cost), required | **Optional**: none at first, or Upstash's free plan (`rediss://`)                                                                      |
| API                        | Cloud Run, 0–4 instances (staging)        | Unchanged: Cloud Run scales to zero; production also starts at 0 instances                                                             |
| Virus scanning             | ClamAV on an always-on VM, plus Cloud NAT | **ClamAV on Cloud Run, scaled to zero** ([apps/scanner](../../apps/scanner)); the API calls it over HTTPS with a Google identity token |
| Worker (jobs, emergencies) | Cloud Run, one instance always on         | **On demand** (`WORKER_MODE=on-demand`): scaled to zero, woken by Cloud Tasks and Cloud Scheduler; emergencies keep their timing       |
| Load balancer, Cloud Armor | With `api_domain`                         | Not used: leave `api_domain` empty and map the API domain directly to Cloud Run                                                        |

Terraform gets two settings:

- `database_provider`: `external` (default) or `cloudsql`;
- `redis_provider`: `none` (default), `external` or `memorystore`.

The managed options still work: moving to Cloud SQL or Memorystore later is a change of one variable, not a rewrite.

With an external database or Redis, Terraform creates only the empty secret. The owner adds the URL as a secret version by hand, so the password never reaches the Terraform state.

## Consequences

- **Cost:** on top of Vercel, domains and Firebase, a pilot costs close to nothing until real usage grows. Free plans have limits (Neon storage and compute hours, Upstash commands, Cloud Run free allowance), so check them before launch and whenever usage grows. The budget alert stays on.
- **Without Redis:**
  - rate limits and the route cache are per API instance;
  - a realtime message reaches clients on another instance only through replay (`docs/operations/slo.md`).

  At pilot size there is usually one instance. Add Upstash when the API often runs more than one.

- **Neon:**
  - its compute suspends after a few idle minutes, so the first query after a pause takes about a second longer;
  - anything that polls the database every few seconds keeps it awake and uses up the free compute hours. This is another reason for step 3.
  - point-in-time restore depends on the Neon plan; the backup runbook covers both providers.
- **WebSockets:** an open realtime connection keeps a Cloud Run instance active and billed. With few users this stays small; it is the first thing to watch on the bill.
- **Vercel:** the website's environment variables are set in the Vercel project, not in `apphosting.*.yaml`. `WEB_URL`, the API's CORS origin and the quarantine bucket's CORS origin (`web_origins`) must use the Vercel domain.
- **Data residency (OQ-02):**
  - Neon and Vercel each let you pick a region. Use a European one for the database, for example Neon `aws-eu-central-1` (Frankfurt).
  - The Vercel functions region is `cdg1` (Paris), close to the API in `europe-west1`.

## Plan

1. **Done in this change:**
   - optional Cloud SQL and Memorystore in Terraform (lean defaults);
   - Redis optional in the API;
   - deploy templates and workflows without the Cloud SQL link and Redis secret when they aren't used;
   - Vercel configuration;
   - documentation.
2. **Done:** ClamAV as a scale-to-zero Cloud Run service (`apps/scanner`: clamd behind a dependency-free Node HTTP server).
   - The API's `clamav-http` scanner calls it over HTTPS with a Google identity token and still fails closed.
   - Only the API's runtime account may call it (`roles/run.invoker`).
   - The release deploys it (`deploy/cloudrun/scanner.sh`).
   - Signatures come baked into the image, and freshclam fetches the day's updates at start-up.
   - CI builds the image and checks that real ClamAV finds the EICAR test file.
   - The ClamAV VM and Cloud NAT are created only with `malware_scanner = "vm"`.
   - The first scan after a quiet period waits for ClamAV to load (about 20–60 s), so that upload takes longer.
3. **Done:** the worker on demand (`WORKER_MODE=on-demand`). The worker service scales to zero, with CPU only during requests.
   - **Wake-ups:** after every successful write, the API asks Cloud Tasks to start a worker run. It waits for that call before answering, because Cloud Run gives almost no CPU after a response. At most one call per instance every 2 s, except emergency routes, which always call.
   - **A run** (`WorkerRunner`) does exactly what the timers do in `loop` mode: the emergency pass every `EMERGENCY_TICK_MS` (1 s) and the outbox relay, for up to `WORKER_RUN_MS` (50 s). It ends after three quiet passes.
   - **While an emergency is active**, each run books the next one right away. Escalation after 120 s, email fallback and the 5 s / 15 s / 45 s retries keep their timing.
   - **Future work:** otherwise the run books a wake-up at the next delivery or outbox retry.
   - **Cloud Scheduler** runs a safety-net run every 15 minutes (for a lost wake-up), reminders hourly and retention daily.
   - **Access:** only `fleettrust-jobs` may invoke the worker (internal ingress, identity token).
   - **Cost:** the worker costs nothing while idle. While an emergency is active, it runs continuously: about USD 2 a day, at most 12 hours per incident.
   - **`loop` mode** (always-on timers) is still the default for local development, CI and the release rehearsals.

If a wake-up can't be created, the API logs an error and the next safety-net run (at most 15 minutes later) catches up. An emergency already active keeps its own chain of runs. The first push of a new alert is still sent inline by the API, as before.

## Alternatives considered

- **Stay on Cloud SQL's smallest shared-core tier:** cheaper than today, but still a fixed fee every hour, and the shared-core tiers aren't covered by the Cloud SQL SLA.
- **Run the API on Vercel functions too:** one host instead of two, but the API's WebSocket realtime channel and Firebase Admin, KMS and Cloud Storage access fit Cloud Run better. Cloud Run is pay per use on the existing Firebase billing.
- **Supabase instead of Neon:** also free with PostGIS, but its free projects pause after a week without activity and need a manual restart. Neon resumes on the next query.

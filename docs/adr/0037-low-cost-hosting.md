# ADR-0037: Low-cost hosting for the pilot: website on Vercel, database on Neon, optional Redis, no fixed-cost cloud parts

- Status: Accepted (step 1 of 3 done: see "Plan")
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

| Part                       | Before                                    | Now                                                                                                                       |
| -------------------------- | ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Website                    | Firebase App Hosting                      | **Vercel** (already paid), project root `apps/web`, [vercel.json](../../apps/web/vercel.json)                             |
| Database                   | Cloud SQL (fixed hourly cost)             | **Neon** free plan (Postgres with PostGIS and `btree_gist`), URL in the secret `fleettrust-database-url`                  |
| Redis                      | Memorystore (fixed hourly cost), required | **Optional**: none at first, or Upstash's free plan (`rediss://`)                                                         |
| API                        | Cloud Run, 0–4 instances (staging)        | Unchanged: Cloud Run scales to zero; production also starts at 0 instances                                                |
| Virus scanning             | ClamAV on an always-on VM, plus Cloud NAT | Step 2: ClamAV on Cloud Run that scales to zero                                                                           |
| Worker (jobs, emergencies) | Cloud Run, one instance always on         | Step 3: woken on demand by Cloud Tasks (exact times for emergency escalation) and Cloud Scheduler (hourly and daily jobs) |
| Load balancer, Cloud Armor | With `api_domain`                         | Not used: leave `api_domain` empty and map the API domain directly to Cloud Run                                           |

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
2. **Next:** ClamAV as a scale-to-zero Cloud Run service. The API calls it over HTTPS with a Google identity token; it still fails closed. The ClamAV VM and Cloud NAT are then removed.
3. **Then:** the worker on demand. Cloud Tasks wakes it when an emergency delivery or escalation is due (keeping today's 120-second escalation and 5 s / 15 s / 45 s retries), when the outbox has messages, and Cloud Scheduler runs the hourly and daily jobs. The always-on worker is then removed.

Until steps 2 and 3 are done, the ClamAV VM, Cloud NAT and the always-on worker are the remaining fixed costs (roughly USD 70–80 a month together). Don't apply staging or production until then, unless the owner accepts that cost.

## Alternatives considered

- **Stay on Cloud SQL's smallest shared-core tier:** cheaper than today, but still a fixed fee every hour, and the shared-core tiers aren't covered by the Cloud SQL SLA.
- **Run the API on Vercel functions too:** one host instead of two, but the API's WebSocket realtime channel and Firebase Admin, KMS and Cloud Storage access fit Cloud Run better. Cloud Run is pay per use on the existing Firebase billing.
- **Supabase instead of Neon:** also free with PostGIS, but its free projects pause after a week without activity and need a manual restart. Neon resumes on the next query.

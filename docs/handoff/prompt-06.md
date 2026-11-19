# Handoff — Prompt 06: Authentication and minimal signup

- Date: 2026-11-19
- Status: **awaiting owner approval** · PR **#6**
- Prompt 05 approved and merged (PR #1). `main` is protected by the "main protection" ruleset (PR + 5 checks, no force-push, linear history, no deletion).

## What was built

| Area         | Details                                                                                                                                                                                                                                                                                                                                  |
| ------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data         | `users` (Firebase UID → internal UUIDv7, optional display name, status, last sign-in provider); `audit_events.actor_id` FK to `users` (migrations `0003`, `0004`)                                                                                                                                                                        |
| API guard    | Global `AuthGuard`: every route needs a Firebase ID token unless `@Public()`. Verifies via an `AuthVerifier` port (firebase-admin adapter), App Check via an `AppCheckVerifier` port (`off`/`monitor`/`enforce`). Creates the account on first sign-in, concurrency-safe, with a `user.signed_up` audit event. Blocks suspended accounts |
| Decorators   | `@Public`, `@CurrentUser`, `@CurrentAuth`, `@CheckRevoked` (sensitive routes), `@RequireRecentLogin(s)` (destructive actions), `@RequireDisplayName` (contributions)                                                                                                                                                                     |
| Endpoints    | `GET /v1/me`, `PATCH /v1/me` (display name, validated), `POST /v1/me/sessions/revoke` ("sign out everywhere")                                                                                                                                                                                                                            |
| Throttling   | Redis (atomic Lua) or in-memory limiter: failed auth 20 / 10 min per IP (valid tokens never count), per-user limits on profile and revoke. Trusted-proxy client IP. Fails open on a Redis outage                                                                                                                                         |
| Safety rails | API and web refuse to start in staging or production with an Auth-emulator host (it accepts forged tokens) or a `demo-` project. Production requires `APP_CHECK_MODE=enforce`. Deployed environments require `REDIS_URL`                                                                                                                 |
| SDK          | `getIdToken` / `getAppCheckToken` hooks; `me()`, `updateMe()`, `revokeAllSessions()`; `ApiError.reason`, `requiresSignIn`, `retryAfterSeconds`                                                                                                                                                                                           |
| Web          | `/sign-in` (email link, Google, Apple), `/auth/finish` (browser-only via `use(browser())`, re-asks for the email on another device), `/account` (display name, sign out, sign out on all devices)                                                                                                                                        |
| Deploy       | Cloud Run template adds `FIREBASE_PROJECT_ID`, `APP_CHECK_MODE`, `TRUST_PROXY_HOPS=1`, `REDIS_URL` secret; staging runs App Check in `monitor`                                                                                                                                                                                           |
| Docs         | [docs/operations/authentication.md](../operations/authentication.md): flows, error reasons, throttling, account recovery, Firebase console setup                                                                                                                                                                                         |

**Deferred (by design):** mobile sign-in to Prompt 25 (needs `@react-native-firebase` and an Expo dev build); admin MFA to Prompt 26 (Identity Platform, OQ-12); account deletion and export to Prompt 27 (will use `@RequireRecentLogin`).

## Acceptance criteria

| Criterion                       | Evidence                                                                                                                                                                                                                                                                 |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Registration/login tests        | Local: first sign-in creates the account plus an audit event, the next sign-in returns the same account, 6 concurrent first requests give 1 account and 1 audit event. CI: **real email-link and Google sign-in against the Auth emulator** with the production verifier |
| Invalid token tests             | Missing, malformed, illegal-character, unknown, expired, revoked and disabled tokens, plus wrong-project tokens (CI). Suspended account → 403                                                                                                                            |
| Rate-limit tests                | 21st failed attempt from one IP → 429 with `Retry-After`, while valid users on that IP still pass. Per-user limit on sign-out-everywhere. Redis limiter atomic under 40 parallel hits (CI)                                                                               |
| No required documents at signup | A token with no email and no name still creates a usable account. The display name is only required by contribution routes                                                                                                                                               |

## Evidence (actual results)

| Check                                          | Result                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `lint typecheck test build` | **Pass**: 39/39 tasks, **251 tests** (api 83, db 41, local-infra 44, repo-guards 22, ui 22, web 16, sdk 10, env 5, mobile 5, types 3)                                                                                                                                                                                                                                                                                                                             |
| Schema drift, module guard, format             | **Pass**                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| CI on PR #6 (run 13, commit `cfcc720`)         | **4/5 green**, including `local-infra`: **real email-link and Google sign-in, wrong-project tokens and Firebase revocation against the Auth emulator**, plus Redis limiter atomicity on real Redis. **security failed**: high advisory GHSA-m9gg-hp2v-232j in `@grpc/grpc-js` via the `firebase` umbrella package (Firestore). Fixed in the next commit (see notes); re-run pending ([run](https://github.com/winner-dev123/FleetTrust/actions/runs/44593970489)) |

## Decisions and notes

- **Email link, not one-time codes:** Firebase has no native email OTP, and the pack allows either (ADR-0005).
- **Module-boundary lint fix:** the Prompt 02 rule wrongly blocked modules from importing the shared kernel (`../../config`, `../../platform`, …). The pattern is fixed, with tests in both directions.
- **`@fleettrust/db` re-exports Drizzle operators** (`eq`, `and`, …) so the API never installs a second Drizzle copy with incompatible types.
- **Install script denied:** `@firebase/util` (postinstall bakes App Hosting auto-config; we configure explicitly).
- **Web uses modular `@firebase/app` + `@firebase/auth`, not the `firebase` umbrella.** The umbrella pulls in Firestore and `@grpc/grpc-js` (high advisory GHSA-m9gg-hp2v-232j), which CI's audit caught. We never use Firestore (ADR-0004), so the vulnerable code is no longer installed at all. Versions match `firebase` 13.3.0 exactly.
- **Dependabot:** ignore rules added for `@types/node` ≥ 25 (runtime is Node 24), PostGIS majors (Cloud SQL 17) and Redis ≥ 7.3 (Memorystore 7.2). Dependabot PRs #2, #3 and #5 propose exactly these and should be closed. #4 (minor/patch group) can be merged if its CI is green.
- `apps/web/tsconfig.tsbuildinfo` (a build cache committed by mistake in stage 01) is untracked and `*.tsbuildinfo` ignored. `apps/web/AGENTS.md` is generated by Next.js and kept.

## Before production (owner)

- Firebase console: enable Email link, Google and Apple; set authorized domains; register App Check providers ([setup](../operations/authentication.md#firebase-console-setup-per-environment)).
- Apple sign-in needs an Apple Developer account (OQ-19).
- **GitHub email privacy:** turn on Settings → Emails → "Keep my email addresses private". With the new ruleset, merges happen on GitHub, and web merges otherwise stamp your Gmail into the public history.

## Next: Prompt 07 — Organizations, memberships and RBAC

Organizations (provider and fleet), memberships, invitations with expiry and revocation, role permissions, branch scope, organization switching, a tenancy guard producing `TenantContext`, cross-tenant integration tests using `expectTenantIsolation()`, and a decision on Postgres row-level security as a second layer.

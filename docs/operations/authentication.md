# Authentication

Firebase Authentication proves **who** someone is; the API decides **what** they may do ([ADR-0005](../adr/0005-authn-firebase-authz-api.md)). Signup is minimal: an email link, or a Google or Apple account. There are no passwords, no forms and no documents (SRS FR-01).

## How sign-in works

| Step | Where              | What happens                                                                                                                                                                                         |
| ---- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1    | Web `/sign-in`     | The user enters an email (Firebase emails a one-time link) or picks Google or Apple                                                                                                                  |
| 2    | Web `/auth/finish` | The link is redeemed. The address is remembered on the requesting device; opened elsewhere, the user must re-type it, so an intercepted link alone isn't enough                                      |
| 3    | Any API call       | `Authorization: Bearer <Firebase ID token>`. The global `AuthGuard` verifies it (firebase-admin) and finds or creates the internal `users` row. The first call writes a `user.signed_up` audit event |
| 4    | Afterwards         | The Firebase SDK refreshes the 1-hour ID token automatically. The SDK client attaches the current one to every request                                                                               |

Mobile sign-in (`@react-native-firebase`, Expo dev build) arrives with Prompt 25; it uses the same API contract.

## API behaviour

| Concern             | Behaviour                                                                                                                                                                                                                                            |
| ------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Default             | **Every route requires sign-in** unless decorated `@Public()` (health checks)                                                                                                                                                                        |
| Identity mapping    | `users.firebase_uid` ↔ `users.id` (UUIDv7). Only `users.id` is used elsewhere or returned to clients                                                                                                                                                 |
| Errors              | `401 { reason }` with `missing_token`, `malformed_token`, `invalid_token`, `expired_token` (refresh and retry), `revoked_token`, `user_disabled`, `reauthentication_required`, `app_check_failed`. `403 account_suspended`. `409 profile_incomplete` |
| Revocation          | `@CheckRevoked()` routes (account changes, admin actions) look up revocation on every call. Other routes accept a token until it expires (≤ 1 h)                                                                                                     |
| Sign out everywhere | `POST /v1/me/sessions/revoke` revokes all refresh tokens. Sensitive routes reject old tokens immediately                                                                                                                                             |
| Recent login        | `@RequireRecentLogin(seconds)` for destructive actions (e.g. account deletion in Prompt 27). It checks when the user actually signed in, not when the token was refreshed                                                                            |
| Display name        | Optional. `@RequireDisplayName()` routes (articles, comments, groups) return `409 profile_incomplete` until it's set. 1–50 characters, no control or formatting characters                                                                           |
| Suspension          | `users.status = 'suspended'` blocks all authenticated routes (moderation tooling: Prompt 26)                                                                                                                                                         |
| App Check           | `APP_CHECK_MODE` `off` (local), `monitor` (staging: log only), `enforce` (required in production). Header `X-Firebase-AppCheck`                                                                                                                      |

## Abuse throttling

| Limit                         | Scope         | Window          | Response                                                                                                                          |
| ----------------------------- | ------------- | --------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| Failed authentication         | per client IP | 20 per 10 min   | `429` + `Retry-After`. Valid tokens never consume this budget, so real users aren't locked out by an attacker on the same network |
| `POST /v1/me/sessions/revoke` | per user      | 5 per 10 min    | `429`                                                                                                                             |
| `PATCH /v1/me`                | per user      | 20 per hour     | `429`                                                                                                                             |
| Sign-in emails, OAuth         | Firebase      | Firebase quotas | Built-in Firebase throttling and abuse detection; App Check in production                                                         |

Limits are shared across instances through Redis (`REDIS_URL`; Memorystore when deployed). If Redis is unreachable the limiter **fails open** and logs a warning: availability and emergency flows outrank throttling. The client IP is taken `TRUST_PROXY_HOPS` entries from the right of `X-Forwarded-For` (Cloud Run: 1), so spoofed left-hand entries are ignored.

## Account recovery

- **Lost device or signed out:** sign in again with an email link or Google/Apple. There are no passwords to reset.
- **Lost access to the email address or the Google/Apple account:** support case (Prompt 26 admin tooling). Identity is verified out of band before support links a new sign-in method. Every step is audited. Never change an account's email on request alone.
- **Compromised account:** "Sign out on all devices" (account page) revokes every session. Support can also disable the Firebase user, which the API reports as `user_disabled`.

## Firebase console setup (per environment)

1. Authentication → Sign-in method:
   - Enable **Email/Password** with **Email link (passwordless sign-in)**.
   - Enable **Google**.
   - Enable **Apple**: needs an Apple Developer account with a Services ID and key (OQ-19). Apple sign-in is mandatory on iOS when Google is offered (KC-01).
2. Authentication → Settings → **Authorized domains**: the web app's domains only. Remove `localhost` from production.
3. Upgrade to **Identity Platform** if admin MFA is needed (OQ-12, Prompt 26).
4. App Check: register the web app (reCAPTCHA Enterprise) and mobile apps (Play Integrity, App Attest). Start in `monitor` mode in staging and switch production to `enforce`.
5. Web app config (`NEXT_PUBLIC_FIREBASE_*`): Project settings → Your apps. These are public identifiers, not secrets.

## Local development

```sh
pnpm emulators                         # Auth emulator on 127.0.0.1:9099 (needs Java 21)
# apps/api/.env:  FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
# apps/web/.env.local: NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST=127.0.0.1:9099
pnpm dev
```

Sign-in emails appear in the Emulator UI (http://127.0.0.1:4000/auth) instead of an inbox. **The emulator accepts unsigned tokens**, so the API and web apps refuse to start with an emulator host configured in staging or production.

## Tests

| Suite                                                                         | Covers                                                                                                                                                                                                                                                                |
| ----------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apps/api/test/identity.e2e-spec.ts`                                          | Registration and login, concurrent first sign-in (one account, one audit event), invalid, expired, revoked and disabled tokens, suspension, display-name rules, recent-login, sign out everywhere, failed-auth and per-user throttling, App Check enforce and monitor |
| `apps/api/test/integration/firebase-auth.int-spec.ts` (CI `local-infra`)      | **Real email-link and Google sign-in against the Auth emulator** with the production firebase-admin verifier, wrong-project tokens, Firebase-side revocation                                                                                                          |
| `apps/api/test/integration/redis-rate-limiter.int-spec.ts` (CI `local-infra`) | Atomic limits under concurrency on real Redis; counters always expire                                                                                                                                                                                                 |
| `packages/sdk/src/client.test.ts`, `apps/web/src/**/*.test.ts`                | Token attachment, reason codes, Retry-After, email-link helpers, env safety rules                                                                                                                                                                                     |

# ADR-0005: Authentication by Firebase, authorization by the API

- Status: Accepted
- Date: 2026-11-19

## Context

Firebase Authentication proves _who_ a user is. FleetTrust's permissions depend on several things:

- Organization membership.
- Branch scope.
- Admin sub-roles.
- Plan entitlements.
- Verification state.

These change often, and changes must take effect immediately, for example when a member is removed. Firebase custom claims are size-limited and only refresh when the ID token refreshes, which can take up to about an hour.

## Decision

1. Clients sign in with the Firebase client SDK:
   - Email link (passwordless).
   - Google.
   - Apple (mandatory on iOS when Google is offered).
2. Clients send the **Firebase ID token** as `Authorization: Bearer` and the **App Check token** as `X-Firebase-AppCheck` on every API call.
3. The API verifies the ID token with the Firebase Admin SDK. Sensitive operations also check revocation (`checkRevoked`): logout everywhere, admin actions, emergency acknowledgement by contacts.
4. The API maps `firebase_uid` → an internal `users.id` (UUID). The row is created just-in-time on first verified call. **Internal UUIDs are used everywhere**; Firebase UIDs never appear in domain tables other than the identity mapping.
5. **All authorization happens in the API** using Postgres data:
   - Every org-scoped request names its organization (`X-Org-Id` header or path segment).
   - Guards check membership, role, branch scope and entitlements.
   - Custom claims are **not** used for permissions. At most a non-authoritative `admin: true` hint is used for UI routing.
6. Logout everywhere = `revokeRefreshTokens(uid)`, plus the API rejecting tokens issued before the revocation time.
7. Admin accounts must enrol **TOTP MFA** through Identity Platform. The API rejects admin-scope calls whose token doesn't show a second factor.
8. Rate limits on sign-in attempts rely on Firebase's built-in throttling, App Check, and API-side limits (Redis) for endpoints we own.
9. Email **one-time codes** aren't native to Firebase Auth. The pack allows "one-time code **or** magic link", so we use email link. A code flow can be added later via custom tokens if needed.

## Consequences

- A membership change takes effect on the next API call; there's no wait for token refresh.
- Firebase is replaceable: swapping the `AuthVerifier` adapter plus client SDK calls doesn't touch authorization code.
- Every API call needs a valid token. WebSocket connections authenticate on connect and re-validate periodically.
- Security rules for any Firebase product the client touches directly (Storage) must be **deny-by-default** ([ADR-0006](0006-object-storage-and-private-documents.md)), because authorization lives in the API.

## Alternatives considered

- **Custom claims for roles**: rejected because of staleness and the size limit.
- **Self-built auth (sessions, OTP)**: rejected. More attack surface; Firebase/Identity Platform already provides vetted flows.

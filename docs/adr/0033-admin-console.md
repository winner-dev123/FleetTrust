# ADR-0033: Admin console with mandatory staff MFA, least-privilege roles, confirmed irreversible actions and scoped audit search

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 26 builds the admin console (SRS F-080 to F-085) for:

- verification;
- plan activation and quota overrides;
- moderation;
- the service taxonomy and feature configuration;
- audit search and support.

The acceptance criteria are **admin MFA, least privilege, audit logs and confirmation of irreversible actions**.

Already in place:

- **Staff roles in `platform_staff`, granted by `pnpm db:staff`:** billing operator, verification reviewer and trust and safety moderator. Non-staff get 404.
- **Existing staff APIs:** verification review (Prompt 09), billing (Prompt 08), moderation, sanctions and appeals (Prompts 15 and 23).
- **Audit:** every staff action already writes `audit_events`.
- **Read-only web page:** `/app/admin` was a read-only overview (Prompt 24).
- **Second factor already decoded:** the ID token's `sign_in_second_factor` is read but never enforced.
- **TOTP needs Identity Platform** (OQ-12, default: assume yes).

## Decision

1. **Admin MFA is enforced by the API.**
   - Every staff route requires the current sign-in to have used a second factor (`sign_in_second_factor` in the ID token, TOTP through Identity Platform). Otherwise: 403 `mfa_required`.
   - **Exception:** `GET /v1/admin/me` reports the MFA state, so the console can send people to set it up.
   - **Configuration:** `ADMIN_MFA` defaults to `required`. `off` is allowed only in local and test (the Auth emulator has no TOTP), and config validation refuses it in staging and production.
   - **On the web:**
     - a setup page enrols an authenticator app (`TotpMultiFactorGenerator`);
     - both sign-in paths (email link and Google/Apple) ask for the code when Firebase reports `auth/multi-factor-auth-required`.
2. **Least privilege: five roles, each a separate API surface.**
   - Two roles are added from SRS §2.3:
     - `super_admin`: staff roles, feature settings, service categories;
     - `support_agent`: account metadata and sign-in help.
   - **No overlap:** a super admin does **not** get billing, verification or moderation powers. Those roles are granted separately.
   - **Not discoverable:** routes for a role answer 404 to everyone else (an API test checks every role against every section).
   - **Own roles:** nobody can change their own roles, so one compromised account can't grant itself more. The first super admin comes from the CLI.
3. **Irreversible actions need a recent sign-in and an explicit confirmation.**
   - **Which actions:** `@Irreversible(action)` marks:
     - badge revocation;
     - the document purge;
     - ending a plan assignment;
     - granting and revoking staff roles;
     - "sign out everywhere" for an account.
   - **What the API checks:**
     - the sign-in must be at most 10 minutes old (401 `reauthentication_required`);
     - the request must carry `X-Confirm-Action: <action>` (428 `confirmation_required`).
   - **The client:**
     - the SDK makes the action name a required argument of those methods;
     - the console sends it only after the person types a phrase (the email address, or REVOKE / PURGE / END / SIGN OUT) into a confirmation dialog.
4. **Feature settings: a fixed list, stored in the database, audited.**
   - **Where defined:** `FEATURE_SETTINGS` in `@fleettrust/types` defines each key, schema, default and whether it's public.
   - **Storage:** the `feature_settings` table holds overrides (wrapped as `{value}`, so JSON null isn't SQL NULL).
   - **The first settings, all wired into real behaviour:**
     - `signups.paused`: new accounts get 403 `signups_paused`; existing accounts are unaffected;
     - `community.auto_hide_reporters`: replaces the constant 3;
     - `site.notice`: a public banner on the web, loaded after the page so it never delays one.
   - **No future-module flags (ADR-0011).** A new key is a code change.
   - **Audit:** changes record the before and after values (`feature.setting_changed`).
5. **Service taxonomy: presentation and availability, not new codes.**
   - **Codes stay in code:** the seven category codes are used by database checks, labels and search filters, so adding or renaming one stays a code change.
   - **What admins edit** (in `service_category_settings`): the description, the order, and whether new offerings may use a category.
   - **Enforcement:** `POST`/`PUT` offerings answer 409 `category_closed`; existing offerings stay.
   - **Public list:** `GET /v1/taxonomy` returns the list in admin order.
6. **Audit search with per-role scope.**
   - `GET /v1/admin/audit` filters by action (exact, or a family ending in `.`), actor, target, organization and time. It pages newest first with a keyset cursor.
   - **Scope by role** (`AUDIT_SCOPES`): reviewers see `verification.*`, billing operators `plan.*` and `entitlement.*`, moderators the moderation families, support `support.*` and `user.*`. Super admins see everything.
   - **Searches are audited:** every search writes `admin.audit_searched`, with the filters used.
   - **New indexes:** on `occurred_at` and on `(action text_pattern_ops, occurred_at)`.
7. **Support works through cases.**
   - **What support sees:** support agents look up account metadata only (status, dates, organizations, counts; never documents, messages or request contents). Each lookup is audited.
   - **Cases first:** account actions happen inside an open `support_cases` row:
     - "sign out everywhere" (Firebase refresh-token revocation);
     - emailing a sign-in link to the account's **own** address.
   - **No account takeover:** support never sees the link and can't send it elsewhere. Closed cases refuse actions (409 `case_closed`).
   - **History:** case history comes from the audit log (`target_type = support_case`).
8. **Console structure.**
   - **The frame:** `/app/admin` loads `adminMe`, shows only the sections the person's roles allow, and gates everything except the setup page on MFA.
   - **Pages:** verification queue and case review (single-use document links), plans and quotas, moderation queue and member standing, support, staff roles, feature settings, service categories, audit log.
   - **Staff detection:** the signed-in navigation now uses `adminMe` instead of the trust dashboard, so staff without MFA can still reach the setup page.

## Consequences

- **Before staff can use deployed consoles:** Identity Platform with TOTP must be enabled on the Firebase project (OQ-12), and each staff member enrols an app.
- **Lost phones:** a staff member who loses their phone needs a super admin to reset MFA in the Firebase console. There is no self-service recovery code yet.
- **Revoking a badge from the console** takes the badge ID (from an appeal or the audit log). A per-subject badge list for reviewers is a follow-up.
- **The mock API in the browser tests** decides staff and MFA by email prefix. The real enforcement is covered by API tests against the real guards.

## Alternatives considered

- **Custom claims for staff roles:** they refresh only when the ID token does (up to an hour), so revocation would lag; the database check is immediate.
- **Requiring MFA for everyone:** out of scope for consumers. MFA is for staff only.
- **Confirmation tokens issued by the API (two requests):** a single header after a typed confirmation gives the same protection against accidental or scripted calls, with simpler clients. The recent-sign-in check covers stolen long-lived sessions.
- **A generic key/value flag store:** rejected by ADR-0011; every setting must be typed, documented and wired.

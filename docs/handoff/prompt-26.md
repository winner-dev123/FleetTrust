# Handoff — Prompt 26: Administration and operations

- Date: 2026-11-24
- Status: **approved** · merged as PR #28 → `c5338d6` (CI 6/6 green on `4611b09`)
- Prompt 25 approved and merged (PR #27 → `f621a16`).

## Assumptions

- **Staff MFA uses Identity Platform TOTP** (the OQ-12 default). The API enforces it. Local and test turn it off (`ADMIN_MFA=off`), because the Auth emulator has no TOTP. Staging and production refuse `off`.
- **Two new staff roles from SRS §2.3:** `super_admin` and `support_agent`. A super admin manages staff, settings and categories only; billing, verification and moderation powers are separate roles.
- **"Service taxonomy" means presentation and availability.** The seven category codes stay in code (database checks and labels use them). Admins edit descriptions, order, and whether new offerings may use a category.
- **"Feature configuration" means a fixed, typed list** of real server-side settings, never flags for unbuilt modules (ADR-0011).
- **Support** sees account metadata only, and acts only through audited cases.

## What was built

| Area                 | Details                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Admin MFA            | Staff routes require `sign_in_second_factor` (403 `mfa_required`); `GET /v1/admin/me` reports the MFA state. Web: authenticator-app enrolment page, and a code step in both sign-in flows                                                                                                                                 |
| Least privilege      | Five roles, each a separate API surface (404 to everyone else); nobody changes their own roles; the console shows only permitted sections                                                                                                                                                                                 |
| Irreversible actions | `@Irreversible`: recent sign-in (10 min) plus `X-Confirm-Action`; the console asks for a typed phrase. Badge revoke, document purge, ending a plan, staff grant/revoke, sign out everywhere                                                                                                                               |
| Staff management     | `/v1/admin/staff`, grant by email and revoke (super admins), audited                                                                                                                                                                                                                                                      |
| Feature settings     | `feature_settings` table and `FEATURE_SETTINGS` registry: `signups.paused` (blocks new accounts), `community.auto_hide_reporters` (replaces the constant 3), `site.notice` (website banner via `GET /v1/config`); before/after audited                                                                                    |
| Service categories   | `service_category_settings`; `GET /v1/taxonomy`; closed categories refuse new offerings (409 `category_closed`)                                                                                                                                                                                                           |
| Audit search         | `GET /v1/admin/audit`: filters, keyset paging, per-role scope (`AUDIT_SCOPES`), every search audited; new indexes                                                                                                                                                                                                         |
| Support              | Metadata lookup (audited), cases, "sign out everywhere", sign-in link emailed only to the account's own address, close; actions refused on closed cases                                                                                                                                                                   |
| Console (web)        | `/app/admin` frame with role-based sections and an MFA gate; pages for verification (queue, case review with single-use document links, appeals, badge revoke, purge), plans and quotas, moderation (queue, case, member standing, sanctions, appeals), support, staff, settings, categories, audit log, two-step sign-in |
| SDK                  | Admin methods, including the existing billing and verification staff routes; irreversible methods take the action name                                                                                                                                                                                                    |
| Database             | Migrations `0039_admin_console` (tables, roles, audit indexes) and `0040_admin_console_triggers`                                                                                                                                                                                                                          |
| Docs                 | [ADR-0033](../adr/0033-admin-console.md), [architecture/admin.md](../architecture/admin.md)                                                                                                                                                                                                                               |

## Acceptance criteria

| Criterion                         | Evidence                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Admin MFA                         | **API tests:** staff routes refuse sign-ins without a second factor (403 `mfa_required`); `/v1/admin/me` reports the MFA state; non-staff get 404 even with MFA. **Config:** `ADMIN_MFA=off` is refused in staging and production. **Web:** enrolment page; code step at sign-in (component tests); staff without MFA can open only the setup page (browser test). |
| Least privilege                   | **API test:** each of the five roles against every staff section (allowed → 200, others → 404). Own-role changes → 403 `own_roles`. Audit search scope per role. **Web:** section list per role (unit test); members see no console (browser test).                                                                                                                |
| Audit logs                        | New actions audited: `staff.role_granted/revoked`, `feature.setting_changed` (before/after), `taxonomy.category_updated`, `support.*`, `admin.audit_searched`. **API tests** check them. **Audit search:** scoped per role, paged, forged cursors refused; works in the console (browser test).                                                                    |
| Irreversible actions confirmation | **API tests:** without the header → 428; with a stale sign-in → 401 `reauthentication_required`; with the wrong action → 428; the existing irreversible routes (badge revoke, purge, ending a plan) now require it. **Web:** the confirmation button stays disabled until the exact phrase is typed (component test and browser test).                             |

## Evidence (actual results)

- **`pnpm check`:** passes locally (prettier, module guard: 846 files, 39/39 turbo tasks).
- **Tests:**
  - API **348** (was 326; 21 new admin tests plus one adapter test);
  - web **64** (was 54);
  - SDK 34; types 84; db 96 + 6 skipped; mobile 81.
- **Browser tests:** **26** pass locally (was 18), including 3 console journeys and the console pages' accessibility checks, at desktop size and on a 320 px phone.
- **Drift check:** no schema changes after the two migrations.
- **Checked that the tests catch regressions** (each broke the tests, then was restored):
  - no MFA check;
  - no confirmation check;
  - own roles allowed;
  - audit scope ignored;
  - a super admin given billing powers;
  - actions allowed on a closed support case;
  - the sign-up pause ignored;
  - the confirmation button enabled without the phrase.
- **Bugs found while testing (fixed):** clearing a setting (`null`) became an SQL NULL in a NOT NULL column; values are now stored wrapped.

## Not built here (gaps)

- **Self-service MFA recovery:** recovery codes or a second factor. A super admin resets it in the Firebase console.
- **Badges by subject:** a reviewer view of a subject's badges. Revocation takes the badge ID.
- **More settings:** only three are wired; others come with the features that need them.
- **Draft-and-publish plan editing:** plans still change through code review and seeds (ADR-0015).
- **Audit export, and alerting on admin actions:** Prompts 27 and 29.

## Before production (owner)

- **OQ-12:** upgrade to Identity Platform and enable TOTP MFA; every staff member enrols an authenticator app.
- **First super admin:** `pnpm db:staff grant <email> super_admin` on each environment.
- **`PUBLIC_WEB_URL`:** set per environment (support sign-in links continue there).
- **OQ-06 (email provider):** support sign-in links use the email adapter, which only records until a vendor is chosen.

## Next: Prompt 27 — Security and privacy hardening

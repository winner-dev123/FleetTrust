# Admin console

The design decision is [ADR-0033](../adr/0033-admin-console.md). The web pages live in `apps/web/src/app/app/admin`. The API is spread across modules:

- `admin`: staff, settings, categories, audit and support;
- `verification`, `entitlements` and `moderation`: their own staff routes.

## Roles (least privilege)

| Role                     | Console sections                                  | API                                                              |
| ------------------------ | ------------------------------------------------- | ---------------------------------------------------------------- |
| `super_admin`            | Staff roles, Feature settings, Service categories | `/v1/admin/staff*`, `/v1/admin/features*`, `/v1/admin/taxonomy*` |
| `verification_reviewer`  | Verification                                      | `/v1/admin/verification/*`                                       |
| `billing_operator`       | Plans and quotas                                  | `/v1/admin/billing/*`                                            |
| `trust_safety_moderator` | Moderation                                        | `/v1/moderation/*`                                               |
| `support_agent`          | Support                                           | `/v1/admin/support/*`                                            |

- **For every role:** Overview, Audit log (scoped) and Two-step sign-in. The trust dashboard is shared by reviewers and moderators.
- **Discoverability:** everyone without the role gets **404**.
- **Own roles:** nobody can change their own roles.
- **Separate powers:** a super admin doesn't get the other roles' powers unless granted them.

**Bootstrap the first super admin** (the person must have signed in once):

```sh
pnpm db:staff grant ops-lead@example.com super_admin
```

After that, super admins grant roles in the console.

## Admin MFA

- **What's required:** every staff route needs the current sign-in to have used a second factor (TOTP authenticator app through Identity Platform). Otherwise: 403 `mfa_required`.
- **The exception:** `GET /v1/admin/me` answers without it and reports `{ mfa: { required, satisfied } }`.
- **Enrolment:** the console's **Two-step sign-in** page enrols an app. The person then signs in again with the code.
- **Signing in:** the email link and Google/Apple both show the code step when Firebase asks for it.
- **Configuration:** `ADMIN_MFA` is `required` by default. `off` is allowed only in local and test (the Auth emulator has no TOTP), and is refused in staging and production.

**Owner setup (OQ-12):**

1. Upgrade the Firebase project to Identity Platform.
2. Enable TOTP multi-factor authentication in the Identity Platform settings.
3. Each staff member enrols an app.
4. To reset a lost authenticator, a super admin removes the factor in the Firebase console.

## Irreversible actions

| Action                         | Endpoint                                           | Typed phrase in the console |
| ------------------------------ | -------------------------------------------------- | --------------------------- |
| `badge.revoke`                 | `POST /v1/admin/verification/badges/:id/revoke`    | REVOKE                      |
| `verification.purge`           | `POST /v1/admin/verification/purge`                | PURGE                       |
| `plan.end_assignment`          | `POST /v1/admin/billing/assignments/:id/end`       | END                         |
| `staff.grant` / `staff.revoke` | `POST /v1/admin/staff/grant` / `revoke`            | the person's email          |
| `support.revoke_sessions`      | `POST /v1/admin/support/cases/:id/revoke-sessions` | SIGN OUT                    |

What the API checks:

- the sign-in is at most **10 minutes** old (401 `reauthentication_required`);
- the request carries **`X-Confirm-Action: <action>`** (428 `confirmation_required`).

In the SDK, the action name is a required argument of these methods.

## Feature settings

| Key                             | Type               | Default | Public | Effect                                                             |
| ------------------------------- | ------------------ | ------- | ------ | ------------------------------------------------------------------ |
| `signups.paused`                | boolean            | false   | no     | New accounts get 403 `signups_paused`; existing ones still sign in |
| `community.auto_hide_reporters` | integer 2–10       | 3       | no     | Distinct reporters that hide content until a moderator decides     |
| `site.notice`                   | text ≤ 280 or null | null    | yes    | Banner at the top of the website (`GET /v1/config`)                |

- **Endpoints:** `GET /v1/admin/features` and `PUT /v1/admin/features/:key { value }` (super admin).
- **Validation:** values are checked against the schema in `FEATURE_SETTINGS`.
- **Audit:** every change is audited with the before and after values.
- **New keys** are added in code. Never add flags for unbuilt modules (ADR-0011).

## Service categories

- **Public list:** `GET /v1/taxonomy`, in admin order.
- **Admin edits:** `PUT /v1/admin/taxonomy/:category { description?, sortOrder?, acceptingNewOfferings? }` (super admin).
- **Closed categories:** a closed category refuses new offerings (409 `category_closed`); existing offerings stay.
- **Codes:** adding or renaming a category code is a code change.

## Audit search

`GET /v1/admin/audit` takes these filters:

- `action`: exact, or a family such as `verification.`;
- `actorEmail` or `actorId`;
- `targetType`, `targetId`, `organizationId`;
- `from`, `to`;
- `cursor` and `limit` (at most 100).

Results come newest first, as `{ items, nextCursor, scope }`.

| Role                  | Searches                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| super admin           | everything                                                                                                                        |
| verification reviewer | `verification.*`                                                                                                                  |
| billing operator      | `plan.*`, `entitlement.*`                                                                                                         |
| moderator             | `moderation.*`, `power_user.*`, `content_report.*`, `article.*`, `article_comment.*`, `group.*`, `job.*`, `user.suspension_ended` |
| support agent         | `support.*`, `user.*`                                                                                                             |

Every search writes `admin.audit_searched`.

## Support

| Endpoint                                                             | What                                                                   |
| -------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `GET /v1/admin/support/accounts?email=` or `?userId=`                | Account metadata only; audited `support.account_viewed`                |
| `POST /v1/admin/support/cases { userId, reason }`                    | Opens a case (`support.case_opened`)                                   |
| `GET /v1/admin/support/cases?status=open\|closed`, `GET …/cases/:id` | Cases, with their history from the audit log                           |
| `POST …/cases/:id/send-sign-in-link`                                 | Emails a sign-in link to the account's own address; staff never see it |
| `POST …/cases/:id/revoke-sessions`                                   | Signs the account out everywhere (irreversible, confirmed)             |
| `POST …/cases/:id/close { resolution }`                              | Closes the case; later actions get 409 `case_closed`                   |

## Configuration

| Variable         | Default                              | Notes                                                 |
| ---------------- | ------------------------------------ | ----------------------------------------------------- |
| `ADMIN_MFA`      | `required` (`off` in local and test) | `off` is refused in staging and production            |
| `PUBLIC_WEB_URL` | `http://localhost:3000`              | Support sign-in links continue to `<web>/auth/finish` |

## Data

- `feature_settings` (key, `{value}`, who, when);
- `service_category_settings` (category, description, order, accepting new offerings);
- `support_cases`;
- `platform_staff` allows the two new roles;
- new audit indexes on time and on action family.

Migrations: `0039_admin_console`, `0040_admin_console_triggers`.

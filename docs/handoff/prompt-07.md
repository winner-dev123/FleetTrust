# Handoff — Prompt 07: Organizations, memberships and RBAC

- Date: 2026-11-19
- Status: **approved** · PR **#7** squash-merged as `8a250d9` (CI 5/5 green on `f5006bd`)
- Prompt 06 approved and merged (PR #6 → `d608ab2`).

## Assumptions

- "Provider organizations" and "fleet organizations" are one `organizations` table with a `kind`. Kind-specific profile data (services, coverage, verification) comes in Prompts 09–11 and 19–22.
- "User profiles" were delivered in Prompt 06 (`/v1/me`). This stage adds the organization side.
- Roles are fixed per kind, with permissions in code. Custom roles are out of scope (ADR-0014).
- Invitation emails need the notifications stage (17). Until then the inviter shares the one-time link.

## What was built

| Area      | Details                                                                                                                                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Data      | `organizations`, `branches`, `memberships`, `invitations` (migrations `0005`, `0006`). Composite FKs make the role valid for the organization's kind and keep branch scope inside the same organization. One open invitation per email per organization; token stored as SHA-256 only. `audit_events.organization_id` now has an FK |
| Tenancy   | `@OrgPermission('<perm>')` + `TenancyGuard`: non-member, unknown or malformed `:orgId` → 404; suspended organization → 403; missing permission → 403. Attaches `TenantAccess` (branded `TenantContext`, role, permissions, branch scope); `@CurrentTenant()` injects it                                                             |
| RBAC      | Owner, admin, manager, staff (providers), driver and recruiter (fleets). Branch-scoped manager, staff and driver. Only owners touch the owner role. The last owner can't be demoted, removed or leave; changes lock the organization row and re-check the caller's role under the lock                                              |
| Endpoints | Create and list (switcher), get and rename organizations; branches CRUD; members list, update and remove/leave; invitations create, list and revoke; `POST /v1/invitations/accept`. See [organizations-and-roles.md](../architecture/organizations-and-roles.md#api)                                                                |
| Invites   | 256-bit token shown once, carried in the URL **fragment**, 7-day expiry. Re-invite supersedes the old one. Accepting requires the invited **verified** email; expired, revoked and used → 410 with a reason                                                                                                                         |
| Audit     | 11 event types (org, branch, member, invitation), each with organization and request ID, never tokens or invitee emails                                                                                                                                                                                                             |
| SDK       | 15 organization methods; `ApiError.reason` now covers organization reasons; path IDs URL-encoded                                                                                                                                                                                                                                    |
| Web       | `/invitations/accept` (token moved out of the address bar, kept through sign-in, clear messages per reason); sign-in returns to a pending invitation; the account page lists your organizations                                                                                                                                     |
| Docs      | [ADR-0014](../adr/0014-tenancy-and-rbac.md) (tenancy and RBAC; RLS deferred to Prompt 27), [organizations-and-roles.md](../architecture/organizations-and-roles.md) (model, roles, API, error reasons, how later modules use the guard), isolation test plan updated                                                                |
| Also      | Shared `parseBody()` validation helper (MeController uses it too). `@fleettrust/db` re-exports `count`, `gt`, `lte`. Dependabot now ignores **all** React updates (React Native needs the exact version Expo pins; Dependabot #4 proposed React 19.3.1)                                                                             |

## Acceptance criteria

| Criterion                           | Evidence                                                                                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant access forbidden       | `apps/api/test/organizations.e2e-spec.ts`: an owner of org B calling all **12** org-A routes gets 404 each time. A's branch, member and invitation IDs used through B's own org → 404. A's branch ID in B's invitation body → 400 `branch_not_found`. A's data checked unchanged afterwards. `expectTenantIsolation()` passes over HTTP (branches) and at repository level (branches, memberships, invitations) |
| Invitation expiry works             | Invitation with `expires_at` in the past → 410 `invitation_expired`, no membership created                                                                                                                                                                                                                                                                                                                      |
| Invitation revocation works         | Revoked → 410 `invitation_revoked`; second revoke → 404; re-invite supersedes (old token → 410 `invitation_revoked`, new one works); used token → 410 `invitation_used`                                                                                                                                                                                                                                         |
| Roles, branch scope, owner safety   | Admin can't invite, demote or remove owners or promote themselves (403 `owner_role_required`); last owner can't demote or leave (409); concurrent owner demotions leave exactly one success and at least one owner; drivers can't list members; branch-scoped staff see only their branch; a branch-scoped manager sees only their branch's members                                                             |
| DB and TypeScript role tables agree | Every role × kind inserted against the database check matches `ROLES_BY_KIND`                                                                                                                                                                                                                                                                                                                                   |

## Evidence (actual results)

| Check                                 | Result                                                                                                                                                                                                                                 |
| ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local, whole repo: `pnpm check`       | **Pass**: format, module guard, 39/39 turbo tasks (lint, typecheck, test, build). Tests: api **107** (+24), db **52** (+11), sdk **14** (+4), web **18** (+2), local-infra 44, repo-guards 22, ui 22, env 5, types 3, mobile unchanged |
| Schema drift (`drizzle-kit generate`) | "No schema changes"                                                                                                                                                                                                                    |
| Postgres 17 (`pnpm test:db`) / CI     | Not run locally (no Docker). CI's `database` job runs the db suites on Postgres 17 for this PR                                                                                                                                         |

## Decisions and notes

- **404, not 403, for other tenants.** A non-member can't tell "exists" from "doesn't exist". 403 is only for members lacking a permission.
- **`ON DELETE RESTRICT` raises SQLSTATE 23001**, not 23503. The branch-delete path handles both; noted in [database.md](../development/database.md).
- **Branch deletion** clears the branch from closed invitations and is refused while members or open invitations use it.
- **Faster test databases:** CI's first run timed out (60 s hook) on the new e2e file. Booting PGlite + PostGIS and migrating took about 50–60 s per file on a loaded runner. `createTestDatabase()` now loads a migrated snapshot, built once per run by a Vitest `globalSetup`, cached in the OS temp dir and keyed by the migration files and PGlite versions. Locally the API suite went from 13.3 s to 6.7 s. `migrate: false` still gives an empty database, so the migration chain is still tested from zero.
- **Leaving** is `DELETE …/members/<own membershipId>`; any member may do it, except the last owner.
- **Migration notes:** `0005_organizations` creates the four tables and adds the `audit_events.organization_id` FK. Safe on existing data, because all existing audit rows have a null organization. `0006` adds the `updated_at` triggers. Forward-only, like every migration.

## Before production (owner)

- Nothing new to configure. Invitation emails arrive with Prompt 17; until then, invite links are shared manually.

## Next: Prompt 08 — Subscription catalog and entitlements

Plans and features catalog, manual plan assignment per organization (ADR-0008), an entitlement check API with quotas. Trust signals and emergency stay independent of entitlements (ADR-0009, ADR-0010; already lint-enforced).

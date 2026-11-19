# ADR-0014: Tenancy and role-based access in the API, row-level security later

- Status: Accepted
- Date: 2026-11-19
- Refines: [ADR-0005](0005-authn-firebase-authz-api.md) (authorization lives in the API)

## Context

Prompt 07 adds organizations: providers (workshops, towing, parts) and fleets. Every later business table (catalog, requests, vehicles, jobs) is owned by one organization, and a user can belong to several. We need:

1. A single place that turns "user X asks about organization Y" into a checked tenant context.
2. Roles with fixed permissions, some limited to one branch.
3. Invitations that expire, can be revoked, and can't be redeemed by someone else.
4. A decision on Postgres row-level security (RLS) as a second layer (Prompt 04 deferred it to here).

## Decision

1. **Tenant in the URL, not in a session.** Org routes are `/v1/orgs/:orgId/…`. "Switching organization" is a client concern: `GET /v1/orgs` lists the caller's memberships with role and permissions, and the client picks one. No server-side "current organization" state can go stale or leak across tabs.
2. **`@OrgPermission('<permission>')` + `TenancyGuard`.** The guard runs after the global `AuthGuard` and:
   - answers **404** if `:orgId` is malformed, unknown, or the caller isn't a member (other tenants can't be probed);
   - answers **403 `organization_suspended`** for suspended organizations;
   - answers **403 `insufficient_permission`** if the role lacks the permission;
   - otherwise attaches `TenantAccess` (branded `TenantContext`, organization, membership, role, permissions, branch scope).
     It is the only code that mints a `TenantContext` from user input. Repositories take the context and filter with `tenantFilter()`; resource lookups by ID are scoped too, so `/orgs/B/branches/<A's id>` is also 404.
3. **Roles map to fixed permissions in code** (`@fleettrust/types`: `ROLE_PERMISSIONS`). Roles valid per kind are enforced by the database as well (`memberships_role_valid_for_kind`):

   | Role      | Provider | Fleet | Branch-scopable | Permissions                                 |
   | --------- | -------- | ----- | --------------- | ------------------------------------------- |
   | owner     | ✓        | ✓     |                 | all, including `owners.manage`              |
   | admin     | ✓        | ✓     |                 | all except `owners.manage`                  |
   | manager   | ✓        | ✓     | ✓               | `org.read`, `branches.read`, `members.read` |
   | staff     | ✓        |       | ✓               | `org.read`, `branches.read`                 |
   | driver    |          | ✓     | ✓               | `org.read`, `branches.read`                 |
   | recruiter |          | ✓     |                 | `org.read`                                  |

   Later prompts add domain permissions (`catalog.manage`, `vehicles.read`, …) to the same table. Custom roles are out of scope until there is demand (they'd need a permissions table and an admin UI).

4. **Composite foreign keys carry the invariants into the database:** a membership's `(organization_id, organization_kind)` must match the organization, and `(branch_id, organization_id)` must match a branch _of the same organization_. A bug in the API can't scope a member to another tenant's branch.
5. **Invitations:** a 256-bit token, shown once, stored as SHA-256 only. The link carries it in the URL fragment so it never reaches server logs or `Referer`. Accepting requires the invited email to equal the caller's **verified** Firebase email. Invitations expire after 7 days. Re-inviting the same email revokes the previous one (at most one open invitation per email per organization, enforced by a partial unique index). Expired, revoked and used tokens get **410** with a specific reason.
6. **Owner safety:** only owners grant, change or remove the owner role. The last owner can't be demoted, removed or leave. Membership changes lock the organization row (`SELECT … FOR UPDATE`) and re-check the caller's own role under the lock, so concurrent demotions can't remove every owner.
7. **RLS is deferred to Prompt 27 (security hardening), not rejected.** Today the API connects as one role and every query goes through `tenantFilter()`, a branded type and these tests. RLS would need a per-transaction `SET LOCAL app.org_id`, policies on every tenant table, and a separate role for cross-tenant jobs (search indexing, admin, outbox). That's a sound second layer once the table set is stable. Prompt 27 decides with real query patterns in hand.

## Consequences

- Every tenant-scoped controller method must carry `@OrgPermission()`. Forgetting it fails closed: `CurrentTenant` throws, so the handler returns 500 rather than unscoped data. The module-boundary lint plus the per-resource `expectTenantIsolation()` tests catch the rest.
- Permissions are compiled in. Changing what a role can do is a code change with review and tests, not a runtime setting.
- Invitation emails aren't sent yet: the inviter gets the link once and shares it. Delivery comes with notifications (Prompt 17). The token isn't in the outbox, so the sender will issue a fresh invitation (superseding the old one) at send time.
- Platform administrators (Prompt 26) will reach tenants through a separate audited admin path, never by faking membership.

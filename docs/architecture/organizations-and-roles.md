# Organizations, memberships and roles

How tenants work in FleetTrust (SRS FR-02). Design rationale: [ADR-0014](../adr/0014-tenancy-and-rbac.md). Isolation tests: [tenant-isolation-test-plan.md](../qa/tenant-isolation-test-plan.md).

## Model

```
users ──< memberships >── organizations ──< branches
             │  role, branch_id?            kind: provider | fleet
             │                              status: active | suspended
invitations ─┘ (email, role, branch_id?, token_hash, expires_at, accepted_*/revoked_*)
```

| Table           | Key rules (enforced in Postgres)                                                                                                                                                                                          |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `organizations` | `kind` provider/fleet, `status` active/suspended, name 2–120 characters. Never deleted (`ON DELETE RESTRICT` everywhere)                                                                                                  |
| `branches`      | Name unique per organization, ignoring case                                                                                                                                                                               |
| `memberships`   | One per user per organization. Role must be valid for the organization's kind (composite FK carries the kind). `branch_id` must be a branch of the **same** organization (composite FK) and only for manager/staff/driver |
| `invitations`   | Token stored as SHA-256 only, unique. Email lower-case. At most one open invitation per email per organization. Accepted and revoked are mutually exclusive, each with who and when                                       |

`audit_events.organization_id` now references `organizations`.

## Roles and permissions

Defined once in `@fleettrust/types` (`ROLES_BY_KIND`, `ROLE_PERMISSIONS`). The database check and the TypeScript table are kept in step by an API test.

| Role      | Provider | Fleet | Can be branch-scoped | Permissions                                                                                                                                                                                                                                                                                                                   |
| --------- | :------: | :---: | :------------------: | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| owner     |    ✓     |   ✓   |                      | everything, including `owners.manage`                                                                                                                                                                                                                                                                                         |
| admin     |    ✓     |   ✓   |                      | `org.read`, `org.update`, `branches.read`, `branches.manage`, `members.read`, `members.manage`, `invitations.manage`, `verification.manage`, `profile.manage`, `catalog.manage`, `hours.manage`, `requests.create`, `requests.manage`, `requests.respond`, `articles.publish`, `groups.host`, `vehicles.manage`, `crm.manage` |
| manager   |    ✓     |   ✓   |          ✓           | `org.read`, `branches.read`, `members.read`, `catalog.manage`, `hours.manage`, `requests.create`, `requests.manage`, `requests.respond`, `articles.publish`, `groups.host`, `vehicles.manage`, `crm.manage` (branch-scoped: own branch only)                                                                                  |
| staff     |    ✓     |       |          ✓           | `org.read`, `branches.read`, `requests.respond`                                                                                                                                                                                                                                                                               |
| driver    |          |   ✓   |          ✓           | `org.read`, `branches.read`, `requests.create` (own requests)                                                                                                                                                                                                                                                                 |
| recruiter |          |   ✓   |                      | `org.read`                                                                                                                                                                                                                                                                                                                    |

A branch-scoped member sees only their branch in `GET …/branches`. A branch-scoped manager sees only that branch's members (plus themselves) in `GET …/members`. A branch-scoped manager edits only their branch's hours and offerings limited to their branch (Prompt 11). Later prompts add domain permissions (requests, vehicles, jobs) to the same table.

## Using the tenancy guard (for later modules)

```ts
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";

@Get(":orgId/vehicles")
@OrgPermission("vehicles.read")
list(@CurrentTenant() access: TenantAccess) {
  return this.vehicles.list(access.tenant); // repositories filter with tenantFilter(table, tenant)
}
```

- The route path must contain `:orgId`. The guard runs after sign-in and answers 404 for non-members, so tenant IDs can't be probed.
- Look up child resources **with** the tenant filter: `/orgs/B/things/<A's id>` must be 404 too.
- Add the resource to the isolation test plan with an `expectTenantIsolation()` case and HTTP cross-tenant tests.

## API

All routes need a Firebase ID token. 🔒 marks routes that also check token revocation (`@CheckRevoked`).

| Method & path                                  | Permission                                                    | Notes                                                                                                                                                                 |
| ---------------------------------------------- | ------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /v1/orgs`                                | signed in                                                     | `{ kind, name }` → 201 `MyOrganization`; caller becomes owner. 10 per user per day                                                                                    |
| `GET /v1/orgs`                                 | signed in                                                     | The caller's organizations with role, branch and permissions (organization switcher)                                                                                  |
| `GET /v1/orgs/:orgId`                          | `org.read`                                                    | `MyOrganization`                                                                                                                                                      |
| `PATCH /v1/orgs/:orgId`                        | `org.update`                                                  | `{ name }`                                                                                                                                                            |
| `GET /v1/orgs/:orgId/branches`                 | `branches.read`                                               | Narrowed to the caller's branch if scoped                                                                                                                             |
| `POST /v1/orgs/:orgId/branches`                | `branches.manage`                                             | `{ name }`; 409 `branch_name_taken`                                                                                                                                   |
| `PATCH /v1/orgs/:orgId/branches/:branchId`     | `branches.manage`                                             | `{ name }`                                                                                                                                                            |
| `DELETE /v1/orgs/:orgId/branches/:branchId`    | `branches.manage`                                             | 409 `branch_in_use` while members or open invitations are scoped to it                                                                                                |
| `GET /v1/orgs/:orgId/members`                  | `members.read`                                                | Narrowed to the caller's branch if scoped                                                                                                                             |
| `PATCH /v1/orgs/:orgId/members/:membershipId`  | `members.manage` (+`owners.manage` for owners) 🔒             | `{ role?, branchId? }`; 409 `last_owner`                                                                                                                              |
| `DELETE /v1/orgs/:orgId/members/:membershipId` | any member for self (leave), else `members.manage` 🔒         | 409 `last_owner`                                                                                                                                                      |
| `GET /v1/orgs/:orgId/invitations`              | `invitations.manage`                                          | Open invitations (expired ones included, see `expiresAt`)                                                                                                             |
| `POST /v1/orgs/:orgId/invitations`             | `invitations.manage` (+`owners.manage` to invite an owner) 🔒 | `{ email, role, branchId? }` → `{ invitation, token, acceptPath }`. **The token is shown once.** Supersedes an open invitation to the same email. 50 per user per day |
| `DELETE /v1/orgs/:orgId/invitations/:id`       | `invitations.manage`                                          | Revoke; 404 if already closed                                                                                                                                         |
| `POST /v1/invitations/accept`                  | signed in 🔒                                                  | `{ token }` → `MyOrganization`. 10 per user per 10 min                                                                                                                |

Malformed or unknown IDs in paths are 404. Bodies are validated with the shared zod schemas (400 `validation_failed` with issue paths).

### Error reasons

Errors carry `{ statusCode, error, reason }` like the auth errors (`ApiError.reason` in the SDK):

| Status | `reason`                                                                                   | Meaning                                                                                 |
| ------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------- |
| 400    | `role_not_allowed`, `branch_not_found`                                                     | Role not valid for this kind, or not branch-scopable; branch isn't in this organization |
| 403    | `insufficient_permission`, `owner_role_required`, `organization_suspended`                 |                                                                                         |
| 403    | `invitation_email_mismatch`, `email_not_verified`                                          | Sign in with the invited, verified address                                              |
| 404    | `invitation_not_found` (accept only)                                                       | Other 404s carry no reason                                                              |
| 409    | `last_owner`, `already_member`, `branch_name_taken`, `branch_in_use`, `membership_changed` | `membership_changed`: your own role changed while the request ran; retry                |
| 410    | `invitation_expired`, `invitation_revoked`, `invitation_used`                              |                                                                                         |

### Invitation flow

1. An admin or owner calls `POST …/invitations` and gets `acceptPath` = `/invitations/accept#token=…`. Until email delivery exists (Prompt 17), they share the link themselves.
2. The invitee opens the link. The web page moves the token out of the address bar and keeps it through sign-in.
3. After sign-in, the page calls `POST /v1/invitations/accept`. The API checks the token hash, that the invitation is open and unexpired (7 days), that the organization is active, and that the caller's **verified** email equals the invited email. Then it creates the membership and marks the invitation used, in one transaction.

### Audit events

`org.created`, `org.updated`, `branch.created`, `branch.renamed`, `branch.deleted`, `member.role_changed`, `member.removed`, `member.left`, `invitation.created`, `invitation.revoked`, `invitation.accepted`. All carry `organization_id` and the request ID. They never contain tokens or invitee emails.

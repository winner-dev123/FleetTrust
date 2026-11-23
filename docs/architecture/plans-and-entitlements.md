# Plans and entitlements

How plans, quotas and billing-operator actions work (SRS F-010..F-013, FR-03..FR-05). Design rationale: [ADR-0008](../adr/0008-manual-plan-activation.md) (manual activation) and [ADR-0015](../adr/0015-entitlements-model.md) (counters, grace, overrides). Plans buy **capacity only**: never badges, verification or ranking ([ADR-0009](../adr/0009-trust-independent-of-payment.md)). Emergency features never touch any of this ([ADR-0010](../adr/0010-emergency-exempt-from-quotas.md)).

## Capabilities

| Key                      | Kind     | Applies to         | Counted as                                 | Enforced from                                    |
| ------------------------ | -------- | ------------------ | ------------------------------------------ | ------------------------------------------------ |
| `friend_requests.daily`  | daily    | user               | successful outgoing requests per local day | Prompt 16                                        |
| `service_requests.daily` | daily    | user, organization | requests created per local day             | Prompt 14                                        |
| `articles.daily`         | daily    | user, organization | articles submitted per local day           | **now**: first publication of each article       |
| `groups.daily`           | daily    | user, organization | groups created per local day               | Prompt 16                                        |
| `staff.seats`            | capacity | organization       | members + pending (unexpired) invitations  | **now**: inviting; accepting checks members only |
| `branches.max`           | capacity | organization       | branches                                   | **now**: creating a branch                       |

## Sample catalog (OQ-09: limits and prices are placeholders)

| Plan            | Audience | Default | Price (display only) | Limits                                                                  |
| --------------- | -------- | :-----: | -------------------- | ----------------------------------------------------------------------- |
| `personal-free` | user     |    ✓    | —                    | friend requests 20/day, service requests 3, articles 2, groups 1        |
| `personal-plus` | user     |         | USD 4.99 / month     | 100, 10, 10, 5                                                          |
| `provider-free` | provider |    ✓    | —                    | 5 seats, 3 branches, articles 2/day, groups 1/day                       |
| `provider-pro`  | provider |         | USD 49 / month       | 50 seats, 20 branches, articles 20/day, groups 5/day                    |
| `fleet-free`    | fleet    |    ✓    | —                    | 10 seats, 3 branches, service requests 10/day, articles 2, groups 1     |
| `fleet-pro`     | fleet    |         | USD 99 / month       | 200 seats, 50 branches, service requests 200/day, articles 20, groups 5 |

To change the catalog, edit `packages/db/src/seed/plans.data.ts` and run `pnpm db:seed`. Changed plans get a new version; existing assignments keep theirs.

## Using entitlements in a feature (later prompts)

```ts
// Daily quota: consume inside the transaction that creates the thing.
await this.db.transaction(async (tx) => {
  await this.entitlements.consume(tx, subjectOfUser(user), "friend_requests.daily", {
    idempotencyKey: request.headers["idempotency-key"], // optional, client-supplied
  });
  await tx.insert(friendRequests).values(...);
});

// Capacity: hold the organization lock, then check.
await lockOrganization(tx, access.tenant);
await this.entitlements.assertCapacity(tx, subjectOfOrganization(access.organization), "branches.max");
```

Both throw **403** `{ reason: "quota_exceeded", key, limit, used }`.

## API

| Method & path                                     | Who                 | Notes                                                                                                                               |
| ------------------------------------------------- | ------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/entitlements`                         | signed in           | Personal plan, limits and usage meters                                                                                              |
| `GET /v1/orgs/:orgId/entitlements`                | any member          | Organization plan, limits and meters (`overLimit` after a downgrade)                                                                |
| `PATCH /v1/me` / `PATCH /v1/orgs/:orgId`          | self / `org.update` | `{ timeZone }` (IANA name): daily quotas reset at local midnight                                                                    |
| `GET /v1/admin/billing/plans`                     | billing operator    | Catalog with every version and its limits                                                                                           |
| `GET /v1/admin/billing/{organizations,users}/:id` | billing operator    | Current entitlements plus assignment and override history                                                                           |
| `POST /v1/admin/billing/assignments`              | billing operator    | `{ subject, planVersionId, externalReference, invoiceNumber?, note?, graceDays? (14), endsAt? }`. Supersedes the current assignment |
| `POST /v1/admin/billing/assignments/:id/end`      | billing operator    | Cancel now; its grace period starts. 409 `assignment_already_ended`                                                                 |
| `POST /v1/admin/billing/overrides`                | billing operator    | `{ subject, key, limit (null = unlimited), reason, expiresAt? }`. Replaces the open override for that key                           |
| `DELETE /v1/admin/billing/overrides/:id`          | billing operator    | Revoke                                                                                                                              |

Staff routes answer **404** to everyone without the role and check token revocation. Errors: 400 `plan_audience_mismatch`, `plan_version_not_assignable` (draft or retired), `capability_not_applicable`. All operator actions are audited with actor type `admin`: `plan.assigned`, `plan.assignment_ended`, `entitlement.override_set`, `entitlement.override_revoked`.

**Wording (ADR-0008):** say "Activated by FleetTrust staff on <date>". Never "paid", "payment verified" or "payment received". The API has no payment fields; `externalReference` points at wherever the external confirmation lives.

## Granting staff roles

Roles: `billing_operator` (plans), `verification_reviewer` (evidence), `trust_safety_moderator` (reports and article moderation, Prompt 15).

```sh
pnpm db:staff grant ops@example.com billing_operator   # the person must have signed in once
pnpm db:staff list
pnpm db:staff revoke ops@example.com billing_operator
```

Uses `DATABASE_URL` (add `--test` for `DATABASE_URL_TEST`). Every grant and revocation is written to the audit log as a system action. MFA-protected management comes with the admin console (Prompt 26).

## Downgrade behaviour

1. The operator assigns the lower plan. The previous assignment is marked `superseded`, and **its** `grace_days` start counting.
2. During grace, each limit is the more generous of the new plan and the old one (`source: "grace"`, `graceUntil`).
3. After grace, creation above the new limit gets 403. Existing members, branches and other data are untouched and still editable and deletable. Meters show `overLimit: true` until usage drops.
4. Accepting an invitation is refused once members reach the new seat limit, even if the invitation predates the downgrade.

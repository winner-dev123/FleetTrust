# Power User, sanctions, appeals and the trust and safety dashboard

SRS F-160, F-161, J9. Design: [ADR-0030](../adr/0030-power-user-sanctions-and-appeals.md).

## Power User

| Method & path                  | Who                                                                                                        |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `GET /v1/me/power-user`        | You: status, whether it's shown, each rule and how you stand                                               |
| `POST /v1/me/power-user`       | Claim it. Granted only if every rule passes; otherwise 409 `not_eligible` (`already_power_user` if active) |
| `GET /v1/users/:userId/status` | **No sign-in**: `{ powerUser, since, meaning }`                                                            |

**Rules** (`POWER_USER_RULES`):

| Rule              | Needs                                                                                                                          |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Verified identity | An active verified-driver badge                                                                                                |
| Account age       | ≥ 180 days                                                                                                                     |
| Activity          | Last 365 days: score ≥ 20, on ≥ 10 different days, from ≥ 2 kinds of activity                                                  |
| Standing          | Not suspended; no upheld decision in 180 days (rejected or hidden content, warning, suspension, revocation), unless overturned |

**Activity score:**

| Activity                  | Points | Counted up to |
| ------------------------- | ------ | ------------- |
| Published article         | 3      | 10            |
| Visible comment           | 1      | 30            |
| Completed service request | 2      | 10            |

**`GET /v1/me/power-user` response:**

```json
{
  "status": "none",
  "shown": false,
  "eligibility": {
    "eligible": false,
    "criteria": {
      "verifiedIdentity": {
        "met": false,
        "detail": "Needs a current verified-driver badge (identity check)"
      },
      "accountAge": { "met": true, "days": 230, "detail": "Account is 230 days old (needs 180)" },
      "activity": {
        "met": false,
        "score": 25,
        "activeDays": 12,
        "kinds": 1,
        "counts": { "publishedArticles": 0, "visibleComments": 25, "completedRequests": 0 },
        "detail": "Score 25/20, 12/10 active days, 1/2 kinds of activity in the last 365 days"
      },
      "standing": {
        "met": true,
        "upheldActions": 0,
        "detail": "No upheld moderation decisions in the last 180 days"
      }
    }
  },
  "meaning": "Earned through verified identity, account age, activity and good standing. Not a staff, moderator or professional endorsement, and it can't be bought."
}
```

- **No plan, payment, rating or review input exists.** The `power-user`, `verification` and `search` modules can't import entitlements or plan and quota tables (lint rule).
- **When the label shows:** only while the status is active, the identity badge is current and the account isn't suspended.

## Sanctions (trust and safety moderators)

| Method & path                                | Body                                                                                               |
| -------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `POST /v1/moderation/users/:id/sanctions`    | `{ kind: "warning", reason }` or `{ kind: "suspension", reason, days? }` (no `days`: until lifted) |
| `POST /v1/moderation/sanctions/:id/lift`     | `{ reason }`                                                                                       |
| `POST /v1/moderation/power-users/:id/revoke` | `{ reason }` (409 `not_revocable` if not active)                                                   |
| `GET /v1/moderation/users/:id/history`       | Sanctions, appeals, content decisions, reports, audit trail                                        |

- **What a sanction does:**
  - resolves open reports about the member;
  - revokes Power User;
  - records a moderation action and audit event;
  - notifies the member (`account_sanctioned`, `power_user`).
- **Suspended members:**
  - Get 403 `account_suspended`, except on `GET /v1/me/sanctions`, `GET /v1/me/appeals` and `POST /v1/me/appeals`.
  - When a suspension runs out, the account is active again on the next request.
- **Errors:** `own_account`, `already_suspended`, `invalid_transition`.

## Appeals

| Method & path                              | Who                                                         |
| ------------------------------------------ | ----------------------------------------------------------- |
| `POST /v1/me/appeals`                      | The member (works while suspended)                          |
| `GET /v1/me/appeals`                       | The member                                                  |
| `GET /v1/moderation/appeals?status=&kind=` | Moderators                                                  |
| `POST /v1/moderation/appeals/:id/decide`   | Moderators: `{ outcome: "upheld" \| "overturned", reason }` |

**Filing:**

```json
{ "kind": "sanction", "sanctionId": "…", "statement": "Those messages were sent by someone else using my phone." }
{ "kind": "power_user", "statement": "…" }
{ "kind": "content", "moderationActionId": "…", "statement": "…" }
```

- **Limits:** within 30 days of the decision, once per decision.
- **Content appeals:** only reject or hide decisions about your own content.
- **Who decides:** a different moderator from the one who made the decision (409 `own_decision`).
- **Overturning:**
  - a sanction is lifted and marked overturned;
  - Power User is reinstated;
  - hidden or rejected content is shown again.

  The member gets `appeal_decided`.

- **Errors:** `not_appealable`, `appeal_window_closed`, `already_appealed`, `own_account`, `own_decision`, `invalid_transition`.

## Shared dashboard

`GET /v1/trust-safety/dashboard`: trust and safety moderators **and** verification reviewers. Everyone else gets 404.

| Section             | Contents                                                                       |
| ------------------- | ------------------------------------------------------------------------------ |
| `reports`           | Open, by target type, by reason, per day for 14 days                           |
| `pendingModeration` | Articles and jobs waiting                                                      |
| `appeals`           | Open moderation appeals by kind; open verification appeals                     |
| `members`           | Active suspensions, warnings (30 days), Power Users, revocations (30 days)     |
| `verification`      | Cases waiting                                                                  |
| `emergency`         | Flagged active incidents                                                       |
| `recentActions`     | The 20 latest `moderation.*`, `power_user.*` and `verification.*` audit events |

## Data

| Table                | Notes                                                                                             |
| -------------------- | ------------------------------------------------------------------------------------------------- |
| `power_user_status`  | One row per person: active or revoked, the rules met at the grant, revocation reason              |
| `member_sanctions`   | Warnings and suspensions; never deleted while the account exists (trigger)                        |
| `moderation_appeals` | One per decision (unique per sanction, moderation action or revocation); decision reason required |

`moderation_actions.action` gains `warn`, `suspend`, `lift_suspension`, `revoke_power_user`, `appeal_upheld` and `appeal_overturned`.

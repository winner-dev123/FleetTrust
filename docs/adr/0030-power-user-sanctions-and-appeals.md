# ADR-0030: Power User earned from identity, age, activity and standing; member sanctions, appeals and a shared trust and safety dashboard

- Status: Accepted
- Date: 2026-11-24

## Context

Prompt 23 covers trust signals and moderation (SRS F-160, F-161, J9, AB-12):

- Power User eligibility from verified identity, account age, meaningful activity and moderation standing;
- badge revocation and appeals;
- a shared trust and safety dashboard;
- abuse reporting and audit trails.

The acceptance criteria are:

- paid plans can't buy verified or Power User badges;
- no review-based reputation.

Prompt 15 deferred member sanctions (warnings, suspensions) and their appeals to this prompt.

## Decision

1. **Power User is computed from four rules and nothing else.** The rules are published as `POWER_USER_RULES`, and every response explains each one:

   | Rule              | Needs                                                                                                                              |
   | ----------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
   | Verified identity | An active verified-driver badge (a reviewer checked identity evidence, Prompt 09)                                                  |
   | Account age       | At least 180 days                                                                                                                  |
   | Activity          | In the last 365 days, a score of at least 20 on **at least 10 different days** and **at least 2 kinds** of activity (see below)    |
   | Standing          | No upheld moderation decision in the last 180 days (rejected or hidden content, warnings, suspensions, revocations), not suspended |
   - **Activity score:**

     | Activity                  | Points | Counted up to |
     | ------------------------- | ------ | ------------- |
     | Published article         | 3      | 10            |
     | Visible comment           | 1      | 30            |
     | Completed service request | 2      | 10            |

     The caps, and the minimum days and kinds, make farming one kind of action in a burst useless (AB-12).

   - **Standing:**
     - Decisions overturned on appeal don't count.
     - Automatic flags don't count; only human decisions do.
   - **Claiming:** the person claims the status (`POST /v1/me/power-user`). It's granted only if every rule passes. There's no staff endorsement, and the rules met are stored with the grant.
   - **The public label** (`GET /v1/users/:id/status`, visitors included) shows only while all of these hold:
     - the status is active;
     - the identity badge is current;
     - the account isn't suspended.

     It carries `POWER_USER_MEANING` ("…Not a staff, moderator or professional endorsement, and it can't be bought").

2. **Payment can't reach it.**
   - **The rules:** none of them has a plan, payment, rating or review input. The database has no such column.
   - **Lint rule:** the module boundary rule (ADR-0009) now also stops the `verification`, `power-user` and `search` modules importing the plan and quota tables from `@fleettrust/db`, not just the entitlements module. `module-boundaries.spec.ts` proves it fires.
   - **API test:** after a paid personal plan is assigned, eligibility is identical and verification labels don't change.
   - **Mutation check:** counting a plan as identity makes that test fail.
3. **No review-based reputation.**
   - **The activity rule:** it counts the person's own published contributions only. Nothing other people score, rate or vote on is an input.
   - **The repository guard (ADR-0011)** already rejects rating and review tables, columns and routes.
4. **Member sanctions.**
   - **Who:** trust and safety moderators warn or suspend a member, for a number of days or until lifted, with a reason.
   - **What a sanction does:**
     - resolves open reports about the member;
     - revokes Power User;
     - is recorded in `moderation_actions` and the audit log;
     - notifies the member.
   - **Suspended members:**
     - Get 403 `account_suspended` everywhere, except `GET /v1/me/sanctions` and `/v1/me/appeals` (new `@AllowSuspended()`). They can always appeal.
     - A suspension that has run out reactivates the account on the next request; no job is needed.
   - **History is kept:** sanctions are never deleted while the account exists (database trigger). Lifting and overturning are updates.
5. **Appeals.**
   - **What can be appealed:** a sanction, a Power User revocation, or a moderator's reject or hide decision about your content.
   - **Limits:** once per decision, within 30 days.
   - **Who decides:** a **different** moderator from the one who made the decision (`own_decision`).
   - **Overturning undoes the decision:**
     - a sanction is lifted and marked overturned;
     - Power User is reinstated;
     - hidden or rejected content is shown again.
   - **Every decision** is audited and notified.
   - **Verification badge appeals** stay in the verification module (Prompt 09).
6. **One dashboard for trust and safety.**
   - **Who sees it:** `GET /v1/trust-safety/dashboard`, for trust and safety moderators and verification reviewers. `PlatformRoleRequired` now accepts several roles.
   - **What it shows:**
     - open reports by target and reason, and reports per day for 14 days;
     - items waiting for moderation;
     - open moderation and verification appeals;
     - active suspensions, recent warnings, Power Users and recent revocations;
     - the verification queue and flagged emergency incidents;
     - the latest audited actions.
   - **Member history** (moderators only): sanctions, appeals, decisions about their content, reports against them, and their audit trail.

## Consequences

- **Power User is pull, not push:** people claim it when they qualify. It's revoked by sanctions or by a moderator, not automatically when activity drops.
- **"Verified identity" means the driver badge**, the only person-level identity badge so far. Fleet managers or provider staff who aren't drivers can't become Power Users until an identity-only badge exists (to decide with OQ-14).
- **The dashboard is computed on request.** That is fine at pilot scale.
- **Found in passing:** two Prompt 09 checks (`verification_badges_revocation_reason`, `verification_cases_reason_required`) don't refuse a missing note, because a length check on NULL passes. The API always sends one; fix the checks in Prompt 27.
- **Not built:**
  - automatic sanctions;
  - shadow bans;
  - appeal of automatic flags (they're temporary until a moderator decides);
  - the admin console UI (Prompt 26).

## Alternatives considered

- **Moderators granting Power User:** that turns the label into a staff endorsement, which SRS §8.1 says it isn't.
- **Counting likes, ratings or helpful votes:** that is review-based reputation, and it's easy to farm.
- **Revoking Power User whenever activity dips:** status would flap. Standing and moderation are what matter after the grant.
- **A scheduled job to end suspensions:** the auth guard already loads the user, so ending it on the next request is simpler and exact.

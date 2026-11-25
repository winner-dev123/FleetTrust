# Privacy: data inventory, rights and consent

The design decision is [ADR-0034](../adr/0034-security-and-privacy-hardening.md).

## Data inventory

| Category | Examples                                              | Where                  | Protection                                                         |
| -------- | ----------------------------------------------------- | ---------------------- | ------------------------------------------------------------------ |
| Account  | email, display name, sign-in method, time zone        | `users`, Firebase Auth | Firebase keeps the minimum (OQ-01); email only for support lookups |
| Location | search point, request location, alert location        | requests, incidents    | Approximate for visitors; alert locations erased at close          |
| Content  | messages, articles, comments, requests                | Postgres               | Access derived per request                                         |
| Files    | request and chat photos, vault and identity documents | private bucket         | Envelope encryption (KMS) per file; metadata stripped; scanned     |
| Contacts | friends, trusted contacts, blocks                     | Postgres               | Visible only to the two people                                     |
| Business | organizations, branches, offerings                    | Postgres               | Public only once published                                         |
| Device   | push installation ID                                  | `push_devices`         | Removed at sign-out and after 9 months idle                        |
| Consent  | purpose, version, choice, time                        | `consents`             | Append-only history                                                |

**Special categories:** none collected on purpose. Emergency notes are free text: the UI says what is shared and with whom.

## Rights

| Right                  | How                                                                                                                       | Where                                                     |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| Access and portability | `GET /v1/me/export`: one JSON file of the person's data (internal keys removed); 5 a day; audited `privacy.data_exported` | Web: Account → Download my data. Mobile: links to the web |
| Erasure                | `DELETE /v1/me`: needs a sign-in from the last 10 minutes and `X-Confirm-Action: account.delete`                          | Web and mobile Account (typed DELETE)                     |
| Rectification          | People edit their profile, vehicles and content                                                                           | Everywhere                                                |
| Withdraw consent       | `POST /v1/me/consents` with `granted: false` for optional purposes                                                        | Web Account → Your choices                                |

### What account deletion does

**Refused (409 `sole_owner`)** while the person is the only owner of an organization.

**Erased:**

- profile fields (the user row becomes an anonymous tombstone: `status = deleted`, no email or name, Firebase UID replaced);
- the Firebase account;
- personal vehicles with their documents (files deleted);
- identity document files;
- consents and bookmarks;
- friends, friend requests and blocks;
- group memberships;
- trusted contacts (both directions);
- emergency alerts;
- job applications;
- saved lists;
- conversation state, notifications, push devices and preferences;
- Power User status and appeals;
- staff availability and time off;
- organization memberships and platform staff roles;
- images they uploaded for articles (public files deleted).

**Withdrawn:** articles (unpublished, content erased) and comments (marked deleted).

**Kept, anonymised:** messages sent, service requests (location note removed), sanctions history and the audit log. See [data retention](data-retention.md).

**Every reference is classified.** [user-data-map.ts](../../apps/api/src/modules/privacy/user-data-map.ts) lists every database column that points to a person (111 today) as `erased`, `withdrawn` or `kept`, each with a reason. Two tests enforce it:

- The list must match the foreign keys in the migrated database exactly, so a new column referencing `users` fails CI until someone decides how erasure treats it.
- After a deletion, no `erased` column may still reference the person.

Writing the map found two gaps, both fixed: article images stayed publicly reachable after deletion, and staff roles stayed attached to the tombstone.

**Audit:** recorded as `user.account_deleted`, with counts and any staff roles removed.

**After deletion:** the same email can sign up again as a new account.

## Consent

| Purpose                    | Required | Default          |
| -------------------------- | -------- | ---------------- |
| `terms` (terms of service) | yes      | must accept      |
| `privacy` (privacy notice) | yes      | must acknowledge |
| `analytics`                | no       | off              |
| `marketing_email`          | no       | off              |

- **Versions:** each purpose has a current version (`CURRENT_CONSENT_VERSIONS`). When a document changes, bump its version: everyone is asked again.
- **Asking:** the web (`ConsentGate` in the signed-in area) and the mobile app (full-screen gate after sign-in) ask until both required consents are accepted for the current version.
- **What the API accepts:**
  - only the current version (409 `stale_consent_version`);
  - required consents can't be withdrawn (409 `required_consent`): deleting the account is the way out.
- **History:** every choice is a new row, and audited (`privacy.consent_granted` / `privacy.consent_withdrawn`).
- **Analytics:** no analytics SDK is installed yet; when one is added, it must check `analytics` first (ADR-0004: opt-in only).

## Owner items

- Legal review of the [privacy notice](/legal/privacy) and [terms](/legal/terms) (OQ-17); both are marked draft.
- A privacy contact address.
- Jurisdiction (OQ-03) decides breach-notification deadlines and the minimum age.

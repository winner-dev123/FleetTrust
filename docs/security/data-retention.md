# Data retention

FleetTrust keeps personal data only as long as it's needed.

- **Automatic deletion:** the worker role runs `RetentionService` daily (`RETENTION_INTERVAL_MS`). Each run is recorded as `privacy.retention_run`, with counts.
- **Deletion on request:** account deletion erases a person's data at any time ([privacy](privacy.md)).

## Deleted automatically

| Data                             | Kept for                                                            | Rule                                                                                                                    |
| -------------------------------- | ------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Delivered domain events (outbox) | 30 days after delivery                                              | `outbox_events_published`                                                                                               |
| Read notifications               | 180 days                                                            | `notifications_read`                                                                                                    |
| Unread notifications             | 365 days                                                            | `notifications_unread`                                                                                                  |
| One-time document viewing links  | 1 day after expiry                                                  | `document_access_grants_expired`                                                                                        |
| Quota usage records              | 400 days                                                            | `quota_consumptions` (a year for billing disputes)                                                                      |
| Push registrations not seen      | 270 days                                                            | `push_devices_stale`                                                                                                    |
| Identity and business documents  | 90 days after the decision (`VERIFICATION_DOCUMENT_RETENTION_DAYS`) | verification purge                                                                                                      |
| Emergency alert locations        | Until the alert closes                                              | erased when the alert resolves, is cancelled or expires (Prompt 18)                                                     |
| Upload quarantine objects        | Until processed                                                     | deleted after the scan; abandoned verification uploads are purged after a day (other abandoned uploads: gap, see below) |

## Kept while the account exists

These are deleted or anonymised with the account:

- profile;
- vehicles and vault documents;
- lists;
- trusted contacts;
- messages and requests;
- articles and comments;
- consents;
- notifications preferences.

## Kept after an account is deleted (anonymised)

| Data                                    | Why                                                      | How                                                   |
| --------------------------------------- | -------------------------------------------------------- | ----------------------------------------------------- |
| Messages the person sent                | They belong to the other participants' conversations too | Sender shown as a deleted member; no name or email    |
| Service requests and quotes             | Providers' business records and disputes                 | Requester anonymised; free-text location note removed |
| Moderation sanctions and decisions      | Trust and safety records                                 | Linked only to the anonymous tombstone                |
| Audit log                               | Security and accountability                              | References the tombstone ID; no personal fields       |
| Organization records the person created | They belong to the organization                          | Unchanged; the person's membership is removed         |

## Not yet automated

These are decided now and implemented when needed:

| Data                                                     | Plan                                                                                                                                                                                                                                                                                           |
| -------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Audit log                                                | Keep 7 years, then archive to cold storage (Prompt 29 sets up the export)                                                                                                                                                                                                                      |
| Closed support cases                                     | Keep 2 years                                                                                                                                                                                                                                                                                   |
| Backups                                                  | Cloud SQL point-in-time recovery for 7 days and 30 daily backups; deleted storage objects are soft-deleted for 7 days ([backup runbook](../operations/backup-restore-runbook.md)). Deleted accounts can reappear only in a restore older than the deletion: re-run deletions after any restore |
| Abandoned uploads (chat, request, vault, article images) | Delete quarantine objects older than a day with a bucket lifecycle rule (Prompt 29 Terraform)                                                                                                                                                                                                  |

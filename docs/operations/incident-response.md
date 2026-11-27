# Incident response

This runbook covers security and privacy incidents: suspected attacks, leaks, compromised accounts and abuse waves. Outages follow the same roles; their technical steps are in [observability.md](observability.md) and the [backup runbook](backup-restore-runbook.md).

## Severity

| Level     | Examples                                                                                                                                | Response                                             |
| --------- | --------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- |
| **SEV-1** | Personal data exposed to others; identity documents accessed without authorization; staff account compromised; emergency alerts failing | Start now, at any hour; owner informed within 1 hour |
| **SEV-2** | Exploitable vulnerability with no evidence of use; abuse wave affecting many users; a single account takeover                           | Same working day                                     |
| **SEV-3** | Low-risk vulnerability; isolated abuse                                                                                                  | Next sprint                                          |

## Roles

- **Incident lead:** coordinates, decides, and keeps the timeline. It's the first engineer on call until handed over.
- **Communications:** the owner. Users, authorities and partners.
- **Scribe:** records every action with a UTC time in the incident document.

## Steps

1. **Declare.** Open an incident document (a private channel, not a public issue). Set the severity and write down what is known.
2. **Contain.** Use the levers below. Prefer reversible actions.
3. **Preserve evidence.**
   - Export the relevant audit events (`/app/admin/audit`, super admin) and Cloud Logging entries before retention removes them.
   - Don't delete affected data until it's understood.
4. **Eradicate.** Fix the cause. Add a test that would have caught it (as the tenant penetration test does for access control).
5. **Recover.** Restore service. Re-run account deletions if a backup older than any deletion was restored.
6. **Notify.** See below.
7. **Review within 5 working days.** Write a blameless review covering the timeline, cause, what worked, and follow-ups with owners. Update the [threat model](../security/threat-model.md).

## Containment levers

| Lever                         | How                                                                                                                              | Effect                                                              |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| Pause new sign-ups            | Admin console → Feature settings → `signups.paused`                                                                              | Stops new accounts (spam or fraud waves); existing users unaffected |
| Lower the auto-hide threshold | `community.auto_hide_reporters` = 2                                                                                              | Reported content disappears faster                                  |
| Site notice                   | `site.notice`                                                                                                                    | Tell users what's happening                                         |
| Sign a person out everywhere  | Support case → Sign out everywhere; or the user's own "Sign out on all devices"                                                  | Revokes refresh tokens                                              |
| Suspend a member              | Moderation → New sanction                                                                                                        | Blocks the account (appealable)                                     |
| Remove a staff role           | Staff roles → Revoke (super admin)                                                                                               | Immediate; the next request gets 404                                |
| Disable a Firebase account    | Firebase console → Authentication                                                                                                | Blocks sign-in entirely                                             |
| Enforce App Check             | `APP_CHECK_MODE=enforce`                                                                                                         | Rejects requests from non-genuine clients                           |
| Stop the worker               | Pause the Cloud Tasks queue `fleettrust-jobs` and the `fleettrust-*` Cloud Scheduler jobs (the worker scales to zero on its own) | Pauses push, email, emergency escalation and retention jobs         |
| Block traffic                 | Cloud Armor rule (after Prompt 29)                                                                                               | Edge blocking by IP or region                                       |

## Playbooks

### Compromised staff account

1. Revoke the person's staff roles (another super admin), and disable their Firebase account.
2. Revoke their sessions.
3. Search the audit log for their actions since the suspected time: `actorEmail=<them>`, scope "all".
4. Reverse their actions:
   - re-grant badges they revoked (new verification);
   - end plans they assigned;
   - restore content they hid;
   - lift sanctions they applied.
5. Reset their MFA in the Firebase console before restoring access.

### Account takeover (a user)

1. Support case: sign them out everywhere, then email a sign-in link to their own address.
2. Check the audit log (`targetId=<user>`) for changes made by the attacker: display name, organizations, invitations.
3. If the person's email account itself was taken over, Firebase can't help. Disable the account until they recover it.

### Cross-tenant data exposure (access-control bug)

1. Reproduce with the tenant penetration test setup. Fix, and add the case to `CROSS_TENANT_BY_DESIGN` only if it is truly by design (with a reason).
2. Use logs and audit events to find who accessed what. Request IDs link log lines.
3. This is a personal-data breach: notify (below).

### Leaked secret

1. Rotate the secret in Secret Manager and redeploy.
2. Revoke the old value at the provider.
3. Rewrite git history only if the secret was in the repository: rotate first, regardless of history.
4. Check access logs for use of the old value during the exposure window.

### Malware reported in an upload

1. Confirm the scanner result. Files are quarantined until scanned; a reported file that passed means the signatures were stale.
2. Delete the object. Mark the attachment or document rejected.
3. Update ClamAV signatures. Re-scan objects uploaded in the window.

### Abuse or spam wave

1. Pause sign-ups, lower the auto-hide threshold, and post a site notice.
2. Moderators sanction the accounts involved. Tighten rate limits if a route is being hammered.

## Notification

- **Who decides:** the owner decides with legal advice. Deadlines depend on the jurisdiction (OQ-03):
  - GDPR: the supervisory authority within **72 hours** of becoming aware;
  - POPIA (South Africa): the Information Regulator and affected people "as soon as reasonably possible".
- **What to tell people:**
  - what happened;
  - what data;
  - what we did;
  - what they should do (for example, watch for phishing);
  - a contact.
- **How:** use email (needs a provider, OQ-06) and a site notice.
- **Record keeping:** keep a record of every breach, including ones that weren't notified, with the reasoning.

## Contacts (owner to complete before launch)

| Role                                | Name | Contact |
| ----------------------------------- | ---- | ------- |
| Incident lead (engineering on call) |      |         |
| Owner / communications              |      |         |
| Legal adviser                       |      |         |
| Google Cloud support                |      |         |

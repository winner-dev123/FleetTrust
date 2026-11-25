# Support playbook

For FleetTrust support staff during the pilot. Tools: the admin console (`/app/admin`, two-step sign-in required) and the support inbox (address to be set up with the email provider, OQ-06). Every action you take in the console is recorded in the audit log.

## Principles

- **Never ask for passwords, codes or document photos by email or chat.** FleetTrust staff never need them.
- **Confirm identity before changing anything.** The person must write from the email address on the account, or sign in and contact us through the app.
- **Look at the least data that answers the question.** The support view shows account metadata only; that is deliberate.
- **Open a case for every request that needs an action**, and close it with what you did.
- **Emergency questions come first** (below).

## Response targets (pilot)

| Kind                                                | First reply                   | Resolution goal                         |
| --------------------------------------------------- | ----------------------------- | --------------------------------------- |
| Emergency feature not working (alerts not received) | **Immediately**: page on-call | Same day                                |
| Can't sign in, account locked or suspended          | 4 working hours               | 1 working day                           |
| Verification question, provider listing problem     | 1 working day                 | 3 working days                          |
| Privacy request (export, deletion, correction)      | 2 working days                | Legal deadline (GDPR: 1 month)          |
| Abuse report (harassment, scam, fake listing)       | 4 working hours               | Moderator decision within 1 working day |
| General question or feedback                        | 2 working days                | —                                       |

## Common requests

| Request                                     | What to do                                                                                                                                                                                                                                                                                                                                            |
| ------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **"I can't sign in"**                       | Support → find the account by email. If it exists and is active, open a case and use **Send sign-in link**: it goes to the account's own address, and you never see it. Suspended: explain that they can see the reason and appeal from their account page. No account and the pilot allowlist is on: see [pilot-onboarding.md](pilot-onboarding.md). |
| **"Someone else got into my account"**      | Open a case and **Revoke sessions** (signs out everywhere; confirmed action). Ask them to sign in again with their own email and check their trusted contacts. If they suspect a breach beyond their own account, follow [incident-response.md](../operations/incident-response.md).                                                                  |
| **"I didn't get an emergency alert"**       | Treat as urgent. Check the admin audit log for the incident and the delivery attempts, and confirm the contact accepted the trusted-contact invitation and has notifications on. Page on-call if a delivery failed. **Always remind them: FleetTrust is not an emergency service; call the local emergency number.**                                  |
| **"Why isn't my business verified?"**       | Verification reviewers decide; support doesn't. Point them to the status and reason on their verification page. Escalate to a reviewer if the case has waited more than 3 working days.                                                                                                                                                               |
| **"Delete my account" / "Send me my data"** | Both are self-service: account deletion in Account settings on the website and in the app, and the data export on the website (the app links there). If they can't sign in, verify their identity first (email from the account address), then send a sign-in link so they can do it themselves. Staff don't delete accounts on someone's behalf.     |
| **"Change my plan"**                        | Billing operators assign plans after the payment is confirmed outside FleetTrust (ADR-0008). Support passes the request on with the case number.                                                                                                                                                                                                      |
| **Abuse report**                            | Ask for the link or the message, report it in the app if the person hasn't, and hand it to a trust & safety moderator. Don't argue the case with the reported person.                                                                                                                                                                                 |
| **Bug report**                              | Get the device, the app version (from the phone's app settings or store page), the time, and what they expected. Open a GitHub issue without personal data.                                                                                                                                                                                           |

## Escalation

1. **Support agent** → **moderator** (abuse), **verification reviewer** (badges), **billing operator** (plans), or **on-call engineer** (anything broken).
2. **On-call engineer** → incident process for outages, data exposure or emergency-path failures ([incident-response.md](../operations/incident-response.md)).

## Canned replies

Keep them plain, short and in the person's language where possible. Never promise an outcome on behalf of a provider, and never call a provider "safe" or "recommended": verification has a precise meaning (SRS §8).

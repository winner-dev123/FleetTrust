# FleetTrust — Software Requirements Specification (SRS)

| Field   | Value                                                                                                                                                            |
| ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Status  | Draft for review (Prompt 01)                                                                                                                                     |
| Version | 0.1.0                                                                                                                                                            |
| Date    | 2026-11-19                                                                                                                                                       |
| Related | [Feature matrix](feature-matrix.md) · [Backlog](backlog.md) · [Open questions](open-questions.md) · [C4 model](../architecture/c4.md) · [ADRs](../adr/README.md) |

> This document describes **intended** behaviour. Nothing in it claims that an implementation exists.
> "MUST", "SHOULD" and "MAY" follow RFC 2119.

---

## 1. Purpose and scope

FleetTrust is a multi-tenant SaaS that helps the people who keep vehicles moving find and work with each other:

- **Individuals**: drivers, owner-operators and private vehicle owners who need a workshop, tow, tyres, fuel, parking or parts, often on the road and sometimes in an emergency.
- **Providers**: workshops, towing operators, tyre shops, fuel stations, parts sellers, parking operators and mobile mechanics who want to be found and receive service requests.
- **Fleets**: companies that run vehicles and drivers and need maintenance oversight, preferred providers, incident visibility and hiring.
- **Platform administrators**: staff who verify evidence, activate subscriptions, moderate content and support users.

The product is delivered as a responsive web app (Next.js), an iOS/Android app (React Native) and a single API (NestJS modular monolith). The platform runs on Google Cloud with Firebase for identity, push, file storage and mobile reliability tooling. PostgreSQL/PostGIS is the system of record ([ADR-0004](../adr/0004-firebase-hybrid-platform.md)).

### 1.1 Product principles

1. **Trust can't be bought.** Paid plans buy capacity (quotas, staff seats, branches), never badges, verification, or search ranking.
2. **No money moves through the platform.** Prices are indicative; payment is arranged between the parties outside the platform.
3. **Safety beats monetisation.** Emergency and trusted-contact features work regardless of plan or quota.
4. **Honest labels.** Unverified is shown as unverified. Indicative is shown as indicative. Stale stock is shown as stale. Community posts are not reviews.
5. **Minimal signup.** An email address or a Google/Apple account is enough to start. Documents are requested only when a user asks for a verification badge.

### 1.2 Definitions

| Term               | Meaning                                                                                                                        |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| Tenant             | An organization (provider or fleet). Individual users are their own scope.                                                     |
| Branch             | A physical location of a provider or fleet organization. Roles can be scoped to a branch.                                      |
| Indicative price   | A provider-published price of type `fixed`, `from`, `range` or `quote_required`. It isn't a binding offer and has no checkout. |
| Verification badge | A label (driver, business, location) granted by an admin after reviewing evidence. It has an expiry date.                      |
| Power User         | An earned status based on verified identity, account age, meaningful activity and moderation standing. It can't be purchased.  |
| Entitlement        | A capability or quota that comes from the organization's or user's assigned plan version.                                      |
| Emergency incident | A user-initiated request for help that notifies trusted contacts and, optionally, nearby providers.                            |
| Trusted contact    | A user the requester has chosen to alert in emergencies. Both sides must consent.                                              |

---

## 2. Roles

Authorization is enforced by the API against PostgreSQL. Firebase Authentication only proves identity ([ADR-0005](../adr/0005-authn-firebase-authz-api.md)).

### 2.1 Account-level roles

| Role            | Who                   | Scope                                                                                                 |
| --------------- | --------------------- | ----------------------------------------------------------------------------------------------------- |
| Visitor         | Not signed in         | Public provider profiles, public articles, approximate-area search. No contact actions.               |
| Individual user | Any signed-in account | Own profile, vehicles, service requests, saved lists, friends, messages, emergency, trusted contacts. |
| Platform admin  | FleetTrust staff      | Back-office only, with MFA. Split into the sub-roles below (least privilege).                         |

### 2.2 Organization roles

A user can belong to several organizations and switch between them. Every org-scoped request carries an explicit organization context.

| Org type | Role      | Branch-scopable | Key permissions                                                                            |
| -------- | --------- | --------------- | ------------------------------------------------------------------------------------------ |
| Provider | Owner     | No              | Everything in the org, including billing contact, deleting the org, transferring ownership |
| Provider | Admin     | No              | Manage profile, branches, staff, catalog, request verification                             |
| Provider | Manager   | Yes             | Manage catalog, hours, inquiries, quotes and appointments for the branch                   |
| Provider | Staff     | Yes             | Respond to assigned inquiries, view the branch calendar                                    |
| Fleet    | Owner     | No              | Everything in the org                                                                      |
| Fleet    | Admin     | No              | Manage vehicles, drivers, preferred providers, members                                     |
| Fleet    | Manager   | Yes             | Vehicles, maintenance, incidents for the branch                                            |
| Fleet    | Driver    | Yes             | Own assigned vehicles, raise service requests and incidents                                |
| Fleet    | Recruiter | No              | Job listings and applications only                                                         |

### 2.3 Platform admin sub-roles

| Sub-role                 | Can                                                                                        | Can't                                                           |
| ------------------------ | ------------------------------------------------------------------------------------------ | --------------------------------------------------------------- |
| Super admin              | Manage admin accounts and roles, feature configuration                                     | Act without audit; bypass MFA                                   |
| Verification reviewer    | Review evidence, grant/deny/revoke badges, handle appeals                                  | Change plans or quotas                                          |
| Billing operator         | Assign plans after external billing confirmation, apply quota overrides, set grace periods | Grant badges                                                    |
| Trust & safety moderator | Act on reports, hide content, suspend accounts, revoke Power User                          | Read identity documents                                         |
| Support agent            | View account metadata, trigger account recovery assistance                                 | View documents or message content without an open, audited case |

### 2.4 Statuses, not roles

- **Power User**: earned and revocable, can be appealed. Gives no admin powers.
- **Verified (driver / business / location)**: evidence-based badges with an expiry date.
- **Trusted contact**: a consented, mutual relationship between two individual users.

---

## 3. Experiences

The product has four separate experiences that share one account system:

| Experience | Primary surfaces                              | Home screen                                                 |
| ---------- | --------------------------------------------- | ----------------------------------------------------------- |
| Individual | Mobile first, web                             | Nearby providers map, active requests, emergency button     |
| Provider   | Web first, mobile for on-the-go replies       | Inquiry inbox, today's appointments, profile completeness   |
| Fleet      | Web first                                     | Maintenance due, open incidents, vehicles needing attention |
| Admin      | Web only (separate route group, MFA required) | Review queues: verification, reports, plan activations      |

---

## 4. User journeys

Each journey lists its release phase (see §5) and the prompts that build it.

### J1 — Sign up and find help nearby (Individual, R1; prompts 06, 12, 24, 25)

1. The user installs the app and signs in with an email link, Google or Apple. No display name or documents are required.
2. The app asks for location permission and explains why. The user can decline and search by place name instead.
3. The user sees nearby providers filtered by category, open now, vehicle type and verification.
4. Each provider card shows distance, indicative price labels and badges, with "Unverified" shown explicitly where it applies.

### J2 — Request a service and compare quotes (Individual ↔ Provider, R1; prompts 14, 17)

1. The user creates a service request with category, vehicle, location, description and photos. This consumes one service-request quota unit, atomically.
2. Matching providers receive it in their inquiry inbox.
3. Providers reply with quotes, which are informational. Each quote is linked to a conversation thread.
4. The user records which quote they accepted. The platform shows: _"Payment is arranged directly with the provider. FleetTrust doesn't process or verify payments."_
5. Either party can cancel. Status changes and evidence are kept in the event history.

### J3 — Emergency assistance (Individual, R1; prompt 18)

1. The user taps Emergency. The first screen always shows one-tap official emergency service guidance (the local emergency number, see [OQ-03](open-questions.md)).
2. The user consents to sharing their location for this incident only and selects trusted contacts (pre-selected from their circle).
3. The platform notifies the selected contacts by push (FCM) and falls back to email. It MAY also notify nearby opted-in providers.
4. Contacts acknowledge. If nobody acknowledges within a set time, the incident escalates to the next contacts.
5. An incident room (a time-limited conversation) opens. The incident expires automatically, and all actions are audited.
6. None of this depends on the user's plan or quotas. The UI never claims that help is guaranteed.

### J4 — Provider onboarding and verification (Provider, R1; prompts 07, 09, 10, 11)

1. The provider creates an organization and completes a resumable wizard: legal and trading names, category-dependent fields, branches, contacts, location, service area, vehicle types, media.
2. They preview the public profile, then publish it. It is labelled "Unverified" until verification is complete.
3. They optionally request business or location verification and upload evidence to private storage.
4. An admin reviews the evidence and grants or denies the badge. Badges expire and prompt reverification. Denials can be appealed.

### J5 — Fleet maintenance oversight (Fleet, R1 core / R2 dashboards; prompts 07, 19, 22)

1. The fleet admin adds vehicles and assigns drivers.
2. Maintenance schedules generate mileage- and date-based reminders.
3. Service history entries carry their source: "entered by fleet", "entered by provider", "from document". No record is automatically labelled verified.
4. Dashboards (R2) summarise maintenance due, incidents and user-entered spend. Spend isn't presented as verified payments.

### J6 — Plan activation (Billing operator, R1; prompts 08, 26)

1. The organization asks to upgrade and pays through an external channel (invoice, bank transfer or a third-party billing tool; see [OQ-05](open-questions.md)).
2. A billing operator confirms the external payment and assigns the plan version, with a reference note.
3. The entitlements take effect immediately. On downgrade, existing data is kept but new creation is blocked above the limit, after the grace period.
4. The UI says "Activated by FleetTrust staff". It never says "Payment verified".

### J7 — Community (Individual, R2; prompts 15, 16, 17, 23)

1. Users publish articles. Rich text is sanitised. Articles can't contain ratings and are labelled "Community content — not a verified review".
2. Users send friend requests (daily quota on successful outgoing requests), join groups by region, route or specialty, and message.
3. Sustained good standing can earn Power User status.

### J8 — Route-aware discovery (Individual / Fleet driver, R2; prompt 13)

1. The user enters an origin and destination. The routing provider returns a route.
2. Providers within a corridor along the route are listed, with the disclaimer _"Road and truck restrictions aren't verified by FleetTrust."_
3. If routing is unavailable, the app falls back to point search around waypoints.

### J9 — Moderation and support (Admin, R1; prompts 23, 26)

Reports from any surface land in a shared trust and safety queue. Moderator actions (hide, warn, suspend, revoke badge) are audited, and the affected user is notified and can appeal.

---

## 5. Release phases

Build order follows the prompt numbers. A release phase is what is **switched on** for users. Features built in an earlier prompt aren't exposed until their phase ships.

| Phase | Name                        | Goal                                                                                                           | Prompts                                                               |
| ----- | --------------------------- | -------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| R0    | Foundation                  | Repo, infra, DB, CI, identity, tenancy, entitlements                                                           | 02–08                                                                 |
| R1    | Pilot MVP                   | Core loop: find → request → quote → arrange externally, plus verification, emergency, vehicles, admin          | 09–12, 14, 17 (1:1 + request threads), 18, 19, 24, 25, 26, 27, 28, 29 |
| R2    | Community & fleet growth    | Route discovery, articles, friends and groups, group messaging, CRM, parts, fleet dashboards, jobs, Power User | 13, 15, 16, 17 (groups), 20, 21, 22, 23                               |
| F     | Future (specification only) | Rewards, payments/escrow, transaction-backed reviews, AI, telematics, multilingual                             | 30 (RFCs only)                                                        |

Whether R2 ships in the pilot or after it is an open product decision ([OQ-10](open-questions.md)). Every feature's phase and role are listed in the [feature matrix](feature-matrix.md).

---

## 6. Functional requirements (summary)

Detailed requirements are written stage by stage in each prompt's own docs. The following are binding across all stages.

| ID    | Requirement                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| FR-01 | Signup MUST need only an email address or a Google/Apple identity. A display name is optional until the user's first public contribution.                                                             |
| FR-02 | Every org-scoped API call MUST resolve an organization context and check membership and role (and branch, where relevant) before touching data.                                                       |
| FR-03 | Quota consumption MUST be atomic and idempotent. Daily quotas reset at 00:00 in the tenant's configured timezone (see [OQ-08](open-questions.md)).                                                    |
| FR-04 | Emergency creation, trusted-contact notification and incident messaging MUST NOT check or consume ordinary quotas.                                                                                    |
| FR-05 | Plan assignment MUST record the operator, the external reference and a timestamp. Plans MUST NOT change verification, Power User status or search ranking.                                            |
| FR-06 | Search ranking MUST use only relevance signals: category/text match, distance and service-radius coverage, open now, vehicle support. Verification is a user-selectable filter and a displayed label. |
| FR-07 | Prices MUST be shown with their type (`fixed`, `from`, `range`, `quote_required`) and currency, plus the disclaimer that they are indicative. No checkout or payment endpoint exists.                 |
| FR-08 | Identity documents MUST be stored privately, encrypted, and accessed only through short-lived signed URLs issued to authorised reviewers. Each access is audited.                                     |
| FR-09 | Every state-changing admin action MUST write an audit event. Irreversible actions need explicit confirmation.                                                                                         |
| FR-10 | Community content MUST NOT feed any rating, score or ranking of providers.                                                                                                                            |
| FR-11 | Future modules (§9) MUST NOT have live endpoints, tables, UI, workers or feature flags.                                                                                                               |

---

## 7. Non-functional requirements

Targets are **proposed** for the pilot. Prompt 28 records actual measurements against them.

| Area                     | Requirement                                                                                                                                                                       |
| ------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Availability             | API and web: 99.5% monthly during the pilot. Emergency dispatch path: 99.9%.                                                                                                      |
| Latency                  | Nearby search p95 ≤ 400 ms server-side at pilot data volume. Other read APIs p95 ≤ 300 ms. Writes p95 ≤ 500 ms.                                                                   |
| Emergency dispatch       | p95 ≤ 10 s from incident creation to the first FCM send attempt. Email fallback within 60 s if push isn't acknowledged. Retries with backoff are idempotent.                      |
| Scale (pilot assumption) | 10k users, 1k provider orgs, 50k vehicles, 100 requests/s peak. The architecture must scale ×10 without a redesign.                                                               |
| Security                 | OWASP ASVS L2 as the baseline. TLS everywhere. Firebase App Check on clients. Secrets in Secret Manager, never in the repo.                                                       |
| Privacy                  | Data minimisation. Location is shared per purpose, with consent. Users can export and delete their data. Retention follows the [OQ-03](open-questions.md) jurisdiction decision.  |
| Tenant isolation         | Automated tests prove cross-tenant reads and writes fail for every org-scoped resource.                                                                                           |
| Accessibility            | WCAG 2.2 AA for web. Platform accessibility APIs (VoiceOver, TalkBack) on mobile.                                                                                                 |
| Observability            | Structured JSON logs with request IDs and secrets redacted. OpenTelemetry traces. Crashlytics for mobile. Alerts on SLO burn.                                                     |
| Recoverability           | Cloud SQL point-in-time recovery. Pilot RPO ≤ 15 min, RTO ≤ 4 h. Restores are rehearsed (Prompt 28).                                                                              |
| Cost                     | Use managed, scale-to-zero services where possible: Cloud Run min instances 0 except where latency requires otherwise. Track a monthly budget alert ([OQ-07](open-questions.md)). |
| Internationalisation     | English UI at launch. UTF-8 throughout. Locale-aware dates, currencies and units. Strings kept outside code so translation can be added later.                                    |
| Mobile resilience        | Requests survive network drops through offline drafts and idempotency keys. The app works with location denied.                                                                   |

---

## 8. Trust model

### 8.1 What each label means

| Label                     | Means                                                                        | Doesn't mean                                 |
| ------------------------- | ---------------------------------------------------------------------------- | -------------------------------------------- |
| Verified driver           | An admin reviewed identity and licence evidence before the shown expiry date | The driver is safe, insured, or competent    |
| Verified business         | An admin reviewed business registration evidence                             | The quality of the business's work           |
| Verified location         | An admin reviewed evidence that the business operates at this address        | That it's open now                           |
| Unverified                | No current verification                                                      | That the provider is untrustworthy           |
| Power User                | Earned through verified identity, account age, activity and good standing    | Staff, moderator or professional endorsement |
| Indicative price          | The provider's published guidance                                            | A binding offer                              |
| Stock as of `<timestamp>` | The last time the provider updated the listing                               | That the item is available now               |
| Community article         | One member's opinion or knowledge                                            | A verified service review                    |

### 8.2 Invariants

1. No code path links plan tier to verification, Power User status or ranking. Tests assert this.
2. Badges are granted only through a review case with a reviewer, a decision and evidence references.
3. Every badge has an expiry date. Expired badges are hidden automatically and reverification is requested.
4. Users can see why something is labelled the way it is (an info tooltip linking to a "How verification works" page).
5. No numeric reputation score exists anywhere: no stars, no percentages, no "trust score".

---

## 9. Explicit non-goals

The following are **out of scope** for the initial implementation. Prompt 30 may produce RFCs for some of them, but no runtime code, tables, endpoints, UI, workers or feature flags.

| Non-goal                                                                  | Reason / note                                                        |
| ------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| Customer-to-provider payment processing, checkout, escrow, payouts        | Business rule. Payment is arranged externally. RFC only (Prompt 30). |
| Automatic subscription billing or "payment verified" claims               | Plans are activated manually after external confirmation (ADR-0008). |
| Reviews, star ratings, reputation scores, trust scores                    | Business rule. Transaction-backed reviews are RFC only.              |
| Daily rewards, check-ins, streaks, points ledger                          | Business rule. RFC only.                                             |
| AI features (recommendations, chat assistants, auto-moderation decisions) | RFC only.                                                            |
| Telematics, live vehicle tracking, ELD integration                        | RFC only.                                                            |
| Multilingual UI                                                           | RFC only. Strings are externalised from day one.                     |
| Freight or load matching, dispatch, brokerage                             | Not requested. Different product.                                    |
| Guaranteed emergency response or replacing official emergency services    | Safety and legal. The UI always points to official services.         |
| Verifying truck route restrictions (height, weight, hazmat)               | Route data comes from a third party, shown with a disclaimer.        |
| Parts checkout or reservations                                            | Inquiry only.                                                        |
| Microservices                                                             | Modular monolith until measured needs justify a split (ADR-0002).    |
| Native desktop apps                                                       | The responsive web app covers desktop.                               |

---

## 10. Abuse cases

| ID    | Abuse case                                                       | Mitigations (prompt)                                                                                                                                                                     |
| ----- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| AB-01 | Fake provider listings to harvest leads or scam                  | Publication rules, "Unverified" label, reports, rate limits on org creation, admin takedown (10, 23, 26)                                                                                 |
| AB-02 | Forged verification documents                                    | Human review, metadata checks, expiry and reverification, appeals, audit (09)                                                                                                            |
| AB-03 | Emergency false alarms or harassment via emergency alerts        | Contacts only with mutual consent, per-user emergency rate limits with safety exceptions, contacts can mute or report, suspension for proven abuse; never blocks the first incident (18) |
| AB-04 | Stalking through location sharing                                | Per-incident location consent, location expires with the incident, no persistent location history, approximate location for public search (12, 18)                                       |
| AB-05 | Harassment via friend requests or messages                       | Block, mute, report, quotas on successful outgoing requests, privacy settings (16, 17)                                                                                                   |
| AB-06 | Spam or SEO articles and comments                                | Sanitisation, article quotas, link limits for new accounts, moderation queue (15)                                                                                                        |
| AB-07 | Off-platform payment scams ("pay deposit to this account")       | Persistent warning on quotes, report-a-scam flow, link heuristics in messages (14, 17)                                                                                                   |
| AB-08 | Scraping provider and contact data                               | Rate limits, App Check, contact details revealed only to signed-in users, pagination caps (12, 27)                                                                                       |
| AB-09 | Cross-tenant data access (IDOR)                                  | Org context guard, tenant-scoped repositories, integration leak tests on every resource (07, 27)                                                                                         |
| AB-10 | Account takeover via email link or OAuth                         | Firebase Auth email-link best practices, token revocation, session listing and logout everywhere, App Check, anomaly alerts (06, 27)                                                     |
| AB-11 | Insider abuse by admins                                          | Least-privilege sub-roles, MFA, audited document access, four-eyes rule for destructive actions (26)                                                                                     |
| AB-12 | Farming Power User status                                        | Eligibility requires verified identity and account age, meaningful-activity heuristics, revocation and appeal (23)                                                                       |
| AB-13 | Defamatory "review" content in articles                          | Articles can't rate. Report and takedown flow. Label "not a verified review" (15)                                                                                                        |
| AB-14 | Fake job postings or recruiter scams                             | Employer verification, posting moderation, scam warnings, reports (22)                                                                                                                   |
| AB-15 | Malicious uploads (malware, polyglot files, EXIF location leaks) | Signed uploads, type and size checks, malware scan before release, EXIF stripping on public media (09, 27)                                                                               |
| AB-16 | Paid-tier pressure on trust ("buy a badge")                      | Code invariants and tests (§8.2), staff guidance (08, 23)                                                                                                                                |
| AB-17 | Undisclosed referral kickbacks                                   | Referrals require explicit consent and visibility. Commissions aren't processed (21)                                                                                                     |
| AB-18 | Quota bypass via concurrency or retries                          | Atomic counters, idempotency keys, concurrency tests (08)                                                                                                                                |

---

## 11. Constraints and assumptions

| ID   | Assumption                                                                 | Status                                                                                 |
| ---- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| A-01 | Platform: Google Cloud plus Firebase hybrid                                | **Decided by owner, 2026-11-19** ([ADR-0004](../adr/0004-firebase-hybrid-platform.md)) |
| A-02 | Single production region, chosen once the launch jurisdiction is known     | Open ([OQ-02](open-questions.md))                                                      |
| A-03 | English-only UI at launch                                                  | Assumed                                                                                |
| A-04 | Visitors can browse public profiles and articles without an account        | Assumed. Useful for SEO; confirm ([OQ-11](open-questions.md))                          |
| A-05 | Prices may be in several currencies; no FX conversion                      | Assumed                                                                                |
| A-06 | Mobile uses React Native with Expo dev builds and `@react-native-firebase` | Proposed. Confirmed in Prompt 02/25                                                    |
| A-07 | Transactional email goes through a third-party provider behind an adapter  | Open ([OQ-06](open-questions.md))                                                      |

Open jurisdiction, billing and legal questions are tracked in [open-questions.md](open-questions.md).

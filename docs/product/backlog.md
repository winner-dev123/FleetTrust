# Prioritized backlog

Ordered by build sequence, which matches the prompt numbers. Priority uses MoSCoW for the **pilot** (R1). Feature IDs refer to the [feature matrix](feature-matrix.md). Each epic is delivered by one prompt and closes only when that prompt's acceptance criteria pass.

| #   | Epic                         | Phase                          | Pilot priority   | Features           | Depends on  | Key risks / notes                                                                                        |
| --- | ---------------------------- | ------------------------------ | ---------------- | ------------------ | ----------- | -------------------------------------------------------------------------------------------------------- |
| 01  | Requirements & architecture  | —                              | Must             | —                  | —           | This document set                                                                                        |
| 02  | Monorepo bootstrap           | R0                             | Must             | —                  | 01          | Metro + pnpm symlinks for React Native; module-boundary lint rules (ADR-0009/0010)                       |
| 03  | Local infrastructure         | R0                             | Must             | —                  | 02          | Docker not installed yet (KC-04); Firebase Emulator Suite; storage emulator choice (ADR-0006)            |
| 04  | Database & migrations        | R0                             | Must             | F-014              | 03          | ORM choice; PostGIS raw SQL; tenant column conventions                                                   |
| 05  | CI/CD & observability        | R0                             | Must             | —                  | 02–04       | GitHub remote needed; Workload Identity Federation for GCP deploys; future-module guard (ADR-0011)       |
| 06  | Authentication               | R0                             | Must             | F-001–F-004        | 04          | Email-link Hosting domain (KC-02); Apple sign-in required on iOS (KC-01); Firebase data location (OQ-01) |
| 07  | Organizations & RBAC         | R0                             | Must             | F-005–F-009        | 06          | Cross-tenant leak tests become the template for all later modules                                        |
| 08  | Entitlements                 | R0                             | Must             | F-010–F-013        | 07          | Plans/limits are placeholders until OQ-09; quota reset timezone OQ-08                                    |
| 09  | Document verification        | R1                             | Must             | F-020–F-023        | 07, 08      | KMS envelope encryption; scanner choice OQ-15; evidence rules OQ-14                                      |
| 10  | Provider onboarding          | R1                             | Must             | F-030–F-032        | 07, 09      | Category-specific schemas shared via `packages/types`                                                    |
| 11  | Catalog & pricing            | R1                             | Must             | F-033–F-035        | 10          | Timezones and holiday exceptions; indicative-price copy                                                  |
| 12  | Geospatial search            | R1                             | Must             | F-040–F-042        | 11          | Index plans (GiST); visitor approximate location; map vendor OQ-13                                       |
| 13  | Route discovery & lists      | R2                             | Could            | F-100, F-101       | 12          | Routing vendor caching terms (OQ-13); never fabricate truck restrictions                                 |
| 14  | Service requests & quotes    | R1                             | Must             | F-050–F-052        | 08, 12      | Atomic quota + idempotency; no payment endpoints                                                         |
| 15  | Articles                     | R2                             | Could            | F-110–F-112        | 08          | XSS sanitisation; "not a review" labelling                                                               |
| 16  | Friends & groups             | R2                             | Could            | F-120–F-122        | 08          | Quota only on _successful_ outgoing requests                                                             |
| 17  | Messaging                    | R1 (1:1) / R2 (groups)         | Must (1:1)       | F-053–F-055, F-123 | 14          | WebSockets on Cloud Run; replay cursor; Redis pub/sub (ADR-0007)                                         |
| 18  | Emergency                    | R1                             | Must             | F-060–F-064        | 06, 17      | Legal copy review OQ-04; emergency numbers OQ-03; no quota coupling                                      |
| 19  | Vehicles & maintenance       | R1                             | Should           | F-070–F-074        | 07, 09      | Never auto-verify records                                                                                |
| 20  | Provider CRM & appointments  | R2                             | Could            | F-130–F-132        | 14          | Atomic booking conflicts; staff timezone                                                                 |
| 21  | Parts & referrals            | R2                             | Won't (pilot)    | F-140–F-142        | 11          | Stale stock labelling; referral consent                                                                  |
| 22  | Fleet dashboards & jobs      | R2                             | Could            | F-150–F-154        | 19          | Spending ≠ verified payments; job scams                                                                  |
| 23  | Power User & moderation      | R2 (Power User) / R1 (reports) | Should           | F-160, F-161       | 09, 15, 16  | Must not read entitlements                                                                               |
| 24  | Web product & design system  | R1                             | Must             | F-092              | all R1 APIs | WCAG 2.2 AA; copy lint for forbidden wording                                                             |
| 25  | Mobile app                   | R1                             | Must             | F-093, F-094       | all R1 APIs | Expo dev builds; push and permission testing on real devices                                             |
| 26  | Admin & operations           | R1                             | Must             | F-080–F-085        | 08, 09      | Identity Platform MFA (OQ-12)                                                                            |
| 27  | Security & privacy hardening | R1                             | Must             | F-090, F-091       | all         | Pen-test scope; data export/deletion across Postgres, GCS **and Firebase Auth**                          |
| 28  | Performance & QA             | R1                             | Must             | —                  | all         | Restore drill; emergency fan-out load test                                                               |
| 29  | Staging, production, launch  | R1                             | Must             | —                  | all         | Terraform for GCP + Firebase; go/no-go; legal docs OQ-17                                                 |
| 30  | Future-module RFCs           | F                              | Must (docs only) | F-900–F-905        | —           | No runtime code (ADR-0011)                                                                               |

## Cross-cutting definition of done (every epic)

- Tenant isolation tests for every new org-scoped resource.
- Authorization guard on every new route; no unauthenticated mutation routes.
- Audit events for state changes that matter to trust, money-like data or safety.
- Idempotency keys on create endpoints used by mobile.
- OpenAPI docs updated; SDK regenerated.
- Lint, typecheck, unit and integration tests pass in CI, with real output recorded in the handoff.
- `.env.example` updated; no secrets committed.
- Accessibility check on any new UI.
- Handoff notes updated in `docs/handoff/`.

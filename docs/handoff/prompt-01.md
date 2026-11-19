# Handoff — Prompt 01: Product requirements and architecture

- Date: 2026-11-19
- Status: **awaiting owner approval**

## What was done

- Inspected the repository: `d:\FleetTrust` was empty and not a git repository. Ran `git init -b main`. **No commits made.**
- Copied the prompt pack into [docs/prompt-pack/](../prompt-pack/INDEX.md) unchanged. Added [OVERLAY.md](../prompt-pack/OVERLAY.md) recording the owner's Firebase decision and how it changes each later prompt.
- Wrote the SRS, feature matrix, backlog, open questions, C4 model and 11 ADRs.

## Decisions taken this stage

| Decision                                                                                                                        | Source                                                                  |
| ------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Firebase hybrid on Google Cloud: Firebase Auth/FCM/Storage/App Check/Crashlytics, with Postgres/PostGIS as the system of record | Owner, 2026-11-19 ([ADR-0004](../adr/0004-firebase-hybrid-platform.md)) |
| Authorization in the API, not Firebase custom claims                                                                            | [ADR-0005](../adr/0005-authn-firebase-authz-api.md)                     |
| Email **link** sign-in (Firebase has no native email OTP; the pack allows either)                                               | ADR-0005                                                                |
| Release phases R0/R1/R2/F                                                                                                       | [SRS §5](../product/SRS.md#5-release-phases)                            |
| Jobs via Cloud Tasks/Pub/Sub. Still **Proposed**; confirm in 03/05                                                              | [ADR-0007](../adr/0007-jobs-and-realtime.md)                            |

## Assumptions (please correct any that are wrong)

1. English-only UI at launch; strings externalised.
2. Visitors may browse public provider profiles and articles without signing in (OQ-11).
3. Minimum age 18, attested at signup (OQ-16).
4. Mobile is Expo with dev builds plus `@react-native-firebase` (OQ-20).
5. The pilot NFR targets in [SRS §7](../product/SRS.md#7-non-functional-requirements) are proposals, not commitments.

## Files created

```text
.gitattributes
.gitignore
README.md
docs/adr/README.md
docs/adr/0001-typescript-monorepo.md
docs/adr/0002-modular-monolith-api.md
docs/adr/0003-postgresql-postgis-system-of-record.md
docs/adr/0004-firebase-hybrid-platform.md
docs/adr/0005-authn-firebase-authz-api.md
docs/adr/0006-object-storage-and-private-documents.md
docs/adr/0007-jobs-and-realtime.md
docs/adr/0008-manual-plan-activation.md
docs/adr/0009-trust-independent-of-payment.md
docs/adr/0010-emergency-exempt-from-quotas.md
docs/adr/0011-future-modules-spec-only.md
docs/architecture/c4.md
docs/handoff/CHECKLIST.md
docs/handoff/prompt-01.md
docs/product/SRS.md
docs/product/backlog.md
docs/product/feature-matrix.md
docs/product/open-questions.md
docs/prompt-pack/OVERLAY.md
docs/prompt-pack/  (32 files copied verbatim from transport_logistics_saas_prompt_pack.zip)
```

## Checks

| Check                                                                    | Result                                                                                                                                                                                     |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Feature matrix: every row has a unique ID, a phase and a role            | **Pass**: 82 rows, 82 unique IDs                                                                                                                                                           |
| Internal Markdown links and heading anchors resolve (custom Node script) | **Pass**: 109 links checked, 0 broken                                                                                                                                                      |
| Markdown lint (`markdownlint-cli2`)                                      | **Not run**: running a package from npm was blocked by the session's permission policy                                                                                                     |
| Mermaid diagram rendering (`@mermaid-js/mermaid-cli`)                    | **Not run**, for the same reason. The C4 diagrams use Mermaid's C4 syntax, which Mermaid labels experimental. Preview `docs/architecture/c4.md` in GitHub or VS Code to confirm it renders |
| Tests, migrations, API docs                                              | Not applicable: this stage is documentation only                                                                                                                                           |

## Blockers and risks for upcoming stages

- **Prompt 03 needs Docker** (not installed: KC-04).
- **Prompt 05 needs a GitHub remote** and, for staging deploys, a Google Cloud project and billing account (OQ-19).
- Answers to OQ-03 (jurisdiction) and OQ-05/OQ-09 (billing and plans) are needed by Prompts 08–09. Until then, placeholder defaults are used.

## Next: Prompt 02 — Monorepo bootstrap (not started)

Proposed plan, for approval:

1. Enable pnpm through Corepack and pin it with `packageManager`. Pin Node 24 LTS.
2. Turborepo with `apps/web` (Next.js), `apps/api` (NestJS), `apps/mobile` (Expo with dev builds), and `packages/config`, `types`, `sdk`, `ui`.
3. Strict TypeScript, ESLint (flat config) with module-boundary rules from ADR-0009/0010 stubbed, and Prettier.
4. Validate environment variables with zod per app. `.env.example` files contain no real values. `firebase.json` / `.firebaserc` use the `demo-fleettrust` project ID only.
5. Root scripts: `install`, `lint`, `typecheck`, `test`, `build`. Run them all and record the real output.

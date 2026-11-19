# Handoff — Prompt 02: Monorepo bootstrap

- Date: 2026-11-19
- Status: **awaiting owner approval**
- Prompt 01 approved by owner on 2026-11-19 ("pls start").

## What was built

A pnpm + Turborepo TypeScript monorepo with three runnable apps and four shared packages. Every workspace has `build`, `dev`, `typecheck`, `lint`, `test` and `clean` scripts.

| Workspace         | Contents                                                                                                                                                                                                                                             |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/config` | Strict tsconfig presets (`base`, `node`, `library`, `nextjs`); flat ESLint presets (`base` = typescript-eslint strict + stylistic, type-aware; `react`; `next`); Prettier config; `parseEnv()` + `envFields` env validation that never echoes values |
| `packages/types`  | `healthResponseSchema`, `appRoleSchema`, `uuidSchema` (zod)                                                                                                                                                                                          |
| `packages/sdk`    | `createApiClient({ baseUrl })` with typed `health()`, response validation, timeout, and `ApiError` codes                                                                                                                                             |
| `packages/ui`     | Colour tokens (light/dark) with WCAG AA contrast tests, spacing, radii, type scale                                                                                                                                                                   |
| `apps/api`        | NestJS 12 (ESM): `GET /health`, validated env (`APP_ROLE=api\|worker`, `PORT`, `CORS_ORIGINS`, …), module-boundary lint rules for ADR-0002/0009/0010 with tests proving they fire                                                                    |
| `apps/web`        | Next.js 16 App Router: placeholder home page, theme from shared tokens, validated `NEXT_PUBLIC_*` env                                                                                                                                                |
| `apps/mobile`     | Expo SDK 58 / React Native 0.88: placeholder screen using shared tokens, validated `EXPO_PUBLIC_*` env, Jest + Testing Library                                                                                                                       |

## Versions and why

| Choice                                                        | Reason                                                                                                                           |
| ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Node 24 (`.nvmrc`, `engines`)                                 | Installed LTS on this machine                                                                                                    |
| pnpm 12.21.0 via Corepack (`packageManager`)                  | Current; its install-script blocking and release-age policy are kept on                                                          |
| **TypeScript 6.0.3, not 7.0**                                 | typescript-eslint 8.73 supports TypeScript `<6.1`. Revisit when typescript-eslint supports 7                                     |
| turbo **2.11.10**, not 2.11.13                                | 2.11.13 was 1 day old and pnpm's release-age policy blocked it. Pinned an older release instead of adding an exclusion           |
| React 19.3.0 everywhere                                       | The version Expo SDK 58 requires; Next 16 accepts it, so web and mobile share one React                                          |
| All ESM (`"type": "module"`)                                  | NestJS 12 is ESM-only. Shared packages compile to ESM `dist/` with `.d.ts`                                                       |
| Vitest (packages, api, web) · Jest + jest-expo (mobile)       | React Native components need Jest; everything else uses Vitest. The API uses `unplugin-swc` so decorator metadata works in tests |
| Shared versions in a pnpm **catalog** (`pnpm-workspace.yaml`) | One place to bump TypeScript, ESLint, React, zod, etc.                                                                           |

Install scripts **denied** in `pnpm-workspace.yaml` → `allowBuilds`: `@swc/core` and `@parcel/watcher`. Both scripts only build from source; prebuilt binaries are installed as optional dependencies. Tests confirm both work without the scripts.

## Files created or changed

```text
.editorconfig  .nvmrc  .prettierignore  package.json  pnpm-lock.yaml  pnpm-workspace.yaml  prettier.config.js  turbo.json
.gitignore                         (added next-env.d.ts)
README.md                          (layout, getting started, commands)
packages/config/{package.json, prettier.js, eslint.config.js, tsconfig.json, tsconfig.build.json}
packages/config/tsconfig/{base,node,library,nextjs}.json
packages/config/eslint/{base,react,next}.js
packages/config/src/{env.ts, env.test.ts}
packages/types/{package.json, eslint.config.js, tsconfig.json, tsconfig.build.json}
packages/types/src/{index.ts, ids.ts, health.ts, health.test.ts}
packages/sdk/{package.json, eslint.config.js, tsconfig.json, tsconfig.build.json}
packages/sdk/src/{index.ts, client.ts, client.test.ts}
packages/ui/{package.json, eslint.config.js, tsconfig.json, tsconfig.build.json}
packages/ui/src/{index.ts, tokens.ts, contrast.ts, tokens.test.ts}
apps/api/{package.json, .env.example, nest-cli.json, tsconfig.json, tsconfig.build.json, vitest.config.ts}
apps/api/{eslint.config.js, eslint.boundaries.js, eslint.boundaries.d.ts}
apps/api/src/{main.ts, app.module.ts}
apps/api/src/config/{env.ts, env.spec.ts, config.module.ts}
apps/api/src/health/{health.controller.ts, health.module.ts}
apps/api/test/{health.e2e-spec.ts, module-boundaries.spec.ts}
apps/web/{package.json, .env.example, next.config.ts, tsconfig.json, eslint.config.js}
apps/web/src/{env.ts, env.test.ts, types/process-env.d.ts}
apps/web/src/app/{layout.tsx, page.tsx, theme.ts}
apps/mobile/{package.json, .env.example, app.json, index.ts, tsconfig.json, eslint.config.mjs}
apps/mobile/src/{App.tsx, App.test.tsx, env.ts, env.test.ts, types/process-env.d.ts}
docs/handoff/{CHECKLIST.md, prompt-02.md}
docs/prompt-pack/OVERLAY.md        (02 done; firebase.json moved to 03)
docs/product/open-questions.md     (KC-05 updated)
docs/**/*.md                       (Prettier table formatting only, no content changes)
```

## Test evidence (actual results, 2026-11-19)

| Check                                     | Command                                                                                                 | Result                                                                                        |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Clean install                             | deleted every `node_modules`, `dist`, `.next`, `.turbo`, `.expo`; then `pnpm install --frozen-lockfile` | **Pass**                                                                                      |
| Formatting                                | `pnpm format:check`                                                                                     | **Pass**: all files use Prettier style                                                        |
| Lint + typecheck + test + build, no cache | `pnpm turbo run lint typecheck test build --force`                                                      | **Pass**: 28/28 tasks                                                                         |
| Unit/integration tests                    | (same run)                                                                                              | **55 passed, 0 failed**: config 5, types 3, sdk 4, ui 22, api 12, web 4, mobile 5             |
| Web production build                      | `next build`                                                                                            | **Pass**: `/` and `/_not-found` prerendered static                                            |
| Mobile bundle                             | `expo export`                                                                                           | **Pass**: iOS (696 modules) and Android (694 modules) Hermes bundles                          |
| API runtime                               | `node dist/main.js`, then `GET /health`                                                                 | **Pass**: `{"status":"ok","service":"fleettrust-api","role":"api","version":"0.0.0-dev"}`     |
| API fails fast on bad config              | `CORS_ORIGINS='*' node dist/main.js`                                                                    | **Pass**: exit code 1, `CORS_ORIGINS.0: …` with no value echoed                               |
| Dev servers                               | `pnpm --filter … dev` for api and web                                                                   | **Pass**: both returned HTTP 200; processes stopped afterwards                                |
| Secrets                                   | scan of all files git would track                                                                       | **Pass**: only placeholder `.env.example` files and a deliberate fake secret in `env.test.ts` |

A test caught a real issue during this stage: `z.url()` accepted `"localhost:8080"` (parsed as the scheme `localhost:`). Fixed with `envFields.httpUrl()`, which allows only http(s), and covered by tests.

## Not done / deferred (by design)

- No Firebase SDKs, database, Docker or CI yet. Those belong to prompts 03–06.
- `firebase.json` / `.firebaserc` deferred to Prompt 03 alongside the emulators (overlay updated).
- No Expo dev build or native `ios/` / `android/` folders yet. They'll be needed once `@react-native-firebase` is added (Prompt 06/25).
- Mobile has no on-device or simulator testing yet. Only Jest and the Metro bundle export were verified.
- **Not committed.** The repo has no commits; all files are untracked.

## Risks and notes

- **Bleeding-edge majors** (NestJS 12, Expo 58, ESLint 10, Vitest 5, pnpm 12) are newer than most online examples. The toolchain is verified working, but expect to check upstream changelogs when adding libraries.
- **Turborepo telemetry** is on by default. Opt out with `pnpm turbo telemetry disable` or `TURBO_TELEMETRY_DISABLED=1` if preferred. Next.js and Expo telemetry were disabled for these runs via env vars only.
- Placeholder app identifiers `com.fleettrust.app` in `apps/mobile/app.json` depend on OQ-21 (final brand and domain).

## Next: Prompt 03 — Local infrastructure (not started)

Blocked until **Docker Desktop** (or a compatible engine) is installed (KC-04). Proposed plan:

1. `infra/local/compose.yaml` with Postgres + PostGIS, Redis and Mailpit. Named volumes, health checks, and credentials generated into an ignored `.env` (no public defaults).
2. Firebase Local Emulator Suite (Auth, Storage, Hosting) with `firebase.json` / `.firebaserc` using `demo-fleettrust`; `firebase-tools` as a pinned dev dependency.
3. Storage emulator vs `fake-gcs-server` decision for signed URLs (ADR-0006).
4. `pnpm infra:up` / `infra:down` / `infra:status` scripts plus a health-check script; docs in `docs/development/local-infrastructure.md`.

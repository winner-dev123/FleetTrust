# ADR-0001: TypeScript monorepo with pnpm and Turborepo

- Status: Accepted
- Date: 2026-11-19

## Context

FleetTrust ships a Next.js web app, a React Native mobile app and a NestJS API. All three share domain types, validation schemas, an API client and design tokens. Version drift between these would cause bugs, such as a mobile client sending a field the API no longer accepts.

## Decision

- A single repository managed by **pnpm workspaces** and **Turborepo**.
- Layout (created in Prompt 02):
  - `apps/web` (Next.js), `apps/api` (NestJS), `apps/mobile` (React Native / Expo)
  - `packages/config` (ESLint, TS, Prettier presets), `packages/types` (shared domain types and zod schemas), `packages/sdk` (typed API client), `packages/ui` (design tokens and web components)
- **Strict TypeScript** everywhere (`strict`, `noUncheckedIndexedAccess`).
- Environment variables are validated at startup with zod schemas; apps refuse to start on invalid configuration.
- Node version is pinned via `.nvmrc` / `engines`; pnpm is pinned via Corepack (`packageManager` field).

## Consequences

- One PR can change the API contract and both clients at once, and CI catches breakage.
- React Native's Metro bundler needs monorepo-aware configuration (symlinks, `watchFolders`). Expo's monorepo support covers this but has to be set up deliberately in Prompt 02.
- Turborepo remote caching is optional. Local caching is enough initially.

## Alternatives considered

- **Nx**: more features, heavier. Turborepo is enough for four apps and packages.
- **Polyrepo**: rejected because shared types would need publishing and versioning.

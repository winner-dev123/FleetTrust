# ADR-0002: NestJS modular monolith API

- Status: Accepted
- Date: 2026-11-19

## Context

The domain has many bounded contexts: identity, organizations, entitlements, verification, providers, search, requests, messaging, emergency, vehicles, community, admin. The team is small and traffic during the pilot is modest. Microservices would add network failure modes, distributed transactions and operational cost without any measured need.

## Decision

- One deployable **NestJS** API (`apps/api`), organised as modules that match the bounded contexts.
- Module boundaries are enforced by lint rules: modules import each other only through their public `index.ts` and may not reach into another module's repositories.
- Cross-module side effects go through an in-process domain event bus. Events that need durability go through a **transactional outbox** table and the job system ([ADR-0007](0007-jobs-and-realtime.md)).
- The same container image runs in two **roles**, selected by environment variable:
  - `api`: HTTP plus WebSocket.
  - `worker`: HTTP endpoints that receive Cloud Tasks / Pub/Sub pushes.

  This keeps a single codebase while letting the two roles scale independently on Cloud Run.

- Firebase Cloud Functions are **not** used for business logic. Functions are allowed only where Firebase requires them, for example Identity Platform blocking functions.

## Consequences

- Local transactions span modules. Quotas plus request creation stays atomic in one Postgres transaction.
- A module can be extracted later because boundaries and events already exist. Extraction needs measured evidence: latency, scaling or team ownership.
- Cold starts on Cloud Run matter for the emergency path. The `api` role may need `min-instances=1` in production (cost tracked in [OQ-07](../product/open-questions.md)).

## Alternatives considered

- **Cloud Functions per feature**: rejected. Business logic would be spread across functions, it's harder to test transactions, and cold starts multiply.
- **Microservices**: rejected until measured need.

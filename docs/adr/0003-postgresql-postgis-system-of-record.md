# ADR-0003: PostgreSQL + PostGIS as the system of record

- Status: Accepted
- Date: 2026-11-19

## Context

Core features are relational and spatial:

- Organizations → branches → memberships → roles.
- Atomic quota counters.
- Audit trails.
- Nearby, bounding-box and route-corridor search with service radii.

Firestore was considered because the owner requested Firebase. However, it only supports approximate geohash radius queries, has no spatial joins or corridor queries, and would push tenant isolation into security rules that are hard to test exhaustively.

## Decision

- **PostgreSQL with the PostGIS extension** is the system of record.
- Production uses **Cloud SQL for PostgreSQL**, which supports PostGIS, with automated backups and point-in-time recovery enabled.
- Local development uses the `postgis/postgis` image in Docker Compose (Prompt 03).
- ORM: chosen in Prompt 04 (Prisma is the default candidate). Spatial columns and queries use raw SQL through the ORM's escape hatch; migrations are SQL-reviewable.
- Conventions (detailed in Prompt 04):
  - UUID primary keys.
  - `created_at` / `updated_at` columns.
  - Explicit soft-delete only where a retention reason exists.
  - A `tenant_id` / `organization_id` column on every org-scoped table.
  - Audit events in an append-only table.
- **Firestore isn't used** for core data. If a future, measured realtime need appears, it gets a new ADR.

## Consequences

- The API is the only path to data. Clients never read the database directly, unlike typical Firestore apps.
- Cloud SQL has a fixed minimum cost even when idle; this is the largest fixed line item for the pilot.
- Connections from Cloud Run go through the Cloud SQL connector or Auth Proxy with IAM. Connection pooling must be sized for Cloud Run concurrency.

## Alternatives considered

- **Firestore**: rejected for core data. Reasons: geospatial limits, relational RBAC, cross-document invariants, reporting.
- **Firebase Data Connect** (managed GraphQL over Cloud SQL): rejected for now. Our authorization and quota logic needs custom transactional code and raw PostGIS SQL. Can revisit for read-only client queries.
- **AlloyDB**: higher cost floor; unnecessary at pilot scale.

# Prompt 03 — Local infrastructure

Use the Global instructions from README.md.

## Task
Provide Docker Compose for local PostgreSQL with PostGIS, Redis, S3-compatible local object storage and optional email testing only; persistent volumes, health checks, init scripts, .env.example. No Docker requirement for production.

## Deliverables
- Production-quality implementation or documentation as appropriate.
- Relevant tests, migration notes, configuration examples, and API docs.
- Updated task checklist and handoff notes for the next prompt.

## Acceptance criteria
Local services start with documented commands and health checks; no public default credentials.

## Execution contract
First inspect the existing repository. State assumptions and propose a concise plan. Implement only this stage, run available checks, report actual results, unresolved blockers, and precise files changed. Do not silently skip tests or implement future-stage modules. Stop and request approval before the next stage.

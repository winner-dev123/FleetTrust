# Prompt 04 — Database and migration foundation

Use the Global instructions from README.md.

## Task
Set up Prisma or another well-supported ORM with PostGIS-compatible raw SQL where needed; migration workflow, seed data, UUID keys, timestamps, soft-delete policy, tenant scoping, audit events and indexes. Document migration rollback strategy.

## Deliverables
- Production-quality implementation or documentation as appropriate.
- Relevant tests, migration notes, configuration examples, and API docs.
- Updated task checklist and handoff notes for the next prompt.

## Acceptance criteria
Migrations apply to fresh DB; seed repeatable; spatial query test passes; tenant leak tests planned.

## Execution contract
First inspect the existing repository. State assumptions and propose a concise plan. Implement only this stage, run available checks, report actual results, unresolved blockers, and precise files changed. Do not silently skip tests or implement future-stage modules. Stop and request approval before the next stage.

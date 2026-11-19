# Prompt 05 — CI/CD and observability foundation

Use the Global instructions from README.md.

## Task
Set up GitHub Actions for lint/typecheck/tests/build/security scanning; branch protection guidance, dependency updates, structured logs, request IDs, OpenTelemetry, error monitoring adapters, staging deployment templates, backup and restore runbook.

## Deliverables
- Production-quality implementation or documentation as appropriate.
- Relevant tests, migration notes, configuration examples, and API docs.
- Updated task checklist and handoff notes for the next prompt.

## Acceptance criteria
Pipeline works on sample PR; logs redact secrets; backup restoration is documented.

## Execution contract
First inspect the existing repository. State assumptions and propose a concise plan. Implement only this stage, run available checks, report actual results, unresolved blockers, and precise files changed. Do not silently skip tests or implement future-stage modules. Stop and request approval before the next stage.

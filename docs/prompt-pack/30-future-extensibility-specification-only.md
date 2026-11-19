# Prompt 30 — Future extensibility specification only

Use the Global instructions from README.md.

## Task
Write RFCs for daily rewards/check-ins/streaks/ledger, escrow/payments, transaction-backed reviews, AI, telematics, and multilingual support. Define integration seams and event schemas only; do not implement runtime, tables, endpoints, UI or jobs for excluded modules.

## Deliverables
- Production-quality implementation or documentation as appropriate.
- Relevant tests, migration notes, configuration examples, and API docs.
- Updated task checklist and handoff notes for the next prompt.

## Acceptance criteria
Architecture review confirms no excluded modules implemented and clear future migration paths.

## Execution contract
First inspect the existing repository. State assumptions and propose a concise plan. Implement only this stage, run available checks, report actual results, unresolved blockers, and precise files changed. Do not silently skip tests or implement future-stage modules. Stop and request approval before the next stage.

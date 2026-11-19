# Prompt 08 — Subscription catalog and entitlements

Use the Global instructions from README.md.

## Task
Build versioned plans, capabilities, plan assignments, manual external-billing confirmation, quotas, atomic counters, daily reset semantics, override audit logs and grace periods. Include friend request, service request, article, group, staff and branch limits.

## Deliverables
- Production-quality implementation or documentation as appropriate.
- Relevant tests, migration notes, configuration examples, and API docs.
- Updated task checklist and handoff notes for the next prompt.

## Acceptance criteria
Concurrent quota tests pass; plan downgrades safe; emergency exempt from standard quota.

## Execution contract
First inspect the existing repository. State assumptions and propose a concise plan. Implement only this stage, run available checks, report actual results, unresolved blockers, and precise files changed. Do not silently skip tests or implement future-stage modules. Stop and request approval before the next stage.

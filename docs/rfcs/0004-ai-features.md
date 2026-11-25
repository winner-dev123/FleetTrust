# RFC-0004: AI assistance

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:** SRS §9 ("AI features (recommendations, chat assistants, auto-moderation decisions)"; RFC only)

## Summary

Large-language-model assistance in a few narrow, **advisory** places:

1. **Request drafting:** turn a driver's free-text description into the structured request form (category, vehicle type, urgency) for the driver to confirm.
2. **Moderation triage:** suggest a policy category and priority for reported content, so moderators see the riskiest reports first.
3. **Provider profile help:** suggest clearer service descriptions from what a provider typed.

AI never takes a decision that affects a person: no automatic removals, sanctions, verifications, matches or emergency actions. A human (the user or a moderator) confirms every suggestion.

## Why it's excluded today, and preconditions

- **Data protection:** messages, documents and locations are personal data, some of them sensitive. Sending them to a model vendor needs a lawful basis, a data processing agreement, data residency (Europe, OQ-02) and transparency.
- **The EU AI Act** adds obligations depending on the use. Moderation and anything touching access to services needs careful classification.
- **Hallucinations in a safety product** (wrong advice in an emergency, invented provider facts) are unacceptable.
- **Preconditions to start:**
  - the vendor chosen, with an EU data residency and no-training terms;
  - a DPIA (data protection impact assessment);
  - a consent and transparency design;
  - an evaluation set for each use case;
  - an ADR superseding ADR-0011 for this module.

## Principles and constraints

1. **Advisory only.** Outputs are suggestions shown to a human who confirms or edits them. Never auto-apply, auto-remove or auto-decide (SRS §9 explicitly excludes auto-moderation decisions).
2. **Never in the emergency path** (ADR-0010). Emergency screens show the official guidance and contacts only, with no generated text.
3. **No trust or ranking effects.** No AI-generated summaries of providers, and no AI ranking of search results.
4. **Minimise data.** Send only the text needed for the task. Never documents, exact locations, other people's messages or identity data. Redact emails, phone numbers and registration plates before sending (the existing log redaction rules are a starting point).
5. **Disclosed and optional.** Label AI suggestions as AI suggestions, with a consent purpose `ai_assistance` and a way to turn it off. Moderation triage is an internal tool for staff, covered by the privacy notice.
6. **Vendor-neutral port.** One adapter per vendor behind a port, with a deterministic fake for tests, like the routing and map adapters today.
7. **Measured.** Every use case has an offline evaluation set and acceptance thresholds before it ships, and an online metric for how often humans accept or edit suggestions.

## Proposed design

A new module `assist` with a `LanguageModel` port, prompt templates kept in the repository and reviewed like code, and an evaluation harness in `tools/`.

**Data it would own** (described, not created):

| Table (future)       | Purpose                                                                                                                                                      |
| -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `assist_suggestions` | Use case, input hash (not the input), output, model and prompt version, accepted / edited / rejected, latency. Kept 90 days for quality review, then deleted |

## Integration seams

### Consumes (existing events)

| Event                   | Producer (today)  | Use                                                                                              |
| ----------------------- | ----------------- | ------------------------------------------------------------------------------------------------ |
| `ContentReported`       | Moderation module | Triage suggestion (category, priority) attached to the moderation case for staff                 |
| `ServiceRequestCreated` | Requests module   | Offline only: measure how often drafted fields were changed (quality metric). No content is sent |

**Synchronous seams** (in the request path, behind a port):

- Request form: `assist.draftRequest(text)` → suggested fields. The client shows them for confirmation and nothing is saved until the driver submits.
- Provider profile editor: `assist.improveDescription(text)` → suggested text.

### Emits (proposed events; schemas in [events/](events/))

| Event                      | When                                                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------- |
| `AssistSuggestionRecorded` | A suggestion was produced and the human's response (accepted, edited, rejected) recorded |

### Ports (future)

- `LanguageModel.complete({ template, variables, maxTokens, timeoutMs })` → `{ text, model, usage }`. It times out to "no suggestion" and never blocks the user's action.
- `Redactor.redact(text)`: shared with logging redaction.

### Touch points in existing code

- **Request form and provider profile editor:** a "Suggest" button, hidden unless consent is given.
- **Moderation queue:** a "Suggested category" chip, staff-only.
- **Privacy:** the new consent purpose; export includes the person's suggestion history; erasure deletes it.

## Event schemas

- [`AssistSuggestionRecorded`](events/AssistSuggestionRecorded.schema.json)

## Migration path

1. **Decide.** Vendor and terms (EU residency, no training on our data), DPIA, AI Act classification per use case. A new ADR, and the guard's AI SDK block narrowed to the chosen SDK, used only inside the `assist` module.
2. **Evaluate offline.** Build an evaluation set from synthetic and consented examples, and set thresholds such as "≥ 90 % of drafted categories accepted unchanged".
3. **Expand.** Add the module, the table and the consent purpose. The fake model runs in CI.
4. **Staff-only triage first:** the lowest risk, because it is internal and advisory.
5. **Opt-in user features**, measured by acceptance rate. Remove any use case that doesn't meet its threshold.
6. **Withdraw path.** Hide the buttons, stop calling the port, delete suggestions after the retention period.

## Risks

| Risk                                                    | Mitigation                                                                                    |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Personal data leaving the EU or being used for training | Vendor terms, EU endpoint, redaction, minimal inputs                                          |
| Wrong or unsafe output                                  | Advisory only, human confirmation, never in emergency or trust paths, evaluation thresholds   |
| Bias in moderation triage                               | Suggestions don't change the decision; audit the accepted vs. overridden rate by category     |
| Cost spikes                                             | Per-day budget in the adapter; time out to no suggestion                                      |
| Prompt injection via user text                          | Templates treat user text as data; outputs are only ever suggestions for a human; no tool use |

## Open questions

- Is request drafting valuable enough given the current form? (Measure form completion time in the pilot first.)
- Do we self-host an open model in Europe instead of using a vendor?

## Exit criteria (to leave Draft)

- Vendor, DPIA and AI Act classification recorded.
- Evaluation sets and thresholds defined per use case.
- The ADR and guard change drafted with the first migration.

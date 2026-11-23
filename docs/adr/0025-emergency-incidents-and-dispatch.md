# ADR-0025: Emergency incidents with mutual-consent contacts, a dedicated delivery queue, waves of escalation, and erased locations

- Status: Accepted
- Date: 2026-11-23

## Context

Prompt 18 builds emergency assistance (SRS J3, F-060..F-064): incidents, location consent, trusted contacts, nearby provider matching, push with email fallback, acknowledgements, escalation, an incident room, expiry, audit, and official emergency-services guidance first.

The acceptance criteria are:

- independent of ordinary quotas;
- no guaranteed-rescue claims;
- safety and retry tests pass.

ADR-0010 already forbids any dependency on entitlements and asks for safety-oriented abuse controls. ADR-0007 proposed a dedicated emergency queue.

## Decision

1. **Guidance first.**
   - `GET /v1/emergency/guidance` is public, so the first screen works even signed out or offline-cached.
   - It reads a per-country table (`emergency_guidance`) that **ships empty** until the launch country is decided (OQ-03). Until then the answer is "Call your local emergency number".
   - Every incident and alert response carries the guidance and the disclaimer "FleetTrust doesn't replace emergency services…".
2. **Trusted contacts need mutual consent** (AB-03).
   - **Invitations:** a contact must accept an invitation before they can be alerted.
   - **Contact controls:** contacts can pause alerts or leave.
   - **Owner controls:** owners choose primary or backup priority, with up to 10 contacts.
   - **Blocks:** blocks either way end the link and stop alerts.
3. **No quotas, no hard rate limit.**
   - The module never imports entitlements (lint boundary, plus a source test).
   - Creation has no `@RateLimit`.
   - **Soft threshold:** more than `EMERGENCY_SOFT_LIMIT_PER_HOUR` incidents (default 3) flags the incident and the account for review (audited). Flagged incidents are still created and alerted; the first is never flagged.
   - **Duplicates:** repeated taps are absorbed instead of refused. `clientIncidentId` is idempotent, and a second create while one is active returns the active incident.
4. **Location consent per incident.**
   - The location is stored only when `shareLocation` is true for this incident. The database enforces that a location exists only with consent.
   - **Who sees it:** the owner and alerted contacts, while the incident is active.
   - **Erasure:** it is erased when the incident is resolved, cancelled or expires.
   - **Audit:** never records coordinates.
5. **A dedicated delivery queue** (`incident_deliveries`), separate from the notification outbox so ordinary traffic can't delay it.
   - **First push inline:** the first push is attempted inside the create request (SRS: p95 ≤ 10 s to the first send attempt).
   - **Retries:** failures retry with backoff (5 s, 15 s, 45 s, 135 s; 5 attempts). Each attempt claims the row with a lease, so retries are idempotent and concurrent workers can't double-send.
   - **Email fallback:** when push can't be delivered (no devices, or all attempts failed), or when a contact hasn't acknowledged a delivered push within `EMERGENCY_EMAIL_FALLBACK_SECONDS` (60).
   - **Ignores ordinary push opt-outs:** emergency pushes skip the category switches, because the contact explicitly agreed to be an emergency contact. Pausing is their opt-out.
   - **Alerting:** final failures are logged at error level for on-call alerting.
6. **Acknowledgement and escalation.**
   - **Acknowledging:** a contact acknowledging means "I've seen it". It stops escalation and tells the owner. The copy never says help is on its way.
   - **Waves:** if nobody acknowledges within `EMERGENCY_ESCALATION_SECONDS` (120):
     - wave 2 alerts the backup contacts;
     - wave 3 alerts anyone left;
     - with nobody new to alert, a wave reminds those already alerted.
     - At most three waves.
7. **Nearby providers (opt-in on both sides).**
   - Providers opt in with a radius; this needs a published profile.
   - The person chooses `notifyNearbyProviders` per incident, which needs a shared location.
   - **Matching:** up to 10 nearest opted-in providers within their radius, using the search projection. Their team (`requests.respond`, branch scope) gets a push.
   - **What providers see:** an approximate area (about 1 km), the category and the distance. They never see the person or the note.
   - **Offers:** a provider can offer help. The person sees the business name, phone and message and decides. The payment disclaimer applies.
8. **Incident room.**
   - A conversation of kind `incident`, built on the messaging module (ADR-0024), for the owner and alerted contacts.
   - Writable while active; read-only for 24 hours after closing; then gone.
   - Message history follows messaging retention (Prompt 27).
9. **Expiry and audit.**
   - Incidents expire after `EMERGENCY_INCIDENT_HOURS` (12) and their location is erased.
   - Every step is audited: created, flagged, acknowledged, escalated, location updated (no coordinates), resolved, cancelled, expired, provider offered, and contact changes.
10. **Safe wording.** `FORBIDDEN_EMERGENCY_WORDING` ("help is on the way", "guarantee", "rescue is coming", …) is checked by tests over the emergency code, the shared types, and every push and email sent during the tests.

## Consequences

- **Some abusive alerts get through** before moderation reacts. This is accepted, per ADR-0010.
- **Email has no vendor yet** (OQ-06). Locally and in tests, emails are recorded. Production launch needs a provider; this is a launch blocker, documented but not enforced by env validation yet.
- **Legal review of the wording and provider matching** (OQ-04) remains a launch blocker.
- **The worker role runs the timers** (retries, fallback, escalation, expiry) every `EMERGENCY_TICK_MS`. The first push is still sent inline if the worker is down. Production may move timers to Cloud Tasks (ADR-0007) by calling the same `tick()`.
- **Load:** emergency fan-out load tests come in Prompt 28.

## Alternatives considered

- **A separate emergency quota:** rejected (ADR-0010).
- **Using the general outbox:** ordinary event volume could delay emergency sends.
- **Exact location for providers:** unnecessary to offer help, and riskier for the person.
- **Contacts without consent:** turns alerts into a harassment channel (AB-03).

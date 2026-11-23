# Emergency assistance and trusted contacts

SRS J3, F-060..F-064. Design: [ADR-0010](../adr/0010-emergency-exempt-from-quotas.md), [ADR-0025](../adr/0025-emergency-incidents-and-dispatch.md).

> **FleetTrust doesn't replace emergency services.** Every response includes this disclaimer and the official guidance. Never write copy that promises help or rescue: tests reject "help is on the way", "guarantee", "rescue is coming" and similar.

## Flow

1. **First screen:** `GET /v1/emergency/guidance?country=ZA` (public) gives the official number, or "Call your local emergency number" when none is configured.
2. **Raise:** `POST /v1/emergency/incidents`. Primary contacts get a push at once.
3. **Contacts:** they open the alert (`GET /v1/emergency/incidents/:id`), acknowledge ("I've seen it"), and talk in the incident room.
4. **No acknowledgement:** email fallback after 60 s, then escalation to backups after 120 s (three waves at most).
5. **Close:** the person marks themselves safe or cancels, or the incident expires after 12 hours. The location is erased.

## Trusted contacts (mutual consent)

| Method & path                                           | Who     | Notes                                                                       |
| ------------------------------------------------------- | ------- | --------------------------------------------------------------------------- |
| `GET /v1/me/trusted-contacts`                           | anyone  | Your contacts (`role: my_contact`) and people who chose you (`contact_for`) |
| `POST /v1/me/trusted-contacts`                          | owner   | `{ userId, priority: primary \| backup }` (20 per day, up to 10 contacts)   |
| `POST /v1/me/trusted-contacts/:id/accept` or `/decline` | contact | Only accepted contacts can be alerted                                       |
| `POST /v1/me/trusted-contacts/:id/mute`                 | contact | `{ muted }`: pause or resume alerts                                         |
| `PATCH /v1/me/trusted-contacts/:id`                     | owner   | `{ priority }`                                                              |
| `DELETE /v1/me/trusted-contacts/:id`                    | either  | Remove, or leave                                                            |

Blocks either way end the link.

## Incidents

```json
POST /v1/emergency/incidents
{
  "clientIncidentId": "0196f2a8-…",
  "category": "breakdown",
  "note": "Truck stopped on the N3 shoulder",
  "shareLocation": true,
  "location": { "lng": 28.05, "lat": -26.2, "accuracyM": 25 },
  "contactIds": null,
  "notifyNearbyProviders": false,
  "countryCode": "ZA"
}
```

**Fields:**

- **`category`:** `breakdown`, `accident`, `medical`, `security`, `stranded`, `other`.
- **`shareLocation`:** consent for this incident only. Without it nothing is stored.
- **`contactIds`:** limits who is alerted (default: every active contact).
- **`clientIncidentId`:** reuse it on retry. While one incident is active, creating another returns it.

**No limits apply:** no quotas, no plan checks, no rate limit. More than 3 incidents in an hour sets `flagged` (for review); it is never refused.

| Method & path                                  | Who                     | Notes                                                                |
| ---------------------------------------------- | ----------------------- | -------------------------------------------------------------------- |
| `GET /v1/emergency/incidents`                  | owner                   | Your incidents                                                       |
| `GET /v1/emergency/incidents/:id`              | owner, alerted contacts | Contacts see the owner's name, note and shared location while active |
| `POST /v1/emergency/incidents/:id/location`    | owner                   | `{ location }`. Shares or refreshes it                               |
| `POST /v1/emergency/incidents/:id/acknowledge` | contact                 | Stops escalation and tells the owner it was seen                     |
| `POST /v1/emergency/incidents/:id/resolve`     | owner                   | "I'm safe". Contacts are told                                        |
| `POST /v1/emergency/incidents/:id/cancel`      | owner                   | "False alarm"                                                        |
| `GET /v1/emergency/alerts`                     | contacts                | Alerts you received                                                  |

**Incident room:** `conversationId` is a messaging conversation of kind `incident` ([messaging.md](messaging.md)), for the owner and alerted contacts. It is writable while active, read-only for 24 hours after closing, then gone.

## Delivery

| Step                           | When                                                                                 |
| ------------------------------ | ------------------------------------------------------------------------------------ |
| First push to primary contacts | Inline, before the create response                                                   |
| Retry a failed push            | 5 s, 15 s, 45 s, 135 s (5 attempts), then email                                      |
| Email                          | At once if the contact has no device; or 60 s after an unacknowledged push           |
| Wave 2                         | 120 s without any acknowledgement: backup contacts (or a reminder if there are none) |
| Wave 3                         | Another 120 s: anyone not yet alerted (or a reminder)                                |
| Expiry                         | 12 h: closed, location erased                                                        |

**Emergency pushes ignore the ordinary push opt-outs:** the contact agreed to be an emergency contact, and pausing is their opt-out. The worker role runs the timers every `EMERGENCY_TICK_MS`.

## Nearby providers (opt-in)

| Method & path                                              | Permission         | Notes                                                                        |
| ---------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------- |
| `GET` / `PUT /v1/orgs/:orgId/emergency-assist`             | `profile.manage`   | `{ optedIn, radiusKm 1–100 }`. Opting in needs a published profile           |
| `GET /v1/orgs/:orgId/emergency-alerts`                     | `requests.respond` | Category, approximate area (about 1 km, while active), distance. No identity |
| `POST /v1/orgs/:orgId/emergency-alerts/:recipientId/offer` | `requests.respond` | `{ message? }`. The person sees your name, phone and message                 |

Providers are alerted only when the person chose `notifyNearbyProviders` and shared a location. At most the 10 nearest opted-in providers within their own radius are alerted.

## Configuration

| Variable                           | Default                                    | Notes                                                          |
| ---------------------------------- | ------------------------------------------ | -------------------------------------------------------------- |
| `EMERGENCY_ESCALATION_SECONDS`     | 120                                        | Time before the next wave                                      |
| `EMERGENCY_EMAIL_FALLBACK_SECONDS` | 60                                         | Unacknowledged push → email                                    |
| `EMERGENCY_INCIDENT_HOURS`         | 12                                         | Automatic expiry                                               |
| `EMERGENCY_SOFT_LIMIT_PER_HOUR`    | 3                                          | Above this, incidents are flagged (never refused)              |
| `EMERGENCY_TICK_MS`                | 1000                                       | Worker timer interval                                          |
| `EMAIL_PROVIDER`                   | `log`                                      | Vendor pending (OQ-06). `log` records only: **launch blocker** |
| `EMAIL_FROM`                       | `FleetTrust <no-reply@fleettrust.invalid>` | Sender address                                                 |

**Official numbers** live in `emergency_guidance` (country code, number, label, text). It ships empty (OQ-03). Add rows once the launch country is decided and the text is legally reviewed (OQ-04).

## Data

| Table                         | Notes                                                                                                                                   |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `emergency_guidance`          | Official numbers per country (empty until OQ-03)                                                                                        |
| `trusted_contacts`            | Owner, contact, status, priority, paused by the contact                                                                                 |
| `emergency_incidents`         | Category, note, status, location only with consent (erased on close), wave, escalation and expiry times, flagged. One active per person |
| `incident_recipients`         | Contacts (by wave, acknowledged) and providers (distance, offer)                                                                        |
| `incident_deliveries`         | The delivery queue: channel, purpose, attempts, next attempt, status, last error                                                        |
| `provider_emergency_settings` | Provider opt-in and radius                                                                                                              |

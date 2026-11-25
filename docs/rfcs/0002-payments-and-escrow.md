# RFC-0002: Customer-to-provider payments and escrow

- **Status:** Draft (specification only, [ADR-0011](../adr/0011-future-modules-spec-only.md))
- **Date:** 2026-11-25
- **Excluded by:**
  - SRS §9 ("Customer-to-provider payment processing, checkout, escrow, payouts"; business rule);
  - [ADR-0008](../adr/0008-manual-plan-activation.md) (plans activated manually after external payment);
  - [ADR-0009](../adr/0009-trust-independent-of-payment.md) (trust independent of payment).

## Summary

Customers would pay providers for accepted quotes inside FleetTrust, optionally with funds held by a licensed payment provider until the job is confirmed complete (escrow), then released to the provider. FleetTrust would **never hold funds itself**: a regulated payment service provider (PSP) would hold and move all money.

## Why it's excluded today, and preconditions

- **Moving money is regulated.** Depending on the jurisdiction (OQ-03) that means PSD2 / e-money rules in the EU, KYC/AML for payouts, PCI DSS and tax reporting. Escrow-like holds are often a licensed activity on their own.
- **Disputes and chargebacks need operations** (a support team, evidence handling) that the pilot doesn't have.
- **Today, payment is arranged directly between customer and provider**, and the product says so. Quotes and prices are indicative (SRS §8.1).
- **Preconditions to start:**
  - the jurisdiction (OQ-03) decided;
  - a PSP chosen with a marketplace or connected-accounts product that holds funds under its own licence;
  - legal sign-off on the flow of funds and the terms;
  - a support process for disputes.

## Principles and constraints

1. **FleetTrust never touches card data or holds funds.** Card entry happens in the PSP's hosted fields or checkout, and funds sit in the PSP's regulated accounts.
2. **Trust stays independent of payment** (ADR-0009). Paying through FleetTrust never affects verification, Power User status or ranking, and "paid via FleetTrust" is never shown as a trust signal. The SRS non-goal "payment verified" claims remains in force.
3. **Emergency features are never behind a payment** (ADR-0010).
4. **Payment is optional per request.** Off-platform payment stays possible and is never penalised in the product.
5. **Idempotent, event-driven money state.** Every state change comes from a verified PSP webhook or an explicit user action, with idempotency keys. No balance is ever computed in FleetTrust; the PSP is the ledger of record.
6. **Clear fees.** Any platform fee is disclosed before the customer pays, as referral fees are disclosed today (AB-17).

## Proposed design

A new module `payments`, plus a PSP adapter behind a port, following the pattern of the email, push and storage adapters.

**Flow (escrow variant):**

```
quote accepted ──► customer pays (PSP hosted checkout) ──► funds held by the PSP
     ▲                                                      │
     │                       job completed + confirmation window (e.g. 72 h) or customer confirms
     │                                                      ▼
 (existing event)                                   release to provider (PSP payout)
                                    dispute ──► PSP dispute process; FleetTrust provides the request history as evidence
```

**Data it would own** (described, not created):

| Table (future)             | Purpose                                                                                                                  |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `payment_intents`          | One per accepted quote that the customer chooses to pay: amount, currency, PSP intent ID, status mirror, idempotency key |
| `payment_events`           | Append-only verified PSP webhooks (ID, type, payload hash) for audit and replay                                          |
| `provider_payout_accounts` | PSP connected-account ID and onboarding status per provider organisation. No bank details stored                         |

## Integration seams

### Consumes (existing events)

| Event                             | Producer (today) | Use                                                                         |
| --------------------------------- | ---------------- | --------------------------------------------------------------------------- |
| `ServiceRequestQuoteAccepted`     | Requests module  | Offer "pay now" for the accepted quote (amount and currency from the quote) |
| `ServiceRequestCompleted`         | Requests module  | Start the confirmation window, then release the held funds                  |
| `ServiceRequestProviderCancelled` | Requests module  | Refund (or cancel the authorisation) in full                                |
| `AppointmentCancelled`            | CRM module       | Apply the provider's stated cancellation terms through the PSP refund API   |

### Emits (proposed events; schemas in [events/](events/))

| Event               | When                                                    |
| ------------------- | ------------------------------------------------------- |
| `PaymentAuthorized` | The PSP confirmed funds are held for a request          |
| `EscrowReleased`    | Funds were released to the provider's connected account |
| `PaymentRefunded`   | A full or partial refund completed                      |
| `PaymentDisputed`   | The PSP reported a dispute or chargeback                |

### Ports (future)

- **`PaymentProvider`:** `createCheckout`, `capture`, `release`, `refund`, `verifyWebhook`, `onboardingLink`. Adapters per PSP, with a fake for tests, like `RecordingEmailSender` today.
- **Webhook ingress:** one signed, unauthenticated route verified by the PSP signature and rate limited. It writes `payment_events`, then the outbox.

### Touch points in existing code

- **Quote view:** a "Pay through FleetTrust (optional)" action. Copy and fees are disclosed first.
- **Provider organisation settings:** PSP onboarding link (status only).
- **Privacy:** export the payment history, not card data. Erasure keeps the PSP references FleetTrust is legally required to keep, linked to the tombstone.
- **Entitlements:** none. Payment never changes plans automatically; ADR-0008 stays.

## Event schemas

- [`PaymentAuthorized`](events/PaymentAuthorized.schema.json)
- [`EscrowReleased`](events/EscrowReleased.schema.json)
- [`PaymentRefunded`](events/PaymentRefunded.schema.json)
- [`PaymentDisputed`](events/PaymentDisputed.schema.json)

## Migration path

1. **Decide.** Jurisdiction, PSP, legal opinion and dispute process. A new ADR supersedes the payment parts of ADR-0011 and SRS §9. The guard's payment stems, routes and SDK list are narrowed to the chosen PSP SDK and the `payments` module only.
2. **Expand.** Add the tables, the PSP adapter (sandbox) and the webhook route. Nothing is visible yet.
3. **Sandbox end to end** in staging with the PSP's test mode: authorise, release, refund and dispute paths, with rehearsed webhook replays (idempotency).
4. **Pilot with selected providers**, payment optional, escrow window agreed in writing.
5. **General availability**, or withdraw. Withdrawal: switch the action off, settle or refund open intents through the PSP, keep the records for the legal retention period, then delete them in a contract release.

## Risks

| Risk                                | Mitigation                                                                                    |
| ----------------------------------- | --------------------------------------------------------------------------------------------- |
| Becoming an unlicensed money holder | Funds only ever in PSP accounts; legal sign-off; no FleetTrust balances                       |
| Payment perceived as trust          | No badges or ranking effects; copy reviewed against SRS §8                                    |
| Fraud and chargebacks               | PSP risk tools, 3-D Secure, delayed release window, dispute evidence from the request history |
| Webhook spoofing or replay          | Signature verification, stored event IDs, idempotent handlers                                 |
| PCI scope creep                     | Hosted fields or checkout only; no card data in logs or the database                          |

## Open questions

- Should escrow be the default, or one option beside immediate payment?
- How are part payments (deposits) for large jobs handled?
- What is the fee model (none, flat, percentage)? It must be disclosed and never affect ranking.

## Exit criteria (to leave Draft)

- Jurisdiction, PSP and legal opinion recorded.
- Threat model updated (payments section).
- Dispute runbook written.
- The ADR and guard change drafted together with the first migration.

import { z } from "zod";

import { boundedText } from "./providers.js";
import { RECIPIENT_STATUSES } from "./requests.js";

/**
 * Provider-to-provider referrals (SRS F-142, AB-17, ADR-0028). A provider that received a
 * service request can suggest another provider to the customer. Nothing about the customer or
 * the request reaches the other provider until the customer explicitly consents, and any
 * business relationship (including a referral fee, which FleetTrust never processes) is declared
 * up front and shown to the customer. Every step is audited.
 */

export const REFERRAL_RELATIONSHIPS = ["none", "partner", "same_owner", "referral_fee"] as const;
export type ReferralRelationship = (typeof REFERRAL_RELATIONSHIPS)[number];

/** What the customer reads about the relationship. */
export const REFERRAL_RELATIONSHIP_LABELS: Readonly<Record<ReferralRelationship, string>> = {
  none: "No business relationship declared",
  partner: "Business partners",
  same_owner: "Same owner or group",
  referral_fee:
    "The referring provider receives a referral fee (arranged between the providers, not through FleetTrust)",
};

export const REFERRAL_STATUSES = [
  "pending_consent",
  "consented",
  "declined",
  "withdrawn",
  /** Shown when the request closed before the customer decided. */
  "expired",
] as const;
export type ReferralStatus = (typeof REFERRAL_STATUSES)[number];

/** Open referrals (pending or consented) one inquiry can have at a time. */
export const MAX_REFERRALS_PER_INQUIRY = 3;

/** The exact text the customer agrees to; stored with the decision. */
export const REFERRAL_CONSENT_TEXT_VERSION = 1;
export function referralConsentText(input: {
  toName: string;
  sharePhotos: boolean;
  shareOutcomeWithReferrer: boolean;
}): string {
  const parts = [
    `I agree to send my service request to ${input.toName}.`,
    "They will see the description, the vehicle (without its registration), the urgency and an approximate location, as the providers I chose do.",
    input.sharePhotos ? "They will also see my photos." : "They will not see my photos.",
    input.shareOutcomeWithReferrer
      ? "The referring provider may see whether they quoted and whether I accepted."
      : "The referring provider will not see what happens next.",
  ];
  return parts.join(" ");
}

export const createReferralSchema = z
  .object({
    /** The provider being suggested (its public slug). */
    toProvider: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/),
    /** Why: shown to the customer, and to the other provider only after consent. */
    message: boundedText(1000).min(10, "Tell the customer why (at least 10 characters)"),
    relationship: z.enum(REFERRAL_RELATIONSHIPS),
    /** Required unless relationship is `none`, e.g. "10% of the invoice". */
    relationshipDetails: boundedText(300).min(3).nullable().default(null),
  })
  .strict()
  .refine((v) => (v.relationship === "none") === (v.relationshipDetails === null), {
    path: ["relationshipDetails"],
    message: "Describe the relationship (and only when there is one)",
  });
export type CreateReferral = z.input<typeof createReferralSchema>;

export const referralConsentSchema = z
  .object({
    /** Must be literally true: consent is never implied. */
    consent: z.literal(true),
    sharePhotos: z.boolean().default(false),
    shareOutcomeWithReferrer: z.boolean().default(false),
  })
  .strict();
export type ReferralConsent = z.input<typeof referralConsentSchema>;

export const referralListQuerySchema = z
  .object({
    direction: z.enum(["sent", "received"]).default("sent"),
    status: z.enum(REFERRAL_STATUSES).optional(),
  })
  .strict();

const party = z.object({ organizationId: z.uuid(), name: z.string(), slug: z.string().nullable() });

export const referralHistoryEntrySchema = z.object({
  action: z.enum(["proposed", "consented", "declined", "withdrawn"]),
  side: z.enum(["referrer", "customer"]),
  at: z.iso.datetime(),
});

/** Shared by the customer's and the providers' views; each hides what isn't theirs to see. */
export const referralSchema = z.object({
  id: z.uuid(),
  requestId: z.uuid(),
  from: party,
  to: party,
  message: z.string(),
  relationship: z.enum(REFERRAL_RELATIONSHIPS),
  relationshipLabel: z.string(),
  relationshipDetails: z.string().nullable(),
  status: z.enum(REFERRAL_STATUSES),
  /** Set once the customer consented. */
  sharing: z
    .object({
      photos: z.boolean(),
      outcomeWithReferrer: z.boolean(),
      consentText: z.string(),
    })
    .nullable(),
  /**
   * Referrer's view only, and only when the customer allowed it: what the other provider's
   * inquiry became (quoted, declined, accepted…). Null otherwise.
   */
  outcome: z.enum(RECIPIENT_STATUSES).nullable(),
  /** The other provider's inquiry, in the receiver's view after consent. */
  recipientId: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
  decidedAt: z.iso.datetime().nullable(),
  /** From the append-only audit log. */
  history: z.array(referralHistoryEntrySchema),
});
export type ReferralDto = z.infer<typeof referralSchema>;

export const referralErrorReasonSchema = z.enum([
  "not_a_provider",
  "provider_not_found",
  "provider_not_matching",
  "self_referral",
  "already_recipient",
  "already_referred",
  "too_many_referrals",
  "invalid_transition",
]);
export type ReferralErrorReason = z.infer<typeof referralErrorReasonSchema>;

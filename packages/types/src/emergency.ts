import { z } from "zod";

import { safeText } from "./articles.js";

/**
 * Emergency assistance and trusted circles (SRS J3, F-060..F-064, ADR-0010, ADR-0025).
 * Never gated by plans or quotas. The wording never promises that help will come.
 */

/** Shown with every incident, alert and guidance response. */
export const EMERGENCY_DISCLAIMER =
  "FleetTrust doesn't replace emergency services. If anyone is in danger, call your local emergency number first. Your contacts and nearby providers may not be able to respond.";

/** Used when no official number is configured for the country (OQ-03). */
export const DEFAULT_EMERGENCY_GUIDANCE = "Call your local emergency number.";

/**
 * Wording that must never appear in emergency copy (SRS J3, ADR-0010): nothing may imply that
 * rescue is certain or already coming. Checked by tests over the emergency code and these types.
 */
export const FORBIDDEN_EMERGENCY_WORDING =
  /help is on (?:the|its) way|guarantee|rescue (?:is )?(?:coming|on)|someone will come|we will (?:save|rescue|send)|you are safe now/i;

export const INCIDENT_CATEGORIES = [
  "breakdown",
  "accident",
  "medical",
  "security",
  "stranded",
  "other",
] as const;
export const INCIDENT_CATEGORY_LABELS: Record<(typeof INCIDENT_CATEGORIES)[number], string> = {
  breakdown: "Vehicle breakdown",
  accident: "Accident",
  medical: "Medical",
  security: "Personal safety",
  stranded: "Stranded",
  other: "Needs assistance",
};

export const MAX_TRUSTED_CONTACTS = 10;

// ---------------------------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------------------------

const lngLat = z
  .object({
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    /** Device-reported accuracy in metres. */
    accuracyM: z.number().int().min(0).max(100_000).nullable().default(null),
  })
  .strict();

export const inviteTrustedContactSchema = z
  .object({
    userId: z.uuid(),
    /** Primary contacts are alerted first; backups when nobody acknowledges in time. */
    priority: z.enum(["primary", "backup"]).default("primary"),
  })
  .strict();

export const updateTrustedContactSchema = z
  .object({ priority: z.enum(["primary", "backup"]) })
  .strict();

export const muteTrustedContactSchema = z.object({ muted: z.boolean() }).strict();

export const createIncidentSchema = z
  .object({
    /** Client-generated; repeated taps or retries return the same incident. */
    clientIncidentId: z.uuid(),
    category: z.enum(INCIDENT_CATEGORIES),
    note: safeText(500, { multiline: true }).nullable().default(null),
    /** Consent to share the location for this incident only. */
    shareLocation: z.boolean(),
    location: lngLat.nullable().default(null),
    /** Which trusted contacts to alert (defaults to every active contact). */
    contactIds: z.array(z.uuid()).max(MAX_TRUSTED_CONTACTS).nullable().default(null),
    /** Also alert nearby providers who opted in (they see an approximate area only). */
    notifyNearbyProviders: z.boolean().default(false),
    /** ISO country for official guidance, if the device knows it. */
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .nullable()
      .default(null),
  })
  .strict()
  .refine((v) => !v.shareLocation || v.location !== null, {
    message: "Location required when sharing it",
    path: ["location"],
  });
export type CreateIncident = z.input<typeof createIncidentSchema>;

export const updateIncidentLocationSchema = z.object({ location: lngLat }).strict();

export const closeIncidentSchema = z
  .object({ note: safeText(500, { multiline: true }).nullable().default(null) })
  .strict();

export const emergencyAssistSettingsSchema = z
  .object({
    optedIn: z.boolean(),
    radiusKm: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const providerOfferSchema = z
  .object({ message: safeText(300, { multiline: true }).nullable().default(null) })
  .strict();

// ---------------------------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------------------------

export const emergencyGuidanceSchema = z.object({
  countryCode: z.string().nullable(),
  /** Official number to call, or null when none is configured. */
  number: z.string().nullable(),
  label: z.string(),
  text: z.string(),
  disclaimer: z.literal(EMERGENCY_DISCLAIMER),
});
export type EmergencyGuidance = z.infer<typeof emergencyGuidanceSchema>;

export const trustedContactSchema = z.object({
  id: z.uuid(),
  /** The other person (your contact, or the person you're a contact for). */
  person: z.object({ userId: z.uuid(), displayName: z.string() }),
  role: z.enum(["my_contact", "contact_for"]),
  status: z.enum(["pending", "active", "declined"]),
  priority: z.enum(["primary", "backup"]),
  /** The contact paused alerts. Owners see it as "paused". */
  muted: z.boolean(),
  createdAt: z.iso.datetime(),
});
export type TrustedContactDto = z.infer<typeof trustedContactSchema>;

const point = z.object({ lng: z.number(), lat: z.number(), accuracyM: z.number().nullable() });

export const incidentSchema = z.object({
  id: z.uuid(),
  status: z.enum(["active", "resolved", "cancelled", "expired"]),
  category: z.enum(INCIDENT_CATEGORIES),
  categoryLabel: z.string(),
  note: z.string().nullable(),
  owner: z.object({ userId: z.uuid(), displayName: z.string(), mine: z.boolean() }),
  /** Exact, while active and only if the owner shared it. Erased when the incident closes. */
  location: point.nullable(),
  locationUpdatedAt: z.iso.datetime().nullable(),
  wave: z.number().int(),
  contacts: z.array(
    z.object({
      userId: z.uuid(),
      displayName: z.string(),
      notifiedAt: z.iso.datetime().nullable(),
      acknowledgedAt: z.iso.datetime().nullable(),
    }),
  ),
  providerOffers: z.array(
    z.object({
      organizationId: z.uuid(),
      name: z.string(),
      phone: z.string().nullable(),
      distanceKm: z.number().nullable(),
      message: z.string().nullable(),
      offeredAt: z.iso.datetime(),
    }),
  ),
  conversationId: z.uuid().nullable(),
  /** More alerts than usual recently: flagged for review, never blocked (ADR-0010). */
  flagged: z.boolean(),
  createdAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  closedAt: z.iso.datetime().nullable(),
  guidance: emergencyGuidanceSchema,
  disclaimer: z.literal(EMERGENCY_DISCLAIMER),
});
export type IncidentDto = z.infer<typeof incidentSchema>;

/** What an opted-in provider sees: no identity, approximate area only. */
export const providerAlertSchema = z.object({
  recipientId: z.uuid(),
  incidentId: z.uuid(),
  status: z.enum(["active", "resolved", "cancelled", "expired"]),
  category: z.enum(INCIDENT_CATEGORIES),
  categoryLabel: z.string(),
  /** Rounded to about 1 km while active; null once the incident closes (location erased). */
  approximateLocation: z.object({ lng: z.number(), lat: z.number() }).nullable(),
  distanceKm: z.number().nullable(),
  offered: z.boolean(),
  createdAt: z.iso.datetime(),
  disclaimer: z.literal(EMERGENCY_DISCLAIMER),
});
export type ProviderAlertDto = z.infer<typeof providerAlertSchema>;

export const emergencyErrorReasonSchema = z.enum([
  "not_allowed",
  "already_contact",
  "too_many_contacts",
  "contact_not_active",
  "incident_closed",
  "not_a_provider",
  "not_published",
  "location_not_shared",
]);
export type EmergencyErrorReason = z.infer<typeof emergencyErrorReasonSchema>;

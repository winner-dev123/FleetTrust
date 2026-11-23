import { z } from "zod";

import { indicativePriceSchema } from "./catalog.js";
import {
  PROFILE_IMAGE_TYPES,
  boundedText,
  providerCategorySchema,
  vehicleTypeSchema,
} from "./providers.js";

/**
 * Service requests and quotes (SRS J2, F-050..F-052, ADR-0021). No money moves through the
 * platform: quotes are informational and an accepted quote only records what was agreed.
 */
export const PAYMENT_DISCLAIMER =
  "Payment is arranged directly with the provider. FleetTrust doesn't process or verify payments.";

/** Shown with every quote (SRS AB-07: off-platform payment scams). */
export const QUOTE_SCAM_WARNING =
  "Never pay a deposit to an account you can't verify. FleetTrust will never ask you to pay through a link in a quote or message.";

export const MAX_DIRECT_PROVIDERS = 5;
export const MAX_MATCHED_PROVIDERS = 10;
export const MAX_REQUEST_PHOTOS = 6;
export const MAX_QUOTES_PER_PROVIDER = 10;
/** Open requests stop accepting quotes after this many days. */
export const REQUEST_OPEN_DAYS = 14;

export const REQUEST_URGENCIES = ["routine", "soon", "urgent"] as const;

const lngLat = z
  .object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
  .strict();

export const requestVehicleSchema = z
  .object({
    vehicleType: vehicleTypeSchema,
    make: boundedText(60).nullable().default(null),
    model: boundedText(60).nullable().default(null),
    year: z.number().int().min(1900).max(2100).nullable().default(null),
    registration: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z0-9 -]{2,15}$/, "Letters, digits, spaces and hyphens")
      .nullable()
      .default(null),
  })
  .strict();

/** Who receives the request: chosen providers, or matching providers near the location. */
export const requestTargetSchema = z.discriminatedUnion("mode", [
  z
    .object({
      mode: z.literal("direct"),
      providerIds: z.array(z.uuid()).min(1).max(MAX_DIRECT_PROVIDERS),
    })
    .strict(),
  z
    .object({
      mode: z.literal("match"),
      radiusKm: z.number().min(1).max(100).default(25),
    })
    .strict(),
]);

export const createServiceRequestSchema = z
  .object({
    /** Client-generated ID: retries with the same ID return the same request (no second quota use). */
    clientRequestId: z.uuid(),
    category: providerCategorySchema,
    vehicle: requestVehicleSchema,
    location: lngLat,
    /** Free text such as a street or landmark. Shared with the accepted provider only. */
    locationNote: boundedText(200).nullable().default(null),
    description: boundedText(2000).min(10, "Describe the problem in at least 10 characters"),
    urgency: z.enum(REQUEST_URGENCIES).default("routine"),
    neededBy: z.iso.datetime().nullable().default(null),
    /** Photos uploaded first (`POST …/attachments`), referenced here. */
    photoIds: z.array(z.uuid()).max(MAX_REQUEST_PHOTOS).default([]),
    target: requestTargetSchema,
    /** Fleet requests: the fleet branch it belongs to (branch-scoped visibility). */
    fleetBranchId: z.uuid().nullable().default(null),
  })
  .strict();
export type CreateServiceRequest = z.input<typeof createServiceRequestSchema>;

export const createAttachmentSchema = z
  .object({
    contentType: z.enum(PROFILE_IMAGE_TYPES),
    size: z
      .number()
      .int()
      .min(1)
      .max(8 * 1024 * 1024),
  })
  .strict();

export const submitQuoteSchema = z
  .object({
    price: indicativePriceSchema,
    message: boundedText(2000).nullable().default(null),
    /** When the provider could start. */
    availableFrom: z.iso.datetime().nullable().default(null),
    validDays: z.number().int().min(1).max(30).default(7),
  })
  .strict();

export const reasonSchema = z
  .object({ reason: boundedText(500).min(3, "Give a short reason") })
  .strict();

export const evidenceSchema = z
  .object({
    note: boundedText(2000).nullable().default(null),
    photoIds: z.array(z.uuid()).max(MAX_REQUEST_PHOTOS).default([]),
  })
  .strict()
  .refine((e) => e.note !== null || e.photoIds.length > 0, "Add a note or a photo");

export const REQUEST_STATUSES = ["open", "accepted", "completed", "cancelled", "expired"] as const;
export const RECIPIENT_STATUSES = [
  "pending",
  "viewed",
  "quoted",
  "declined",
  "accepted",
  "not_selected",
  "cancelled",
] as const;
export const QUOTE_STATUSES = [
  "active",
  "superseded",
  "withdrawn",
  "accepted",
  "not_selected",
  "expired",
] as const;

export const quoteSchema = z.object({
  id: z.uuid(),
  recipientId: z.uuid(),
  providerOrganizationId: z.uuid(),
  price: z.intersection(
    indicativePriceSchema,
    z.object({ indicative: z.literal(true), label: z.string() }),
  ),
  message: z.string().nullable(),
  availableFrom: z.iso.datetime().nullable(),
  validUntil: z.iso.datetime(),
  status: z.enum(QUOTE_STATUSES),
  createdAt: z.iso.datetime(),
  disclaimer: z.literal(PAYMENT_DISCLAIMER),
  scamWarning: z.literal(QUOTE_SCAM_WARNING),
});
export type QuoteDto = z.infer<typeof quoteSchema>;

export const recipientSchema = z.object({
  id: z.uuid(),
  providerOrganizationId: z.uuid(),
  providerName: z.string(),
  providerSlug: z.string().nullable(),
  status: z.enum(RECIPIENT_STATUSES),
  quotes: z.array(quoteSchema),
});

export const requestEventSchema = z.object({
  id: z.uuid(),
  type: z.string(),
  actorSide: z.enum(["requester", "provider", "system"]),
  providerOrganizationId: z.uuid().nullable(),
  note: z.string().nullable(),
  attachmentIds: z.array(z.uuid()),
  createdAt: z.iso.datetime(),
});

export const attachmentSchema = z.object({
  id: z.uuid(),
  contentType: z.string().nullable(),
  /** Authenticated download path. */
  path: z.string(),
  uploadedBySide: z.enum(["requester", "provider"]),
});

const requestCore = {
  id: z.uuid(),
  category: providerCategorySchema,
  vehicle: z.object({
    vehicleType: vehicleTypeSchema,
    make: z.string().nullable(),
    model: z.string().nullable(),
    year: z.number().nullable(),
    registration: z.string().nullable(),
  }),
  description: z.string(),
  urgency: z.enum(REQUEST_URGENCIES),
  neededBy: z.iso.datetime().nullable(),
  status: z.enum(REQUEST_STATUSES),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  attachments: z.array(attachmentSchema),
  events: z.array(requestEventSchema),
};

/** The requester's view: every recipient and quote. */
export const serviceRequestSchema = z.object({
  ...requestCore,
  requester: z.object({
    kind: z.enum(["user", "organization"]),
    organizationId: z.uuid().nullable(),
    createdBy: z.uuid(),
    fleetBranchId: z.uuid().nullable(),
  }),
  location: z.object({ lng: z.number(), lat: z.number() }),
  locationNote: z.string().nullable(),
  recipients: z.array(recipientSchema),
  acceptedQuoteId: z.uuid().nullable(),
  /** Set once a quote is accepted: what was agreed, for information only. */
  agreement: z
    .object({
      quoteId: z.uuid(),
      providerOrganizationId: z.uuid(),
      priceLabel: z.string(),
      informational: z.literal(true),
      disclaimer: z.literal(PAYMENT_DISCLAIMER),
    })
    .nullable(),
});
export type ServiceRequestDto = z.infer<typeof serviceRequestSchema>;

/** A provider's view of a request sent to it (an inquiry). */
export const inquirySchema = z.object({
  ...requestCore,
  recipientId: z.uuid(),
  recipientStatus: z.enum(RECIPIENT_STATUSES),
  branchId: z.uuid().nullable(),
  /** Rounded to ~1 km until this provider's quote is accepted; exact afterwards. */
  location: z.object({ lng: z.number(), lat: z.number(), approximate: z.boolean() }),
  locationNote: z.string().nullable(),
  distanceKm: z.number().nullable(),
  quotes: z.array(quoteSchema),
});
export type InquiryDto = z.infer<typeof inquirySchema>;

export const requestErrorReasonSchema = z.enum([
  "no_matching_providers",
  "provider_not_matching",
  "invalid_transition",
  "quote_not_active",
  "too_many_quotes",
  "attachment_not_ready",
  "unknown_currency",
  "too_many_decimals",
  "unknown_branch",
  "not_a_fleet",
  "not_a_provider",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
]);
export type RequestErrorReason = z.infer<typeof requestErrorReasonSchema>;

export const declineSchema = z
  .object({ reason: boundedText(500).nullable().default(null) })
  .strict();

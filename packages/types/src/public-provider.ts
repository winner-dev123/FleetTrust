import { z } from "zod";

import { INDICATIVE_PRICE_DISCLAIMER, publicOfferingSchema } from "./catalog.js";
import { hoursExceptionSchema, openingStatusSchema } from "./opening-hours.js";
import { providerCategorySchema, vehicleTypeSchema } from "./providers.js";
import { BADGE_TYPES } from "./verification.js";

export const publicBranchSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  /** Street lines are omitted for visitors who aren't signed in (OQ-11). */
  addressLine1: z.string().nullable(),
  addressLine2: z.string().nullable(),
  locality: z.string().nullable(),
  region: z.string().nullable(),
  postalCode: z.string().nullable(),
  countryCode: z.string().nullable(),
  /** Rounded to about 1 km for visitors who aren't signed in. */
  location: z.object({ lng: z.number(), lat: z.number(), approximate: z.boolean() }),
  serviceRadiusKm: z.number().nullable(),
  phone: z.string().nullable(),
  /** Opening hours are live (not frozen at publication) so closures show at once. */
  timeZone: z.string(),
  hours: z.object({
    weekly: z
      .record(z.string(), z.array(z.object({ opens: z.string(), closes: z.string() })))
      .nullable(),
    /** The next 60 days. */
    exceptions: z.array(hoursExceptionSchema),
    status: openingStatusSchema,
  }),
});

export const publicMediaSchema = z.object({
  id: z.uuid(),
  kind: z.enum(["logo", "cover", "gallery"]),
  url: z.string(),
  altText: z.string().nullable(),
});

/** What the public sees. `contact` is null for visitors who aren't signed in (OQ-11). */
export const publicProviderProfileSchema = z.object({
  organizationId: z.uuid(),
  slug: z.string(),
  tradingName: z.string(),
  legalName: z.string(),
  description: z.string().nullable(),
  categories: z.array(providerCategorySchema),
  categoryDetails: z.record(z.string(), z.record(z.string(), z.unknown())),
  vehicleTypes: z.array(vehicleTypeSchema),
  contact: z
    .object({
      phone: z.string().nullable(),
      email: z.string().nullable(),
      website: z.string().nullable(),
    })
    .nullable(),
  branches: z.array(publicBranchSchema),
  /** Indicative prices only: no checkout (FR-07). */
  catalog: z.object({
    disclaimer: z.literal(INDICATIVE_PRICE_DISCLAIMER),
    offerings: z.array(publicOfferingSchema),
  }),
  media: z.array(publicMediaSchema),
  /** Live verification labels; "unverified" until a badge is granted (SRS §8.1). */
  verification: z.array(
    z.object({
      badgeType: z.enum(BADGE_TYPES),
      status: z.enum(["verified", "unverified"]),
      expiresAt: z.iso.datetime().nullable(),
    }),
  ),
  publishedAt: z.iso.datetime(),
});
export type PublicProviderProfile = z.infer<typeof publicProviderProfileSchema>;

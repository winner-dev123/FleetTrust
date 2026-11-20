import { z } from "zod";

/** Provider categories (SRS F-033). Each has its own required profile fields. */
export const PROVIDER_CATEGORIES = [
  "workshop",
  "fuel_station",
  "towing",
  "tyres",
  "parts",
  "parking",
  "mobile_mechanic",
] as const;
export const providerCategorySchema = z.enum(PROVIDER_CATEGORIES);
export type ProviderCategory = z.infer<typeof providerCategorySchema>;

export const VEHICLE_TYPES = [
  "car",
  "van",
  "light_truck",
  "heavy_truck",
  "trailer",
  "bus",
  "motorcycle",
  "agricultural",
] as const;
export const vehicleTypeSchema = z.enum(VEHICLE_TYPES);

const nonEmpty = <T extends readonly [string, ...string[]]>(values: T) =>
  z.array(z.enum(values)).min(1, "Choose at least one").max(values.length);

/**
 * Category-dependent fields. Drafts may hold any subset (`.partial()`); publishing requires
 * the full object for every chosen category.
 */
export const CATEGORY_DETAIL_SCHEMAS = {
  workshop: z
    .object({
      specialities: nonEmpty([
        "engine",
        "electrical",
        "brakes",
        "suspension",
        "bodywork",
        "diagnostics",
        "air_conditioning",
        "transmission",
        "inspections",
      ]),
      bays: z.number().int().min(1).max(200),
    })
    .strict(),
  fuel_station: z
    .object({
      fuelTypes: nonEmpty([
        "diesel",
        "petrol",
        "adblue",
        "lpg",
        "cng",
        "lng",
        "hvo",
        "ev_charging",
      ]),
      heavyVehicleAccess: z.boolean(),
    })
    .strict(),
  towing: z
    .object({
      maxTowWeightKg: z.number().int().min(500).max(60_000),
      recoveryTypes: nonEmpty([
        "light",
        "medium",
        "heavy",
        "motorcycle",
        "flatbed",
        "underlift",
        "winch",
      ]),
      operates24h: z.boolean(),
    })
    .strict(),
  tyres: z
    .object({
      tyreSegments: nonEmpty(["car", "van", "truck", "agricultural", "motorcycle"]),
      mobileFitting: z.boolean(),
    })
    .strict(),
  parts: z
    .object({
      partsSegments: nonEmpty(["car", "van", "truck", "trailer", "bus", "agricultural"]),
      delivery: z.boolean(),
    })
    .strict(),
  parking: z
    .object({
      truckSpaces: z.number().int().min(1).max(2000),
      security: z.array(z.enum(["cctv", "fenced", "guarded", "lighting", "gated"])).max(5),
      overnight: z.boolean(),
    })
    .strict(),
  mobile_mechanic: z
    .object({
      services: nonEmpty(["roadside_repair", "diagnostics", "battery", "tyres", "servicing"]),
    })
    .strict(),
} as const satisfies Record<ProviderCategory, z.ZodObject>;

/** Categories that serve customers away from the premises: branches need a service radius. */
export const RADIUS_CATEGORIES: readonly ProviderCategory[] = ["mobile_mechanic", "towing"];

/**
 * Draft version of a category schema: every field optional, and multi-choice lists may be
 * empty (the wizard saves as boxes are ticked and unticked). Publishing uses the full schema.
 */
function draftOf(schema: z.ZodObject): z.ZodOptional<z.ZodObject> {
  const shape = Object.fromEntries(
    Object.entries(schema.shape).map(([key, field]: [string, z.ZodType]) => [
      key,
      (field instanceof z.ZodArray
        ? z.array(field.element as z.ZodType).max(20)
        : field
      ).optional(),
    ]),
  );
  return z.object(shape).strict().optional();
}

const categoryDetailsDraftSchema = z
  .object({
    workshop: draftOf(CATEGORY_DETAIL_SCHEMAS.workshop),
    fuel_station: draftOf(CATEGORY_DETAIL_SCHEMAS.fuel_station),
    towing: draftOf(CATEGORY_DETAIL_SCHEMAS.towing),
    tyres: draftOf(CATEGORY_DETAIL_SCHEMAS.tyres),
    parts: draftOf(CATEGORY_DETAIL_SCHEMAS.parts),
    parking: draftOf(CATEGORY_DETAIL_SCHEMAS.parking),
    mobile_mechanic: draftOf(CATEGORY_DETAIL_SCHEMAS.mobile_mechanic),
  })
  .strict();

/** Trimmed text without control characters (newlines and tabs allowed). */
export const boundedText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .refine(
      (value) => !/\p{Cc}/u.test(value.replace(/[\n\r\t]/g, "")),
      "Contains invalid characters",
    );

export const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/;

/** Wizard save (PATCH): any subset, shape-checked only. Completeness is checked at publish. */
export const updateProviderProfileRequestSchema = z
  .object({
    slug: z
      .string()
      .trim()
      .toLowerCase()
      .regex(SLUG_PATTERN, "3–60 characters: a–z, 0–9 and hyphens"),
    legalName: boundedText(200).nullable(),
    tradingName: boundedText(120).nullable(),
    description: boundedText(2000).nullable(),
    categories: z.array(providerCategorySchema).max(PROVIDER_CATEGORIES.length),
    vehicleTypes: z.array(vehicleTypeSchema).max(VEHICLE_TYPES.length),
    categoryDetails: categoryDetailsDraftSchema,
    contactPhone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9 ]{6,18}$/, "International format, e.g. +27 21 555 0100")
      .nullable(),
    contactEmail: z.email().trim().toLowerCase().max(254).nullable(),
    website: z
      .url({ protocol: /^https$/ })
      .max(300)
      .nullable(),
  })
  .partial()
  .strict();
export type UpdateProviderProfileRequest = z.input<typeof updateProviderProfileRequestSchema>;

export const branchLocationRequestSchema = z
  .object({
    addressLine1: boundedText(200).nullable(),
    addressLine2: boundedText(200).nullable(),
    locality: boundedText(100).nullable(),
    region: boundedText(100).nullable(),
    postalCode: boundedText(20).nullable(),
    countryCode: z
      .string()
      .regex(/^[A-Z]{2}$/, "ISO 3166-1 alpha-2, e.g. ZA")
      .nullable(),
    location: z
      .object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
      .strict()
      .nullable(),
    serviceRadiusKm: z.number().int().min(1).max(500).nullable(),
    phone: z
      .string()
      .trim()
      .regex(/^\+[1-9][0-9 ]{6,18}$/)
      .nullable(),
  })
  .partial()
  .strict();

export const WIZARD_STEPS = [
  "basics",
  "categories",
  "vehicles",
  "contact",
  "branches",
  "catalog",
  "hours",
  "media",
] as const;

export const wizardStepSchema = z.object({
  id: z.enum(WIZARD_STEPS),
  complete: z.boolean(),
  /** Human-readable problems to fix before publishing. */
  issues: z.array(z.object({ path: z.string(), message: z.string() })),
});

export const providerProfileSchema = z.object({
  organizationId: z.uuid(),
  status: z.enum(["draft", "published", "hidden"]),
  slug: z.string().nullable(),
  legalName: z.string().nullable(),
  tradingName: z.string().nullable(),
  description: z.string().nullable(),
  categories: z.array(providerCategorySchema),
  vehicleTypes: z.array(vehicleTypeSchema),
  categoryDetails: z.record(z.string(), z.record(z.string(), z.unknown())),
  contactPhone: z.string().nullable(),
  contactEmail: z.string().nullable(),
  website: z.string().nullable(),
  steps: z.array(wizardStepSchema),
  canPublish: z.boolean(),
  /** The draft differs from what's published. */
  hasUnpublishedChanges: z.boolean(),
  publishedAt: z.iso.datetime().nullable(),
  updatedAt: z.iso.datetime(),
});
export type ProviderProfileDto = z.infer<typeof providerProfileSchema>;

export const PROFILE_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export const MAX_PROFILE_IMAGE_BYTES = 5 * 1024 * 1024;
export const MAX_GALLERY_IMAGES = 12;

export const addMediaRequestSchema = z
  .object({
    kind: z.enum(["logo", "cover", "gallery"]),
    contentType: z.enum(PROFILE_IMAGE_TYPES),
    size: z.number().int().min(1).max(MAX_PROFILE_IMAGE_BYTES),
    altText: boundedText(200).nullable().default(null),
  })
  .strict();

export const providerErrorReasonSchema = z.enum([
  "not_a_provider",
  "slug_taken",
  "profile_incomplete",
  "too_many_images",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
]);
export type ProviderErrorReason = z.infer<typeof providerErrorReasonSchema>;

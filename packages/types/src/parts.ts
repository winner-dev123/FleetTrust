import { z } from "zod";

import { formatIndicativePrice, type IndicativePrice, indicativePriceSchema } from "./catalog.js";
import { boundedText, vehicleTypeSchema } from "./providers.js";

/**
 * Parts listings and availability inquiries (SRS F-140, F-141, ADR-0028). FleetTrust shows what
 * a provider says it has and lets people ask; it never sells, reserves or takes payment for a
 * part (no checkout, SRS §8). Stock is a claim with a timestamp: listings say how long ago the
 * provider last confirmed it, and stale stock is labelled as such.
 */

export const PART_CATEGORIES = [
  "engine",
  "brakes",
  "suspension_steering",
  "electrical",
  "filters",
  "tyres_wheels",
  "body",
  "transmission",
  "cooling",
  "exhaust",
  "lighting",
  "fluids",
  "accessories",
  "other",
] as const;
export const partCategorySchema = z.enum(PART_CATEGORIES);
export type PartCategory = z.infer<typeof partCategorySchema>;

export const PART_CONDITIONS = ["new", "used", "refurbished"] as const;
export const STOCK_STATUSES = ["in_stock", "low_stock", "out_of_stock", "on_order"] as const;
export type StockStatus = (typeof STOCK_STATUSES)[number];

/** Stock confirmed within this many days is "fresh". */
export const STOCK_FRESH_DAYS = 3;
/** After this many days without confirmation stock is "stale" and labelled so everywhere. */
export const STOCK_STALE_DAYS = 14;
/** Listings unconfirmed for this long leave public search until the provider confirms again. */
export const STOCK_HIDDEN_DAYS = 90;

export const MAX_PARTS = 2000;
export const MAX_COMPATIBILITY_ENTRIES = 50;
/** Unanswered availability inquiries close after this many days. */
export const PART_INQUIRY_OPEN_DAYS = 14;

/** Shown with every part and inquiry. */
export const PARTS_DISCLAIMER =
  "Prices and stock are indicative, as reported by the provider. FleetTrust doesn't sell or reserve parts or take payment: confirm with the provider and pay them directly.";

export const STOCK_FRESHNESS = ["fresh", "aging", "stale", "expired"] as const;
export type StockFreshness = (typeof STOCK_FRESHNESS)[number];

const DAY_MS = 86_400_000;

/** How old the last stock confirmation is. */
export function stockFreshness(confirmedAt: Date, now: Date): StockFreshness {
  const age = now.getTime() - confirmedAt.getTime();
  if (age <= STOCK_FRESH_DAYS * DAY_MS) return "fresh";
  if (age <= STOCK_STALE_DAYS * DAY_MS) return "aging";
  if (age <= STOCK_HIDDEN_DAYS * DAY_MS) return "stale";
  return "expired";
}

const STATUS_TEXT: Record<StockStatus, string> = {
  in_stock: "In stock",
  low_stock: "Low stock",
  out_of_stock: "Out of stock",
  on_order: "On order",
};

function ago(days: number): string {
  if (days < 1) return "today";
  if (days < 2) return "yesterday";
  return `${Math.floor(days)} days ago`;
}

/**
 * The text every client shows next to stock. Stale and expired stock never reads as a plain
 * "In stock": it says when it was last confirmed and that it may have changed.
 */
export function stockLabel(status: StockStatus, confirmedAt: Date, now: Date): string {
  const days = Math.max(0, (now.getTime() - confirmedAt.getTime()) / DAY_MS);
  const freshness = stockFreshness(confirmedAt, now);
  if (freshness === "stale" || freshness === "expired") {
    return `Stock not confirmed for ${String(Math.floor(days))} days (last reported: ${STATUS_TEXT[status].toLowerCase()}). It may have changed: ask the provider.`;
  }
  return `${STATUS_TEXT[status]} · confirmed ${ago(days)}`;
}

// --- Provider listings ------------------------------------------------------------------------

/** One compatible vehicle range. A model needs a make; years are inclusive. */
export const compatibilityEntrySchema = z
  .object({
    vehicleType: vehicleTypeSchema,
    make: boundedText(60).min(1).nullable().default(null),
    model: boundedText(60).min(1).nullable().default(null),
    yearFrom: z.number().int().min(1900).max(2100).nullable().default(null),
    yearTo: z.number().int().min(1900).max(2100).nullable().default(null),
  })
  .strict()
  .refine((v) => v.model === null || v.make !== null, {
    path: ["model"],
    message: "A model needs a make",
  })
  .refine((v) => v.yearFrom === null || v.yearTo === null || v.yearFrom <= v.yearTo, {
    path: ["yearTo"],
    message: "yearTo must not be before yearFrom",
  });
export type CompatibilityEntry = z.output<typeof compatibilityEntrySchema>;

const partNumberSchema = z
  .string()
  .trim()
  .min(2)
  .max(40)
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ./-]*$/, "Letters, digits, spaces, dots, slashes and hyphens");

/** `"0 986-494.104"` → `"0986494104"`: what part number searches compare. */
export function normalizePartNumber(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export const stockRequestSchema = z
  .object({
    status: z.enum(STOCK_STATUSES),
    /** Optional count on hand; only meaningful for in_stock and low_stock. */
    quantity: z.number().int().min(0).max(100_000).nullable().default(null),
  })
  .strict()
  .refine((v) => v.quantity === null || v.status === "in_stock" || v.status === "low_stock", {
    path: ["quantity"],
    message: "Only in_stock and low_stock carry a quantity",
  });

/** Create or replace a listing. Stock is set on create, then through the stock endpoint. */
export const partRequestSchema = z
  .object({
    name: boundedText(120).min(2),
    brand: boundedText(60).min(1).nullable().default(null),
    partNumber: partNumberSchema.nullable().default(null),
    category: partCategorySchema,
    condition: z.enum(PART_CONDITIONS),
    description: boundedText(1000).nullable().default(null),
    /** Where the stock is. Null = held for the whole organization. */
    branchId: z.uuid().nullable().default(null),
    price: indicativePriceSchema,
    /** Empty = no compatibility data ("check with the provider"). */
    compatibility: z.array(compatibilityEntrySchema).max(MAX_COMPATIBILITY_ENTRIES).default([]),
    status: z.enum(["active", "archived"]).default("active"),
  })
  .strict();
export type PartRequest = z.input<typeof partRequestSchema>;

export const createPartRequestSchema = partRequestSchema.extend({ stock: stockRequestSchema });
export type CreatePartRequest = z.input<typeof createPartRequestSchema>;

export const partListQuerySchema = z
  .object({
    status: z.enum(["active", "archived"]).optional(),
    branchId: z.uuid().optional(),
    /** Only listings whose stock is stale or expired: the "needs a check" list. */
    stale: z
      .enum(["true", "false"])
      .transform((v) => v === "true")
      .optional(),
    q: z.string().trim().max(100).optional(),
  })
  .strict();

const priceDtoSchema = z.intersection(
  indicativePriceSchema,
  z.object({ indicative: z.literal(true), label: z.string() }),
);

export const stockSchema = z.object({
  status: z.enum(STOCK_STATUSES),
  quantity: z.number().int().nullable(),
  confirmedAt: z.iso.datetime(),
  freshness: z.enum(STOCK_FRESHNESS),
  /** Ready-to-show text; stale stock says so. */
  label: z.string(),
});
export type StockDto = z.infer<typeof stockSchema>;

export const partSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  brand: z.string().nullable(),
  partNumber: z.string().nullable(),
  category: partCategorySchema,
  condition: z.enum(PART_CONDITIONS),
  description: z.string().nullable(),
  branchId: z.uuid().nullable(),
  price: priceDtoSchema,
  compatibility: z.array(
    z.object({
      vehicleType: vehicleTypeSchema,
      make: z.string().nullable(),
      model: z.string().nullable(),
      yearFrom: z.number().int().nullable(),
      yearTo: z.number().int().nullable(),
    }),
  ),
  stock: stockSchema,
  status: z.enum(["active", "archived"]),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
  disclaimer: z.literal(PARTS_DISCLAIMER),
});
export type PartDto = z.infer<typeof partSchema>;

// --- Public search ----------------------------------------------------------------------------

const flag = z.enum(["true", "false"]).transform((v) => v === "true");

export const partSearchQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100).optional(),
    partNumber: partNumberSchema.optional(),
    category: partCategorySchema.optional(),
    condition: z.enum(PART_CONDITIONS).optional(),
    /** Compatibility filter: a vehicle type, optionally narrowed by make, model and year. */
    vehicleType: vehicleTypeSchema.optional(),
    make: z.string().trim().min(1).max(60).optional(),
    model: z.string().trim().min(1).max(60).optional(),
    year: z.coerce.number().int().min(1900).max(2100).optional(),
    /** Signed-in only: use one of your vehicles (Prompt 19) as the compatibility filter. */
    vehicleId: z.uuid().optional(),
    /** A provider's listings only. */
    provider: z
      .string()
      .regex(/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i)
      .optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(1).max(300).default(50),
    /** in_stock or low_stock, confirmed within STOCK_STALE_DAYS. */
    inStockOnly: flag.optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
    offset: z.coerce.number().int().min(0).max(500).default(0),
  })
  .strict()
  .superRefine((v, ctx) => {
    if ((v.lat === undefined) !== (v.lng === undefined)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "Send both lat and lng" });
    }
    if ((v.make !== undefined || v.model !== undefined || v.year !== undefined) && !v.vehicleType) {
      ctx.addIssue({ code: "custom", path: ["vehicleType"], message: "Needs vehicleType" });
    }
    if (v.model !== undefined && v.make === undefined) {
      ctx.addIssue({ code: "custom", path: ["model"], message: "A model needs a make" });
    }
    if (v.vehicleId !== undefined && v.vehicleType !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["vehicleId"],
        message: "Send either vehicleId or vehicleType",
      });
    }
  });

export const publicPartSchema = partSchema
  .omit({ status: true, createdAt: true, updatedAt: true, branchId: true })
  .extend({
    provider: z.object({ organizationId: z.uuid(), slug: z.string(), name: z.string() }),
    branch: z
      .object({ id: z.uuid(), name: z.string(), locality: z.string().nullable() })
      .nullable(),
    /** Distance to the stock's branch (or the provider's nearest branch), when searching near a point. */
    distanceKm: z.number().nullable(),
    /** With a compatibility filter: true when a listed range matches the vehicle. */
    fits: z.boolean().nullable(),
  });
export type PublicPart = z.infer<typeof publicPartSchema>;

export const partSearchResultSchema = z.object({
  items: z.array(publicPartSchema),
  /** Echo of the vehicle used for the compatibility filter. */
  vehicle: z
    .object({
      vehicleType: vehicleTypeSchema,
      make: z.string().nullable(),
      model: z.string().nullable(),
      year: z.number().int().nullable(),
    })
    .nullable(),
  nextOffset: z.number().int().nullable(),
  disclaimer: z.literal(PARTS_DISCLAIMER),
});
export type PartSearchResult = z.infer<typeof partSearchResultSchema>;

// --- Availability inquiries -------------------------------------------------------------------

export const PART_AVAILABILITY = ["available", "not_available", "can_order"] as const;
export type PartAvailability = (typeof PART_AVAILABILITY)[number];
export const PART_INQUIRY_STATUSES = ["open", "answered", "closed", "expired"] as const;

export const createPartInquirySchema = z
  .object({
    partId: z.uuid(),
    quantity: z.number().int().min(1).max(999).default(1),
    message: boundedText(1000).nullable().default(null),
    /** The vehicle it's for: one of your vehicles, or typed in. Both optional. */
    vehicleId: z.uuid().nullable().default(null),
    vehicle: z
      .object({
        vehicleType: vehicleTypeSchema,
        make: boundedText(60).min(1).nullable().default(null),
        model: boundedText(60).min(1).nullable().default(null),
        year: z.number().int().min(1900).max(2100).nullable().default(null),
      })
      .strict()
      .nullable()
      .default(null),
  })
  .strict()
  .refine((v) => v.vehicleId === null || v.vehicle === null, {
    path: ["vehicle"],
    message: "Send either vehicleId or vehicle",
  });
export type CreatePartInquiry = z.input<typeof createPartInquirySchema>;

export const answerPartInquirySchema = z
  .object({
    availability: z.enum(PART_AVAILABILITY),
    quantityAvailable: z.number().int().min(1).max(100_000).nullable().default(null),
    /** can_order only: expected days until it arrives. */
    etaDays: z.number().int().min(1).max(90).nullable().default(null),
    message: boundedText(1000).nullable().default(null),
  })
  .strict()
  .refine((v) => v.etaDays === null || v.availability === "can_order", {
    path: ["etaDays"],
    message: "Only can_order carries etaDays",
  })
  .refine((v) => v.quantityAvailable === null || v.availability === "available", {
    path: ["quantityAvailable"],
    message: "Only available carries quantityAvailable",
  });
export type AnswerPartInquiry = z.input<typeof answerPartInquirySchema>;

export const partInquiryQuerySchema = z
  .object({ status: z.enum(PART_INQUIRY_STATUSES).optional() })
  .strict();

export const partInquirySchema = z.object({
  id: z.uuid(),
  /** Null when the listing was deleted; the name and number below are kept. */
  partId: z.uuid().nullable(),
  partName: z.string(),
  partNumber: z.string().nullable(),
  provider: z.object({ organizationId: z.uuid(), slug: z.string().nullable(), name: z.string() }),
  branchId: z.uuid().nullable(),
  requester: z.object({
    kind: z.enum(["user", "organization"]),
    /** Display name of the person, or the fleet's name. */
    name: z.string(),
    organizationId: z.uuid().nullable(),
  }),
  quantity: z.number().int(),
  message: z.string().nullable(),
  vehicle: z
    .object({
      vehicleType: vehicleTypeSchema,
      make: z.string().nullable(),
      model: z.string().nullable(),
      year: z.number().int().nullable(),
    })
    .nullable(),
  status: z.enum(PART_INQUIRY_STATUSES),
  answer: z
    .object({
      availability: z.enum(PART_AVAILABILITY),
      quantityAvailable: z.number().int().nullable(),
      etaDays: z.number().int().nullable(),
      message: z.string().nullable(),
      answeredAt: z.iso.datetime(),
    })
    .nullable(),
  expiresAt: z.iso.datetime(),
  createdAt: z.iso.datetime(),
  disclaimer: z.literal(PARTS_DISCLAIMER),
});
export type PartInquiryDto = z.infer<typeof partInquirySchema>;

export const partsErrorReasonSchema = z.enum([
  "not_a_provider",
  "not_a_fleet",
  "invalid_branch",
  "too_many_parts",
  "unknown_currency",
  "too_many_decimals",
  "part_unavailable",
  "own_part",
  "already_asked",
  "invalid_transition",
  "not_allowed",
]);
export type PartsErrorReason = z.infer<typeof partsErrorReasonSchema>;

/** The API price shape plus its display label (listings and search). */
export function priceDto(price: IndicativePrice) {
  return { ...price, indicative: true as const, label: formatIndicativePrice(price) };
}

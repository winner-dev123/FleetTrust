import { z } from "zod";

import {
  boundedText,
  PROVIDER_CATEGORIES,
  providerCategorySchema,
  VEHICLE_TYPES,
  vehicleTypeSchema,
} from "./providers.js";

/**
 * Service catalogs and indicative prices (SRS F-033, F-034, FR-07). Prices are guidance
 * published by the provider. They are never a binding offer, and the platform has no checkout
 * or payment flow (SRS §1 rule 2, ADR-0008).
 */
export const PRICE_TYPES = ["fixed", "from", "range", "quote_required"] as const;
export type PriceType = (typeof PRICE_TYPES)[number];

/** What a price is per. */
export const PRICE_UNITS = [
  "job",
  "hour",
  "day",
  "night",
  "km",
  "litre",
  "kwh",
  "item",
  "tyre",
  "vehicle",
] as const;
export type PriceUnit = (typeof PRICE_UNITS)[number];

/** Where the service happens. `at_customer` needs a branch service radius. */
export const SERVICE_LOCATIONS = ["at_premises", "at_customer"] as const;

export const MAX_OFFERINGS = 200;

/** Shown wherever prices appear (FR-07). */
export const INDICATIVE_PRICE_DISCLAIMER =
  "Prices are indicative and are not a binding offer. Confirm the final price with the provider. FleetTrust does not process payments.";

/** Decimal string, so amounts stay exact: `450`, `450.5`, `1299.99`. */
const amountSchema = z
  .string()
  .regex(/^(?:0|[1-9]\d{0,9})(?:\.\d{1,4})?$/, "An amount such as 450 or 450.50")
  .refine((value) => Number(value) > 0, "Must be more than zero");

const currencySchema = z.string().regex(/^[A-Z]{3}$/, "ISO 4217 code, e.g. ZAR");

export const indicativePriceSchema = z
  .discriminatedUnion("type", [
    z
      .object({
        type: z.literal("fixed"),
        currency: currencySchema,
        amount: amountSchema,
        unit: z.enum(PRICE_UNITS),
      })
      .strict(),
    z
      .object({
        type: z.literal("from"),
        currency: currencySchema,
        amount: amountSchema,
        unit: z.enum(PRICE_UNITS),
      })
      .strict(),
    z
      .object({
        type: z.literal("range"),
        currency: currencySchema,
        min: amountSchema,
        max: amountSchema,
        unit: z.enum(PRICE_UNITS),
      })
      .strict(),
    z.object({ type: z.literal("quote_required") }).strict(),
  ])
  .superRefine((price, ctx) => {
    if (price.type === "range" && !(Number(price.max) > Number(price.min))) {
      ctx.addIssue({ code: "custom", path: ["max"], message: "Must be more than the minimum" });
    }
  });
export type IndicativePrice = z.infer<typeof indicativePriceSchema>;

/** Create or replace (PUT) an offering. Empty `branchIds` = offered at every branch. */
export const offeringRequestSchema = z
  .object({
    category: providerCategorySchema,
    name: boundedText(120).min(2, "Name must be at least 2 characters"),
    description: boundedText(1000).nullable().default(null),
    vehicleTypes: z
      .array(vehicleTypeSchema)
      .min(1, "Choose at least one vehicle type")
      .max(VEHICLE_TYPES.length),
    serviceLocation: z.enum(SERVICE_LOCATIONS).default("at_premises"),
    branchIds: z.array(z.uuid()).max(100).default([]),
    price: indicativePriceSchema,
    sortOrder: z.number().int().min(0).max(999).default(0),
  })
  .strict();
export type OfferingRequest = z.input<typeof offeringRequestSchema>;

/** The provider's own (draft) view of an offering. */
export const offeringSchema = z.object({
  id: z.uuid(),
  category: z.enum(PROVIDER_CATEGORIES),
  name: z.string(),
  description: z.string().nullable(),
  vehicleTypes: z.array(vehicleTypeSchema),
  serviceLocation: z.enum(SERVICE_LOCATIONS),
  branchIds: z.array(z.uuid()),
  price: indicativePriceSchema,
  sortOrder: z.number(),
  updatedAt: z.iso.datetime(),
});
export type OfferingDto = z.infer<typeof offeringSchema>;

/** A published offering. `label` is the English display text; `indicative` is always true. */
export const publicOfferingSchema = offeringSchema
  .omit({ updatedAt: true, sortOrder: true })
  .extend({
    price: z.intersection(
      indicativePriceSchema,
      z.object({ indicative: z.literal(true), label: z.string() }),
    ),
  });
export type PublicOffering = z.infer<typeof publicOfferingSchema>;

const UNIT_LABELS: Record<PriceUnit, string> = {
  job: "per job",
  hour: "per hour",
  day: "per day",
  night: "per night",
  km: "per km",
  litre: "per litre",
  kwh: "per kWh",
  item: "each",
  tyre: "per tyre",
  vehicle: "per vehicle",
};

/**
 * Display text for an indicative price, e.g. "From ZAR 450.00 per hour" (locale `en` by default; clients pass theirs). The text always states
 * the price type; it never says "buy", "pay" or "checkout". Shared by web and mobile.
 */
export function formatIndicativePrice(price: IndicativePrice, locale = "en"): string {
  if (price.type === "quote_required") return "Price on request (quote required)";
  const money = (amount: string) =>
    new Intl.NumberFormat(locale, { style: "currency", currency: price.currency }).format(
      Number(amount),
    );
  const unit = UNIT_LABELS[price.unit];
  switch (price.type) {
    case "fixed":
      return `${money(price.amount)} ${unit}`;
    case "from":
      return `From ${money(price.amount)} ${unit}`;
    case "range":
      return `${money(price.min)}–${money(price.max)} ${unit}`;
  }
}

/** Fraction digits in a decimal amount string. */
export function fractionDigits(amount: string): number {
  const dot = amount.indexOf(".");
  return dot === -1 ? 0 : amount.length - dot - 1;
}

export const catalogErrorReasonSchema = z.enum([
  "unknown_currency",
  "too_many_decimals",
  "unknown_branch",
  "outside_branch_scope",
  "too_many_offerings",
  "date_out_of_range",
  /** An admin closed the category to new offerings (Prompt 26); existing ones stay. */
  "category_closed",
]);
export type CatalogErrorReason = z.infer<typeof catalogErrorReasonSchema>;

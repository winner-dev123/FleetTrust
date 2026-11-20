import { z } from "zod";

import { INDICATIVE_PRICE_DISCLAIMER } from "./catalog.js";
import { openingStatusSchema } from "./opening-hours.js";
import { PROVIDER_CATEGORIES, vehicleTypeSchema } from "./providers.js";
import { BADGE_SUBJECT, BADGE_TYPES } from "./verification.js";

/**
 * Provider search (SRS F-040..F-042, FR-06, ADR-0019). Ranking uses relevance only: text match,
 * distance, service-radius coverage and open now. Plans never affect it (ADR-0009).
 */
export const ORGANIZATION_BADGE_TYPES = BADGE_TYPES.filter(
  (b) => BADGE_SUBJECT[b] === "organization",
) as ("business" | "location")[];

export const MAX_SEARCH_RADIUS_KM = 200;
/** Largest map viewport, in degrees of latitude or longitude. */
export const MAX_VIEWPORT_DEGREES = 10;

const csv = <T extends readonly [string, ...string[]]>(values: T) =>
  z
    .string()
    .max(200)
    .transform((s) => [
      ...new Set(
        s
          .split(",")
          .map((v) => v.trim())
          .filter(Boolean),
      ),
    ])
    .pipe(z.array(z.enum(values)).min(1).max(values.length));

const flag = z.enum(["true", "false"]).transform((v) => v === "true");

const bboxSchema = z
  .string()
  .max(100)
  .transform((s) => s.split(",").map(Number))
  .pipe(
    z
      .tuple([
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
        z.number().min(-180).max(180),
        z.number().min(-90).max(90),
      ])
      .transform(([west, south, east, north]) => ({ west, south, east, north })),
  );

/** Query string of `GET /v1/search/providers`: either `lat`+`lng` (nearby) or `bbox` (map). */
export const searchProvidersQuerySchema = z
  .object({
    lat: z.coerce.number().min(-90).max(90).optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    radiusKm: z.coerce.number().min(0.5).max(MAX_SEARCH_RADIUS_KM).default(25),
    /** `west,south,east,north`; west > east crosses the antimeridian. */
    bbox: bboxSchema.optional(),
    /** Comma-separated; matches any. */
    category: csv(PROVIDER_CATEGORIES).optional(),
    vehicleType: vehicleTypeSchema.optional(),
    /** Comma-separated badge types the provider must currently hold (all of them). */
    verified: csv(
      ORGANIZATION_BADGE_TYPES as unknown as readonly ["business", "location"],
    ).optional(),
    openNow: flag.optional(),
    /** Only providers whose service radius reaches the searcher (they travel to you). */
    coversLocation: flag.optional(),
    q: z.string().trim().max(100).optional(),
    cursor: z.string().max(600).optional(),
    limit: z.coerce.number().int().min(1).max(50).default(20),
  })
  .strict()
  .superRefine((query, ctx) => {
    const hasPoint = query.lat !== undefined && query.lng !== undefined;
    if ((query.lat === undefined) !== (query.lng === undefined)) {
      ctx.addIssue({ code: "custom", path: ["lat"], message: "Send both lat and lng" });
    }
    if (hasPoint === (query.bbox !== undefined)) {
      ctx.addIssue({
        code: "custom",
        path: ["bbox"],
        message: "Search either near a point (lat, lng) or inside a map area (bbox)",
      });
    }
    if (query.coversLocation && !hasPoint) {
      ctx.addIssue({ code: "custom", path: ["coversLocation"], message: "Needs lat and lng" });
    }
    if (query.bbox) {
      const { west, south, east, north } = query.bbox;
      const width = west <= east ? east - west : 360 - (west - east);
      if (south > north) {
        ctx.addIssue({ code: "custom", path: ["bbox"], message: "South must be below north" });
      } else if (width > MAX_VIEWPORT_DEGREES || north - south > MAX_VIEWPORT_DEGREES) {
        ctx.addIssue({
          code: "custom",
          path: ["bbox"],
          message: "Zoom in: the map area is too large",
        });
      }
    }
  });
export type SearchProvidersQuery = z.input<typeof searchProvidersQuerySchema>;

export const providerSearchResultSchema = z.object({
  branchId: z.uuid(),
  organizationId: z.uuid(),
  slug: z.string(),
  tradingName: z.string(),
  branchName: z.string(),
  locality: z.string().nullable(),
  countryCode: z.string().nullable(),
  categories: z.array(z.enum(PROVIDER_CATEGORIES)),
  vehicleTypes: z.array(vehicleTypeSchema),
  /** Visitors get the ~1 km rounded point (`approximate: true`). */
  location: z.object({ lng: z.number(), lat: z.number(), approximate: z.boolean() }),
  /** From the search point (or the map centre); from the rounded point for visitors. */
  distanceKm: z.number(),
  serviceRadiusKm: z.number().nullable(),
  /** The branch's service radius reaches the search point. */
  coversSearchLocation: z.boolean(),
  hours: openingStatusSchema,
  /** "unverified" is shown explicitly (SRS J1). */
  verification: z.array(
    z.object({ badgeType: z.enum(BADGE_TYPES), status: z.enum(["verified", "unverified"]) }),
  ),
  /** Up to three indicative prices, preferring the searched categories. */
  priceHighlights: z.array(z.object({ name: z.string(), label: z.string() })),
  logoUrl: z.string().nullable(),
});
export type ProviderSearchResult = z.infer<typeof providerSearchResultSchema>;

export const providerSearchPageSchema = z.object({
  results: z.array(providerSearchResultSchema),
  /** Pass back as `cursor` with the same query for the next page; null at the end. */
  nextCursor: z.string().nullable(),
  /** Ranked by relevance (text, distance, coverage, open now); never by plan or payment. */
  ranking: z.literal("relevance"),
  priceDisclaimer: z.literal(INDICATIVE_PRICE_DISCLAIMER),
});
export type ProviderSearchPage = z.infer<typeof providerSearchPageSchema>;

export const geocodeQuerySchema = z
  .object({
    q: z.string().trim().min(2).max(100),
    country: z
      .string()
      .regex(/^[A-Z]{2}$/)
      .optional(),
    limit: z.coerce.number().int().min(1).max(10).default(5),
  })
  .strict();

export const geocodeResultSchema = z.object({
  label: z.string(),
  location: z.object({ lng: z.number(), lat: z.number() }),
  countryCode: z.string().nullable(),
});
export type GeocodeResult = z.infer<typeof geocodeResultSchema>;

export const mapConfigSchema = z.object({
  provider: z.string(),
  /** XYZ tile template, or null when no tile source is configured (development). */
  tileUrl: z.string().nullable(),
  attribution: z.string().nullable(),
});
export type MapConfig = z.infer<typeof mapConfigSchema>;

export const searchErrorReasonSchema = z.enum(["invalid_cursor"]);

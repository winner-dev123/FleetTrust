import { z } from "zod";

import { INDICATIVE_PRICE_DISCLAIMER } from "./catalog.js";
import { PROVIDER_CATEGORIES, vehicleTypeSchema } from "./providers.js";
import { ORGANIZATION_BADGE_TYPES, providerSearchResultSchema } from "./search.js";

/**
 * Route-aware discovery (SRS J8, F-100, ADR-0020). FleetTrust never verifies or invents road or
 * truck restrictions: this disclaimer accompanies every route result (SRS §7).
 */
export const ROUTE_DISCLAIMER = "Road and truck restrictions aren't verified by FleetTrust.";

export const MAX_WAYPOINTS = 5;
export const MAX_CORRIDOR_KM = 25;
/** Radius of each point search when routing is unavailable. */
export const WAYPOINT_FALLBACK_RADIUS_KM = 25;

const lngLat = z
  .object({ lng: z.number().min(-180).max(180), lat: z.number().min(-90).max(90) })
  .strict();

/** `POST /v1/search/route` (signed in). Coordinates go in the body, never the URL. */
export const routeSearchRequestSchema = z
  .object({
    origin: lngLat,
    destination: lngLat,
    waypoints: z.array(lngLat).max(MAX_WAYPOINTS).default([]),
    /** Passed to the routing vendor. It never makes FleetTrust claim a route suits trucks. */
    profile: z.enum(["car", "truck"]).default("car"),
    corridorKm: z.number().min(0.5).max(MAX_CORRIDOR_KM).default(5),
    category: z
      .array(z.enum(PROVIDER_CATEGORIES))
      .min(1)
      .max(PROVIDER_CATEGORIES.length)
      .optional(),
    vehicleType: vehicleTypeSchema.optional(),
    verified: z
      .array(z.enum(ORGANIZATION_BADGE_TYPES as unknown as readonly ["business", "location"]))
      .min(1)
      .optional(),
    openNow: z.boolean().optional(),
    q: z.string().trim().max(100).optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine((r) => r.origin.lng !== r.destination.lng || r.origin.lat !== r.destination.lat, {
    path: ["destination"],
    message: "Origin and destination are the same",
  });
export type RouteSearchRequest = z.input<typeof routeSearchRequestSchema>;

export const routeDegradedReasonSchema = z.enum(["not_configured", "timeout", "error", "no_route"]);

export const routeSchema = z.object({
  distanceKm: z.number(),
  durationMinutes: z.number().nullable(),
  /** The routing source, e.g. a vendor name or `straight-line` (development). */
  source: z.string(),
  /** True when the geometry is synthetic (straight line), not a road route. */
  approximate: z.boolean(),
  /** Only what the vendor reported. FleetTrust never asserts truck suitability. */
  truckProfileApplied: z.boolean(),
  /** Vendor restriction or warning texts, verbatim. Empty when the vendor sent none. */
  vendorNotices: z.array(z.string()),
  geometry: z.array(z.object({ lng: z.number(), lat: z.number() })),
});

export const routeSearchResultSchema = providerSearchResultSchema.extend({
  /** Corridor mode: position along the route, 0 (start) to 1 (end). */
  routeFraction: z.number().nullable(),
  /** Waypoint mode: index of the stop (origin 0, waypoints…, destination last) it is near. */
  nearStop: z.number().int().nullable(),
});

export const routeSearchResponseSchema = z.object({
  /** `corridor` when a route was found; `waypoints` when it degraded to point searches. */
  mode: z.enum(["corridor", "waypoints"]),
  route: routeSchema.nullable(),
  degradedReason: routeDegradedReasonSchema.nullable(),
  disclaimer: z.literal(ROUTE_DISCLAIMER),
  results: z.array(routeSearchResultSchema),
  /** More providers matched than `limit`. */
  truncated: z.boolean(),
  priceDisclaimer: z.literal(INDICATIVE_PRICE_DISCLAIMER),
});
export type RouteSearchResponse = z.infer<typeof routeSearchResponseSchema>;

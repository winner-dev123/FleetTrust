import { createHash } from "node:crypto";

import { type Database, type ProviderSearchRow, searchProviders } from "@fleettrust/db";
import {
  INDICATIVE_PRICE_DISCLAIMER,
  ROUTE_DISCLAIMER,
  type routeSearchRequestSchema,
  type RouteSearchResponse,
  WAYPOINT_FALLBACK_RADIUS_KM,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { CACHE, type KeyValueCache } from "../../platform/rate-limit/index.js";
import {
  type LngLat,
  type Route,
  type RoutingFailure,
  ROUTING_PROVIDER,
  type RoutingProvider,
  RoutingUnavailableError,
} from "../../platform/routing/index.js";
import { SearchService } from "./search.service.js";

type RouteSearch = z.output<typeof routeSearchRequestSchema>;

/** Points are rounded to 0.01° (about 1 km) before routing and caching (SRS AB-04). */
const round = (p: LngLat): LngLat => ({
  lng: Math.round(p.lng * 100) / 100,
  lat: Math.round(p.lat * 100) / 100,
});

/**
 * Route-aware discovery (SRS J8, ADR-0020): providers within a corridor along a vendor route,
 * in driving order. When routing is unavailable it degrades to point searches around the
 * origin, waypoints and destination. FleetTrust never states or invents truck restrictions;
 * every response carries the disclaimer, and vendor notices are passed through verbatim.
 */
@Injectable()
export class RouteSearchService {
  private readonly logger = new Logger(RouteSearchService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CACHE) private readonly cache: KeyValueCache,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly search: SearchService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** The route for these (rounded) points, from cache or the vendor, or the failure reason. */
  private async resolveRoute(
    points: LngLat[],
    profile: RouteSearch["profile"],
  ): Promise<Route | RoutingFailure> {
    const env = this.env;
    // Keyed by a hash of rounded coordinates only: no user ID, nothing reversible in the key.
    const key = `route:${this.routing.name}:${createHash("sha256")
      .update(JSON.stringify({ profile, points }))
      .digest("base64url")}`;
    const cached = await this.cache.get(key);
    if (cached) {
      try {
        return JSON.parse(cached) as Route;
      } catch {
        // Corrupt entry: recompute.
      }
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, env.ROUTING_TIMEOUT_MS);
    try {
      const route = await Promise.race([
        this.routing.route({ points, profile }, controller.signal),
        new Promise<never>((_, reject) => {
          controller.signal.addEventListener("abort", () => {
            reject(new RoutingUnavailableError("timeout"));
          });
        }),
      ]);
      if (route.geometry.length < 2) return "no_route";
      await this.cache.set(key, JSON.stringify(route), env.ROUTING_CACHE_TTL_SECONDS);
      return route;
    } catch (error) {
      if (error instanceof RoutingUnavailableError) return error.reason;
      // Never log coordinates; the error message is the vendor's.
      this.logger.warn(`Routing failed (${this.routing.name}): ${(error as Error).message}`);
      return "error";
    } finally {
      clearTimeout(timer);
    }
  }

  async searchRoute(request: RouteSearch): Promise<RouteSearchResponse> {
    const at = this.clock.now();
    const stops = [request.origin, ...request.waypoints, request.destination].map(round);
    const filters = {
      at,
      precise: true,
      ...(request.category ? { categories: request.category } : {}),
      ...(request.vehicleType ? { vehicleType: request.vehicleType } : {}),
      ...(request.verified ? { verification: request.verified } : {}),
      ...(request.openNow ? { openNow: true } : {}),
      ...(request.q ? { text: request.q } : {}),
    };
    const route = await this.resolveRoute(stops, request.profile);

    if (typeof route !== "string") {
      const rows = await searchProviders(this.db, {
        ...filters,
        area: { kind: "corridor", line: route.geometry, widthMeters: request.corridorKm * 1000 },
        limit: request.limit + 1,
      });
      const page = rows.slice(0, request.limit);
      const cards = await this.search.enrich(page, at, true, request.category);
      return {
        mode: "corridor",
        route: {
          distanceKm: Math.round(route.distanceMeters / 100) / 10,
          durationMinutes:
            route.durationSeconds === null ? null : Math.round(route.durationSeconds / 60),
          source: route.source,
          approximate: route.approximate,
          truckProfileApplied: route.truckProfileApplied,
          vendorNotices: route.vendorNotices,
          geometry: route.geometry,
        },
        degradedReason: null,
        disclaimer: ROUTE_DISCLAIMER,
        results: cards.map((card, i) => ({
          ...card,
          routeFraction: page[i]?.routeFraction ?? null,
          nearStop: null,
        })),
        truncated: rows.length > request.limit,
        priceDisclaimer: INDICATIVE_PRICE_DISCLAIMER,
      };
    }

    // Degraded: point search around each stop, merged in stop order without duplicates.
    const seen = new Set<string>();
    const merged: { row: ProviderSearchRow; stop: number }[] = [];
    let truncated = false;
    for (const [stop, point] of stops.entries()) {
      const rows = await searchProviders(this.db, {
        ...filters,
        area: {
          kind: "near",
          point,
          radiusMeters: WAYPOINT_FALLBACK_RADIUS_KM * 1000,
          coversLocationOnly: false,
        },
        limit: request.limit + 1,
      });
      for (const row of rows) {
        if (seen.has(row.branchId)) continue;
        seen.add(row.branchId);
        if (merged.length >= request.limit) {
          truncated = true;
          break;
        }
        merged.push({ row, stop });
      }
    }
    const cards = await this.search.enrich(
      merged.map((m) => m.row),
      at,
      true,
      request.category,
    );
    return {
      mode: "waypoints",
      route: null,
      degradedReason: route,
      disclaimer: ROUTE_DISCLAIMER,
      results: cards.map((card, i) => ({
        ...card,
        routeFraction: null,
        nearStop: merged[i]?.stop ?? null,
      })),
      truncated,
      priceDisclaimer: INDICATIVE_PRICE_DISCLAIMER,
    };
  }
}

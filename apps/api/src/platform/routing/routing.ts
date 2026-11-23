import { type DynamicModule, Module } from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";

export interface LngLat {
  lng: number;
  lat: number;
}

export type RouteProfile = "car" | "truck";

export interface RouteRequest {
  /** Origin, waypoints…, destination (at least two points). */
  points: LngLat[];
  profile: RouteProfile;
}

/**
 * A route from the routing vendor (OQ-13). FleetTrust never invents restriction data: notices
 * are passed through verbatim from the vendor, and `truckProfileApplied` only reports what the
 * vendor said it did. Suitability is never asserted (SRS §7: restrictions aren't verified).
 */
export interface Route {
  geometry: LngLat[];
  distanceMeters: number;
  /** Null when the source can't estimate travel time. */
  durationSeconds: number | null;
  source: string;
  /** True for synthetic geometry (straight line), not a road route. */
  approximate: boolean;
  /** The vendor reported routing with a truck profile. Never set by FleetTrust itself. */
  truckProfileApplied: boolean;
  /** Restriction or warning texts exactly as the vendor returned them. */
  vendorNotices: string[];
}

export type RoutingFailure = "not_configured" | "timeout" | "error" | "no_route";

export class RoutingUnavailableError extends Error {
  constructor(readonly reason: RoutingFailure) {
    super(`Routing unavailable: ${reason}`);
    this.name = "RoutingUnavailableError";
  }
}

/** Routing vendor port. Implementations must honour `signal` (the caller enforces a timeout). */
export interface RoutingProvider {
  readonly name: string;
  route(request: RouteRequest, signal: AbortSignal): Promise<Route>;
}

export const ROUTING_PROVIDER = Symbol("ROUTING_PROVIDER");

/** No vendor configured: every request degrades to point search around the waypoints. */
export class NoRoutingProvider implements RoutingProvider {
  readonly name = "none";

  route(): Promise<Route> {
    return Promise.reject(new RoutingUnavailableError("not_configured"));
  }
}

const EARTH_RADIUS_M = 6_371_008.8;
const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

export function haversineMeters(a: LngLat, b: LngLat): number {
  const h =
    Math.sin(toRad(b.lat - a.lat) / 2) ** 2 +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Point a fraction `f` of the way along the great circle from a to b. */
function interpolate(a: LngLat, b: LngLat, f: number): LngLat {
  const d = haversineMeters(a, b) / EARTH_RADIUS_M;
  if (d === 0) return a;
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const [lat1, lng1, lat2, lng2] = [toRad(a.lat), toRad(a.lng), toRad(b.lat), toRad(b.lng)];
  const x = A * Math.cos(lat1) * Math.cos(lng1) + B * Math.cos(lat2) * Math.cos(lng2);
  const y = A * Math.cos(lat1) * Math.sin(lng1) + B * Math.cos(lat2) * Math.sin(lng2);
  const z = A * Math.sin(lat1) + B * Math.sin(lat2);
  return { lat: toDeg(Math.atan2(z, Math.hypot(x, y))), lng: toDeg(Math.atan2(y, x)) };
}

/**
 * Development only: great-circle segments between the points, marked `approximate`. It is not
 * a road route and knows nothing about roads or trucks. Refused in production.
 */
export class StraightLineRoutingProvider implements RoutingProvider {
  readonly name = "straight-line";

  route(request: RouteRequest): Promise<Route> {
    const geometry: LngLat[] = [];
    let distance = 0;
    for (let i = 1; i < request.points.length; i++) {
      const a = request.points[i - 1];
      const b = request.points[i];
      if (!a || !b) continue;
      const leg = haversineMeters(a, b);
      distance += leg;
      const steps = Math.max(1, Math.ceil(leg / 10_000));
      for (let s = i === 1 ? 0 : 1; s <= steps; s++) geometry.push(interpolate(a, b, s / steps));
    }
    return Promise.resolve({
      geometry,
      distanceMeters: Math.round(distance),
      durationSeconds: null,
      source: this.name,
      approximate: true,
      truckProfileApplied: false,
      vendorNotices: [],
    });
  }
}

@Module({})
export class RoutingModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: RoutingModule,
      global: true,
      providers: [
        {
          provide: ROUTING_PROVIDER,
          useValue:
            env.ROUTING_PROVIDER === "straight-line"
              ? new StraightLineRoutingProvider()
              : new NoRoutingProvider(),
        },
      ],
      exports: [ROUTING_PROVIDER],
    };
  }
}

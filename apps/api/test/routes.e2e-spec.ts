import { ROUTE_DISCLAIMER, type RouteSearchResponse } from "@fleettrust/types";
import request from "supertest";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Route,
  type RouteRequest,
  type RoutingProvider,
  RoutingUnavailableError,
  StraightLineRoutingProvider,
} from "../src/platform/routing/index.js";
import { makePerson, publishProvider } from "./support/providers.js";
import { createTestApp, type TestApp } from "./support/test-app.js";

type Mode = "straight" | "unconfigured" | "fail" | "slow" | "empty" | "vendor-notices";

/** A routing vendor double whose behaviour each test chooses. */
class FakeVendor implements RoutingProvider {
  readonly name = "fake-vendor";
  mode: Mode = "straight";
  calls: RouteRequest[] = [];

  async route(req: RouteRequest, signal: AbortSignal): Promise<Route> {
    this.calls.push(req);
    const straight = await new StraightLineRoutingProvider().route(req);
    switch (this.mode) {
      case "straight":
        return straight;
      case "unconfigured":
        throw new RoutingUnavailableError("not_configured");
      case "fail":
        throw new Error("vendor returned 503");
      case "empty":
        return { ...straight, geometry: [] };
      case "slow":
        return new Promise((resolve) => {
          const timer = setTimeout(() => {
            resolve(straight);
          }, 5_000);
          signal.addEventListener("abort", () => {
            clearTimeout(timer);
          });
        });
      case "vendor-notices":
        return {
          ...straight,
          source: "fake-vendor",
          approximate: false,
          durationSeconds: 5_400,
          truckProfileApplied: true,
          vendorNotices: ["Vendor notice: low bridge reported near km 42"],
        };
    }
  }
}

const vendor = new FakeVendor();

let t: TestApp;

beforeAll(async () => {
  t = await createTestApp({
    routing: vendor,
    env: { ROUTING_TIMEOUT_MS: "300", ROUTING_CACHE_TTL_SECONDS: "600" },
  });
});

afterAll(async () => {
  await t.close();
});

const driver = () => makePerson(t, "route-driver");
const route = (body: object) => driver().post("/v1/search/route", body);

/** Route due east from (lng0, lat) for about 100 km, with providers along it. */
async function corridorFixture(prefix: string, lng0: number, lat: number) {
  const owner = makePerson(t, `${prefix}-owner`);
  // Created out of order to prove results come back in driving order.
  await publishProvider(owner, {
    slug: `${prefix}-km-70`,
    at: { lng: lng0 + 0.7, lat: lat + 0.01 },
  });
  await publishProvider(makePerson(t, `${prefix}-o2`), {
    slug: `${prefix}-km-20`,
    at: { lng: lng0 + 0.2, lat },
  });
  await publishProvider(makePerson(t, `${prefix}-o3`), {
    slug: `${prefix}-far-off`,
    at: { lng: lng0 + 0.5, lat: lat + 0.3 },
  });
  return {
    origin: { lng: lng0, lat },
    destination: { lng: lng0 + 1, lat },
  };
}

describe("route corridor search", () => {
  it("lists providers along the route in driving order, with the restrictions disclaimer", async () => {
    vendor.mode = "straight";
    const trip = await corridorFixture("rc", 22.0, -30.0);
    const res = (await route({ ...trip, corridorKm: 5 }).expect(200)).body as RouteSearchResponse;
    expect(res.mode).toBe("corridor");
    expect(res.degradedReason).toBeNull();
    expect(res.disclaimer).toBe(ROUTE_DISCLAIMER);
    expect(res.results.map((r) => r.slug)).toEqual(["rc-km-20", "rc-km-70"]);
    expect(res.results[0]?.routeFraction).toBeCloseTo(0.2, 1);
    expect(res.results[1]?.routeFraction).toBeCloseTo(0.7, 1);
    expect(res.route).toMatchObject({ source: "straight-line", approximate: true });
    expect(res.route?.distanceKm).toBeGreaterThan(95);
    expect(res.route?.distanceKm).toBeLessThan(100);
    // Signed in: exact locations.
    expect(res.results[0]?.location.approximate).toBe(false);
  });

  it("never fabricates truck restrictions: a truck profile changes nothing FleetTrust asserts", async () => {
    vendor.mode = "straight";
    const trip = { origin: { lng: 22.0, lat: -30.0 }, destination: { lng: 23.0, lat: -30.0 } };
    const car = (await route({ ...trip, profile: "car" }).expect(200)).body as RouteSearchResponse;
    const truck = (await route({ ...trip, profile: "truck" }).expect(200))
      .body as RouteSearchResponse;
    for (const res of [car, truck]) {
      expect(res.route).toMatchObject({ truckProfileApplied: false, vendorNotices: [] });
      expect(res.disclaimer).toBe(ROUTE_DISCLAIMER);
    }
    // No restriction-like fields or claims anywhere in the payload.
    expect(JSON.stringify(truck)).not.toMatch(
      /maxHeight|maxWeight|hazmat|suitable|clearance|restricted":/i,
    );
    expect(Object.keys(truck.route ?? {}).sort()).toEqual(
      [
        "approximate",
        "distanceKm",
        "durationMinutes",
        "geometry",
        "source",
        "truckProfileApplied",
        "vendorNotices",
      ].sort(),
    );
  });

  it("passes vendor restriction notices through verbatim, still with the disclaimer", async () => {
    vendor.mode = "vendor-notices";
    const res = (
      await route({
        origin: { lng: 25.0, lat: -26.0 },
        destination: { lng: 25.5, lat: -26.0 },
        profile: "truck",
      }).expect(200)
    ).body as RouteSearchResponse;
    expect(res.route).toMatchObject({
      source: "fake-vendor",
      approximate: false,
      durationMinutes: 90,
      truckProfileApplied: true,
      vendorNotices: ["Vendor notice: low bridge reported near km 42"],
    });
    expect(res.disclaimer).toBe(ROUTE_DISCLAIMER);
  });

  it("caches routes by rounded coordinates, without a user in the key", async () => {
    vendor.mode = "straight";
    vendor.calls = [];
    const trip = { origin: { lng: 26.1234, lat: -27.0 }, destination: { lng: 26.9, lat: -27.0 } };
    await route(trip).expect(200);
    // Same trip within ~1 km, by another user: served from the cache.
    await makePerson(t, "route-other")
      .post("/v1/search/route", { ...trip, origin: { lng: 26.1249, lat: -27.0001 } })
      .expect(200);
    expect(vendor.calls).toHaveLength(1);
    // The vendor only ever sees rounded points.
    expect(vendor.calls[0]?.points[0]).toEqual({ lng: 26.12, lat: -27 });
    // A different profile is a different route.
    await route({ ...trip, profile: "truck" }).expect(200);
    expect(vendor.calls).toHaveLength(2);
  });
});

describe("graceful degradation", () => {
  it.each<[Mode, string]>([
    ["unconfigured", "not_configured"],
    ["fail", "error"],
    ["slow", "timeout"],
    ["empty", "no_route"],
  ])("vendor %s → point search around the stops (%s)", async (mode, reason) => {
    vendor.mode = mode;
    const lat = -31.0 - ["unconfigured", "fail", "slow", "empty"].indexOf(mode);
    const owner = makePerson(t, `deg-${mode}`);
    await publishProvider(owner, { slug: `deg-${mode}-start`, at: { lng: 20.01, lat } });
    await publishProvider(makePerson(t, `deg-${mode}-2`), {
      slug: `deg-${mode}-stop`,
      at: { lng: 20.5, lat: lat + 0.5 },
    });
    await publishProvider(makePerson(t, `deg-${mode}-3`), {
      slug: `deg-${mode}-end`,
      at: { lng: 21.0, lat },
    });
    await publishProvider(makePerson(t, `deg-${mode}-4`), {
      slug: `deg-${mode}-between`,
      at: { lng: 20.5, lat },
    });

    const started = Date.now();
    const res = (
      await route({
        origin: { lng: 20.0, lat },
        waypoints: [{ lng: 20.5, lat: lat + 0.5 }],
        destination: { lng: 21.0, lat },
      }).expect(200)
    ).body as RouteSearchResponse;
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(res).toMatchObject({
      mode: "waypoints",
      route: null,
      degradedReason: reason,
      disclaimer: ROUTE_DISCLAIMER,
    });
    // Grouped by stop (origin 0, waypoint 1, destination 2); the midpoint isn't near any stop.
    expect(res.results.map((r) => [r.slug, r.nearStop])).toEqual([
      [`deg-${mode}-start`, 0],
      [`deg-${mode}-stop`, 1],
      [`deg-${mode}-end`, 2],
    ]);
  });
});

describe("access and validation", () => {
  it("requires sign-in and validates the request", async () => {
    vendor.mode = "straight";
    const trip = { origin: { lng: 22, lat: -30 }, destination: { lng: 23, lat: -30 } };
    await request(t.server).post("/v1/search/route").send(trip).expect(401);
    for (const bad of [
      { ...trip, destination: trip.origin },
      { ...trip, corridorKm: 30 },
      { ...trip, waypoints: Array.from({ length: 6 }, () => trip.origin) },
      { ...trip, profile: "hazmat" },
      { ...trip, origin: { lng: 200, lat: 0 } },
      { ...trip, sponsored: true },
      { origin: trip.origin },
    ]) {
      await route(bad).expect(400);
    }
  });
});

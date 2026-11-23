import { describe, expect, it } from "vitest";

import {
  haversineMeters,
  NoRoutingProvider,
  RoutingUnavailableError,
  StraightLineRoutingProvider,
} from "./routing.js";

describe("routing adapters", () => {
  it("none: always unavailable (route search degrades)", async () => {
    await expect(new NoRoutingProvider().route()).rejects.toEqual(
      new RoutingUnavailableError("not_configured"),
    );
  });

  it("straight-line: densified great circle through the waypoints, marked approximate, no restriction data", async () => {
    const a = { lng: 18.42, lat: -33.92 };
    const b = { lng: 19.0, lat: -33.5 };
    const c = { lng: 20.0, lat: -33.0 };
    const points = [a, b, c];
    const route = await new StraightLineRoutingProvider().route({ points, profile: "truck" });
    expect(route.geometry[0]).toEqual(a);
    expect(route.geometry.at(-1)?.lng).toBeCloseTo(20.0, 6);
    expect(route.geometry.at(-1)?.lat).toBeCloseTo(-33.0, 6);
    // Every vertex is at most ~10 km from the next.
    for (let i = 1; i < route.geometry.length; i++) {
      const a = route.geometry[i - 1];
      const b = route.geometry[i];
      if (a && b) expect(haversineMeters(a, b)).toBeLessThanOrEqual(10_001);
    }
    const expected = haversineMeters(a, b) + haversineMeters(b, c);
    expect(route.distanceMeters).toBe(Math.round(expected));
    expect(route).toMatchObject({
      approximate: true,
      durationSeconds: null,
      truckProfileApplied: false,
      vendorNotices: [],
      source: "straight-line",
    });
  });
});

import { describe, expect, it } from "vitest";

import { formatDistance, formatPriceRange, titleCase } from "./format.js";
import { notificationHref, notificationPath } from "./links.js";

describe("notificationPath", () => {
  it("leads to the record the notification is about", () => {
    expect(notificationPath({ incidentId: "i1", requestId: "r1" })).toBe("/app/emergency/i1");
    expect(notificationPath({ requestId: "r1" })).toBe("/app/requests/r1");
    expect(notificationPath({ conversationId: "c1" })).toBe("/app/messages/c1");
    expect(notificationPath({ jobId: "j1" })).toBe("/jobs/j1");
    expect(notificationPath({ appealId: "a1" })).toBe("/app/appeals");
  });

  it("works for push data, which carries no kind", () => {
    expect(notificationPath({ sanctionId: "s1" })).toBe("/app/appeals");
    expect(notificationPath({})).toBeNull();
  });

  it("encodes IDs so a payload can't change the path", () => {
    expect(notificationPath({ requestId: "../admin?x=1" })).toBe(
      "/app/requests/..%2Fadmin%3Fx%3D1",
    );
  });

  it("uses the kind for inbox rows without IDs", () => {
    expect(notificationHref({ kind: "power_user", data: {} })).toBe("/app/account");
  });
});

describe("format helpers", () => {
  it("formats distances, prices and labels", () => {
    expect(formatDistance(800)).toBe("800 m");
    expect(formatDistance(12_500)).toBe("12.5 km");
    expect(formatPriceRange("ZAR", "450.00", "900.00")).toBe("ZAR 450–900");
    expect(formatPriceRange(null, null, null)).toBe("Price on request");
    expect(titleCase("on_the_way")).toBe("On the way");
  });
});

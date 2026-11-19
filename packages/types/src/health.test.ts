import { describe, expect, it } from "vitest";

import { healthResponseSchema, uuidSchema } from "./index.js";

describe("healthResponseSchema", () => {
  it("accepts a valid health payload", () => {
    const payload = { status: "ok", service: "fleettrust-api", role: "api", version: "0.0.0" };
    expect(healthResponseSchema.parse(payload)).toEqual(payload);
  });

  it("rejects an unknown role", () => {
    const payload = { status: "ok", service: "fleettrust-api", role: "admin", version: "0.0.0" };
    expect(healthResponseSchema.safeParse(payload).success).toBe(false);
  });
});

describe("uuidSchema", () => {
  it("accepts RFC 9562 UUIDs and rejects other strings", () => {
    expect(uuidSchema.safeParse("0f8fad5b-d9cb-469f-a165-70867728950e").success).toBe(true);
    expect(uuidSchema.safeParse("not-a-uuid").success).toBe(false);
  });
});

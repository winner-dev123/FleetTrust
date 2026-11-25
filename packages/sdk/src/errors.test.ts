import { ApiError } from "./client.js";
import { describe, expect, it } from "vitest";

import { errorMessage } from "./errors.js";

describe("errorMessage", () => {
  it("explains common reasons in plain language", () => {
    expect(
      errorMessage(new ApiError("x", "http_error", 429, { reason: "quota_exceeded" })),
    ).toMatch(/limit/);
    expect(errorMessage(new ApiError("x", "http_error", 429, { retryAfterSeconds: 30 }))).toMatch(
      /30 seconds/,
    );
    expect(errorMessage(new ApiError("x", "network_error"))).toMatch(/connection/);
    expect(errorMessage(new ApiError("x", "http_error", 404))).toMatch(/find that/);
  });

  it("never shows raw error text", () => {
    expect(errorMessage(new Error("SELECT * FROM users failed"))).toBe(
      "Something went wrong. Please try again.",
    );
  });
});

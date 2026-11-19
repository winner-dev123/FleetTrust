import { EnvValidationError } from "@fleettrust/env";
import { describe, expect, it } from "vitest";

import { loadWebEnv } from "./env";

describe("loadWebEnv", () => {
  it("defaults the API URL for local development", () => {
    expect(loadWebEnv({})).toEqual({ appEnv: "local", apiUrl: "http://localhost:8080" });
  });

  it("requires an explicit API URL in deployed environments", () => {
    expect(() => loadWebEnv({ NEXT_PUBLIC_APP_ENV: "production" })).toThrow(EnvValidationError);
    expect(() => loadWebEnv({ NEXT_PUBLIC_APP_ENV: "staging" })).toThrow(/NEXT_PUBLIC_API_URL/);
  });

  it("accepts a deployed configuration", () => {
    expect(
      loadWebEnv({
        NEXT_PUBLIC_APP_ENV: "staging",
        NEXT_PUBLIC_API_URL: "https://api.staging.example.test",
      }),
    ).toEqual({ appEnv: "staging", apiUrl: "https://api.staging.example.test" });
  });

  it("rejects a malformed API URL", () => {
    expect(() => loadWebEnv({ NEXT_PUBLIC_API_URL: "localhost:8080" })).toThrow(EnvValidationError);
  });
});

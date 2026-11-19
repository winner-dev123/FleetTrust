import { EnvValidationError } from "@fleettrust/config/env";
import { describe, expect, it } from "@jest/globals";

import { loadMobileEnv } from "./env";

describe("loadMobileEnv", () => {
  it("defaults the API URL for local development", () => {
    expect(loadMobileEnv({})).toEqual({ appEnv: "local", apiUrl: "http://localhost:8080" });
  });

  it("requires an explicit API URL in deployed environments", () => {
    expect(() => loadMobileEnv({ EXPO_PUBLIC_APP_ENV: "production" })).toThrow(EnvValidationError);
  });

  it("rejects a URL without an http(s) scheme", () => {
    expect(() => loadMobileEnv({ EXPO_PUBLIC_API_URL: "localhost:8080" })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });
});

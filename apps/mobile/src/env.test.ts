import { EnvValidationError } from "@fleettrust/env";
import { describe, expect, it } from "@jest/globals";

import { loadMobileEnv } from "./env";

describe("loadMobileEnv", () => {
  it("defaults the API and web URLs for local development", () => {
    expect(loadMobileEnv({})).toEqual({
      appEnv: "local",
      apiUrl: "http://localhost:8080",
      webUrl: "http://localhost:3000",
      linkDomain: null,
      authEmulatorHost: null,
    });
  });

  it("requires explicit URLs in deployed environments", () => {
    expect(() => loadMobileEnv({ EXPO_PUBLIC_APP_ENV: "production" })).toThrow(EnvValidationError);
    expect(() =>
      loadMobileEnv({
        EXPO_PUBLIC_APP_ENV: "production",
        EXPO_PUBLIC_API_URL: "https://api.example.com",
      }),
    ).toThrow(/EXPO_PUBLIC_WEB_URL/);
  });

  it("rejects a URL without an http(s) scheme", () => {
    expect(() => loadMobileEnv({ EXPO_PUBLIC_API_URL: "localhost:8080" })).toThrow(
      /EXPO_PUBLIC_API_URL/,
    );
  });

  it("never lets a deployed build talk to the Auth emulator", () => {
    expect(() =>
      loadMobileEnv({
        EXPO_PUBLIC_APP_ENV: "staging",
        EXPO_PUBLIC_API_URL: "https://api.example.com",
        EXPO_PUBLIC_WEB_URL: "https://app.example.com",
        EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "10.0.2.2:9099",
      }),
    ).toThrow(/EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST/);
  });
});

import { EnvValidationError } from "@fleettrust/env";
import { describe, expect, it } from "vitest";

import { loadWebEnv } from "./env";

const staging = {
  NEXT_PUBLIC_APP_ENV: "staging",
  NEXT_PUBLIC_API_URL: "https://api.staging.example.test",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fleettrust-staging",
  NEXT_PUBLIC_FIREBASE_API_KEY: "AIza-public-web-key",
};

describe("loadWebEnv", () => {
  it("defaults to the local API and the demo Firebase project", () => {
    expect(loadWebEnv({})).toEqual({
      appEnv: "local",
      apiUrl: "http://localhost:8080",
      firebase: {
        projectId: "demo-fleettrust",
        apiKey: "demo-api-key",
        authDomain: "demo-fleettrust.firebaseapp.com",
        appId: undefined,
        authEmulatorHost: undefined,
      },
    });
  });

  it("accepts a deployed configuration", () => {
    expect(loadWebEnv(staging)).toMatchObject({
      appEnv: "staging",
      apiUrl: "https://api.staging.example.test",
      firebase: {
        projectId: "fleettrust-staging",
        authDomain: "fleettrust-staging.firebaseapp.com",
      },
    });
  });

  it("requires an explicit API URL and real Firebase settings in deployed environments", () => {
    expect(() => loadWebEnv({ NEXT_PUBLIC_APP_ENV: "production" })).toThrow(
      /NEXT_PUBLIC_API_URL[\s\S]*NEXT_PUBLIC_FIREBASE_PROJECT_ID[\s\S]*NEXT_PUBLIC_FIREBASE_API_KEY/,
    );
  });

  it("refuses the Auth emulator outside local development", () => {
    expect(() =>
      loadWebEnv({ ...staging, NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    ).toThrow(/NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST/);
    expect(
      loadWebEnv({ NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }).firebase
        .authEmulatorHost,
    ).toBe("127.0.0.1:9099");
  });

  it("rejects a malformed API URL", () => {
    expect(() => loadWebEnv({ NEXT_PUBLIC_API_URL: "localhost:8080" })).toThrow(EnvValidationError);
  });
});

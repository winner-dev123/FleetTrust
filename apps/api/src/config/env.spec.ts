import { EnvValidationError } from "@fleettrust/env";
import { describe, expect, it } from "vitest";

import { loadApiEnv } from "./env.js";

/** A complete, valid production configuration; tests override one field at a time. */
const production = {
  APP_ENV: "production",
  NODE_ENV: "production",
  APP_VERSION: "1.2.3",
  DATABASE_URL: "postgresql://app@10.0.0.5:5432/fleettrust",
  REDIS_URL: "rediss://10.0.0.6:6378",
  FIREBASE_PROJECT_ID: "fleettrust-prod",
  APP_CHECK_MODE: "enforce",
} as const;

describe("loadApiEnv", () => {
  it("starts with safe local defaults and no configuration", () => {
    expect(loadApiEnv({})).toEqual({
      NODE_ENV: "development",
      APP_ENV: "local",
      APP_ROLE: "api",
      APP_VERSION: "0.0.0-dev",
      PORT: 8080,
      LOG_LEVEL: "info",
      CORS_ORIGINS: [],
      DB_POOL_MAX: 5,
      FIREBASE_PROJECT_ID: "demo-fleettrust",
      APP_CHECK_MODE: "off",
      TRUST_PROXY_HOPS: 0,
    });
  });

  it("accepts a postgres URL and rejects other schemes without echoing the value", () => {
    const url = "postgresql://fleettrust:pw@127.0.0.1:5432/fleettrust";
    expect(loadApiEnv({ DATABASE_URL: url }).DATABASE_URL).toBe(url);

    const leaky = "mysql://admin:sup3r-secret@db.example.test/app";
    expect(() => loadApiEnv({ DATABASE_URL: leaky })).toThrow(/DATABASE_URL/);
    try {
      loadApiEnv({ DATABASE_URL: leaky });
    } catch (error) {
      expect((error as Error).message).not.toContain("sup3r-secret");
    }
  });

  it("parses the worker role and CORS origins", () => {
    const env = loadApiEnv({
      APP_ROLE: "worker",
      CORS_ORIGINS: "http://localhost:3000, https://staging.example.test",
    });
    expect(env.APP_ROLE).toBe("worker");
    expect(env.CORS_ORIGINS).toEqual(["http://localhost:3000", "https://staging.example.test"]);
  });

  it("rejects a CORS origin that is not a URL", () => {
    expect(() => loadApiEnv({ CORS_ORIGINS: "*" })).toThrow(EnvValidationError);
  });

  it("accepts a complete production configuration", () => {
    expect(loadApiEnv(production).APP_ENV).toBe("production");
  });

  it("requires a real version, NODE_ENV=production, a database and Redis when deployed", () => {
    expect(() => loadApiEnv({ APP_ENV: "staging" })).toThrow(
      /REDIS_URL[\s\S]*DATABASE_URL[\s\S]*APP_VERSION[\s\S]*NODE_ENV/,
    );
  });

  it("refuses the Auth emulator in deployed environments (it accepts forged tokens)", () => {
    expect(() =>
      loadApiEnv({ ...production, FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }),
    ).toThrow(/FIREBASE_AUTH_EMULATOR_HOST: must not be set/);
    expect(() =>
      loadApiEnv({
        ...production,
        APP_ENV: "staging",
        APP_CHECK_MODE: "monitor",
        FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
      }),
    ).toThrow(/FIREBASE_AUTH_EMULATOR_HOST/);
    expect(loadApiEnv({ FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" }).APP_ENV).toBe("local");
  });

  it("refuses demo Firebase projects when deployed and requires App Check enforcement in production", () => {
    expect(() => loadApiEnv({ ...production, FIREBASE_PROJECT_ID: "demo-fleettrust" })).toThrow(
      /FIREBASE_PROJECT_ID/,
    );
    expect(() => loadApiEnv({ ...production, APP_CHECK_MODE: "monitor" })).toThrow(
      /APP_CHECK_MODE: must be 'enforce' in production/,
    );
    expect(
      loadApiEnv({ ...production, APP_ENV: "staging", APP_CHECK_MODE: "monitor" }).APP_CHECK_MODE,
    ).toBe("monitor");
  });
});

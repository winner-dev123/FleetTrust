import { EnvValidationError } from "@fleettrust/config/env";
import { describe, expect, it } from "vitest";

import { loadApiEnv } from "./env.js";

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
    });
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

  it("requires a real version and NODE_ENV=production when deployed", () => {
    expect(() => loadApiEnv({ APP_ENV: "staging" })).toThrow(/APP_VERSION[\s\S]*NODE_ENV/);
    expect(
      loadApiEnv({ APP_ENV: "production", NODE_ENV: "production", APP_VERSION: "1.2.3" }).APP_ENV,
    ).toBe("production");
  });
});

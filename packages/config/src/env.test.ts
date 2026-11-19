import { describe, expect, it } from "vitest";
import { z } from "zod";

import { EnvValidationError, envFields, parseEnv } from "./env.js";

const schema = z.object({
  APP_ENV: envFields.appEnv(),
  PORT: envFields.port(8080),
  DEBUG: envFields.flag(false),
  ORIGINS: envFields.list(),
  API_URL: z.url(),
  SECRET_TOKEN: z.string().min(32),
});

const valid = {
  API_URL: "https://api.example.test",
  SECRET_TOKEN: "x".repeat(32),
};

describe("parseEnv", () => {
  it("applies defaults and coerces types", () => {
    const env = parseEnv(schema, { ...valid, PORT: "3000", DEBUG: "true", ORIGINS: "a, b,," });
    expect(env).toEqual({
      APP_ENV: "local",
      PORT: 3000,
      DEBUG: true,
      ORIGINS: ["a", "b"],
      API_URL: "https://api.example.test",
      SECRET_TOKEN: "x".repeat(32),
    });
  });

  it("treats empty strings as unset so defaults apply", () => {
    const env = parseEnv(schema, { ...valid, PORT: "", APP_ENV: "" });
    expect(env.PORT).toBe(8080);
    expect(env.APP_ENV).toBe("local");
  });

  it("reports every invalid variable by name", () => {
    expect(() => parseEnv(schema, { PORT: "99999", APP_ENV: "prod" }, "api")).toThrow(
      EnvValidationError,
    );
    try {
      parseEnv(schema, { PORT: "99999", APP_ENV: "prod" }, "api");
    } catch (error) {
      const issues = (error as EnvValidationError).issues.join("\n");
      expect(issues).toMatch(/^PORT:/m);
      expect(issues).toMatch(/^APP_ENV:/m);
      expect(issues).toMatch(/^API_URL:/m);
      expect(issues).toMatch(/^SECRET_TOKEN:/m);
      expect((error as Error).message).toContain("Invalid api environment");
    }
  });

  it("httpUrl accepts only absolute http(s) URLs", () => {
    const url = envFields.httpUrl();
    expect(url.safeParse("http://localhost:8080").success).toBe(true);
    expect(url.safeParse("https://api.example.test/v1").success).toBe(true);
    expect(url.safeParse("localhost:8080").success).toBe(false);
    expect(url.safeParse("ftp://files.example.test").success).toBe(false);
    expect(url.safeParse("javascript:alert(1)").success).toBe(false);
  });

  it("never echoes submitted values in the error message", () => {
    const leakedSecret = "super-secret-value-should-not-appear";
    const leakedEnum = "definitely-not-an-env-name";
    try {
      parseEnv(schema, { ...valid, SECRET_TOKEN: leakedSecret, APP_ENV: leakedEnum });
      expect.unreachable("parseEnv should have thrown");
    } catch (error) {
      expect((error as Error).message).not.toContain(leakedSecret);
      expect((error as Error).message).not.toContain(leakedEnum);
    }
  });
});

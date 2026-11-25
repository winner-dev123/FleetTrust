import { describe, expect, it } from "vitest";

import { loadWebEnv } from "../env";
import { contentSecurityPolicy, securityHeaders } from "./security-headers";

const local = loadWebEnv({ NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099" });
const production = loadWebEnv({
  NEXT_PUBLIC_APP_ENV: "production",
  NEXT_PUBLIC_API_URL: "https://api.fleettrust.example",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: "fleettrust-prod",
  NEXT_PUBLIC_FIREBASE_API_KEY: "key",
});

describe("website security headers", () => {
  it("only lets the page talk to the API and Firebase Auth, and never be framed", () => {
    const csp = contentSecurityPolicy(production, { development: false });
    expect(csp).toContain(
      "connect-src 'self' https://api.fleettrust.example https://identitytoolkit.googleapis.com https://securetoken.googleapis.com;",
    );
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-src https://fleettrust-prod.firebaseapp.com;");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).not.toContain("127.0.0.1");
  });

  it("allows the Auth emulator and dev tooling only locally", () => {
    const csp = contentSecurityPolicy(local, { development: true });
    expect(csp).toContain("http://127.0.0.1:9099");
    expect(csp).toContain("'unsafe-eval'");
    expect(csp).not.toContain("upgrade-insecure-requests");
  });

  it("adds HSTS only when deployed", () => {
    const keys = (env: typeof local) =>
      securityHeaders(env, { development: false }).map((h) => h.key);
    expect(keys(production)).toContain("Strict-Transport-Security");
    expect(keys(local)).not.toContain("Strict-Transport-Security");
    expect(keys(local)).toEqual(
      expect.arrayContaining(["X-Frame-Options", "X-Content-Type-Options", "Referrer-Policy"]),
    );
  });
});

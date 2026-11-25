import { describe, expect, it } from "vitest";

import { runChecks, type SmokeContext } from "../src/checks.ts";

const API_HEADERS = {
  "Content-Type": "application/json",
  "X-Content-Type-Options": "nosniff",
  "X-Frame-Options": "DENY",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
};

/** A fake environment that behaves like a healthy deployment unless told otherwise. */
function fakeEnvironment(overrides: Record<string, () => Response> = {}): typeof fetch {
  const routes: Record<string, () => Response> = {
    "GET /health": () =>
      new Response(JSON.stringify({ status: "ok", version: "abc123" }), { headers: API_HEADERS }),
    "GET /health/ready": () =>
      new Response(JSON.stringify({ status: "ready", checks: { database: "ok" } }), {
        headers: API_HEADERS,
      }),
    "GET /v1/config": () =>
      new Response(JSON.stringify({ siteNotice: null }), { headers: API_HEADERS }),
    "GET /v1/search/providers": () =>
      new Response(JSON.stringify({ results: [] }), { headers: API_HEADERS }),
    "GET /v1/me": () => new Response("{}", { status: 401, headers: API_HEADERS }),
    "GET /v1/no-such-route": () =>
      new Response(JSON.stringify({ statusCode: 404 }), { status: 404, headers: API_HEADERS }),
    ...overrides,
  };
  return (input, init) => {
    const url = new URL(
      typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
    );
    const route = routes[`${init?.method ?? "GET"} ${url.pathname}`];
    return Promise.resolve(route ? route() : new Response("not found", { status: 404 }));
  };
}

const ctx = (fetchImpl: typeof fetch, extra: Partial<SmokeContext> = {}): SmokeContext => ({
  apiUrl: "https://api.example.test",
  expectHttps: true,
  fetch: fetchImpl,
  ...extra,
});

describe("smoke checks", () => {
  it("pass against a healthy environment and skip what isn't configured", async () => {
    const results = await runChecks(ctx(fakeEnvironment(), { expectVersion: "abc123" }));
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
    expect(results.filter((r) => r.status === "skip").map((r) => r.name)).toEqual([
      "CORS allows the website and refuses other sites",
      "Realtime refuses unauthenticated sockets",
      "Signed-in call works (smoke-test account)",
      "Website pages load with a Content-Security-Policy",
    ]);
  });

  it("fail when the wrong release is serving, the database is down or headers are missing", async () => {
    const broken = fakeEnvironment({
      "GET /health": () =>
        new Response(JSON.stringify({ status: "ok", version: "old999" }), {
          headers: { "Content-Type": "application/json", "X-Powered-By": "Express" },
        }),
      "GET /health/ready": () =>
        new Response(JSON.stringify({ status: "not_ready", checks: { database: "unavailable" } }), {
          status: 503,
        }),
    });
    const failed = (await runChecks(ctx(broken, { expectVersion: "abc123" })))
      .filter((r) => r.status === "fail")
      .map((r) => `${r.name}: ${r.detail}`);
    expect(failed).toHaveLength(3);
    expect(failed[0]).toContain("version old999, expected abc123");
    expect(failed[1]).toContain("expected 200, got 503");
    expect(failed[2]).toMatch(/nosniff.*X-Frame-Options.*CSP.*X-Powered-By present.*HSTS/);
  });

  it("catch an open private endpoint, a leaked stack trace, loose CORS and an open socket", async () => {
    const leaky = fakeEnvironment({
      "GET /v1/me": () => new Response("{}", { status: 200, headers: API_HEADERS }),
      "GET /v1/no-such-route": () =>
        new Response("Error: boom\n    at handler (/app/dist/main.js:10:5)", { status: 404 }),
      "OPTIONS /v1/me": () =>
        new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*" } }),
    });
    const results = await runChecks(
      ctx(leaky, {
        allowedOrigin: "https://www.example.test",
        socketCloseCode: () => Promise.resolve("open"),
      }),
    );
    const failed = results.filter((r) => r.status === "fail").map((r) => r.name);
    expect(failed).toEqual([
      "Private endpoints refuse anonymous callers",
      "Errors don't leak internals",
      "CORS allows the website and refuses other sites",
      "Realtime refuses unauthenticated sockets",
    ]);
  });

  it("skip a check on request, by part of its name", async () => {
    const noHeaders = fakeEnvironment({
      "GET /health": () =>
        new Response(JSON.stringify({ status: "ok", version: "abc123" }), {
          headers: { "Content-Type": "application/json" },
        }),
    });
    const results = await runChecks(ctx(noHeaders, { skip: ["Security Headers"] }));
    expect(results.filter((r) => r.status === "fail")).toEqual([]);
    expect(results.find((r) => r.name === "API sends the security headers")).toMatchObject({
      status: "skip",
      detail: "skipped on request",
    });
  });
});

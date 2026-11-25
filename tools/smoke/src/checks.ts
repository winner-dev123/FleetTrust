/**
 * Smoke checks for one FleetTrust environment (Prompt 29). Each check throws with a short reason
 * when it fails. They only read, never write: safe against production.
 */

export interface SmokeContext {
  /** API base URL, e.g. https://api.staging.example.com */
  apiUrl: string;
  /** Website base URL; website checks are skipped when absent. */
  webUrl?: string;
  /** The release being checked: /health must report this version. */
  expectVersion?: string;
  /** A website origin the API must allow (CORS). */
  allowedOrigin?: string;
  /** Deployed environments must send HSTS; local runs over http don't. */
  expectHttps: boolean;
  /** Optional Firebase ID token of a smoke-test account: checks a signed-in call. */
  idToken?: string;
  fetch: typeof fetch;
  /** Opens a WebSocket, sends one frame, resolves with the close code (or "open" on timeout). */
  socketCloseCode?: (url: string, frame: string) => Promise<number | "open">;
}

export interface SmokeCheck {
  name: string;
  /** Skipped (not failed) when this returns false, e.g. no website URL. */
  applies?: (ctx: SmokeContext) => boolean;
  run: (ctx: SmokeContext) => Promise<void>;
}

export interface SmokeResult {
  name: string;
  status: "pass" | "fail" | "skip";
  detail: string;
  ms: number;
}

const fail = (message: string): never => {
  throw new Error(message);
};

async function json(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return fail(`expected JSON, got: ${text.slice(0, 80)}`);
  }
}

const expectStatus = (response: Response, status: number, what: string) => {
  if (response.status !== status)
    fail(`${what}: expected ${String(status)}, got ${String(response.status)}`);
};

const header = (response: Response, name: string) => response.headers.get(name) ?? "";

export const CHECKS: SmokeCheck[] = [
  {
    name: "API is alive and runs the expected release",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/health`);
      expectStatus(response, 200, "/health");
      const body = await json(response);
      if (body["status"] !== "ok") fail(`/health status ${String(body["status"])}`);
      if (ctx.expectVersion && body["version"] !== ctx.expectVersion)
        fail(`version ${String(body["version"])}, expected ${ctx.expectVersion}`);
    },
  },
  {
    name: "API is ready (database reachable)",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/health/ready`);
      const body = await json(response);
      expectStatus(response, 200, `/health/ready (${JSON.stringify(body)})`);
      if (body["status"] !== "ready") fail(`readiness ${String(body["status"])}`);
    },
  },
  {
    name: "API sends the security headers",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/health`);
      const missing: string[] = [];
      if (header(response, "x-content-type-options") !== "nosniff") missing.push("nosniff");
      if (header(response, "x-frame-options") !== "DENY") missing.push("X-Frame-Options");
      if (!header(response, "content-security-policy").includes("default-src 'none'"))
        missing.push("CSP");
      if (header(response, "x-powered-by") !== "") missing.push("X-Powered-By present");
      if (ctx.expectHttps && !header(response, "strict-transport-security").includes("max-age"))
        missing.push("HSTS");
      if (missing.length > 0) fail(missing.join(", "));
    },
  },
  {
    name: "Public configuration answers",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/v1/config`);
      expectStatus(response, 200, "/v1/config");
      const body = await json(response);
      if (!("siteNotice" in body)) fail("no siteNotice in /v1/config");
    },
  },
  {
    name: "Public provider search answers (PostGIS)",
    run: async (ctx) => {
      const response = await ctx.fetch(
        `${ctx.apiUrl}/v1/search/providers?lat=50.85&lng=4.35&radiusKm=25`,
      );
      expectStatus(response, 200, "search");
      const body = await json(response);
      if (!Array.isArray(body["results"])) fail("search returned no results array");
    },
  },
  {
    name: "Private endpoints refuse anonymous callers",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/v1/me`);
      expectStatus(response, 401, "/v1/me without a token");
    },
  },
  {
    name: "Errors don't leak internals",
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/v1/no-such-route`);
      expectStatus(response, 404, "unknown route");
      const text = await response.text();
      if (/at .+\(.+:\d+:\d+\)|node_modules|Error:/.test(text)) fail("stack trace in the body");
    },
  },
  {
    name: "CORS allows the website and refuses other sites",
    applies: (ctx) => ctx.allowedOrigin !== undefined,
    run: async (ctx) => {
      const preflight = (origin: string) =>
        ctx.fetch(`${ctx.apiUrl}/v1/me`, {
          method: "OPTIONS",
          headers: {
            Origin: origin,
            "Access-Control-Request-Method": "GET",
            "Access-Control-Request-Headers": "authorization",
          },
        });
      const allowed = await preflight(ctx.allowedOrigin ?? "");
      if (header(allowed, "access-control-allow-origin") !== ctx.allowedOrigin)
        fail(`allowed origin not echoed (got "${header(allowed, "access-control-allow-origin")}")`);
      const other = await preflight("https://evil.example");
      if (header(other, "access-control-allow-origin") !== "") fail("a foreign origin is allowed");
    },
  },
  {
    name: "Realtime refuses unauthenticated sockets",
    applies: (ctx) => ctx.socketCloseCode !== undefined,
    run: async (ctx) => {
      const url = `${ctx.apiUrl.replace(/^http/, "ws")}/v1/realtime`;
      const frame = JSON.stringify({
        type: "subscribe",
        conversationId: "00000000-0000-4000-8000-000000000000",
        after: 0,
      });
      const code = await (ctx.socketCloseCode ?? (() => Promise.resolve("open" as const)))(
        url,
        frame,
      );
      if (code !== 4401) fail(`expected close code 4401, got ${String(code)}`);
    },
  },
  {
    name: "Signed-in call works (smoke-test account)",
    applies: (ctx) => ctx.idToken !== undefined,
    run: async (ctx) => {
      const response = await ctx.fetch(`${ctx.apiUrl}/v1/me`, {
        headers: { Authorization: `Bearer ${ctx.idToken ?? ""}` },
      });
      expectStatus(response, 200, "/v1/me with the smoke-test token");
    },
  },
  {
    name: "Website pages load with a Content-Security-Policy",
    applies: (ctx) => ctx.webUrl !== undefined,
    run: async (ctx) => {
      for (const path of ["/", "/sign-in", "/emergency", "/legal/privacy", "/legal/terms"]) {
        const response = await ctx.fetch(`${ctx.webUrl ?? ""}${path}`);
        expectStatus(response, 200, path);
        const csp = header(response, "content-security-policy");
        if (!csp.includes("frame-ancestors")) fail(`${path}: no CSP with frame-ancestors`);
        if (ctx.expectHttps && !header(response, "strict-transport-security").includes("max-age"))
          fail(`${path}: no HSTS`);
        await response.arrayBuffer();
      }
    },
  },
];

/** Runs every check in order; never throws. */
export async function runChecks(
  ctx: SmokeContext,
  checks: SmokeCheck[] = CHECKS,
): Promise<SmokeResult[]> {
  const results: SmokeResult[] = [];
  for (const check of checks) {
    if (check.applies && !check.applies(ctx)) {
      results.push({ name: check.name, status: "skip", detail: "not configured", ms: 0 });
      continue;
    }
    const started = performance.now();
    try {
      await check.run(ctx);
      results.push({
        name: check.name,
        status: "pass",
        detail: "",
        ms: Math.round(performance.now() - started),
      });
    } catch (error) {
      results.push({
        name: check.name,
        status: "fail",
        detail: (error as Error).message,
        ms: Math.round(performance.now() - started),
      });
    }
  }
  return results;
}

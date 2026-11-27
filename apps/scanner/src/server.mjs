// HTTP front for clamd, so ClamAV can run on Cloud Run and scale to zero (ADR-0037 step 2).
// Cloud Run checks the caller's Google identity token before a request reaches this server
// (the service doesn't allow unauthenticated calls), so the server itself has no auth.
import { createServer } from "node:http";

import { instream, ping } from "./clamd.mjs";

const json = (res, status, body) => {
  res.writeHead(status, { "content-type": "application/json", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
};

/** Yields the request body, rejecting once it exceeds maxBytes. */
async function* limited(req, maxBytes) {
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      const error = new Error("file too large");
      error.status = 413;
      throw error;
    }
    yield chunk;
  }
}

/**
 * @param {{ clamdHost: string, clamdPort: number, maxBytes: number, readyTimeoutMs: number,
 *   scanTimeoutMs: number, log: (severity: string, message: string, extra?: object) => void }} options
 */
export function createScanServer(options) {
  const { clamdHost, clamdPort, maxBytes, readyTimeoutMs, scanTimeoutMs, log } = options;

  // clamd loads its signature database for 20–60 s after a cold start: wait instead of failing.
  async function waitForClamd() {
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (await ping(clamdHost, clamdPort)) return true;
      if (Date.now() >= deadline) return false;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
    }
  }

  return createServer(async (req, res) => {
    const path = new URL(req.url ?? "/", "http://scanner").pathname;
    try {
      if (req.method === "GET" && path === "/healthz") {
        const ok = await ping(clamdHost, clamdPort);
        return json(res, ok ? 200 : 503, { ok });
      }
      if (req.method !== "POST" || path !== "/scan") return json(res, 404, { error: "not found" });

      const declared = Number(req.headers["content-length"] ?? "0");
      if (declared > maxBytes) return json(res, 413, { error: "file too large" });
      if (!(await waitForClamd())) {
        log("ERROR", "clamd not ready in time");
        return json(res, 503, { error: "scanner not ready" });
      }
      const started = Date.now();
      const result = await instream(clamdHost, clamdPort, limited(req, maxBytes), scanTimeoutMs);
      log(result.clean ? "INFO" : "WARNING", result.clean ? "scan clean" : "scan found malware", {
        signature: result.clean ? undefined : result.signature,
        bytes: declared || undefined,
        ms: Date.now() - started,
      });
      return json(res, 200, result);
    } catch (error) {
      const status = error && error.status === 413 ? 413 : 502;
      log("ERROR", `scan failed: ${error instanceof Error ? error.message : String(error)}`);
      if (!res.headersSent)
        json(res, status, { error: status === 413 ? "file too large" : "scan failed" });
      else res.destroy();
    }
  });
}

import type { IncomingMessage, ServerResponse } from "node:http";

import type { AppLogger } from "./logger.js";
import { resolveRequestId, runWithRequestContext } from "./request-context.js";

export const REQUEST_ID_HEADER = "x-request-id";

/** Paths polled by load balancers; logging every probe would drown real traffic. */
const QUIET_PATHS = new Set(["/health", "/health/ready"]);

/**
 * Assigns a request ID (reusing a safe incoming `X-Request-Id`), echoes it in the response,
 * runs the rest of the request inside that context, and logs one line when the response
 * finishes. Only the path is logged: query strings can carry tokens.
 */
export function createRequestLoggingMiddleware(logger: AppLogger) {
  return (req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    const requestId = resolveRequestId(req.headers[REQUEST_ID_HEADER]);
    res.setHeader("X-Request-Id", requestId);
    const started = process.hrtime.bigint();
    // Express strips the mount path from req.url inside middleware; originalUrl keeps it.
    const url = (req as IncomingMessage & { originalUrl?: string }).originalUrl ?? req.url ?? "/";
    const path = url.split("?")[0] ?? "/";

    res.on("finish", () => {
      const durationMs = Number(process.hrtime.bigint() - started) / 1_000_000;
      const quiet = QUIET_PATHS.has(path) && res.statusCode < 400;
      const level =
        res.statusCode >= 500 ? "error" : res.statusCode >= 400 ? "warn" : quiet ? "debug" : "info";
      runWithRequestContext({ requestId }, () => {
        logger[level](
          {
            httpRequest: {
              requestMethod: req.method,
              requestUrl: path,
              status: res.statusCode,
              latency: `${(durationMs / 1000).toFixed(3)}s`,
              userAgent: req.headers["user-agent"],
            },
          },
          `${req.method ?? "?"} ${path} ${String(res.statusCode)}`,
        );
      });
    });

    runWithRequestContext({ requestId }, next);
  };
}

import type { IncomingMessage } from "node:http";

/**
 * Client IP for rate limiting. Behind N trusted proxies (Cloud Run's front end appends one
 * hop), the real client is the Nth address from the RIGHT of X-Forwarded-For: anything to
 * its left was supplied by the client and can be forged. With 0 hops, the socket address.
 */
export function clientIp(req: IncomingMessage, trustedProxyHops: number): string {
  const socketIp = req.socket.remoteAddress ?? "unknown";
  if (trustedProxyHops <= 0) return socketIp;
  const header = req.headers["x-forwarded-for"];
  const raw = Array.isArray(header) ? header.join(",") : (header ?? "");
  const hops = raw
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "");
  return hops[hops.length - trustedProxyHops] ?? socketIp;
}

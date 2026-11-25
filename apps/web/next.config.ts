import type { NextConfig } from "next";

import { webEnv } from "./src/env";
import { securityHeaders } from "./src/lib/security-headers";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Security headers on every page (Prompt 27): CSP, no framing, no sniffing, HSTS when deployed.
  headers: () =>
    Promise.resolve([
      {
        source: "/:path*",
        headers: securityHeaders(webEnv, { development: process.env.NODE_ENV === "development" }),
      },
    ]),
};

export default nextConfig;

import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type DynamicModule,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";

/**
 * Security headers on every API response (Prompt 27, OWASP ASVS V14). The API serves JSON
 * and a few file downloads, never HTML, so the policy is as strict as it gets: no framing,
 * no scripts, no sniffing, no referrer, no caching unless a route says otherwise. Download
 * routes may set a narrower Content-Security-Policy of their own; theirs wins.
 */
export function securityHeaders(env: Pick<ApiEnv, "APP_ENV">) {
  const deployed = env.APP_ENV === "staging" || env.APP_ENV === "production";
  return (_req: IncomingMessage, res: ServerResponse, next: () => void): void => {
    res.removeHeader("X-Powered-By");
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("Content-Security-Policy", "default-src 'none'; frame-ancestors 'none'");
    res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Cache-Control", "no-store");
    if (deployed) res.setHeader("Strict-Transport-Security", "max-age=31536000; includeSubDomains");
    next();
  };
}

@Module({})
export class SecurityHeadersModule implements NestModule {
  private static env: Pick<ApiEnv, "APP_ENV"> = { APP_ENV: "local" };

  static forRoot(env: ApiEnv): DynamicModule {
    SecurityHeadersModule.env = env;
    return { module: SecurityHeadersModule };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(securityHeaders(SecurityHeadersModule.env)).forRoutes("*path");
  }
}

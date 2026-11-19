import type { IncomingMessage, ServerResponse } from "node:http";

import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  SetMetadata,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { clientIp } from "./client-ip.js";
import { RATE_LIMITER, type RateLimiter, type RateLimitResult } from "./rate-limiter.js";

export interface RateLimitRule {
  /** Bucket name, e.g. "sessions-revoke". */
  name: string;
  limit: number;
  windowSeconds: number;
  /** Count per signed-in user (falls back to IP when anonymous) or per client IP. */
  by: "user" | "ip";
}

const RATE_LIMIT_KEY = Symbol("rate-limit");

/** Applies a fixed-window limit to a route. Runs after authentication, so `by: "user"` works. */
export const RateLimit = (rule: RateLimitRule) => SetMetadata(RATE_LIMIT_KEY, rule);

export class TooManyRequestsException extends HttpException {
  constructor(readonly retryAfterSeconds: number) {
    super(
      {
        statusCode: 429,
        error: "rate_limited",
        message: "Too many requests. Please try again later.",
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }
}

/** Shared helper: count a hit and throw 429 (with Retry-After) when over the limit. */
export async function enforceRateLimit(
  limiter: RateLimiter,
  key: string,
  limit: number,
  windowSeconds: number,
  response: ServerResponse,
  logger: Logger,
): Promise<RateLimitResult> {
  let result: RateLimitResult;
  try {
    result = await limiter.hit(key, limit, windowSeconds);
  } catch (error) {
    // Fail open: a Redis outage must not take the API (or emergency flows) down.
    logger.warn(`Rate limiter unavailable, allowing request (${(error as Error).message})`);
    return { allowed: true, remaining: limit, retryAfterSeconds: 0 };
  }
  if (!result.allowed) {
    response.setHeader("Retry-After", String(result.retryAfterSeconds));
    throw new TooManyRequestsException(result.retryAfterSeconds);
  }
  return result;
}

@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);

  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const rule = this.reflector.getAllAndOverride<RateLimitRule | undefined>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!rule) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<IncomingMessage & { auth?: { user: { id: string } } }>();
    const subject =
      rule.by === "user" && request.auth
        ? `u:${request.auth.user.id}`
        : `ip:${clientIp(request, this.env.TRUST_PROXY_HOPS)}`;
    await enforceRateLimit(
      this.limiter,
      `${rule.name}:${subject}`,
      rule.limit,
      rule.windowSeconds,
      http.getResponse<ServerResponse>(),
      this.logger,
    );
    return true;
  }
}

import type { IncomingMessage, ServerResponse } from "node:http";

import type { AuthErrorReason } from "@fleettrust/types";
import {
  type CanActivate,
  ConflictException,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { currentRequestContext } from "../../observability/request-context.js";
import {
  clientIp,
  enforceRateLimit,
  RATE_LIMITER,
  type RateLimiter,
} from "../../platform/rate-limit/index.js";
import {
  APP_CHECK_VERIFIER,
  type AppCheckVerifier,
  AUTH_VERIFIER,
  AuthenticationError,
  type AuthVerifier,
} from "./auth-verifier.js";
import {
  type AuthenticatedRequest,
  CHECK_REVOKED,
  ALLOW_SUSPENDED,
  IS_PUBLIC,
  RECENT_LOGIN,
  REQUIRE_DISPLAY_NAME,
} from "./decorators.js";
import { DatabaseUnavailableError, UsersService } from "./users.service.js";

/** Failed sign-in attempts allowed per client IP per window before 429 (brute-force/scraping brake). */
export const FAILED_AUTH_LIMIT = 20;
export const FAILED_AUTH_WINDOW_SECONDS = 600;

function deny(reason: AuthErrorReason, status: 401 | 403 | 409 = 401): never {
  const body = {
    statusCode: status,
    error: status === 401 ? "unauthenticated" : "forbidden",
    reason,
  };
  if (status === 403) throw new ForbiddenException(body);
  if (status === 409) throw new ConflictException({ ...body, error: "conflict" });
  throw new UnauthorizedException(body);
}

/**
 * Global authentication guard (ADR-0005): every route requires a valid Firebase ID token
 * unless marked @Public(). Resolves the internal user (creating it on first sign-in) and
 * attaches it to the request. Authorization (org membership, roles) is layered on top in
 * Prompt 07; this guard only answers "who is calling?".
 */
@Injectable()
export class AuthGuard implements CanActivate {
  private readonly logger = new Logger(AuthGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly usersService: UsersService,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    @Inject(APP_CHECK_VERIFIER) private readonly appCheck: AppCheckVerifier,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (context.getType() !== "http") return true;
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const http = context.switchToHttp();
    const request = http.getRequest<IncomingMessage & AuthenticatedRequest>();
    const response = http.getResponse<ServerResponse>();

    await this.checkAppCheck(request);

    const recentLoginSeconds = this.reflector.getAllAndOverride<number | undefined>(
      RECENT_LOGIN,
      targets,
    );
    const checkRevoked =
      recentLoginSeconds !== undefined ||
      this.reflector.getAllAndOverride<boolean | undefined>(CHECK_REVOKED, targets) === true;

    let identity;
    try {
      identity = await this.verifier.verifyIdToken(this.bearerToken(request), { checkRevoked });
    } catch (error) {
      if (!(error instanceof AuthenticationError)) throw error;
      // Count failures per IP; a valid token never consumes this budget.
      await enforceRateLimit(
        this.limiter,
        `auth-failed:ip:${clientIp(request, this.env.TRUST_PROXY_HOPS)}`,
        FAILED_AUTH_LIMIT,
        FAILED_AUTH_WINDOW_SECONDS,
        response,
        this.logger,
      );
      deny(error.reason);
    }

    if (
      recentLoginSeconds !== undefined &&
      Date.now() - identity.authTime.getTime() > recentLoginSeconds * 1000
    ) {
      deny("reauthentication_required");
    }

    let user;
    try {
      user = await this.usersService.findOrCreate(identity, currentRequestContext()?.requestId);
    } catch (error) {
      if (error instanceof DatabaseUnavailableError) {
        throw new ServiceUnavailableException({ statusCode: 503, error: "service_unavailable" });
      }
      throw error;
    }
    if (user.status === "suspended") {
      // A suspension that has ended reactivates the account on the next request.
      user = await this.usersService.reactivateIfSuspensionEnded(user);
    }
    if (
      user.status === "suspended" &&
      !this.reflector.getAllAndOverride<boolean>(ALLOW_SUSPENDED, targets)
    ) {
      deny("account_suspended", 403);
    }
    if (
      this.reflector.getAllAndOverride<boolean>(REQUIRE_DISPLAY_NAME, targets) &&
      !user.displayName
    ) {
      deny("profile_incomplete", 409);
    }

    request.auth = { user, identity };
    return true;
  }

  private bearerToken(request: IncomingMessage): string {
    const header = request.headers.authorization;
    if (header === undefined || header === "") throw new AuthenticationError("missing_token");
    const match = /^Bearer ([A-Za-z0-9._-]{20,4096})$/.exec(header);
    if (!match?.[1]) throw new AuthenticationError("malformed_token");
    return match[1];
  }

  private async checkAppCheck(request: IncomingMessage): Promise<void> {
    if (this.env.APP_CHECK_MODE === "off") return;
    const header = request.headers["x-firebase-appcheck"];
    const token = Array.isArray(header) ? header[0] : header;
    try {
      if (!token) throw new Error("missing App Check token");
      await this.appCheck.verify(token);
    } catch (error) {
      if (this.env.APP_CHECK_MODE === "enforce") deny("app_check_failed");
      this.logger.warn(`App Check would have rejected this request (${(error as Error).message})`);
    }
  }
}

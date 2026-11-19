import type { User } from "@fleettrust/db";
import { createParamDecorator, type ExecutionContext, SetMetadata } from "@nestjs/common";

import type { VerifiedIdentity } from "./auth-verifier.js";

export const IS_PUBLIC = Symbol("is-public");
export const RECENT_LOGIN = Symbol("recent-login");
export const CHECK_REVOKED = Symbol("check-revoked");
export const REQUIRE_DISPLAY_NAME = Symbol("require-display-name");

/** Route needs no sign-in (health checks, public content). Everything else does, by default. */
export const Public = () => SetMetadata(IS_PUBLIC, true);

/**
 * Sensitive route: the token must not be revoked (extra lookup per call). Use for account
 * changes, admin actions and anything that acts on someone else's behalf.
 */
export const CheckRevoked = () => SetMetadata(CHECK_REVOKED, true);

/**
 * The user must have actually signed in within `maxAgeSeconds` (not just refreshed a token),
 * e.g. before deleting the account. Implies CheckRevoked.
 */
export const RequireRecentLogin = (maxAgeSeconds = 300) => SetMetadata(RECENT_LOGIN, maxAgeSeconds);

/** Contributing actions (articles, comments, groups) need a display name: 409 profile_incomplete until set. */
export const RequireDisplayName = () => SetMetadata(REQUIRE_DISPLAY_NAME, true);

export interface AuthContext {
  user: User;
  identity: VerifiedIdentity;
}

export interface AuthenticatedRequest {
  auth?: AuthContext;
}

/** Injects the signed-in user's account into a handler parameter. */
export const CurrentUser = createParamDecorator(
  (_data: unknown, context: ExecutionContext): User => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error("CurrentUser used on a route without authentication");
    return request.auth.user;
  },
);

/** Injects the full auth context (user + verified token claims). */
export const CurrentAuth = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthContext => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.auth) throw new Error("CurrentAuth used on a route without authentication");
    return request.auth;
  },
);

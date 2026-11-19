import type { User } from "@fleettrust/db";
import { type MeResponse, updateMeRequestSchema } from "@fleettrust/types";
import { Body, Controller, Get, HttpCode, Inject, Patch, Post } from "@nestjs/common";

import { currentRequestContext } from "../../observability/request-context.js";
import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { AUTH_VERIFIER, type AuthVerifier } from "./auth-verifier.js";
import { type AuthContext, CheckRevoked, CurrentAuth, CurrentUser } from "./decorators.js";
import { UsersService } from "./users.service.js";

function toMeResponse(user: User): MeResponse {
  return {
    id: user.id,
    email: user.email,
    emailVerified: user.emailVerified,
    displayName: user.displayName,
    profileComplete: user.displayName !== null,
    timeZone: user.timezone,
    createdAt: user.createdAt.toISOString(),
  };
}

@Controller("v1/me")
export class MeController {
  constructor(
    private readonly usersService: UsersService,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
  ) {}

  /** The signed-in user's profile. The first call after sign-in creates the account. */
  @Get()
  me(@CurrentUser() user: User): MeResponse {
    return toMeResponse(user);
  }

  @Patch()
  @CheckRevoked()
  @RateLimit({ name: "me-update", limit: 20, windowSeconds: 3600, by: "user" })
  async update(@CurrentUser() user: User, @Body() body: unknown): Promise<MeResponse> {
    const change = parseBody(updateMeRequestSchema, body);
    if (change.displayName === undefined && change.timeZone === undefined)
      return toMeResponse(user);
    const updated = await this.usersService.updateProfile(
      user,
      change,
      currentRequestContext()?.requestId,
    );
    return toMeResponse(updated);
  }

  /**
   * "Sign out everywhere": revokes every refresh token. Existing ID tokens stay valid for
   * up to an hour on ordinary routes, but sensitive routes (@CheckRevoked) reject them at once.
   */
  @Post("sessions/revoke")
  @HttpCode(204)
  @CheckRevoked()
  @RateLimit({ name: "sessions-revoke", limit: 5, windowSeconds: 600, by: "user" })
  async revokeSessions(@CurrentAuth() auth: AuthContext): Promise<void> {
    await this.verifier.revokeSessions(auth.identity.uid);
    await this.usersService.recordSessionsRevoked(auth.user, currentRequestContext()?.requestId);
  }
}

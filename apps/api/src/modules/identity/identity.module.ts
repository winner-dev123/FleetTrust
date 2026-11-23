import { type DynamicModule, Module } from "@nestjs/common";
import { APP_GUARD } from "@nestjs/core";

import type { ApiEnv } from "../../config/env.js";
import { RateLimitGuard } from "../../platform/rate-limit/index.js";
import { APP_CHECK_VERIFIER, AUTH_VERIFIER } from "./auth-verifier.js";
import { AuthGuard } from "./auth.guard.js";
import { FirebaseAppCheckVerifier, FirebaseAuthVerifier } from "./firebase-adapters.js";
import { MeController } from "./me.controller.js";
import { UsersService } from "./users.service.js";

/**
 * Identity bounded context (ADR-0002, ADR-0005). Registers the global AuthGuard, then the
 * RateLimitGuard (order matters: per-user limits need the authenticated user).
 */
@Module({})
export class IdentityModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: IdentityModule,
      // Global: the realtime gateway (messaging) authenticates sockets with the same verifier.
      global: true,
      controllers: [MeController],
      providers: [
        UsersService,
        {
          provide: AUTH_VERIFIER,
          useFactory: () => FirebaseAuthVerifier.forProject(env.FIREBASE_PROJECT_ID),
        },
        {
          provide: APP_CHECK_VERIFIER,
          useFactory: () => new FirebaseAppCheckVerifier(env.FIREBASE_PROJECT_ID),
        },
        { provide: APP_GUARD, useClass: AuthGuard },
        { provide: APP_GUARD, useClass: RateLimitGuard },
      ],
      exports: [UsersService, AUTH_VERIFIER],
    };
  }
}

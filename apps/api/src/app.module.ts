import { type DynamicModule, Module } from "@nestjs/common";

import { ApiConfigModule } from "./config/config.module.js";
import type { ApiEnv } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { EntitlementsModule } from "./modules/entitlements/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { OrganizationsModule } from "./modules/organizations/index.js";
import { VerificationModule } from "./modules/verification/index.js";
import { type AppLogger, createLogger } from "./observability/logger.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { RateLimitModule } from "./platform/rate-limit/index.js";
import { StorageModule } from "./platform/storage/index.js";

/** Builds the structured logger for an environment (one per process). */
export function createAppLogger(env: ApiEnv): AppLogger {
  return createLogger({
    level: env.LOG_LEVEL,
    service: "fleettrust-api",
    role: env.APP_ROLE,
    version: env.APP_VERSION,
    gcpProject: env.GOOGLE_CLOUD_PROJECT,
  });
}

/**
 * Root module. Bounded-context modules live under `src/modules/<name>` and are
 * registered here as they are built (Prompt 06 onwards).
 */
@Module({})
export class AppModule {
  static register(env: ApiEnv, options: { logger?: AppLogger } = {}): DynamicModule {
    return {
      module: AppModule,
      imports: [
        ObservabilityModule.forRoot(options.logger ?? createAppLogger(env)),
        ApiConfigModule.forRoot(env),
        DatabaseModule.forRoot(env),
        RateLimitModule.forRoot(env),
        // Object storage, document encryption and malware scanning (ADR-0006).
        StorageModule.forRoot(env),
        // Registers the global AuthGuard: every route requires sign-in unless marked @Public().
        IdentityModule.forRoot(env),
        // Tenancy: @OrgPermission() routes check membership and role after sign-in.
        OrganizationsModule,
        // Plans, quotas and billing-operator actions.
        EntitlementsModule,
        // Document verification and badges.
        VerificationModule,
        HealthModule,
      ],
    };
  }
}

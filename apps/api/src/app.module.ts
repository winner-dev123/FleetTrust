import { type DynamicModule, Module } from "@nestjs/common";

import { ApiConfigModule } from "./config/config.module.js";
import type { ApiEnv } from "./config/env.js";
import { DatabaseModule } from "./database/database.module.js";
import { HealthModule } from "./health/health.module.js";
import { AdminModule } from "./modules/admin/index.js";
import { EntitlementsModule } from "./modules/entitlements/index.js";
import { IdentityModule } from "./modules/identity/index.js";
import { ListsModule } from "./modules/lists/index.js";
import { CrmModule } from "./modules/crm/index.js";
import { PartsModule } from "./modules/parts/index.js";
import { FleetModule } from "./modules/fleet/index.js";
import { JobsModule } from "./modules/jobs/index.js";
import { PowerUserModule } from "./modules/power-user/index.js";
import { OrganizationsModule } from "./modules/organizations/index.js";
import { ProvidersModule } from "./modules/providers/index.js";
import { RequestsModule } from "./modules/requests/index.js";
import { ArticlesModule } from "./modules/articles/index.js";
import { ModerationModule } from "./modules/moderation/index.js";
import { CommunityModule } from "./modules/community/index.js";
import { MessagingModule } from "./modules/messaging/index.js";
import { NotificationsModule } from "./modules/notifications/index.js";
import { EmergencyModule } from "./modules/emergency/index.js";
import { VehiclesModule } from "./modules/vehicles/index.js";
import { SearchModule } from "./modules/search/index.js";
import { VerificationModule } from "./modules/verification/index.js";
import { type AppLogger, createLogger } from "./observability/logger.js";
import { ObservabilityModule } from "./observability/observability.module.js";
import { ClockModule } from "./platform/clock/index.js";
import { MapsModule } from "./platform/maps/index.js";
import { RateLimitModule } from "./platform/rate-limit/index.js";
import { SettingsModule } from "./platform/settings/index.js";
import { EmailModule } from "./platform/email/index.js";
import { PushModule } from "./platform/push/index.js";
import { RealtimeModule } from "./platform/realtime/index.js";
import { RoutingModule } from "./platform/routing/index.js";
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
        // Time source (CLOCK), replaceable in tests.
        ClockModule,
        // Map vendor adapter (tiles config, geocoding).
        MapsModule.forRoot(env),
        // Routing adapter for route-corridor search (degrades to point search).
        RoutingModule.forRoot(env),
        RealtimeModule.forRoot(env),
        PushModule.forRoot(env),
        EmailModule.forRoot(env),
        // Admin feature and service-category settings, read by several modules.
        SettingsModule,
        // Registers the global AuthGuard: every route requires sign-in unless marked @Public().
        IdentityModule.forRoot(env),
        // Tenancy: @OrgPermission() routes check membership and role after sign-in.
        OrganizationsModule,
        // Plans, quotas and billing-operator actions.
        EntitlementsModule,
        // Document verification and badges.
        VerificationModule,
        // Provider profiles: setup wizard, publication, public views.
        ProvidersModule,
        // Provider search (PostGIS), ranked by relevance only.
        SearchModule,
        // Favorites and saved provider lists.
        ListsModule,
        // Service requests and informational quotes.
        RequestsModule,
        ArticlesModule,
        ModerationModule,
        CommunityModule,
        MessagingModule,
        NotificationsModule,
        EmergencyModule,
        VehiclesModule,
        CrmModule,
        PartsModule,
        FleetModule,
        JobsModule,
        PowerUserModule,
        // Admin console API: staff roles, settings, categories, audit search, support.
        AdminModule,
        HealthModule,
      ],
    };
  }
}

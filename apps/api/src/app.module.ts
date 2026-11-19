import { type DynamicModule, Module } from "@nestjs/common";

import { ApiConfigModule } from "./config/config.module.js";
import type { ApiEnv } from "./config/env.js";
import { HealthModule } from "./health/health.module.js";

/**
 * Root module. Bounded-context modules live under `src/modules/<name>` and are
 * registered here as they are built (Prompt 04 onwards).
 */
@Module({})
export class AppModule {
  static register(env: ApiEnv): DynamicModule {
    return {
      module: AppModule,
      imports: [ApiConfigModule.forRoot(env), HealthModule],
    };
  }
}

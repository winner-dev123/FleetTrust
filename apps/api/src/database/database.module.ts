import { createDatabase, type DatabaseHandle } from "@fleettrust/db";
import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import type { ApiEnv } from "../config/env.js";

/**
 * Injection token for the database handle, or null when DATABASE_URL is not configured
 * (local development without Docker). Modules that need the database must fail clearly
 * on null rather than assume it exists.
 */
export const DATABASE = Symbol("DATABASE");
export type DatabaseProvider = DatabaseHandle | null;

@Injectable()
class DatabaseLifecycle implements OnApplicationShutdown {
  constructor(@Inject(DATABASE) private readonly handle: DatabaseProvider) {}

  async onApplicationShutdown(): Promise<void> {
    await this.handle?.close();
  }
}

@Module({})
export class DatabaseModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: DatabaseModule,
      global: true,
      providers: [
        {
          provide: DATABASE,
          // The pg pool connects lazily, so creating it never blocks startup.
          useFactory: (): DatabaseProvider =>
            env.DATABASE_URL === undefined
              ? null
              : createDatabase({
                  url: env.DATABASE_URL,
                  maxConnections: env.DB_POOL_MAX,
                  applicationName: `fleettrust-${env.APP_ROLE}`,
                }),
        },
        DatabaseLifecycle,
      ],
      exports: [DATABASE],
    };
  }
}

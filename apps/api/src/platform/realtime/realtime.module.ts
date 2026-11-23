import {
  type DynamicModule,
  Inject,
  Injectable,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";
import {
  MemoryRealtimeBus,
  REALTIME_BUS,
  type RealtimeBus,
  RedisRealtimeBus,
} from "./realtime-bus.js";

@Injectable()
class RealtimeBusLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REALTIME_BUS) private readonly bus: RealtimeBus) {}

  async onApplicationShutdown(): Promise<void> {
    await this.bus.close();
  }
}

/** REALTIME_BUS: Redis pub/sub when REDIS_URL is set (required when deployed), otherwise in memory. */
@Module({})
export class RealtimeModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: RealtimeModule,
      global: true,
      providers: [
        {
          provide: REALTIME_BUS,
          useFactory: (): RealtimeBus =>
            env.REDIS_URL === undefined
              ? new MemoryRealtimeBus()
              : new RedisRealtimeBus(env.REDIS_URL),
        },
        RealtimeBusLifecycle,
      ],
      exports: [REALTIME_BUS],
    };
  }
}

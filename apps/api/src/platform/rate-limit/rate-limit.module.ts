import {
  type DynamicModule,
  Inject,
  Injectable,
  Logger,
  Module,
  type OnApplicationShutdown,
} from "@nestjs/common";
import { createClient } from "redis";

import type { ApiEnv } from "../../config/env.js";
import { MemoryRateLimiter, RATE_LIMITER, type RateLimiter } from "./rate-limiter.js";
import { RedisRateLimiter } from "./redis-rate-limiter.js";

const REDIS_CLIENT = Symbol("REDIS_CLIENT");

function connectRedis(url: string) {
  const client = createClient({
    url,
    socket: {
      connectTimeout: 2_000,
      reconnectStrategy: (retries) => Math.min(retries * 200, 2_000),
    },
  });
  const logger = new Logger("Redis");
  client.on("error", (error: Error) => {
    logger.warn(`Redis client error: ${error.message}`);
  });
  // Connect in the background; the limiter fails open until Redis is reachable.
  void client.connect().catch((error: unknown) => {
    logger.warn(`Redis connect failed: ${(error as Error).message}`);
  });
  return client;
}

type RedisHandle = ReturnType<typeof connectRedis> | null;

@Injectable()
class RedisLifecycle implements OnApplicationShutdown {
  constructor(@Inject(REDIS_CLIENT) private readonly client: RedisHandle) {}

  async onApplicationShutdown(): Promise<void> {
    if (this.client?.isOpen) await this.client.close();
  }
}

/**
 * Provides RATE_LIMITER: Redis-backed (shared across instances) when REDIS_URL is set,
 * otherwise in-memory. Env validation requires REDIS_URL in staging and production.
 */
@Module({})
export class RateLimitModule {
  static forRoot(env: ApiEnv): DynamicModule {
    return {
      module: RateLimitModule,
      global: true,
      providers: [
        {
          provide: REDIS_CLIENT,
          useFactory: (): RedisHandle =>
            env.REDIS_URL === undefined ? null : connectRedis(env.REDIS_URL),
        },
        {
          provide: RATE_LIMITER,
          inject: [REDIS_CLIENT],
          useFactory: (client: RedisHandle): RateLimiter =>
            client ? new RedisRateLimiter(client) : new MemoryRateLimiter(),
        },
        RedisLifecycle,
      ],
      exports: [RATE_LIMITER],
    };
  }
}

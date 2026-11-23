import "reflect-metadata";

import type { Server } from "node:http";

import { createTestDatabase, type TestDatabase } from "@fleettrust/db/testing";
import type { INestApplication, Type } from "@nestjs/common";
import { Test } from "@nestjs/testing";

import { AppModule } from "../../src/app.module.js";
import { loadApiEnv } from "../../src/config/env.js";
import { CLOCK, type Clock, systemClock } from "../../src/platform/clock/index.js";
import { ROUTING_PROVIDER, type RoutingProvider } from "../../src/platform/routing/index.js";
import { DATABASE } from "../../src/database/database.module.js";
import {
  APP_CHECK_VERIFIER,
  AUTH_VERIFIER,
  type AuthVerifier,
} from "../../src/modules/identity/auth-verifier.js";
import { MemoryRateLimiter, RATE_LIMITER } from "../../src/platform/rate-limit/index.js";
import { FakeAppCheckVerifier, FakeAuthVerifier } from "./fake-auth.js";
import { captureLogs, type LogCapture } from "./log-capture.js";

export interface TestApp {
  app: INestApplication;
  server: Server;
  auth: FakeAuthVerifier;
  db: TestDatabase;
  limiter: MemoryRateLimiter;
  logs: LogCapture;
  close(): Promise<void>;
}

/**
 * The real AppModule wired to test doubles: fake Firebase verifiers, an in-process PGlite +
 * PostGIS database (fully migrated), an in-memory rate limiter and captured logs.
 */
export async function createTestApp(
  options: {
    env?: Record<string, string>;
    controllers?: Type[];
    db?: TestDatabase;
    /** Real verifier for integration tests (e.g. Firebase against the Auth emulator). */
    authVerifier?: AuthVerifier;
    /** Time source for entitlements (daily periods, grace periods). */
    clock?: Clock;
    /** Routing vendor double (route search). Defaults to the env-configured adapter. */
    routing?: RoutingProvider;
  } = {},
): Promise<TestApp> {
  const env = loadApiEnv({
    NODE_ENV: "test",
    APP_ENV: "test",
    APP_VERSION: "test-sha",
    ...options.env,
  });
  const db = options.db ?? (await createTestDatabase());
  const auth = new FakeAuthVerifier();
  const limiter = new MemoryRateLimiter();
  const logs = captureLogs();

  let builder = Test.createTestingModule({
    imports: [AppModule.register(env, { logger: logs.logger })],
    controllers: options.controllers ?? [],
  })
    .overrideProvider(DATABASE)
    .useValue({
      db: db.db,
      ping: async () => {
        await db.client.query("SELECT 1");
      },
      close: () => Promise.resolve(),
    })
    .overrideProvider(AUTH_VERIFIER)
    .useValue(options.authVerifier ?? auth)
    .overrideProvider(APP_CHECK_VERIFIER)
    .useValue(new FakeAppCheckVerifier())
    .overrideProvider(RATE_LIMITER)
    .useValue(limiter)
    .overrideProvider(CLOCK)
    .useValue(options.clock ?? systemClock);
  if (options.routing)
    builder = builder.overrideProvider(ROUTING_PROVIDER).useValue(options.routing);
  const moduleRef = await builder.compile();

  const app = moduleRef.createNestApplication();
  app.useLogger(false);
  await app.init();

  return {
    app,
    server: app.getHttpServer() as Server,
    auth,
    db,
    limiter,
    logs,
    close: async () => {
      await app.close();
      if (!options.db) await db.close();
    },
  };
}

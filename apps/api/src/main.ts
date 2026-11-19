import "reflect-metadata";

import { EnvValidationError } from "@fleettrust/env";
import { NestFactory } from "@nestjs/core";

import { AppModule, createAppLogger } from "./app.module.js";
import { type ApiEnv, loadApiEnv } from "./config/env.js";
import { NestPinoLogger } from "./observability/nest-logger.js";

async function bootstrap(env: ApiEnv): Promise<void> {
  const logger = createAppLogger(env);
  // bufferLogs: Nest's startup messages wait until the structured logger is attached.
  const app = await NestFactory.create(AppModule.register(env, { logger }), { bufferLogs: true });
  app.useLogger(new NestPinoLogger(logger));
  app.enableShutdownHooks();
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.CORS_ORIGINS, exposedHeaders: ["X-Request-Id"] });
  }
  await app.listen(env.PORT, "0.0.0.0");
  logger.info({ port: env.PORT, appEnv: env.APP_ENV }, "FleetTrust API listening");
}

let env: ApiEnv;
try {
  env = loadApiEnv(process.env);
} catch (error) {
  if (error instanceof EnvValidationError) {
    console.error(error.message);
    process.exit(1);
  }
  throw error;
}

await bootstrap(env);

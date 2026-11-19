import "reflect-metadata";

import { EnvValidationError } from "@fleettrust/config/env";
import { NestFactory } from "@nestjs/core";

import { AppModule } from "./app.module.js";
import { type ApiEnv, loadApiEnv } from "./config/env.js";

async function bootstrap(env: ApiEnv): Promise<void> {
  const app = await NestFactory.create(AppModule.register(env));
  app.enableShutdownHooks();
  if (env.CORS_ORIGINS.length > 0) {
    app.enableCors({ origin: env.CORS_ORIGINS });
  }
  await app.listen(env.PORT, "0.0.0.0");
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

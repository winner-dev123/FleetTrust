import {
  type DynamicModule,
  Inject,
  type MiddlewareConsumer,
  Module,
  type NestModule,
} from "@nestjs/common";
import { APP_FILTER } from "@nestjs/core";

import { AllExceptionsFilter } from "./all-exceptions.filter.js";
import { ERROR_REPORTER, LogErrorReporter } from "./error-reporter.js";
import type { AppLogger } from "./logger.js";
import { createRequestLoggingMiddleware } from "./request-logging.middleware.js";
import { TracingLifecycle } from "./tracing-shutdown.js";

export const LOGGER = Symbol("LOGGER");

@Module({})
export class ObservabilityModule implements NestModule {
  constructor(@Inject(LOGGER) private readonly logger: AppLogger) {}

  static forRoot(logger: AppLogger): DynamicModule {
    return {
      module: ObservabilityModule,
      global: true,
      providers: [
        { provide: LOGGER, useValue: logger },
        { provide: ERROR_REPORTER, useValue: new LogErrorReporter(logger) },
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        TracingLifecycle,
      ],
      exports: [LOGGER, ERROR_REPORTER],
    };
  }

  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(createRequestLoggingMiddleware(this.logger)).forRoutes("*path");
  }
}

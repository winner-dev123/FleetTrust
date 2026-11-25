import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
  Logger,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

import { ERROR_REPORTER, type ErrorReporter } from "./error-reporter.js";
import { currentRequestContext } from "./request-context.js";
import { isTransientDatabaseError, OVERLOADED_RETRY_AFTER_SECONDS } from "./transient-errors.js";

/**
 * Last-resort exception handling. Expected HTTP errors (4xx, deliberate 503s) pass through
 * unchanged. Anything unexpected is reported once and answered with a generic 500 that
 * carries the request ID for support, never the error message or stack. Transient database
 * pressure (pool exhausted, serialization failure, deadlock) is answered with 503
 * `overloaded` and Retry-After instead, and logged as a warning: the client should retry
 * with the same idempotency key (Prompt 28, docs/operations/slo.md).
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger("AllExceptionsFilter");

  constructor(
    private readonly adapterHost: HttpAdapterHost,
    @Inject(ERROR_REPORTER) private readonly reporter: ErrorReporter,
  ) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const { httpAdapter } = this.adapterHost;
    const response: unknown = host.switchToHttp().getResponse();
    const requestId = currentRequestContext()?.requestId;

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      if (status === 500) this.reporter.report(exception, { requestId });
      httpAdapter.reply(response, exception.getResponse(), status);
      return;
    }

    if (isTransientDatabaseError(exception)) {
      this.logger.warn(`overloaded: ${(exception as Error).message}`);
      httpAdapter.setHeader(response, "Retry-After", String(OVERLOADED_RETRY_AFTER_SECONDS));
      httpAdapter.reply(
        response,
        {
          statusCode: HttpStatus.SERVICE_UNAVAILABLE,
          error: "service_unavailable",
          reason: "overloaded",
          message: "The service is busy. Please try again in a moment.",
          requestId,
        },
        HttpStatus.SERVICE_UNAVAILABLE,
      );
      return;
    }

    this.reporter.report(exception, { requestId });
    httpAdapter.reply(
      response,
      {
        statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
        error: "internal_error",
        message: "Something went wrong. Please try again.",
        requestId,
      },
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Inject,
} from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";

import { ERROR_REPORTER, type ErrorReporter } from "./error-reporter.js";
import { currentRequestContext } from "./request-context.js";

/**
 * Last-resort exception handling. Expected HTTP errors (4xx, deliberate 503s) pass through
 * unchanged. Anything unexpected is reported once and answered with a generic 500 that
 * carries the request ID for support, never the error message or stack.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
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

import type { AppLogger } from "./logger.js";

/**
 * Error monitoring port. The default implementation writes a Cloud Error Reporting–shaped
 * log entry (error severity + stack trace + ReportedErrorEvent type), which Google Cloud
 * groups and alerts on with no extra SDK. A Sentry (or similar) adapter can implement the
 * same interface later without touching call sites.
 */
export interface ErrorReporter {
  report(
    error: unknown,
    context?: { requestId?: string | undefined; [key: string]: unknown },
  ): void;
}

export const ERROR_REPORTER = Symbol("ERROR_REPORTER");

export class LogErrorReporter implements ErrorReporter {
  constructor(private readonly logger: AppLogger) {}

  report(error: unknown, context: Record<string, unknown> = {}): void {
    const err = error instanceof Error ? error : new Error(String(error));
    this.logger.error(
      {
        ...context,
        err,
        "@type":
          "type.googleapis.com/google.devtools.clouderrorreporting.v1beta1.ReportedErrorEvent",
      },
      err.stack ?? err.message,
    );
  }
}

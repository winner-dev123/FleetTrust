import type { LoggerService } from "@nestjs/common";

import type { AppLogger } from "./logger.js";

/** Routes NestJS's own log calls (bootstrap, router, exceptions) through the structured logger. */
export class NestPinoLogger implements LoggerService {
  constructor(private readonly logger: AppLogger) {}

  log(message: unknown, ...params: unknown[]): void {
    this.write("info", message, params);
  }

  error(message: unknown, ...params: unknown[]): void {
    this.write("error", message, params);
  }

  warn(message: unknown, ...params: unknown[]): void {
    this.write("warn", message, params);
  }

  debug(message: unknown, ...params: unknown[]): void {
    this.write("debug", message, params);
  }

  verbose(message: unknown, ...params: unknown[]): void {
    this.write("trace", message, params);
  }

  fatal(message: unknown, ...params: unknown[]): void {
    this.write("fatal", message, params);
  }

  /** Nest passes `[...optionalParams, context]`; error() may also pass a stack string. */
  private write(
    level: "info" | "error" | "warn" | "debug" | "trace" | "fatal",
    message: unknown,
    params: unknown[],
  ): void {
    const context = typeof params.at(-1) === "string" ? (params.at(-1) as string) : undefined;
    const stack =
      level === "error" && typeof params[0] === "string" && params.length > 1
        ? params[0]
        : undefined;
    const fields: Record<string, unknown> = {};
    if (context) fields["context"] = context;
    if (stack) fields["stack"] = stack;
    if (message instanceof Error) {
      this.logger[level]({ ...fields, err: message }, message.message);
    } else if (typeof message === "object" && message !== null) {
      this.logger[level]({ ...fields, ...message });
    } else {
      this.logger[level](fields, String(message));
    }
  }
}

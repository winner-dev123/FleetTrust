import { trace } from "@opentelemetry/api";
import pino, { type DestinationStream, type Logger } from "pino";

import { REDACT_PATHS, REDACTED, redactString } from "./redact.js";
import { currentRequestContext } from "./request-context.js";

export type AppLogger = Logger;

export interface LoggerOptions {
  level: string;
  service: string;
  role: string;
  version: string;
  /** Google Cloud project, enables log ↔ trace correlation in Cloud Logging. */
  gcpProject?: string | undefined;
  /** Defaults to stdout. Tests pass an in-memory stream. */
  destination?: DestinationStream;
}

/** pino level → Cloud Logging severity (https://cloud.google.com/logging/docs/structured-logging). */
const SEVERITY: Readonly<Record<string, string>> = {
  trace: "DEBUG",
  debug: "DEBUG",
  info: "INFO",
  warn: "WARNING",
  error: "ERROR",
  fatal: "CRITICAL",
};

function redactDeep(value: unknown, depth = 0): unknown {
  if (typeof value === "string") return redactString(value);
  if (depth > 6 || value === null || typeof value !== "object") return value;
  // Error properties are non-enumerable; serialize (keeping the stack) before walking.
  if (value instanceof Error) return serializeError(value);
  if (Array.isArray(value)) return value.map((item) => redactDeep(item, depth + 1));
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, redactDeep(item, depth + 1)]),
  );
}

/** Error serializer that keeps the stack (Cloud Error Reporting needs it) but scrubs secrets. */
function serializeError(error: unknown): Record<string, unknown> {
  const serialized = pino.stdSerializers.err(error as Error) as unknown as Record<string, unknown>;
  return redactDeep(serialized) as Record<string, unknown>;
}

/**
 * Structured JSON logger compatible with Cloud Logging: `severity`, `message`, `time`, plus
 * request ID and trace correlation on every line. Secrets are removed twice: by field path
 * (`redact`) and by pattern in all strings (`redactString`).
 */
export function createLogger(options: LoggerOptions): AppLogger {
  return pino(
    {
      level: options.level,
      messageKey: "message",
      base: { service: options.service, role: options.role, version: options.version },
      timestamp: pino.stdTimeFunctions.isoTime,
      formatters: {
        level: (label) => ({ severity: SEVERITY[label] ?? "DEFAULT", level: label }),
        log: (object) => redactDeep(object) as Record<string, unknown>,
      },
      serializers: { err: serializeError, error: serializeError },
      redact: { paths: [...REDACT_PATHS], censor: REDACTED },
      hooks: {
        // Scrub free-text arguments (the message and any printf-style interpolations).
        logMethod(args, method) {
          const cleaned = args.map((arg: unknown) =>
            typeof arg === "string" ? redactString(arg) : arg,
          ) as Parameters<typeof method>;
          method.apply(this, cleaned);
        },
      },
      mixin() {
        const fields: Record<string, string> = {};
        const requestId = currentRequestContext()?.requestId;
        if (requestId) fields["requestId"] = requestId;
        const spanContext = trace.getActiveSpan()?.spanContext();
        if (spanContext) {
          fields["traceId"] = spanContext.traceId;
          fields["spanId"] = spanContext.spanId;
          if (options.gcpProject) {
            fields["logging.googleapis.com/trace"] =
              `projects/${options.gcpProject}/traces/${spanContext.traceId}`;
            fields["logging.googleapis.com/spanId"] = spanContext.spanId;
          }
        }
        return fields;
      },
    },
    options.destination ?? pino.destination({ sync: false }),
  );
}

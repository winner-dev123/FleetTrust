import { Writable } from "node:stream";

import { type AppLogger, createLogger } from "../../src/observability/logger.js";

export interface LogCapture {
  logger: AppLogger;
  /** Parsed JSON log lines written so far. */
  lines(): Record<string, unknown>[];
  /** Raw text of everything logged, for "secret never appears" assertions. */
  raw(): string;
}

/** A real (production-configured) logger that writes to memory instead of stdout. */
export function captureLogs(options: { gcpProject?: string } = {}): LogCapture {
  const chunks: string[] = [];
  const destination = new Writable({
    write(chunk: Buffer | string, _encoding, callback) {
      chunks.push(chunk.toString());
      callback();
    },
  });
  const logger = createLogger({
    level: "debug",
    service: "fleettrust-api",
    role: "api",
    version: "test",
    gcpProject: options.gcpProject,
    destination,
  });
  const raw = () => chunks.join("");
  return {
    logger,
    raw,
    lines: () =>
      raw()
        .split("\n")
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as Record<string, unknown>),
  };
}

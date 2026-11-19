import { Injectable, type OnApplicationShutdown } from "@nestjs/common";

import { TRACING_SHUTDOWN } from "./tracing-slot.js";

/** Flushes buffered spans during Nest's shutdown sequence (triggered by SIGTERM on Cloud Run). */
@Injectable()
export class TracingLifecycle implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    const shutdown = (globalThis as Record<symbol, unknown>)[TRACING_SHUTDOWN];
    if (typeof shutdown === "function") await (shutdown as () => Promise<void>)();
  }
}

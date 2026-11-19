import type { DependencyStatus, HealthResponse, ReadinessResponse } from "@fleettrust/types";
import { Controller, Get, Inject, Logger, ServiceUnavailableException } from "@nestjs/common";

import { API_ENV } from "../config/config.module.js";
import type { ApiEnv } from "../config/env.js";
import { DATABASE, type DatabaseProvider } from "../database/database.module.js";

/** Readiness must answer quickly even when the database hangs. */
const DEPENDENCY_TIMEOUT_MS = 2_000;

@Controller("health")
export class HealthController {
  private readonly logger = new Logger(HealthController.name);

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    @Inject(DATABASE) private readonly database: DatabaseProvider,
  ) {}

  /** Liveness probe. Deliberately touches no dependencies, so a database outage never restarts instances. */
  @Get()
  check(): HealthResponse {
    return {
      status: "ok",
      service: "fleettrust-api",
      role: this.env.APP_ROLE,
      version: this.env.APP_VERSION,
    };
  }

  /** Readiness probe: 200 when dependencies answer, 503 otherwise. Details stay in server logs. */
  @Get("ready")
  async ready(): Promise<ReadinessResponse> {
    const database = await this.checkDatabase();
    const body: ReadinessResponse = {
      status: database === "ok" ? "ready" : "not_ready",
      checks: { database },
    };
    if (body.status !== "ready") throw new ServiceUnavailableException(body);
    return body;
  }

  private async checkDatabase(): Promise<DependencyStatus> {
    if (this.database === null) return "not_configured";
    let timer: NodeJS.Timeout | undefined;
    try {
      await Promise.race([
        this.database.ping(),
        new Promise((_, reject) => {
          timer = setTimeout(() => {
            reject(new Error(`database ping exceeded ${String(DEPENDENCY_TIMEOUT_MS)} ms`));
          }, DEPENDENCY_TIMEOUT_MS);
        }),
      ]);
      return "ok";
    } catch (error) {
      this.logger.warn(`Readiness: database unavailable (${(error as Error).message})`);
      return "unavailable";
    } finally {
      clearTimeout(timer);
    }
  }
}

import type { HealthResponse } from "@fleettrust/types";
import { Controller, Get, Inject } from "@nestjs/common";

import { API_ENV } from "../config/config.module.js";
import type { ApiEnv } from "../config/env.js";

@Controller("health")
export class HealthController {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  /** Liveness probe. Deliberately touches no dependencies; readiness checks arrive with Prompt 04. */
  @Get()
  check(): HealthResponse {
    return {
      status: "ok",
      service: "fleettrust-api",
      role: this.env.APP_ROLE,
      version: this.env.APP_VERSION,
    };
  }
}

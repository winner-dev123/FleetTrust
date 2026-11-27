import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { HistoryService } from "./history.service.js";

/** Worker role: queues maintenance and document-expiry reminders every VEHICLE_REMINDER_INTERVAL_MS. */
@Injectable()
export class VehicleReminderJob implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger("VehicleReminderJob");
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly history: HistoryService,
  ) {}

  onApplicationBootstrap(): void {
    // WORKER_MODE=on-demand: Cloud Scheduler calls the worker endpoint instead (WorkerJobsController).
    if (this.env.APP_ROLE !== "worker" || this.env.WORKER_MODE !== "loop") return;
    this.timer = setInterval(() => {
      if (this.running) return;
      this.running = this.history
        .queueReminders()
        .catch((error: unknown) => {
          this.logger.error(`reminders failed: ${(error as Error).message}`);
        })
        .finally(() => {
          this.running = null;
        });
    }, this.env.VEHICLE_REMINDER_INTERVAL_MS);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.running;
  }

  run() {
    return this.history.queueReminders();
  }
}

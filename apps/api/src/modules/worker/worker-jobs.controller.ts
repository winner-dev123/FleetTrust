import { Controller, HttpCode, Post } from "@nestjs/common";

import { Public } from "../identity/index.js";
import { RetentionService } from "../privacy/index.js";
import { VehicleReminderJob } from "../vehicles/index.js";
import { WorkerRunner } from "./worker-runner.js";

/**
 * Worker endpoints for WORKER_MODE=on-demand (ADR-0037 step 3), registered only on the worker
 * role. They aren't reachable from the internet: the worker service has internal ingress and only
 * the jobs service account (Cloud Tasks and Cloud Scheduler) may invoke it, so Cloud Run checks
 * the caller before a request arrives here. @Public only skips the Firebase user check.
 *
 * - POST /internal/jobs/run: emergencies and the outbox (Cloud Tasks after writes, and the
 *   safety-net schedule every 15 minutes).
 * - POST /internal/jobs/reminders: vehicle reminders (hourly).
 * - POST /internal/jobs/retention: data retention rules (daily).
 */
@Public()
@Controller("internal/jobs")
export class WorkerJobsController {
  constructor(
    private readonly runner: WorkerRunner,
    private readonly reminders: VehicleReminderJob,
    private readonly retention: RetentionService,
  ) {}

  @Post("run")
  @HttpCode(200)
  run(): Promise<{ passes: number }> {
    return this.runner.run();
  }

  @Post("reminders")
  @HttpCode(200)
  async runReminders(): Promise<{ ok: true }> {
    await this.reminders.run();
    return { ok: true };
  }

  @Post("retention")
  @HttpCode(200)
  async runRetention(): Promise<{ ok: true }> {
    await this.retention.run();
    return { ok: true };
  }
}

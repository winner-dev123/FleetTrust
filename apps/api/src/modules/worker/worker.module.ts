import { Module } from "@nestjs/common";

import { EmergencyModule } from "../emergency/index.js";
import { NotificationsModule } from "../notifications/index.js";
import { PrivacyModule } from "../privacy/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { WorkerJobsController } from "./worker-jobs.controller.js";
import { WorkerRunner } from "./worker-runner.js";

/** On-demand worker endpoints (worker role with WORKER_MODE=on-demand only; see AppModule). */
@Module({
  imports: [EmergencyModule, NotificationsModule, PrivacyModule, VehiclesModule],
  controllers: [WorkerJobsController],
  providers: [WorkerRunner],
})
export class WorkerModule {}

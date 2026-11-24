import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { VehicleDocumentsService } from "./documents.service.js";
import { HistoryService } from "./history.service.js";
import { VehicleReminderJob } from "./reminder-job.js";
import {
  FleetVehiclesController,
  MyVehiclesController,
  SharedDocumentsController,
  VehicleController,
} from "./vehicles.controller.js";
import { VehiclesService } from "./vehicles.service.js";

/**
 * Vehicles, drivers, service history, maintenance reminders and the document vault
 * (SRS J5, F-070..F-074, ADR-0026).
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    MyVehiclesController,
    FleetVehiclesController,
    VehicleController,
    SharedDocumentsController,
  ],
  providers: [VehiclesService, HistoryService, VehicleDocumentsService, VehicleReminderJob],
  exports: [VehiclesService, HistoryService, VehicleReminderJob],
})
export class VehiclesModule {}

import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { DashboardService } from "./dashboard.service.js";
import { FleetController, PreferredByController } from "./fleet.controller.js";
import { FleetService } from "./fleet.service.js";

/**
 * Fleet operations (SRS J5, F-150..F-152, ADR-0029): dashboards, incidents, spending records
 * (never verified payments) and preferred providers.
 */
@Module({
  imports: [OrganizationsModule, VehiclesModule],
  controllers: [FleetController, PreferredByController],
  providers: [FleetService, DashboardService],
})
export class FleetModule {}

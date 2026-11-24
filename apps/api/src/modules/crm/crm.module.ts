import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { AnalyticsService } from "./analytics.service.js";
import { AppointmentsService } from "./appointments.service.js";
import {
  CrmController,
  MyAppointmentsController,
  ProviderResponseStatusController,
} from "./crm.controller.js";
import { CrmService } from "./crm.service.js";

/**
 * Provider CRM and appointments (SRS F-130..F-132, ADR-0027): inquiry pipeline, notes, tasks,
 * quote overview, staff availability, slots, atomic booking, analytics and response status.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [CrmController, MyAppointmentsController, ProviderResponseStatusController],
  providers: [CrmService, AppointmentsService, AnalyticsService],
})
export class CrmModule {}

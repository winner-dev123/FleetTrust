import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { TrustedContactsService } from "./contacts.service.js";
import { EmergencyDispatcher } from "./dispatcher.js";
import {
  EmergencyAlertsController,
  EmergencyGuidanceController,
  IncidentsController,
  ProviderEmergencyController,
  TrustedContactsController,
} from "./emergency.controller.js";
import { IncidentsService } from "./incidents.service.js";

/**
 * Emergency assistance and trusted circles (SRS J3, F-060..F-064, ADR-0010, ADR-0025).
 * Never imports entitlements (lint boundary): nothing here is gated by plans or quotas.
 */
@Module({
  imports: [OrganizationsModule],
  controllers: [
    EmergencyGuidanceController,
    TrustedContactsController,
    IncidentsController,
    EmergencyAlertsController,
    ProviderEmergencyController,
  ],
  providers: [TrustedContactsService, IncidentsService, EmergencyDispatcher],
  exports: [EmergencyDispatcher],
})
export class EmergencyModule {}

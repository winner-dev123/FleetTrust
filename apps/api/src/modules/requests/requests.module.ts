import { Module } from "@nestjs/common";

import { EntitlementsModule } from "../entitlements/index.js";
import { OrganizationsModule } from "../organizations/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { AttachmentsService } from "./attachments.service.js";
import {
  FleetRequestsController,
  InquiriesController,
  MyRequestsController,
  RequestAttachmentsController,
} from "./requests.controller.js";
import { RequestsService } from "./requests.service.js";

/** Service requests and informational quotes (SRS J2, ADR-0021). No payment endpoints. */
@Module({
  imports: [OrganizationsModule, EntitlementsModule, VehiclesModule],
  controllers: [
    MyRequestsController,
    FleetRequestsController,
    InquiriesController,
    RequestAttachmentsController,
  ],
  providers: [RequestsService, AttachmentsService],
})
export class RequestsModule {}

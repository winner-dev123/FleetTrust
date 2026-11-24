import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { PartInquiriesService } from "./part-inquiries.service.js";
import {
  FleetPartInquiriesController,
  MyPartInquiriesController,
  PartsController,
  PublicPartsController,
  ReceivedPartInquiriesController,
} from "./parts.controller.js";
import { PartsService } from "./parts.service.js";

/**
 * Parts listings and availability inquiries (SRS F-140, F-141, ADR-0028). No checkout,
 * reservation or payment endpoints: an answer is information only.
 */
@Module({
  imports: [OrganizationsModule, VehiclesModule],
  controllers: [
    PartsController,
    ReceivedPartInquiriesController,
    MyPartInquiriesController,
    FleetPartInquiriesController,
    PublicPartsController,
  ],
  providers: [PartsService, PartInquiriesService],
})
export class PartsModule {}

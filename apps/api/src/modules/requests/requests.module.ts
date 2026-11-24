import { Module } from "@nestjs/common";

import { EntitlementsModule } from "../entitlements/index.js";
import { OrganizationsModule } from "../organizations/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { AttachmentsService } from "./attachments.service.js";
import {
  FleetReferralsController,
  InquiryReferralsController,
  MyReferralsController,
  ProviderReferralsController,
} from "./referrals.controller.js";
import { ReferralsService } from "./referrals.service.js";
import {
  FleetRequestsController,
  InquiriesController,
  MyRequestsController,
  RequestAttachmentsController,
} from "./requests.controller.js";
import { RequestsService } from "./requests.service.js";

/**
 * Service requests and informational quotes (SRS J2, ADR-0021), and provider-to-provider
 * referrals with customer consent (SRS F-142, ADR-0028). No payment endpoints.
 */
@Module({
  imports: [OrganizationsModule, EntitlementsModule, VehiclesModule],
  controllers: [
    MyRequestsController,
    FleetRequestsController,
    InquiriesController,
    RequestAttachmentsController,
    InquiryReferralsController,
    ProviderReferralsController,
    MyReferralsController,
    FleetReferralsController,
  ],
  providers: [RequestsService, AttachmentsService, ReferralsService],
})
export class RequestsModule {}

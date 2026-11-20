import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { VerificationModule } from "../verification/index.js";
import {
  CatalogController,
  HoursController,
  ProviderProfileController,
  PublicProvidersController,
} from "./providers.controller.js";
import { CatalogService } from "./catalog.service.js";
import { HoursService } from "./hours.service.js";
import { ProviderProfilesService } from "./provider-profiles.service.js";

/** Provider profiles: setup wizard, publication and public views (SRS J4, ADR-0017); catalog and opening hours (ADR-0018). */
@Module({
  imports: [OrganizationsModule, VerificationModule],
  controllers: [
    ProviderProfileController,
    CatalogController,
    HoursController,
    PublicProvidersController,
  ],
  providers: [ProviderProfilesService, CatalogService, HoursService],
  exports: [ProviderProfilesService, HoursService],
})
export class ProvidersModule {}

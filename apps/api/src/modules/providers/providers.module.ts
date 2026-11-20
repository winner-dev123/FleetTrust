import { Module } from "@nestjs/common";

import { OrganizationsModule } from "../organizations/index.js";
import { VerificationModule } from "../verification/index.js";
import { ProviderProfileController, PublicProvidersController } from "./providers.controller.js";
import { ProviderProfilesService } from "./provider-profiles.service.js";

/** Provider profiles: setup wizard, publication and public views (SRS J4, ADR-0017). */
@Module({
  imports: [OrganizationsModule, VerificationModule],
  controllers: [ProviderProfileController, PublicProvidersController],
  providers: [ProviderProfilesService],
  exports: [ProviderProfilesService],
})
export class ProvidersModule {}

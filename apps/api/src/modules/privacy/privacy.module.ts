import { Module } from "@nestjs/common";

import { VerificationModule } from "../verification/index.js";

import { PrivacyController } from "./privacy.controller.js";
import { PrivacyService } from "./privacy.service.js";
import { RetentionJob, RetentionService } from "./retention.service.js";

/** Consent, data export, account deletion and data retention (Prompt 27, ADR-0034). */
@Module({
  imports: [VerificationModule],
  controllers: [PrivacyController],
  providers: [PrivacyService, RetentionService, RetentionJob],
  exports: [RetentionService],
})
export class PrivacyModule {}

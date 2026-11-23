import { Module } from "@nestjs/common";

import { ModerationController, ReportsController } from "./moderation.controller.js";
import { ModerationService } from "./moderation.service.js";

/**
 * Reports and the trust and safety queue (SRS J9): articles and comments (ADR-0022), groups and
 * members (ADR-0023). Every decision is append-only and audited.
 */
@Module({
  controllers: [ReportsController, ModerationController],
  providers: [ModerationService],
  exports: [ModerationService],
})
export class ModerationModule {}

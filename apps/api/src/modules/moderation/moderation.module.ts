import { Module } from "@nestjs/common";

import { PowerUserModule } from "../power-user/index.js";
import { AppealsService } from "./appeals.service.js";
import { ModerationController, ReportsController } from "./moderation.controller.js";
import { ModerationService } from "./moderation.service.js";
import { SanctionsService } from "./sanctions.service.js";
import { TrustDashboardService } from "./trust-dashboard.service.js";
import {
  MyModerationController,
  TrustDashboardController,
  TrustModerationController,
} from "./trust.controller.js";

/**
 * Reports and the trust and safety queue (SRS J9): articles and comments (ADR-0022), groups and
 * members (ADR-0023), jobs (ADR-0029); member sanctions, appeals and the shared dashboard
 * (ADR-0030). Every decision is append-only and audited.
 */
@Module({
  imports: [PowerUserModule],
  controllers: [
    ReportsController,
    ModerationController,
    TrustModerationController,
    TrustDashboardController,
    MyModerationController,
  ],
  providers: [ModerationService, SanctionsService, AppealsService, TrustDashboardService],
  exports: [ModerationService],
})
export class ModerationModule {}

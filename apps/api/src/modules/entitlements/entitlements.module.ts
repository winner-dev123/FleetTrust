import { Module } from "@nestjs/common";

import { BillingService } from "./billing.service.js";
import { CLOCK, systemClock } from "./clock.js";
import { BillingAdminController, MyEntitlementsController } from "./entitlements.controller.js";
import { EntitlementsService } from "./entitlements.service.js";

/**
 * Plans, quotas and billing-operator actions (SRS F-010..F-013, ADR-0008). Exported for
 * modules that consume quotas. Verification, Power User, search and emergency are forbidden
 * from importing it (ADR-0009, ADR-0010; eslint.boundaries.js).
 */
@Module({
  controllers: [MyEntitlementsController, BillingAdminController],
  providers: [EntitlementsService, BillingService, { provide: CLOCK, useValue: systemClock }],
  exports: [EntitlementsService, CLOCK],
})
export class EntitlementsModule {}

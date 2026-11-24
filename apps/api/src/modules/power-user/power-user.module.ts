import { Module } from "@nestjs/common";

import { MyPowerUserController, UserStatusController } from "./power-user.controller.js";
import { PowerUserService } from "./power-user.service.js";

/**
 * Power User (SRS F-160, ADR-0030). Never imports plans or entitlements (ADR-0009 lint rule):
 * the status can't be bought.
 */
@Module({
  controllers: [MyPowerUserController, UserStatusController],
  providers: [PowerUserService],
  exports: [PowerUserService],
})
export class PowerUserModule {}

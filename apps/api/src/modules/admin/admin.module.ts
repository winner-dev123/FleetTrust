import { Module } from "@nestjs/common";

import {
  AdminMeController,
  AuditController,
  PublicConfigController,
  SuperAdminController,
  SupportController,
} from "./admin.controller.js";
import { AuditService, StaffService, SupportService } from "./admin.services.js";

/**
 * Admin console API (Prompt 26, ADR-0033): staff roles, feature settings, service
 * categories, audit search and support. Verification, billing and moderation actions stay in
 * their own modules; every staff route needs MFA and the right role.
 */
@Module({
  controllers: [
    PublicConfigController,
    AdminMeController,
    SuperAdminController,
    AuditController,
    SupportController,
  ],
  providers: [StaffService, AuditService, SupportService],
})
export class AdminModule {}

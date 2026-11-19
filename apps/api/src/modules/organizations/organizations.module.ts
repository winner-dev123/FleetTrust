import { Module } from "@nestjs/common";

import { InvitationsService } from "./invitations.service.js";
import { InvitationAcceptController, OrganizationsController } from "./organizations.controller.js";
import { OrganizationsService } from "./organizations.service.js";
import { TenancyGuard } from "./tenancy.js";

/**
 * Organizations bounded context: tenants, branches, memberships, invitations and roles
 * (SRS FR-02, ADR-0014). Other modules protect their tenant routes with @OrgPermission().
 */
@Module({
  controllers: [OrganizationsController, InvitationAcceptController],
  providers: [OrganizationsService, InvitationsService, TenancyGuard],
  exports: [TenancyGuard],
})
export class OrganizationsModule {}

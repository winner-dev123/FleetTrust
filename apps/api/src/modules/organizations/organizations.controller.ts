import type { User } from "@fleettrust/db";
import {
  acceptInvitationRequestSchema,
  type BranchDto,
  branchRequestSchema,
  createInvitationRequestSchema,
  createOrganizationRequestSchema,
  type CreatedInvitation,
  type EntitlementsResponse,
  type InvitationDto,
  type MemberDto,
  type MyOrganization,
  updateMemberRequestSchema,
  updateOrganizationRequestSchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  type PipeTransform,
  Post,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { EntitlementsService, subjectOfOrganization } from "../entitlements/index.js";
import { type AuthContext, CheckRevoked, CurrentAuth, CurrentUser } from "../identity/index.js";
import { notFound } from "./errors.js";
import { InvitationsService } from "./invitations.service.js";
import { toMyOrganization } from "./mappers.js";
import { OrganizationsService } from "./organizations.service.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "./tenancy.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Malformed IDs in the path are simply "not found" (no 400 that hints at the ID format). */
@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw notFound();
    return value.toLowerCase();
  }
}

/** Organizations, branches and members (SRS FR-02). Every route below `:orgId` is tenant-guarded. */
@Controller("v1/orgs")
export class OrganizationsController {
  constructor(
    private readonly organizations: OrganizationsService,
    private readonly invitations: InvitationsService,
    private readonly entitlementsService: EntitlementsService,
  ) {}

  @Post()
  @RateLimit({ name: "org-create", limit: 10, windowSeconds: 86_400, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<MyOrganization> {
    return this.organizations.create(user, parseBody(createOrganizationRequestSchema, body));
  }

  @Get()
  list(@CurrentUser() user: User): Promise<MyOrganization[]> {
    return this.organizations.listForUser(user);
  }

  @Get(":orgId")
  @OrgPermission("org.read")
  get(@CurrentTenant() access: TenantAccess): MyOrganization {
    return toMyOrganization(access.organization, access.membership);
  }

  @Patch(":orgId")
  @OrgPermission("org.update")
  update(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<MyOrganization> {
    return this.organizations.update(
      access,
      user,
      parseBody(updateOrganizationRequestSchema, body),
    );
  }

  /** Plan, limits and usage meters for the organization (SRS F-012). */
  @Get(":orgId/entitlements")
  @OrgPermission("org.read")
  entitlements(@CurrentTenant() access: TenantAccess): Promise<EntitlementsResponse> {
    return this.entitlementsService.describe(subjectOfOrganization(access.organization));
  }

  // --- Branches ---

  @Get(":orgId/branches")
  @OrgPermission("branches.read")
  listBranches(@CurrentTenant() access: TenantAccess): Promise<BranchDto[]> {
    return this.organizations.listBranches(access);
  }

  @Post(":orgId/branches")
  @OrgPermission("branches.manage")
  createBranch(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<BranchDto> {
    const { name } = parseBody(branchRequestSchema, body);
    return this.organizations.createBranch(access, user, name);
  }

  @Patch(":orgId/branches/:branchId")
  @OrgPermission("branches.manage")
  renameBranch(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
    @Body() body: unknown,
  ): Promise<BranchDto> {
    const { name } = parseBody(branchRequestSchema, body);
    return this.organizations.renameBranch(access, user, branchId, name);
  }

  @Delete(":orgId/branches/:branchId")
  @HttpCode(204)
  @OrgPermission("branches.manage")
  async deleteBranch(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
  ): Promise<void> {
    await this.organizations.deleteBranch(access, user, branchId);
  }

  // --- Members ---

  @Get(":orgId/members")
  @OrgPermission("members.read")
  listMembers(@CurrentTenant() access: TenantAccess): Promise<MemberDto[]> {
    return this.organizations.listMembers(access);
  }

  @Patch(":orgId/members/:membershipId")
  @OrgPermission("members.manage")
  @CheckRevoked()
  updateMember(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("membershipId", IdParam) membershipId: string,
    @Body() body: unknown,
  ): Promise<MemberDto> {
    return this.organizations.updateMember(
      access,
      user,
      membershipId,
      parseBody(updateMemberRequestSchema, body),
    );
  }

  /** Remove a member (members.manage), or leave: any member may delete their own membership. */
  @Delete(":orgId/members/:membershipId")
  @HttpCode(204)
  @OrgPermission("org.read")
  @CheckRevoked()
  async removeMember(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("membershipId", IdParam) membershipId: string,
  ): Promise<void> {
    await this.organizations.removeMember(access, user, membershipId);
  }

  // --- Invitations ---

  @Get(":orgId/invitations")
  @OrgPermission("invitations.manage")
  listInvitations(@CurrentTenant() access: TenantAccess): Promise<InvitationDto[]> {
    return this.invitations.listOpen(access);
  }

  @Post(":orgId/invitations")
  @OrgPermission("invitations.manage")
  @CheckRevoked()
  @RateLimit({ name: "invitation-create", limit: 50, windowSeconds: 86_400, by: "user" })
  createInvitation(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<CreatedInvitation> {
    return this.invitations.create(access, user, parseBody(createInvitationRequestSchema, body));
  }

  @Delete(":orgId/invitations/:invitationId")
  @HttpCode(204)
  @OrgPermission("invitations.manage")
  async revokeInvitation(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("invitationId", IdParam) invitationId: string,
  ): Promise<void> {
    await this.invitations.revoke(access, user, invitationId);
  }
}

/** Accepting is not tenant-scoped: the caller isn't a member yet. The token is the capability. */
@Controller("v1/invitations")
export class InvitationAcceptController {
  constructor(private readonly invitations: InvitationsService) {}

  @Post("accept")
  @HttpCode(200)
  @CheckRevoked()
  @RateLimit({ name: "invitation-accept", limit: 10, windowSeconds: 600, by: "user" })
  accept(@CurrentAuth() auth: AuthContext, @Body() body: unknown): Promise<MyOrganization> {
    const { token } = parseBody(acceptInvitationRequestSchema, body);
    return this.invitations.accept(auth, token);
  }
}

import type { User } from "@fleettrust/db";
import {
  addMediaRequestSchema,
  type BranchDto,
  branchLocationRequestSchema,
  type ProviderProfileDto,
  type PublicProviderProfile,
  updateProviderProfileRequestSchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  type PipeTransform,
  Patch,
  Post,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { ProviderProfilesService } from "./provider-profiles.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

@Injectable()
class SlugParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!/^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$/i.test(value)) {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    return value.toLowerCase();
  }
}

/** The provider setup wizard (SRS J4). Any member can read the draft; owners/admins edit and publish. */
@Controller("v1/orgs/:orgId/provider-profile")
export class ProviderProfileController {
  constructor(private readonly profiles: ProviderProfilesService) {}

  @Get()
  @OrgPermission("org.read")
  get(@CurrentTenant() access: TenantAccess): Promise<ProviderProfileDto> {
    return this.profiles.get(access);
  }

  /** Save (any subset of fields). The wizard resumes from whatever was saved. */
  @Patch()
  @OrgPermission("profile.manage")
  @RateLimit({ name: "profile-save", limit: 300, windowSeconds: 3600, by: "user" })
  update(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<ProviderProfileDto> {
    return this.profiles.update(access, user, parseBody(updateProviderProfileRequestSchema, body));
  }

  @Patch("branches/:branchId")
  @OrgPermission("profile.manage")
  updateBranch(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
    @Body() body: unknown,
  ): Promise<BranchDto> {
    return this.profiles.updateBranchLocation(
      access,
      user,
      branchId,
      parseBody(branchLocationRequestSchema, body),
    );
  }

  @Get("preview")
  @OrgPermission("org.read")
  preview(@CurrentTenant() access: TenantAccess) {
    return this.profiles.preview(access);
  }

  @Post("publish")
  @HttpCode(200)
  @OrgPermission("profile.manage")
  publish(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
  ): Promise<ProviderProfileDto> {
    return this.profiles.publish(access, user);
  }

  @Post("unpublish")
  @HttpCode(200)
  @OrgPermission("profile.manage")
  unpublish(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
  ): Promise<ProviderProfileDto> {
    return this.profiles.unpublish(access, user);
  }

  @Post("media")
  @OrgPermission("profile.manage")
  @RateLimit({ name: "profile-media", limit: 60, windowSeconds: 3600, by: "user" })
  addMedia(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ) {
    return this.profiles.addMedia(access, user, parseBody(addMediaRequestSchema, body));
  }

  @Post("media/:mediaId/complete")
  @HttpCode(200)
  @OrgPermission("profile.manage")
  completeMedia(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("mediaId", IdParam) mediaId: string,
  ) {
    return this.profiles.completeMedia(access, user, mediaId);
  }

  @Delete("media/:mediaId")
  @HttpCode(204)
  @OrgPermission("profile.manage")
  async removeMedia(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("mediaId", IdParam) mediaId: string,
  ): Promise<void> {
    await this.profiles.removeMedia(access, user, mediaId);
  }
}

/**
 * Published profiles. Visitors (no sign-in) get approximate locations and no contact details;
 * signed-in users get the full profile (OQ-11 default).
 */
@Controller("v1/providers")
export class PublicProvidersController {
  constructor(private readonly profiles: ProviderProfilesService) {}

  @Get(":slug")
  @Public()
  @RateLimit({ name: "provider-public", limit: 120, windowSeconds: 60, by: "ip" })
  visitor(@Param("slug", SlugParam) slug: string): Promise<PublicProviderProfile> {
    return this.profiles.getPublic(slug, false);
  }

  @Get(":slug/full")
  full(@Param("slug", SlugParam) slug: string): Promise<PublicProviderProfile> {
    return this.profiles.getPublic(slug, true);
  }
}

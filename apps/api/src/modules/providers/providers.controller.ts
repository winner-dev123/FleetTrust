import type { User } from "@fleettrust/db";
import {
  addMediaRequestSchema,
  type BranchDto,
  type BranchHoursDto,
  branchHoursRequestSchema,
  branchLocationRequestSchema,
  hoursExceptionRequestSchema,
  localDateSchema,
  type OfferingDto,
  offeringRequestSchema,
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
  Put,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { CatalogService } from "./catalog.service.js";
import { HoursService } from "./hours.service.js";
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

@Injectable()
class DateParam implements PipeTransform<string, string> {
  transform(value: string): string {
    return parseBody(localDateSchema, value);
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
 * Service catalog (SRS F-033, F-034). Offerings are part of the draft and go public when the
 * profile is (re)published. Branch-scoped managers may only edit offerings limited to their branch.
 */
@Controller("v1/orgs/:orgId/provider-profile/offerings")
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  @OrgPermission("org.read")
  list(@CurrentTenant() access: TenantAccess): Promise<OfferingDto[]> {
    return this.catalog.list(access);
  }

  @Post()
  @OrgPermission("catalog.manage")
  @RateLimit({ name: "catalog-save", limit: 300, windowSeconds: 3600, by: "user" })
  create(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<OfferingDto> {
    return this.catalog.create(access, user, parseBody(offeringRequestSchema, body));
  }

  @Put(":offeringId")
  @OrgPermission("catalog.manage")
  @RateLimit({ name: "catalog-save", limit: 300, windowSeconds: 3600, by: "user" })
  replace(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("offeringId", IdParam) offeringId: string,
    @Body() body: unknown,
  ): Promise<OfferingDto> {
    return this.catalog.replace(access, user, offeringId, parseBody(offeringRequestSchema, body));
  }

  @Delete(":offeringId")
  @HttpCode(204)
  @OrgPermission("catalog.manage")
  async remove(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("offeringId", IdParam) offeringId: string,
  ): Promise<void> {
    await this.catalog.remove(access, user, offeringId);
  }
}

/**
 * Opening hours and holiday exceptions per branch (SRS F-035), in the branch's local time.
 * Live: changes reach the public profile without republishing.
 */
@Controller("v1/orgs/:orgId/provider-profile/branches/:branchId/hours")
export class HoursController {
  constructor(private readonly hours: HoursService) {}

  @Get()
  @OrgPermission("org.read")
  get(
    @CurrentTenant() access: TenantAccess,
    @Param("branchId", IdParam) branchId: string,
  ): Promise<BranchHoursDto> {
    return this.hours.get(access, branchId);
  }

  @Put()
  @OrgPermission("hours.manage")
  @RateLimit({ name: "hours-save", limit: 300, windowSeconds: 3600, by: "user" })
  put(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
    @Body() body: unknown,
  ): Promise<BranchHoursDto> {
    return this.hours.put(access, user, branchId, parseBody(branchHoursRequestSchema, body));
  }

  @Put("exceptions/:date")
  @OrgPermission("hours.manage")
  @RateLimit({ name: "hours-save", limit: 300, windowSeconds: 3600, by: "user" })
  putException(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
    @Param("date", DateParam) date: string,
    @Body() body: unknown,
  ): Promise<BranchHoursDto> {
    return this.hours.putException(
      access,
      user,
      branchId,
      date,
      parseBody(hoursExceptionRequestSchema, body),
    );
  }

  @Delete("exceptions/:date")
  @HttpCode(204)
  @OrgPermission("hours.manage")
  async removeException(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("branchId", IdParam) branchId: string,
    @Param("date", DateParam) date: string,
  ): Promise<void> {
    await this.hours.removeException(access, user, branchId, date);
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

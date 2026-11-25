import type { User } from "@fleettrust/db";
import {
  type AdminMe,
  type AuditPage,
  auditQuerySchema,
  closeSupportCaseSchema,
  type FeatureSettingDto,
  grantStaffRoleSchema,
  openSupportCaseSchema,
  type PlatformStaffMemberDto,
  PROVIDER_CATEGORIES,
  type PublicConfig,
  revokeStaffRoleSchema,
  type ServiceCategoryDto,
  type SupportAccountDto,
  type SupportCaseDto,
  supportLookupSchema,
  updateFeatureSettingSchema,
  updateServiceCategorySchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Injectable,
  NotFoundException,
  Param,
  type PipeTransform,
  Post,
  Put,
  Query,
  Req,
} from "@nestjs/common";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { RateLimit } from "../../platform/rate-limit/index.js";
import { SettingsService } from "../../platform/settings/index.js";
import { parseBody } from "../../platform/validation.js";
import {
  adminMfaRequired,
  type AuthContext,
  CurrentAuth,
  CurrentUser,
  Irreversible,
  MfaNotRequired,
  PlatformRoleRequired,
  Public,
  type StaffRequest,
} from "../identity/index.js";
import { AuditService, StaffService, SupportService } from "./admin.services.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw notFound();
    return value;
  }
}

/** Public, non-sensitive client configuration (settings marked public). */
@Controller("v1")
export class PublicConfigController {
  constructor(private readonly settings: SettingsService) {}

  @Get("config")
  @Public()
  async config(): Promise<PublicConfig> {
    return { siteNotice: await this.settings.get("site.notice") };
  }

  /** Service categories in admin order, with whether new offerings may use them. */
  @Get("taxonomy")
  @Public()
  taxonomy(): Promise<ServiceCategoryDto[]> {
    return this.settings.categories();
  }
}

/**
 * Who am I as staff, and does my sign-in satisfy admin MFA? The only staff route that works
 * without MFA, so the console can ask for enrolment. Non-staff get 404.
 */
@Controller("v1/admin/me")
@PlatformRoleRequired(
  "super_admin",
  "verification_reviewer",
  "billing_operator",
  "trust_safety_moderator",
  "support_agent",
)
export class AdminMeController {
  constructor(@Inject(API_ENV) private readonly env: ApiEnv) {}

  @Get()
  @MfaNotRequired()
  me(@CurrentAuth() auth: AuthContext, @Req() request: StaffRequest): AdminMe {
    return {
      userId: auth.user.id,
      email: auth.user.email,
      roles: request.staffRoles ?? [],
      mfa: { required: adminMfaRequired(this.env), satisfied: Boolean(auth.identity.secondFactor) },
    };
  }
}

/** Super admins: staff roles, feature settings, service categories. */
@Controller("v1/admin")
@PlatformRoleRequired("super_admin")
export class SuperAdminController {
  constructor(
    private readonly staff: StaffService,
    private readonly settings: SettingsService,
  ) {}

  @Get("staff")
  listStaff(): Promise<PlatformStaffMemberDto[]> {
    return this.staff.list();
  }

  @Post("staff/grant")
  @HttpCode(200)
  @Irreversible("staff.grant")
  @RateLimit({ name: "staff-change", limit: 30, windowSeconds: 3600, by: "user" })
  grant(@CurrentUser() actor: User, @Body() body: unknown): Promise<PlatformStaffMemberDto[]> {
    const { email, role } = parseBody(grantStaffRoleSchema, body);
    return this.staff.grant(actor, email, role);
  }

  @Post("staff/revoke")
  @HttpCode(200)
  @Irreversible("staff.revoke")
  @RateLimit({ name: "staff-change", limit: 30, windowSeconds: 3600, by: "user" })
  revoke(@CurrentUser() actor: User, @Body() body: unknown): Promise<PlatformStaffMemberDto[]> {
    const { userId, role } = parseBody(revokeStaffRoleSchema, body);
    return this.staff.revoke(actor, userId, role);
  }

  @Get("features")
  features(): Promise<FeatureSettingDto[]> {
    return this.settings.list();
  }

  @Put("features/:key")
  setFeature(
    @CurrentUser() actor: User,
    @Param("key") key: string,
    @Body() body: unknown,
  ): Promise<FeatureSettingDto> {
    const { value } = parseBody(updateFeatureSettingSchema, body);
    return this.settings.set(actor.id, key, value, currentRequestContext()?.requestId);
  }

  @Get("taxonomy")
  taxonomy(): Promise<ServiceCategoryDto[]> {
    return this.settings.categories();
  }

  @Put("taxonomy/:category")
  updateCategory(
    @CurrentUser() actor: User,
    @Param("category") category: string,
    @Body() body: unknown,
  ): Promise<ServiceCategoryDto> {
    const known = PROVIDER_CATEGORIES.find((value) => value === category);
    if (!known) throw notFound();
    return this.settings.updateCategory(
      actor.id,
      known,
      parseBody(updateServiceCategorySchema, body),
      currentRequestContext()?.requestId,
    );
  }
}

/** Every staff role can search the audit log, limited to its own area (AUDIT_SCOPES). */
@Controller("v1/admin/audit")
@PlatformRoleRequired(
  "super_admin",
  "verification_reviewer",
  "billing_operator",
  "trust_safety_moderator",
  "support_agent",
)
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get()
  @RateLimit({ name: "audit-search", limit: 300, windowSeconds: 3600, by: "user" })
  search(
    @CurrentUser() actor: User,
    @Req() request: StaffRequest,
    @Query() query: Record<string, string>,
  ): Promise<AuditPage> {
    return this.audit.search(actor, request.staffRoles ?? [], parseBody(auditQuerySchema, query));
  }
}

/** Support agents: account metadata and sign-in help, through audited cases. */
@Controller("v1/admin/support")
@PlatformRoleRequired("support_agent")
export class SupportController {
  constructor(private readonly support: SupportService) {}

  @Get("accounts")
  @RateLimit({ name: "support-lookup", limit: 200, windowSeconds: 3600, by: "user" })
  lookup(
    @CurrentUser() actor: User,
    @Query() query: Record<string, string>,
  ): Promise<SupportAccountDto> {
    return this.support.lookup(actor, parseBody(supportLookupSchema, query));
  }

  @Get("cases")
  cases(@Query("status") status: string | undefined): Promise<SupportCaseDto[]> {
    return this.support.list(status === "closed" ? "closed" : "open");
  }

  @Post("cases")
  open(@CurrentUser() actor: User, @Body() body: unknown): Promise<SupportCaseDto> {
    const { userId, reason } = parseBody(openSupportCaseSchema, body);
    return this.support.open(actor, userId, reason);
  }

  @Get("cases/:id")
  get(@Param("id", IdParam) id: string): Promise<SupportCaseDto> {
    return this.support.get(id);
  }

  @Post("cases/:id/close")
  @HttpCode(200)
  close(
    @CurrentUser() actor: User,
    @Param("id", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<SupportCaseDto> {
    return this.support.close(actor, id, parseBody(closeSupportCaseSchema, body).resolution);
  }

  @Post("cases/:id/revoke-sessions")
  @HttpCode(200)
  @Irreversible("support.revoke_sessions")
  revokeSessions(
    @CurrentUser() actor: User,
    @Param("id", IdParam) id: string,
  ): Promise<SupportCaseDto> {
    return this.support.revokeSessions(actor, id);
  }

  @Post("cases/:id/send-sign-in-link")
  @HttpCode(200)
  @RateLimit({ name: "support-sign-in-link", limit: 20, windowSeconds: 3600, by: "user" })
  sendSignInLink(
    @CurrentUser() actor: User,
    @Param("id", IdParam) id: string,
  ): Promise<SupportCaseDto> {
    return this.support.sendSignInLink(actor, id);
  }
}

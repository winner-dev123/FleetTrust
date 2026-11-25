import { type Database, eq, type PlatformRole, platformStaff } from "@fleettrust/db";
import { CONFIRM_ACTION_HEADER, type IrreversibleAction } from "@fleettrust/types";
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CheckRevoked, RequireRecentLogin } from "./decorators.js";
import type { AuthenticatedRequest } from "./decorators.js";

const PLATFORM_ROLE = Symbol("platform-role");
const MFA_EXEMPT = Symbol("mfa-exempt");
const IRREVERSIBLE = Symbol("irreversible");

/** Staff roles of the caller, attached by PlatformRoleGuard for later use (audit scope). */
export interface StaffRequest extends AuthenticatedRequest {
  staffRoles?: PlatformRole[];
}

/** Admin MFA is required unless ADMIN_MFA=off, which only local and test allow. */
export function adminMfaRequired(env: ApiEnv): boolean {
  if (env.ADMIN_MFA !== undefined) return env.ADMIN_MFA === "required";
  return env.APP_ENV !== "local" && env.APP_ENV !== "test";
}

/**
 * FleetTrust staff routes (SRS §2.3). Anyone without one of the roles gets a plain 404, so the
 * staff surface isn't discoverable. Tokens are revocation-checked, and the current sign-in
 * must have used a second factor (403 `mfa_required`) unless the route is MFA-exempt (only
 * `GET /v1/admin/me`, which tells the console to ask for enrolment).
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    const roles = this.reflector.getAllAndOverride<readonly PlatformRole[] | undefined>(
      PLATFORM_ROLE,
      targets,
    );
    if (roles === undefined || roles.length === 0) {
      throw new Error("PlatformRoleGuard used without @PlatformRoleRequired()");
    }
    const request = context.switchToHttp().getRequest<StaffRequest>();
    const auth = request.auth;
    if (!auth) throw new Error("PlatformRoleGuard ran before authentication");
    const db: Database | undefined = this.database?.db;
    if (!db) throw new Error("DATABASE_URL is not configured");
    const held = (
      await db
        .select({ role: platformStaff.role })
        .from(platformStaff)
        .where(eq(platformStaff.userId, auth.user.id))
    ).map((row) => row.role);
    if (!held.some((role) => roles.includes(role)) || auth.user.status !== "active") {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    const exempt = this.reflector.getAllAndOverride<boolean | undefined>(MFA_EXEMPT, targets);
    if (exempt !== true && adminMfaRequired(this.env) && !auth.identity.secondFactor) {
      throw new ForbiddenException({ statusCode: 403, error: "forbidden", reason: "mfa_required" });
    }
    request.staffRoles = held;
    return true;
  }
}

/** Any one of the roles is enough (e.g. the shared trust and safety dashboard). */
export const PlatformRoleRequired = (...roles: [PlatformRole, ...PlatformRole[]]) =>
  applyDecorators(SetMetadata(PLATFORM_ROLE, roles), CheckRevoked(), UseGuards(PlatformRoleGuard));

/** Only for the route that reports MFA status to the console. */
export const MfaNotRequired = () => SetMetadata(MFA_EXEMPT, true);

/**
 * Irreversible or security-sensitive staff actions: the sign-in must be recent (10 minutes)
 * and the client must send `X-Confirm-Action: <action>` after the person confirmed it,
 * otherwise 428 `confirmation_required`. Put it after @PlatformRoleRequired.
 */
@Injectable()
export class IrreversibleGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const action = this.reflector.get<IrreversibleAction | undefined>(
      IRREVERSIBLE,
      context.getHandler(),
    );
    if (action === undefined) throw new Error("IrreversibleGuard used without @Irreversible()");
    const header = context
      .switchToHttp()
      .getRequest<
        AuthenticatedRequest & { headers: Record<string, string | string[] | undefined> }
      >().headers[CONFIRM_ACTION_HEADER.toLowerCase()];
    if (header !== action) {
      throw new HttpException(
        {
          statusCode: 428,
          error: "precondition_required",
          reason: "confirmation_required",
          action,
        },
        428,
      );
    }
    return true;
  }
}

export const Irreversible = (action: IrreversibleAction) =>
  applyDecorators(
    SetMetadata(IRREVERSIBLE, action),
    RequireRecentLogin(600),
    UseGuards(IrreversibleGuard),
  );

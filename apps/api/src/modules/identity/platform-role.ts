import { and, type Database, eq, inArray, type PlatformRole, platformStaff } from "@fleettrust/db";
import {
  applyDecorators,
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  NotFoundException,
  SetMetadata,
  UseGuards,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CheckRevoked } from "./decorators.js";
import type { AuthenticatedRequest } from "./decorators.js";

const PLATFORM_ROLE = Symbol("platform-role");

/**
 * FleetTrust staff routes (SRS §2.4). Anyone without the role gets a plain 404, so the staff
 * surface isn't discoverable. Tokens are revocation-checked. MFA for staff comes with the
 * admin console (Prompt 26).
 */
@Injectable()
export class PlatformRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(DATABASE) private readonly database: DatabaseProvider,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const roles = this.reflector.getAllAndOverride<readonly PlatformRole[] | undefined>(
      PLATFORM_ROLE,
      [context.getHandler(), context.getClass()],
    );
    if (roles === undefined || roles.length === 0) {
      throw new Error("PlatformRoleGuard used without @PlatformRoleRequired()");
    }
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
    if (!user) throw new Error("PlatformRoleGuard ran before authentication");
    const db: Database | undefined = this.database?.db;
    if (!db) throw new Error("DATABASE_URL is not configured");
    const [row] = await db
      .select({ role: platformStaff.role })
      .from(platformStaff)
      .where(and(eq(platformStaff.userId, user.id), inArray(platformStaff.role, [...roles])))
      .limit(1);
    if (!row || user.status !== "active") {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    return true;
  }
}

/** Any one of the roles is enough (e.g. the shared trust and safety dashboard). */
export const PlatformRoleRequired = (...roles: [PlatformRole, ...PlatformRole[]]) =>
  applyDecorators(SetMetadata(PLATFORM_ROLE, roles), CheckRevoked(), UseGuards(PlatformRoleGuard));

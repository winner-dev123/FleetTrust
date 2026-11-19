import { and, type Database, eq, type PlatformRole, platformStaff } from "@fleettrust/db";
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
    const role = this.reflector.getAllAndOverride<PlatformRole | undefined>(PLATFORM_ROLE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (role === undefined) throw new Error("PlatformRoleGuard used without @PlatformRole()");
    const user = context.switchToHttp().getRequest<AuthenticatedRequest>().auth?.user;
    if (!user) throw new Error("PlatformRoleGuard ran before authentication");
    const db: Database | undefined = this.database?.db;
    if (!db) throw new Error("DATABASE_URL is not configured");
    const [row] = await db
      .select({ role: platformStaff.role })
      .from(platformStaff)
      .where(and(eq(platformStaff.userId, user.id), eq(platformStaff.role, role)))
      .limit(1);
    if (!row || user.status !== "active") {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    return true;
  }
}

export const PlatformRoleRequired = (role: PlatformRole) =>
  applyDecorators(SetMetadata(PLATFORM_ROLE, role), CheckRevoked(), UseGuards(PlatformRoleGuard));

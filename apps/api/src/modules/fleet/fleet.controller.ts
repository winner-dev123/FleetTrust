import type { User } from "@fleettrust/db";
import {
  createFleetIncidentSchema,
  dashboardQuerySchema,
  type ExpenseDto,
  expenseQuerySchema,
  expenseRequestSchema,
  type FleetDashboardDto,
  type FleetIncidentDto,
  fleetIncidentQuerySchema,
  type PreferredProviderDto,
  preferredProviderRequestSchema,
  updateFleetIncidentSchema,
  updatePreferredProviderSchema,
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
  Patch,
  type PipeTransform,
  Post,
  Put,
  Query,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { DashboardService } from "./dashboard.service.js";
import { FleetService } from "./fleet.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const WRITE_LIMIT = { name: "fleet-write", limit: 600, windowSeconds: 3600, by: "user" } as const;

/**
 * Fleet operations (SRS J5, F-150..F-152). Dashboards need `vehicles.manage`. Incidents and
 * spending: managers in their branch scope, and the driver assigned to the vehicle (checked per
 * vehicle in the service). Recruiters and other members get 403 or 404.
 */
@Controller("v1/orgs/:orgId/fleet")
export class FleetController {
  constructor(
    private readonly fleet: FleetService,
    private readonly dashboards: DashboardService,
  ) {}

  @Get("dashboard")
  @OrgPermission("vehicles.manage")
  dashboard(
    @CurrentTenant() access: TenantAccess,
    @Query() query: unknown,
  ): Promise<FleetDashboardDto> {
    return this.dashboards.dashboard(access, parseBody(dashboardQuerySchema, query));
  }

  @Get("incidents")
  @OrgPermission("org.read")
  incidents(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ): Promise<FleetIncidentDto[]> {
    return this.fleet.incidents(access, user, parseBody(fleetIncidentQuerySchema, query));
  }

  @Post("incidents")
  @OrgPermission("org.read")
  @RateLimit(WRITE_LIMIT)
  reportIncident(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<FleetIncidentDto> {
    return this.fleet.createIncident(access, user, parseBody(createFleetIncidentSchema, body));
  }

  @Get("incidents/:incidentId")
  @OrgPermission("org.read")
  incident(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) incidentId: string,
  ): Promise<FleetIncidentDto> {
    return this.fleet.incident(access, user, incidentId);
  }

  @Patch("incidents/:incidentId")
  @OrgPermission("vehicles.manage")
  updateIncident(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) incidentId: string,
    @Body() body: unknown,
  ): Promise<FleetIncidentDto> {
    return this.fleet.updateIncident(
      access,
      user,
      incidentId,
      parseBody(updateFleetIncidentSchema, body),
    );
  }

  @Get("expenses")
  @OrgPermission("org.read")
  expenses(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ): Promise<ExpenseDto[]> {
    return this.fleet.expenses(access, user, parseBody(expenseQuerySchema, query));
  }

  @Post("expenses")
  @OrgPermission("org.read")
  @RateLimit(WRITE_LIMIT)
  createExpense(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<ExpenseDto> {
    return this.fleet.createExpense(access, user, parseBody(expenseRequestSchema, body));
  }

  @Get("expenses/:expenseId")
  @OrgPermission("org.read")
  expense(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("expenseId", IdParam) expenseId: string,
  ): Promise<ExpenseDto> {
    return this.fleet.expense(access, user, expenseId);
  }

  @Put("expenses/:expenseId")
  @OrgPermission("org.read")
  @RateLimit(WRITE_LIMIT)
  replaceExpense(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("expenseId", IdParam) expenseId: string,
    @Body() body: unknown,
  ): Promise<ExpenseDto> {
    return this.fleet.replaceExpense(
      access,
      user,
      expenseId,
      parseBody(expenseRequestSchema, body),
    );
  }

  @Delete("expenses/:expenseId")
  @HttpCode(204)
  @OrgPermission("org.read")
  async removeExpense(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("expenseId", IdParam) expenseId: string,
  ): Promise<void> {
    await this.fleet.removeExpense(access, user, expenseId);
  }

  /** Everyone who raises requests sees the list; `requests.manage` edits it. */
  @Get("preferred-providers")
  @OrgPermission("requests.create")
  preferred(@CurrentTenant() access: TenantAccess): Promise<PreferredProviderDto[]> {
    return this.fleet.preferred(access);
  }

  @Post("preferred-providers")
  @OrgPermission("requests.manage")
  @RateLimit(WRITE_LIMIT)
  addPreferred(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<PreferredProviderDto[]> {
    return this.fleet.addPreferred(access, user, parseBody(preferredProviderRequestSchema, body));
  }

  @Patch("preferred-providers/:entryId")
  @OrgPermission("requests.manage")
  updatePreferred(
    @CurrentTenant() access: TenantAccess,
    @Param("entryId", IdParam) entryId: string,
    @Body() body: unknown,
  ): Promise<PreferredProviderDto[]> {
    return this.fleet.updatePreferred(
      access,
      entryId,
      parseBody(updatePreferredProviderSchema, body),
    );
  }

  @Delete("preferred-providers/:entryId")
  @HttpCode(204)
  @OrgPermission("requests.manage")
  async removePreferred(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("entryId", IdParam) entryId: string,
  ): Promise<void> {
    await this.fleet.removePreferred(access, user, entryId);
  }
}

/** A provider's own count of fleets that prefer it (never which ones). */
@Controller("v1/orgs/:orgId/preferred-by")
export class PreferredByController {
  constructor(private readonly fleet: FleetService) {}

  @Get()
  @OrgPermission("org.read")
  count(@CurrentTenant() access: TenantAccess): Promise<{ fleets: number }> {
    return this.fleet.preferredByCount(access);
  }
}

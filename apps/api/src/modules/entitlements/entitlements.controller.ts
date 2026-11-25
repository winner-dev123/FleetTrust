import type { User } from "@fleettrust/db";
import {
  assignPlanRequestSchema,
  type BillingAccount,
  endAssignmentRequestSchema,
  type EntitlementsResponse,
  type PlanAssignmentDto,
  type PlanDto,
  type QuotaOverrideDto,
  setOverrideRequestSchema,
  subjectTypeSchema,
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
  Post,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Irreversible, PlatformRoleRequired } from "../identity/index.js";
import { BillingService } from "./billing.service.js";
import { EntitlementsService, subjectOfUser } from "./entitlements.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

@Injectable()
class SubjectTypeParam implements PipeTransform<string, "user" | "organization"> {
  transform(value: string): "user" | "organization" {
    const parsed = subjectTypeSchema.safeParse(
      value === "organizations" ? "organization" : value === "users" ? "user" : "",
    );
    if (!parsed.success) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return parsed.data;
  }
}

/** The signed-in user's personal plan and usage meters (SRS F-012). */
@Controller("v1/me/entitlements")
export class MyEntitlementsController {
  constructor(private readonly entitlements: EntitlementsService) {}

  @Get()
  get(@CurrentUser() user: User): Promise<EntitlementsResponse> {
    return this.entitlements.describe(subjectOfUser(user));
  }
}

/**
 * Billing operators (ADR-0008, SRS J6). Not discoverable: non-staff get 404. Plan assignment
 * follows external billing confirmation; the API never takes or verifies payments.
 */
@Controller("v1/admin/billing")
@PlatformRoleRequired("billing_operator")
export class BillingAdminController {
  constructor(private readonly billing: BillingService) {}

  @Get("plans")
  plans(): Promise<PlanDto[]> {
    return this.billing.catalog();
  }

  /** `/v1/admin/billing/organizations/:id` or `/v1/admin/billing/users/:id`. */
  @Get(":subjectType/:id")
  account(
    @Param("subjectType", SubjectTypeParam) type: "user" | "organization",
    @Param("id", IdParam) id: string,
  ): Promise<BillingAccount> {
    return this.billing.account(type, id);
  }

  @Post("assignments")
  @RateLimit({ name: "billing-assign", limit: 100, windowSeconds: 3600, by: "user" })
  assign(@CurrentUser() actor: User, @Body() body: unknown): Promise<PlanAssignmentDto> {
    return this.billing.assign(actor, parseBody(assignPlanRequestSchema, body));
  }

  @Post("assignments/:id/end")
  @HttpCode(204)
  @Irreversible("plan.end_assignment")
  async end(
    @CurrentUser() actor: User,
    @Param("id", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { note } = parseBody(endAssignmentRequestSchema, body ?? {});
    await this.billing.endAssignment(actor, id, note);
  }

  @Post("overrides")
  @RateLimit({ name: "billing-override", limit: 100, windowSeconds: 3600, by: "user" })
  setOverride(@CurrentUser() actor: User, @Body() body: unknown): Promise<QuotaOverrideDto> {
    return this.billing.setOverride(actor, parseBody(setOverrideRequestSchema, body));
  }

  @Delete("overrides/:id")
  @HttpCode(204)
  async revokeOverride(
    @CurrentUser() actor: User,
    @Param("id", IdParam) id: string,
  ): Promise<void> {
    await this.billing.revokeOverride(actor, id);
  }
}

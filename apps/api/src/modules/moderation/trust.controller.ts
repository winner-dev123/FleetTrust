import type { User } from "@fleettrust/db";
import {
  type MemberHistoryDto,
  type ModerationAppealDto,
  moderationAppealDecisionSchema,
  moderationAppealQuerySchema,
  moderationAppealRequestSchema,
  moderationReasonSchema,
  type SanctionDto,
  sanctionRequestSchema,
  type TrustDashboardDto,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  type PipeTransform,
  Post,
  Query,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { AllowSuspended, CurrentUser, PlatformRoleRequired } from "../identity/index.js";
import { PowerUserService, trustError } from "../power-user/index.js";
import { AppealsService } from "./appeals.service.js";
import { ModerationService } from "./moderation.service.js";
import { SanctionsService } from "./sanctions.service.js";
import { TrustDashboardService } from "./trust-dashboard.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const reasonOf = (body: unknown) => parseBody(moderationReasonSchema, body).reason;

/** Member sanctions, Power User revocation, appeals and member history (trust and safety moderators). */
@Controller("v1/moderation")
@PlatformRoleRequired("trust_safety_moderator")
export class TrustModerationController {
  constructor(
    private readonly sanctions: SanctionsService,
    private readonly appeals: AppealsService,
    private readonly dashboards: TrustDashboardService,
    private readonly powerUsers: PowerUserService,
    private readonly moderation: ModerationService,
  ) {}

  @Post("users/:id/sanctions")
  sanction(
    @CurrentUser() moderator: User,
    @Param("id", IdParam) userId: string,
    @Body() body: unknown,
  ): Promise<SanctionDto> {
    return this.sanctions.sanction(moderator, userId, parseBody(sanctionRequestSchema, body));
  }

  @Post("sanctions/:id/lift")
  @HttpCode(200)
  lift(
    @CurrentUser() moderator: User,
    @Param("id", IdParam) sanctionId: string,
    @Body() body: unknown,
  ): Promise<SanctionDto> {
    return this.sanctions.lift(moderator, sanctionId, reasonOf(body));
  }

  @Post("power-users/:id/revoke")
  @HttpCode(200)
  async revokePowerUser(
    @CurrentUser() moderator: User,
    @Param("id", IdParam) userId: string,
    @Body() body: unknown,
  ): Promise<MemberHistoryDto> {
    const reason = reasonOf(body);
    if (userId === moderator.id) throw trustError("own_account");
    await this.moderation.withTransaction(async (tx) => {
      if (!(await this.powerUsers.revoke(tx, moderator, userId, reason))) {
        throw trustError("not_revocable");
      }
      await this.moderation.record(tx, moderator, "user", userId, "revoke_power_user", reason, {});
    });
    return this.dashboards.memberHistory(userId);
  }

  @Get("users/:id/history")
  history(@Param("id", IdParam) userId: string): Promise<MemberHistoryDto> {
    return this.dashboards.memberHistory(userId);
  }

  @Get("appeals")
  listAppeals(@Query() query: unknown): Promise<ModerationAppealDto[]> {
    return this.appeals.list(parseBody(moderationAppealQuerySchema, query));
  }

  @Post("appeals/:id/decide")
  @HttpCode(200)
  decide(
    @CurrentUser() moderator: User,
    @Param("id", IdParam) appealId: string,
    @Body() body: unknown,
  ): Promise<ModerationAppealDto> {
    return this.appeals.decide(
      moderator,
      appealId,
      parseBody(moderationAppealDecisionSchema, body),
    );
  }
}

/** The shared trust and safety dashboard: moderators and verification reviewers (SRS F-161). */
@Controller("v1/trust-safety")
@PlatformRoleRequired("trust_safety_moderator", "verification_reviewer")
export class TrustDashboardController {
  constructor(private readonly dashboards: TrustDashboardService) {}

  @Get("dashboard")
  dashboard(): Promise<TrustDashboardDto> {
    return this.dashboards.dashboard();
  }
}

/** A member's own sanctions and appeals. Reachable while suspended, so a suspension can be appealed. */
@Controller("v1/me")
export class MyModerationController {
  constructor(
    private readonly sanctions: SanctionsService,
    private readonly appeals: AppealsService,
  ) {}

  @Get("sanctions")
  @AllowSuspended()
  mySanctions(@CurrentUser() user: User): Promise<SanctionDto[]> {
    return this.sanctions.forUser(user.id);
  }

  @Get("appeals")
  @AllowSuspended()
  myAppeals(@CurrentUser() user: User): Promise<ModerationAppealDto[]> {
    return this.appeals.mine(user);
  }

  @Post("appeals")
  @AllowSuspended()
  @RateLimit({ name: "moderation-appeal", limit: 10, windowSeconds: 86_400, by: "user" })
  appeal(@CurrentUser() user: User, @Body() body: unknown): Promise<ModerationAppealDto> {
    return this.appeals.file(user, parseBody(moderationAppealRequestSchema, body));
  }
}

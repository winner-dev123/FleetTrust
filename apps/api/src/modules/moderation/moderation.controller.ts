import type { User } from "@fleettrust/db";
import {
  createReportSchema,
  type ModerationCase,
  type ModerationQueueItem,
  moderationReasonSchema,
  optionalModerationReasonSchema,
  type ReportTargetType,
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
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, PlatformRoleRequired } from "../identity/index.js";
import { ModerationService, type VisibilityDecision } from "./moderation.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const required = (body: unknown) => parseBody(moderationReasonSchema, body).reason;
const optional = (body: unknown) => parseBody(optionalModerationReasonSchema, body ?? {}).reason;

/** Reports from any signed-in user land in the trust and safety queue (SRS J9). */
@Controller("v1/reports")
export class ReportsController {
  constructor(private readonly moderation: ModerationService) {}

  @Post()
  @RateLimit({ name: "content-report", limit: 20, windowSeconds: 86_400, by: "user" })
  create(
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<{ id: string; status: "open" }> {
    return this.moderation.report(user, parseBody(createReportSchema, body));
  }
}

/** Trust and safety console API (platform role trust_safety_moderator; 404 for everyone else). */
@Controller("v1/moderation")
@PlatformRoleRequired("trust_safety_moderator")
export class ModerationController {
  constructor(private readonly moderation: ModerationService) {}

  @Get("queue")
  queue(): Promise<ModerationQueueItem[]> {
    return this.moderation.queue();
  }

  @Get("articles/:id")
  article(@Param("id", IdParam) id: string): Promise<ModerationCase> {
    return this.moderation.case("article", id);
  }

  @Get("comments/:id")
  comment(@Param("id", IdParam) id: string): Promise<ModerationCase> {
    return this.moderation.case("article_comment", id);
  }

  @Get("groups/:id")
  group(@Param("id", IdParam) id: string): Promise<ModerationCase> {
    return this.moderation.case("group", id);
  }

  @Get("users/:id")
  member(@Param("id", IdParam) id: string): Promise<ModerationCase> {
    return this.moderation.case("user", id);
  }

  /** Reported message (audited view: it's private conversation content). */
  @Get("messages/:id")
  message(@CurrentUser() u: User, @Param("id", IdParam) id: string): Promise<ModerationCase> {
    return this.moderation.viewCase(u, "message", id);
  }

  @Post("articles/:id/approve")
  @HttpCode(200)
  approve(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.moderation.decideArticle(u, id, "approve", optional(b));
  }

  @Post("articles/:id/reject")
  @HttpCode(200)
  reject(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.moderation.decideArticle(u, id, "reject", required(b));
  }

  @Post("articles/:id/hide")
  @HttpCode(200)
  hideArticle(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.moderation.decideArticle(u, id, "hide", required(b));
  }

  @Post("articles/:id/restore")
  @HttpCode(200)
  restoreArticle(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.moderation.decideArticle(u, id, "restore", optional(b));
  }

  private visibility(
    u: User,
    type: "article_comment" | "group" | "message",
    id: string,
    decision: VisibilityDecision,
    b: unknown,
  ) {
    return this.moderation.decideVisibility(
      u,
      type,
      id,
      decision,
      decision === "hide" ? required(b) : optional(b),
    );
  }

  @Post("comments/:id/hide")
  @HttpCode(200)
  hideComment(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "article_comment", id, "hide", b);
  }

  @Post("comments/:id/restore")
  @HttpCode(200)
  restoreComment(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "article_comment", id, "restore", b);
  }

  @Post("groups/:id/hide")
  @HttpCode(200)
  hideGroup(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "group", id, "hide", b);
  }

  @Post("groups/:id/restore")
  @HttpCode(200)
  restoreGroup(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "group", id, "restore", b);
  }

  @Post("messages/:id/hide")
  @HttpCode(200)
  hideMessage(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "message", id, "hide", b);
  }

  @Post("messages/:id/restore")
  @HttpCode(200)
  restoreMessage(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.visibility(u, "message", id, "restore", b);
  }

  @Post("messages/:id/dismiss-reports")
  @HttpCode(200)
  dismissMessage(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.dismiss(u, "message", id, b);
  }

  private dismiss(u: User, type: ReportTargetType, id: string, b: unknown) {
    return this.moderation.dismissReports(u, type, id, optional(b));
  }

  @Post("articles/:id/dismiss-reports")
  @HttpCode(200)
  dismissArticle(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.dismiss(u, "article", id, b);
  }

  @Post("comments/:id/dismiss-reports")
  @HttpCode(200)
  dismissComment(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.dismiss(u, "article_comment", id, b);
  }

  @Post("groups/:id/dismiss-reports")
  @HttpCode(200)
  dismissGroup(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.dismiss(u, "group", id, b);
  }

  @Post("users/:id/dismiss-reports")
  @HttpCode(200)
  dismissUser(@CurrentUser() u: User, @Param("id", IdParam) id: string, @Body() b: unknown) {
    return this.dismiss(u, "user", id, b);
  }
}

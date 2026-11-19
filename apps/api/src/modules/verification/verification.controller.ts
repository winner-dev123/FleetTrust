import type { ServerResponse } from "node:http";

import type { User } from "@fleettrust/db";
import {
  addDocumentRequestSchema,
  appealDecisionRequestSchema,
  appealRequestSchema,
  type BadgeDto,
  caseStatusSchema,
  type DocumentUpload,
  openCaseRequestSchema,
  type ReviewAppealDto,
  type ReviewCaseDto,
  reviewDecisionRequestSchema,
  revokeBadgeRequestSchema,
  type VerificationCaseDto,
  type VerificationLabels,
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
  Res,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, PlatformRoleRequired, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { ReviewService } from "./review.service.js";
import { verificationError } from "./shared.js";
import { VerificationService } from "./verification.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** Personal (driver) verification. */
@Controller("v1/me/verification")
export class MyVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post("cases")
  @RateLimit({ name: "verification-open", limit: 10, windowSeconds: 86_400, by: "user" })
  open(@CurrentUser() user: User, @Body() body: unknown): Promise<VerificationCaseDto> {
    const { badgeType } = parseBody(openCaseRequestSchema.omit({ organizationId: true }), body);
    return this.verification.openCase(user, { type: "user", id: user.id }, badgeType);
  }

  @Get("cases")
  cases(@CurrentUser() user: User): Promise<VerificationCaseDto[]> {
    return this.verification.listCases({ type: "user", id: user.id });
  }

  @Get("badges")
  badges(@CurrentUser() user: User): Promise<BadgeDto[]> {
    return this.verification.listBadges({ type: "user", id: user.id });
  }
}

/** Organization (business / location) verification. */
@Controller("v1/orgs/:orgId/verification")
export class OrgVerificationController {
  constructor(private readonly verification: VerificationService) {}

  @Post("cases")
  @OrgPermission("verification.manage")
  @RateLimit({ name: "verification-open", limit: 10, windowSeconds: 86_400, by: "user" })
  open(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<VerificationCaseDto> {
    const { badgeType } = parseBody(openCaseRequestSchema.omit({ organizationId: true }), body);
    return this.verification.openCase(
      user,
      { type: "organization", id: access.tenant.organizationId },
      badgeType,
    );
  }

  @Get("cases")
  @OrgPermission("verification.manage")
  cases(@CurrentTenant() access: TenantAccess): Promise<VerificationCaseDto[]> {
    return this.verification.listCases({ type: "organization", id: access.tenant.organizationId });
  }

  @Get("badges")
  @OrgPermission("org.read")
  badges(@CurrentTenant() access: TenantAccess): Promise<BadgeDto[]> {
    return this.verification.listBadges({ type: "organization", id: access.tenant.organizationId });
  }
}

/** Case actions; access is checked per case (the person, or verification.manage in the org). */
@Controller("v1/verification")
export class VerificationCaseController {
  constructor(private readonly verification: VerificationService) {}

  @Get("cases/:caseId")
  get(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
  ): Promise<VerificationCaseDto> {
    return this.verification.getCase(user, caseId);
  }

  @Post("cases/:caseId/documents")
  @RateLimit({ name: "verification-upload", limit: 30, windowSeconds: 3600, by: "user" })
  addDocument(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
    @Body() body: unknown,
  ): Promise<DocumentUpload> {
    return this.verification.addDocument(user, caseId, parseBody(addDocumentRequestSchema, body));
  }

  @Post("cases/:caseId/documents/:documentId/complete")
  @HttpCode(200)
  complete(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
    @Param("documentId", IdParam) documentId: string,
  ): Promise<VerificationCaseDto> {
    return this.verification.completeUpload(user, caseId, documentId);
  }

  @Post("cases/:caseId/submit")
  @HttpCode(200)
  submit(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
  ): Promise<VerificationCaseDto> {
    return this.verification.submit(user, caseId);
  }

  @Post("cases/:caseId/withdraw")
  @HttpCode(204)
  async withdraw(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
  ): Promise<void> {
    await this.verification.withdraw(user, caseId);
  }

  @Post("cases/:caseId/appeal")
  @HttpCode(200)
  @RateLimit({ name: "verification-appeal", limit: 5, windowSeconds: 86_400, by: "user" })
  appealCase(
    @CurrentUser() user: User,
    @Param("caseId", IdParam) caseId: string,
    @Body() body: unknown,
  ): Promise<VerificationCaseDto> {
    return this.verification.appealCase(
      user,
      caseId,
      parseBody(appealRequestSchema, body).statement,
    );
  }

  @Post("badges/:badgeId/appeal")
  @HttpCode(200)
  @RateLimit({ name: "verification-appeal", limit: 5, windowSeconds: 86_400, by: "user" })
  appealBadge(
    @CurrentUser() user: User,
    @Param("badgeId", IdParam) badgeId: string,
    @Body() body: unknown,
  ): Promise<BadgeDto> {
    return this.verification.appealBadge(
      user,
      badgeId,
      parseBody(appealRequestSchema, body).statement,
    );
  }

  /** Trust labels for a person or organization: verified/unverified per badge type only. */
  @Get("labels/:subjectType/:id")
  labels(
    @Param("subjectType") subjectType: string,
    @Param("id", IdParam) id: string,
  ): Promise<VerificationLabels> {
    if (subjectType === "users") return this.verification.labels({ type: "user", id });
    if (subjectType === "organizations")
      return this.verification.labels({ type: "organization", id });
    throw new NotFoundException({ statusCode: 404, error: "not_found" });
  }
}

/** Reviewer console API (platform role verification_reviewer; 404 for everyone else). */
@Controller("v1/admin/verification")
@PlatformRoleRequired("verification_reviewer")
export class ReviewController {
  constructor(private readonly review: ReviewService) {}

  @Get("cases")
  queue(@Query("status") status: string | undefined): Promise<ReviewCaseDto[]> {
    const parsed = caseStatusSchema.safeParse(status ?? "submitted");
    if (!parsed.success) throw verificationError(400, "case_not_editable");
    return this.review.queue(parsed.data);
  }

  @Get("cases/:caseId")
  get(@Param("caseId", IdParam) caseId: string): Promise<ReviewCaseDto> {
    return this.review.getCase(caseId);
  }

  @Post("cases/:caseId/decision")
  @HttpCode(200)
  decide(
    @CurrentUser() reviewer: User,
    @Param("caseId", IdParam) caseId: string,
    @Body() body: unknown,
  ): Promise<ReviewCaseDto> {
    return this.review.decide(reviewer, caseId, parseBody(reviewDecisionRequestSchema, body));
  }

  @Post("documents/:documentId/access")
  @HttpCode(200)
  @RateLimit({ name: "document-access", limit: 120, windowSeconds: 3600, by: "user" })
  access(
    @CurrentUser() reviewer: User,
    @Param("documentId", IdParam) documentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.review.grantDocumentAccess(reviewer, documentId);
  }

  @Post("badges/:badgeId/revoke")
  @HttpCode(204)
  async revoke(
    @CurrentUser() reviewer: User,
    @Param("badgeId", IdParam) badgeId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.review.revokeBadge(
      reviewer,
      badgeId,
      parseBody(revokeBadgeRequestSchema, body).reason,
    );
  }

  @Get("appeals")
  appeals(@Query("status") status: string | undefined): Promise<ReviewAppealDto[]> {
    const value = status ?? "open";
    if (value !== "open" && value !== "upheld" && value !== "overturned") {
      throw verificationError(400, "not_appealable");
    }
    return this.review.appeals(value);
  }

  @Post("appeals/:appealId/decision")
  @HttpCode(200)
  decideAppeal(
    @CurrentUser() reviewer: User,
    @Param("appealId", IdParam) appealId: string,
    @Body() body: unknown,
  ): Promise<ReviewAppealDto> {
    const { decision, reason } = parseBody(appealDecisionRequestSchema, body);
    return this.review.decideAppeal(reviewer, appealId, decision, reason);
  }

  /** Runs the retention purge now (until the jobs runtime schedules it daily). */
  @Post("purge")
  @HttpCode(200)
  async purge(@CurrentUser() reviewer: User): Promise<{ purged: number }> {
    return { purged: await this.review.purgeExpiredDocuments(reviewer) };
  }
}

/**
 * Redeems a one-time document link. Public route: the 256-bit, single-use, five-minute token
 * is the capability (an <img> or new tab can't send a bearer token). Served with headers that
 * stop caching, sniffing, framing and script execution.
 */
@Controller("v1/admin/verification/document-access")
export class DocumentAccessController {
  constructor(private readonly review: ReviewService) {}

  @Get(":token")
  @Public()
  async fetch(@Param("token") token: string, @Res() response: ServerResponse): Promise<void> {
    const { data, contentType } = await this.review.redeemDocumentAccess(token);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Content-Disposition": 'inline; filename="document"',
      "Cache-Control": "no-store, private",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; img-src 'self'; object-src 'self'; sandbox",
      "Referrer-Policy": "no-referrer",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(data);
  }
}

import type { ServerResponse } from "node:http";

import type { User } from "@fleettrust/db";
import {
  createAttachmentSchema,
  createServiceRequestSchema,
  declineSchema,
  evidenceSchema,
  providerServiceRecordSchema,
  type InquiryDto,
  reasonSchema,
  type ServiceRequestDto,
  submitQuoteSchema,
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
  Res,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { AttachmentsService } from "./attachments.service.js";
import { RequestsService } from "./requests.service.js";
import type { Requester } from "./shared.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const CREATE_LIMIT = {
  name: "service-request-create",
  limit: 30,
  windowSeconds: 3600,
  by: "user",
} as const;

/** An individual's own service requests (SRS J2). */
@Controller("v1/me/service-requests")
export class MyRequestsController {
  constructor(private readonly requests: RequestsService) {}

  private me(user: User): Requester {
    return { kind: "user", user };
  }

  @Post()
  @RateLimit(CREATE_LIMIT)
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<ServiceRequestDto> {
    return this.requests.create(this.me(user), parseBody(createServiceRequestSchema, body));
  }

  @Get()
  list(@CurrentUser() user: User): Promise<ServiceRequestDto[]> {
    return this.requests.list(this.me(user));
  }

  @Get(":requestId")
  get(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) id: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.get(this.me(user), id);
  }

  @Post(":requestId/quotes/:quoteId/accept")
  @HttpCode(200)
  accept(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) id: string,
    @Param("quoteId", IdParam) quoteId: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.accept(this.me(user), id, quoteId);
  }

  @Post(":requestId/cancel")
  @HttpCode(200)
  cancel(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ServiceRequestDto> {
    return this.requests.cancel(this.me(user), id, parseBody(reasonSchema, body).reason);
  }

  @Post(":requestId/complete")
  @HttpCode(200)
  complete(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) id: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.complete(this.me(user), id);
  }

  @Post(":requestId/evidence")
  @HttpCode(200)
  evidence(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ServiceRequestDto> {
    return this.requests.requesterEvidence(this.me(user), id, parseBody(evidenceSchema, body));
  }
}

/**
 * A fleet's service requests. Drivers see their own; members with requests.manage see the
 * fleet's (branch-scoped managers: their branch). The quota used is the fleet's.
 */
@Controller("v1/orgs/:orgId/service-requests")
export class FleetRequestsController {
  constructor(private readonly requests: RequestsService) {}

  private fleet(user: User, access: TenantAccess): Requester {
    return { kind: "organization", user, access };
  }

  @Post()
  @OrgPermission("requests.create")
  @RateLimit(CREATE_LIMIT)
  create(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Body() body: unknown,
  ): Promise<ServiceRequestDto> {
    return this.requests.create(
      this.fleet(user, access),
      parseBody(createServiceRequestSchema, body),
    );
  }

  @Get()
  @OrgPermission("requests.create")
  list(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
  ): Promise<ServiceRequestDto[]> {
    return this.requests.list(this.fleet(user, access));
  }

  @Get(":requestId")
  @OrgPermission("requests.create")
  get(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) id: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.get(this.fleet(user, access), id);
  }

  @Post(":requestId/quotes/:quoteId/accept")
  @HttpCode(200)
  @OrgPermission("requests.create")
  accept(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) id: string,
    @Param("quoteId", IdParam) quoteId: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.accept(this.fleet(user, access), id, quoteId);
  }

  @Post(":requestId/cancel")
  @HttpCode(200)
  @OrgPermission("requests.create")
  cancel(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ServiceRequestDto> {
    return this.requests.cancel(this.fleet(user, access), id, parseBody(reasonSchema, body).reason);
  }

  @Post(":requestId/complete")
  @HttpCode(200)
  @OrgPermission("requests.create")
  complete(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) id: string,
  ): Promise<ServiceRequestDto> {
    return this.requests.complete(this.fleet(user, access), id);
  }

  @Post(":requestId/evidence")
  @HttpCode(200)
  @OrgPermission("requests.create")
  evidence(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ServiceRequestDto> {
    return this.requests.requesterEvidence(
      this.fleet(user, access),
      id,
      parseBody(evidenceSchema, body),
    );
  }
}

/** A provider's inquiry inbox and quotes (branch-scoped members: their branch). */
@Controller("v1/orgs/:orgId/inquiries")
export class InquiriesController {
  constructor(private readonly requests: RequestsService) {}

  @Get()
  @OrgPermission("requests.respond")
  list(@CurrentTenant() access: TenantAccess): Promise<InquiryDto[]> {
    return this.requests.inquiries(access);
  }

  @Get(":recipientId")
  @OrgPermission("requests.respond")
  get(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
  ): Promise<InquiryDto> {
    return this.requests.inquiry(access, user, id);
  }

  @Post(":recipientId/quotes")
  @OrgPermission("requests.respond")
  @RateLimit({ name: "quote-submit", limit: 120, windowSeconds: 3600, by: "user" })
  quote(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<InquiryDto> {
    return this.requests.submitQuote(access, user, id, parseBody(submitQuoteSchema, body));
  }

  @Post(":recipientId/quotes/:quoteId/withdraw")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  withdraw(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Param("quoteId", IdParam) quoteId: string,
  ): Promise<InquiryDto> {
    return this.requests.withdrawQuote(access, user, id, quoteId);
  }

  @Post(":recipientId/decline")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  decline(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<InquiryDto> {
    return this.requests.decline(access, user, id, parseBody(declineSchema, body ?? {}).reason);
  }

  @Post(":recipientId/cancel")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  cancel(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<InquiryDto> {
    return this.requests.providerCancel(access, user, id, parseBody(reasonSchema, body).reason);
  }

  @Post(":recipientId/complete")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  complete(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
  ): Promise<InquiryDto> {
    return this.requests.providerComplete(access, user, id);
  }

  /** The accepted provider adds a service record to the linked vehicle (Prompt 19). */
  @Post(":recipientId/service-record")
  @OrgPermission("requests.respond")
  serviceRecord(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) recipientId: string,
    @Body() body: unknown,
  ) {
    return this.requests.providerServiceRecord(
      access,
      user,
      recipientId,
      parseBody(providerServiceRecordSchema, body),
    );
  }

  @Post(":recipientId/evidence")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  evidence(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<InquiryDto> {
    return this.requests.providerEvidence(access, user, id, parseBody(evidenceSchema, body));
  }
}

/** Private photo uploads (before a request exists, or as evidence) and authorised downloads. */
@Controller("v1")
export class RequestAttachmentsController {
  constructor(
    private readonly attachments: AttachmentsService,
    private readonly requests: RequestsService,
  ) {}

  @Post("service-request-attachments")
  @RateLimit({ name: "request-attachment", limit: 60, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown) {
    return this.attachments.create(user, parseBody(createAttachmentSchema, body));
  }

  @Post("service-request-attachments/:attachmentId/complete")
  @HttpCode(200)
  complete(@CurrentUser() user: User, @Param("attachmentId", IdParam) id: string) {
    return this.attachments.complete(user, id);
  }

  @Get("service-requests/:requestId/attachments/:attachmentId")
  async download(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) requestId: string,
    @Param("attachmentId", IdParam) attachmentId: string,
    @Res() response: ServerResponse,
  ): Promise<void> {
    const { data, contentType } = await this.requests.attachment(user, requestId, attachmentId);
    response.writeHead(200, {
      "Content-Type": contentType,
      "Content-Length": String(data.length),
      "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
      "Cross-Origin-Resource-Policy": "same-origin",
    });
    response.end(data);
  }
}

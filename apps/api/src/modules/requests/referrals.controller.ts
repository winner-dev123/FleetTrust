import type { User } from "@fleettrust/db";
import {
  createReferralSchema,
  type ReferralDto,
  referralConsentSchema,
  referralListQuerySchema,
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
import { CurrentUser } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { ReferralsService } from "./referrals.service.js";
import type { Requester } from "./shared.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const REFER_LIMIT = {
  name: "referral-create",
  limit: 60,
  windowSeconds: 3600,
  by: "user",
} as const;

/** A provider suggests another provider for an inquiry it received (SRS F-142). */
@Controller("v1/orgs/:orgId/inquiries/:recipientId/referrals")
export class InquiryReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Post()
  @OrgPermission("requests.respond")
  @RateLimit(REFER_LIMIT)
  create(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) recipientId: string,
    @Body() body: unknown,
  ): Promise<ReferralDto> {
    return this.referrals.create(access, user, recipientId, parseBody(createReferralSchema, body));
  }
}

/** Referrals a provider sent, or received after the customer's consent. */
@Controller("v1/orgs/:orgId/referrals")
export class ProviderReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  @Get()
  @OrgPermission("requests.respond")
  list(@CurrentTenant() access: TenantAccess, @Query() query: unknown): Promise<ReferralDto[]> {
    return this.referrals.listForProvider(access, parseBody(referralListQuerySchema, query));
  }

  @Get(":referralId")
  @OrgPermission("requests.respond")
  get(
    @CurrentTenant() access: TenantAccess,
    @Param("referralId", IdParam) referralId: string,
  ): Promise<ReferralDto> {
    return this.referrals.getForProvider(access, referralId);
  }

  @Post(":referralId/withdraw")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  withdraw(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("referralId", IdParam) referralId: string,
  ): Promise<ReferralDto> {
    return this.referrals.withdraw(access, user, referralId);
  }
}

/** The customer's side: see referrals on their request, consent or decline. */
@Controller("v1/me/service-requests/:requestId/referrals")
export class MyReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  private me(user: User): Requester {
    return { kind: "user", user };
  }

  @Get()
  list(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) requestId: string,
  ): Promise<ReferralDto[]> {
    return this.referrals.listForRequest(this.me(user), requestId);
  }

  @Post(":referralId/consent")
  @HttpCode(200)
  consent(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) requestId: string,
    @Param("referralId", IdParam) referralId: string,
    @Body() body: unknown,
  ): Promise<ReferralDto> {
    return this.referrals.consent(
      this.me(user),
      requestId,
      referralId,
      parseBody(referralConsentSchema, body),
    );
  }

  @Post(":referralId/decline")
  @HttpCode(200)
  decline(
    @CurrentUser() user: User,
    @Param("requestId", IdParam) requestId: string,
    @Param("referralId", IdParam) referralId: string,
  ): Promise<ReferralDto> {
    return this.referrals.decline(this.me(user), requestId, referralId);
  }
}

/** The same for a fleet's requests (members who can see the request). */
@Controller("v1/orgs/:orgId/service-requests/:requestId/referrals")
export class FleetReferralsController {
  constructor(private readonly referrals: ReferralsService) {}

  private fleet(user: User, access: TenantAccess): Requester {
    return { kind: "organization", user, access };
  }

  @Get()
  @OrgPermission("requests.create")
  list(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) requestId: string,
  ): Promise<ReferralDto[]> {
    return this.referrals.listForRequest(this.fleet(user, access), requestId);
  }

  @Post(":referralId/consent")
  @HttpCode(200)
  @OrgPermission("requests.create")
  consent(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) requestId: string,
    @Param("referralId", IdParam) referralId: string,
    @Body() body: unknown,
  ): Promise<ReferralDto> {
    return this.referrals.consent(
      this.fleet(user, access),
      requestId,
      referralId,
      parseBody(referralConsentSchema, body),
    );
  }

  @Post(":referralId/decline")
  @HttpCode(200)
  @OrgPermission("requests.create")
  decline(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("requestId", IdParam) requestId: string,
    @Param("referralId", IdParam) referralId: string,
  ): Promise<ReferralDto> {
    return this.referrals.decline(this.fleet(user, access), requestId, referralId);
  }
}

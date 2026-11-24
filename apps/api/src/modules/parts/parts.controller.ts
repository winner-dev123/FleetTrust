import type { User } from "@fleettrust/db";
import {
  answerPartInquirySchema,
  createPartInquirySchema,
  createPartRequestSchema,
  type PartDto,
  type PartInquiryDto,
  partInquiryQuerySchema,
  partListQuerySchema,
  partRequestSchema,
  partSearchQuerySchema,
  type PartSearchResult,
  type PublicPart,
  stockRequestSchema,
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
  Put,
  Query,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { type PartAsker, PartInquiriesService } from "./part-inquiries.service.js";
import { PartsService } from "./parts.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const SAVE_LIMIT = { name: "parts-save", limit: 600, windowSeconds: 3600, by: "user" } as const;
const ASK_LIMIT = {
  name: "part-inquiry-create",
  limit: 30,
  windowSeconds: 3600,
  by: "user",
} as const;
const SEARCH_LIMIT = { name: "parts-search", limit: 120, windowSeconds: 60, by: "ip" } as const;

/**
 * A provider's parts listings (SRS F-140). `parts.manage` edits listings (branch-scoped: that
 * branch's stock); counter staff (`requests.respond`) confirm stock at their branch.
 */
@Controller("v1/orgs/:orgId/parts")
export class PartsController {
  constructor(private readonly parts: PartsService) {}

  @Get()
  @OrgPermission("org.read")
  list(@CurrentTenant() access: TenantAccess, @Query() query: unknown): Promise<PartDto[]> {
    return this.parts.list(access, parseBody(partListQuerySchema, query));
  }

  @Post()
  @OrgPermission("parts.manage")
  @RateLimit(SAVE_LIMIT)
  create(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<PartDto> {
    return this.parts.create(access, user, parseBody(createPartRequestSchema, body));
  }

  @Get(":partId")
  @OrgPermission("org.read")
  get(
    @CurrentTenant() access: TenantAccess,
    @Param("partId", IdParam) partId: string,
  ): Promise<PartDto> {
    return this.parts.get(access, partId);
  }

  @Put(":partId")
  @OrgPermission("parts.manage")
  @RateLimit(SAVE_LIMIT)
  replace(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("partId", IdParam) partId: string,
    @Body() body: unknown,
  ): Promise<PartDto> {
    return this.parts.replace(access, user, partId, parseBody(partRequestSchema, body));
  }

  @Delete(":partId")
  @HttpCode(204)
  @OrgPermission("parts.manage")
  async remove(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("partId", IdParam) partId: string,
  ): Promise<void> {
    await this.parts.remove(access, user, partId);
  }

  /** "Still in stock" counts too: every call refreshes the confirmation time. */
  @Put(":partId/stock")
  @OrgPermission("org.read")
  @RateLimit(SAVE_LIMIT)
  stock(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("partId", IdParam) partId: string,
    @Body() body: unknown,
  ): Promise<PartDto> {
    return this.parts.confirmStock(access, user, partId, parseBody(stockRequestSchema, body));
  }
}

/** Availability inquiries a provider received (SRS F-141). */
@Controller("v1/orgs/:orgId/received-part-inquiries")
export class ReceivedPartInquiriesController {
  constructor(private readonly inquiries: PartInquiriesService) {}

  @Get()
  @OrgPermission("requests.respond")
  list(@CurrentTenant() access: TenantAccess, @Query() query: unknown): Promise<PartInquiryDto[]> {
    return this.inquiries.listReceived(access, parseBody(partInquiryQuerySchema, query));
  }

  @Get(":inquiryId")
  @OrgPermission("requests.respond")
  get(
    @CurrentTenant() access: TenantAccess,
    @Param("inquiryId", IdParam) inquiryId: string,
  ): Promise<PartInquiryDto> {
    return this.inquiries.getReceived(access, inquiryId);
  }

  @Post(":inquiryId/answer")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  @RateLimit(SAVE_LIMIT)
  answer(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("inquiryId", IdParam) inquiryId: string,
    @Body() body: unknown,
  ): Promise<PartInquiryDto> {
    return this.inquiries.answer(access, user, inquiryId, parseBody(answerPartInquirySchema, body));
  }
}

/** A person's own availability inquiries. */
@Controller("v1/me/part-inquiries")
export class MyPartInquiriesController {
  constructor(private readonly inquiries: PartInquiriesService) {}

  private me(user: User): PartAsker {
    return { kind: "user", user };
  }

  @Post()
  @RateLimit(ASK_LIMIT)
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<PartInquiryDto> {
    return this.inquiries.create(this.me(user), parseBody(createPartInquirySchema, body));
  }

  @Get()
  list(@CurrentUser() user: User, @Query() query: unknown): Promise<PartInquiryDto[]> {
    return this.inquiries.listMine(this.me(user), parseBody(partInquiryQuerySchema, query));
  }

  @Get(":inquiryId")
  get(
    @CurrentUser() user: User,
    @Param("inquiryId", IdParam) inquiryId: string,
  ): Promise<PartInquiryDto> {
    return this.inquiries.mine(this.me(user), inquiryId);
  }

  @Post(":inquiryId/close")
  @HttpCode(200)
  close(
    @CurrentUser() user: User,
    @Param("inquiryId", IdParam) inquiryId: string,
  ): Promise<PartInquiryDto> {
    return this.inquiries.close(this.me(user), inquiryId);
  }
}

/** A fleet's availability inquiries (members with `requests.create`). */
@Controller("v1/orgs/:orgId/part-inquiries")
export class FleetPartInquiriesController {
  constructor(private readonly inquiries: PartInquiriesService) {}

  private fleet(user: User, access: TenantAccess): PartAsker {
    return { kind: "organization", user, access };
  }

  @Post()
  @OrgPermission("requests.create")
  @RateLimit(ASK_LIMIT)
  create(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Body() body: unknown,
  ): Promise<PartInquiryDto> {
    return this.inquiries.create(
      this.fleet(user, access),
      parseBody(createPartInquirySchema, body),
    );
  }

  @Get()
  @OrgPermission("requests.create")
  list(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Query() query: unknown,
  ): Promise<PartInquiryDto[]> {
    return this.inquiries.listMine(
      this.fleet(user, access),
      parseBody(partInquiryQuerySchema, query),
    );
  }

  @Get(":inquiryId")
  @OrgPermission("requests.create")
  get(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("inquiryId", IdParam) inquiryId: string,
  ): Promise<PartInquiryDto> {
    return this.inquiries.mine(this.fleet(user, access), inquiryId);
  }

  @Post(":inquiryId/close")
  @HttpCode(200)
  @OrgPermission("requests.create")
  close(
    @CurrentUser() user: User,
    @CurrentTenant() access: TenantAccess,
    @Param("inquiryId", IdParam) inquiryId: string,
  ): Promise<PartInquiryDto> {
    return this.inquiries.close(this.fleet(user, access), inquiryId);
  }
}

/**
 * Public parts search (SRS F-140). Visitors get distances from approximate locations (OQ-11);
 * signed-in users (`/full`) get exact distances and can filter by one of their vehicles.
 */
@Controller("v1/parts")
export class PublicPartsController {
  constructor(private readonly parts: PartsService) {}

  @Get()
  @Public()
  @RateLimit(SEARCH_LIMIT)
  search(@Query() query: unknown): Promise<PartSearchResult> {
    return this.parts.search(parseBody(partSearchQuerySchema, query), null);
  }

  @Get("full")
  @RateLimit({ ...SEARCH_LIMIT, name: "parts-search-full", by: "user" })
  searchFull(@CurrentUser() user: User, @Query() query: unknown): Promise<PartSearchResult> {
    return this.parts.search(parseBody(partSearchQuerySchema, query), user);
  }

  @Get(":partId")
  @Public()
  @RateLimit(SEARCH_LIMIT)
  get(@Param("partId", IdParam) partId: string): Promise<PublicPart> {
    return this.parts.publicPart(partId);
  }
}

import type { User } from "@fleettrust/db";
import {
  type ApplicationDto,
  applicationStatusRequestSchema,
  applyRequestSchema,
  type JobDto,
  jobListQuerySchema,
  jobRequestSchema,
  type PublicJob,
  publicJobQuerySchema,
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
import { CurrentUser, Public } from "../identity/index.js";
import { CurrentTenant, OrgPermission, type TenantAccess } from "../organizations/index.js";
import { JobsService } from "./jobs.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

const WRITE_LIMIT = { name: "jobs-write", limit: 120, windowSeconds: 3600, by: "user" } as const;

/** A fleet's job listings and applications (`jobs.manage`: owners, admins, recruiters). */
@Controller("v1/orgs/:orgId/jobs")
export class EmployerJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @OrgPermission("jobs.manage")
  list(@CurrentTenant() access: TenantAccess, @Query() query: unknown): Promise<JobDto[]> {
    return this.jobs.list(access, parseBody(jobListQuerySchema, query));
  }

  @Post()
  @OrgPermission("jobs.manage")
  @RateLimit(WRITE_LIMIT)
  create(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ): Promise<JobDto> {
    return this.jobs.create(access, user, parseBody(jobRequestSchema, body));
  }

  @Get(":jobId")
  @OrgPermission("jobs.manage")
  get(
    @CurrentTenant() access: TenantAccess,
    @Param("jobId", IdParam) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.get(access, jobId);
  }

  @Put(":jobId")
  @OrgPermission("jobs.manage")
  @RateLimit(WRITE_LIMIT)
  update(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("jobId", IdParam) jobId: string,
    @Body() body: unknown,
  ): Promise<JobDto> {
    return this.jobs.update(access, user, jobId, parseBody(jobRequestSchema, body));
  }

  /** Live at once for verified employers without scam signs; otherwise to moderation. */
  @Post(":jobId/publish")
  @HttpCode(200)
  @OrgPermission("jobs.manage")
  @RateLimit(WRITE_LIMIT)
  publish(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("jobId", IdParam) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.publish(access, user, jobId);
  }

  @Post(":jobId/close")
  @HttpCode(200)
  @OrgPermission("jobs.manage")
  close(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("jobId", IdParam) jobId: string,
  ): Promise<JobDto> {
    return this.jobs.close(access, user, jobId);
  }

  @Delete(":jobId")
  @HttpCode(204)
  @OrgPermission("jobs.manage")
  async remove(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("jobId", IdParam) jobId: string,
  ): Promise<void> {
    await this.jobs.remove(access, user, jobId);
  }

  @Get(":jobId/applications")
  @OrgPermission("jobs.manage")
  applications(
    @CurrentTenant() access: TenantAccess,
    @Param("jobId", IdParam) jobId: string,
  ): Promise<ApplicationDto[]> {
    return this.jobs.applications(access, jobId);
  }
}

@Controller("v1/orgs/:orgId/job-applications")
export class EmployerApplicationsController {
  constructor(private readonly jobs: JobsService) {}

  @Patch(":applicationId")
  @OrgPermission("jobs.manage")
  setStatus(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("applicationId", IdParam) applicationId: string,
    @Body() body: unknown,
  ): Promise<ApplicationDto> {
    return this.jobs.setApplicationStatus(
      access,
      user,
      applicationId,
      parseBody(applicationStatusRequestSchema, body),
    );
  }
}

/** Public job board; applying needs sign-in. */
@Controller("v1/jobs")
export class PublicJobsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  @Public()
  @RateLimit({ name: "jobs-public", limit: 120, windowSeconds: 60, by: "ip" })
  list(@Query() query: unknown): Promise<{ items: PublicJob[]; nextOffset: number | null }> {
    return this.jobs.publicList(parseBody(publicJobQuerySchema, query));
  }

  @Get(":jobId")
  @Public()
  @RateLimit({ name: "jobs-public", limit: 120, windowSeconds: 60, by: "ip" })
  get(@Param("jobId", IdParam) jobId: string): Promise<PublicJob> {
    return this.jobs.publicJob(jobId);
  }

  @Post(":jobId/applications")
  @RateLimit({ name: "job-apply", limit: 20, windowSeconds: 86_400, by: "user" })
  apply(
    @CurrentUser() user: User,
    @Param("jobId", IdParam) jobId: string,
    @Body() body: unknown,
  ): Promise<ApplicationDto> {
    return this.jobs.apply(user, jobId, parseBody(applyRequestSchema, body));
  }
}

@Controller("v1/me/job-applications")
export class MyApplicationsController {
  constructor(private readonly jobs: JobsService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<ApplicationDto[]> {
    return this.jobs.myApplications(user);
  }

  @Post(":applicationId/withdraw")
  @HttpCode(200)
  withdraw(
    @CurrentUser() user: User,
    @Param("applicationId", IdParam) applicationId: string,
  ): Promise<ApplicationDto> {
    return this.jobs.withdraw(user, applicationId);
  }
}

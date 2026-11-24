import type { User } from "@fleettrust/db";
import {
  analyticsQuerySchema,
  appointmentQuerySchema,
  appointmentStatusRequestSchema,
  createAppointmentSchema,
  createTaskSchema,
  inquiryNoteRequestSchema,
  pipelineQuerySchema,
  quoteListQuerySchema,
  SLUG_PATTERN,
  slotQuerySchema,
  staffAvailabilityRequestSchema,
  taskQuerySchema,
  timeOffRequestSchema,
  updateAppointmentSchema,
  updateInquiryCrmSchema,
  updateTaskSchema,
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
import { AnalyticsService } from "./analytics.service.js";
import { AppointmentsService } from "./appointments.service.js";
import { CrmService } from "./crm.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw notFound();
    return value.toLowerCase();
  }
}

@Injectable()
class SlugParam implements PipeTransform<string, string> {
  transform(value: string): string {
    const slug = value.toLowerCase();
    if (!SLUG_PATTERN.test(slug)) throw notFound();
    return slug;
  }
}

/**
 * Provider CRM (F-130..F-132, ADR-0027). Reading and working on inquiries needs
 * `requests.respond` (staff included); assigning others, availability, booking and analytics
 * need `crm.manage`. Branch scope applies throughout.
 */
@Controller("v1/orgs/:orgId/crm")
export class CrmController {
  constructor(
    private readonly crm: CrmService,
    private readonly appointments: AppointmentsService,
    private readonly analyticsService: AnalyticsService,
  ) {}

  // --- Pipeline, inquiries, notes, quotes ------------------------------------------------------

  @Get("pipeline")
  @OrgPermission("requests.respond")
  pipeline(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Query() query: unknown,
  ) {
    return this.crm.pipeline(access, user, parseBody(pipelineQuerySchema, query));
  }

  @Get("inquiries/:recipientId")
  @OrgPermission("requests.respond")
  inquiry(
    @CurrentTenant() access: TenantAccess,
    @Param("recipientId", IdParam) recipientId: string,
  ) {
    return this.crm.inquiry(access, recipientId);
  }

  @Patch("inquiries/:recipientId")
  @OrgPermission("requests.respond")
  updateInquiry(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) recipientId: string,
    @Body() body: unknown,
  ) {
    return this.crm.updateInquiry(
      access,
      user,
      recipientId,
      parseBody(updateInquiryCrmSchema, body),
    );
  }

  @Post("inquiries/:recipientId/notes")
  @OrgPermission("requests.respond")
  @RateLimit({ name: "crm-note", limit: 300, windowSeconds: 3600, by: "user" })
  addNote(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) recipientId: string,
    @Body() body: unknown,
  ) {
    return this.crm.addNote(
      access,
      user,
      recipientId,
      parseBody(inquiryNoteRequestSchema, body).body,
    );
  }

  @Delete("inquiries/:recipientId/notes/:noteId")
  @OrgPermission("requests.respond")
  @HttpCode(204)
  async removeNote(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) recipientId: string,
    @Param("noteId", IdParam) noteId: string,
  ): Promise<void> {
    await this.crm.removeNote(access, user, recipientId, noteId);
  }

  @Get("quotes")
  @OrgPermission("requests.respond")
  quotes(@CurrentTenant() access: TenantAccess, @Query() query: unknown) {
    return this.crm.quotes(access, parseBody(quoteListQuerySchema, query));
  }

  // --- Tasks -----------------------------------------------------------------------------------

  @Get("tasks")
  @OrgPermission("requests.respond")
  tasks(@CurrentTenant() access: TenantAccess, @CurrentUser() user: User, @Query() query: unknown) {
    return this.crm.tasks(access, user, parseBody(taskQuerySchema, query));
  }

  @Post("tasks")
  @OrgPermission("requests.respond")
  @RateLimit({ name: "crm-task", limit: 300, windowSeconds: 3600, by: "user" })
  createTask(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Body() body: unknown,
  ) {
    return this.crm.createTask(access, user, parseBody(createTaskSchema, body));
  }

  @Patch("tasks/:taskId")
  @OrgPermission("requests.respond")
  updateTask(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("taskId", IdParam) taskId: string,
    @Body() body: unknown,
  ) {
    return this.crm.updateTask(access, user, taskId, parseBody(updateTaskSchema, body));
  }

  @Delete("tasks/:taskId")
  @OrgPermission("requests.respond")
  @HttpCode(204)
  async removeTask(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("taskId", IdParam) taskId: string,
  ): Promise<void> {
    await this.crm.removeTask(access, user, taskId);
  }

  // --- Staff and availability ------------------------------------------------------------------

  @Get("staff")
  @OrgPermission("requests.respond")
  staff(@CurrentTenant() access: TenantAccess, @CurrentUser() user: User) {
    return this.appointments.staff(access, user);
  }

  @Put("staff/:userId/availability")
  @OrgPermission("crm.manage")
  putAvailability(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("userId", IdParam) userId: string,
    @Body() body: unknown,
  ) {
    return this.appointments.putAvailability(
      access,
      user,
      userId,
      parseBody(staffAvailabilityRequestSchema, body),
    );
  }

  @Post("staff/:userId/time-off")
  @OrgPermission("crm.manage")
  addTimeOff(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("userId", IdParam) userId: string,
    @Body() body: unknown,
  ) {
    return this.appointments.addTimeOff(
      access,
      user,
      userId,
      parseBody(timeOffRequestSchema, body),
    );
  }

  @Delete("staff/:userId/time-off/:timeOffId")
  @OrgPermission("crm.manage")
  @HttpCode(204)
  async removeTimeOff(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("userId", IdParam) userId: string,
    @Param("timeOffId", IdParam) timeOffId: string,
  ): Promise<void> {
    await this.appointments.removeTimeOff(access, user, userId, timeOffId);
  }

  // --- Slots and appointments ------------------------------------------------------------------

  @Get("slots")
  @OrgPermission("requests.respond")
  slots(@CurrentTenant() access: TenantAccess, @Query() query: unknown) {
    return this.appointments.slots(access, parseBody(slotQuerySchema, query));
  }

  @Get("appointments")
  @OrgPermission("requests.respond")
  listAppointments(@CurrentTenant() access: TenantAccess, @Query() query: unknown) {
    return this.appointments.list(access, parseBody(appointmentQuerySchema, query));
  }

  @Post("appointments")
  @OrgPermission("crm.manage")
  @RateLimit({ name: "appointment-book", limit: 300, windowSeconds: 3600, by: "user" })
  book(@CurrentTenant() access: TenantAccess, @CurrentUser() user: User, @Body() body: unknown) {
    return this.appointments.book(access, user, parseBody(createAppointmentSchema, body));
  }

  @Get("appointments/:appointmentId")
  @OrgPermission("requests.respond")
  appointment(
    @CurrentTenant() access: TenantAccess,
    @Param("appointmentId", IdParam) appointmentId: string,
  ) {
    return this.appointments.get(access, appointmentId);
  }

  @Patch("appointments/:appointmentId")
  @OrgPermission("crm.manage")
  updateAppointment(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("appointmentId", IdParam) appointmentId: string,
    @Body() body: unknown,
  ) {
    return this.appointments.update(
      access,
      user,
      appointmentId,
      parseBody(updateAppointmentSchema, body),
    );
  }

  @Post("appointments/:appointmentId/status")
  @OrgPermission("requests.respond")
  @HttpCode(200)
  setStatus(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("appointmentId", IdParam) appointmentId: string,
    @Body() body: unknown,
  ) {
    return this.appointments.setStatus(
      access,
      user,
      appointmentId,
      parseBody(appointmentStatusRequestSchema, body),
    );
  }

  // --- Analytics -------------------------------------------------------------------------------

  @Get("analytics")
  @OrgPermission("crm.manage")
  analytics(@CurrentTenant() access: TenantAccess, @Query() query: unknown) {
    return this.analyticsService.analytics(access, parseBody(analyticsQuerySchema, query));
  }
}

/** Appointments on service requests you raised (no staff identity, no internal notes). */
@Controller("v1/me/appointments")
export class MyAppointmentsController {
  constructor(private readonly appointments: AppointmentsService) {}

  @Get()
  list(@CurrentUser() user: User) {
    return this.appointments.mine(user);
  }
}

/** Public response status of a published provider ("Usually responds within …"). */
@Controller("v1/providers")
export class ProviderResponseStatusController {
  constructor(private readonly analyticsService: AnalyticsService) {}

  @Get(":slug/response-status")
  @Public()
  @RateLimit({ name: "provider-response-status", limit: 120, windowSeconds: 60, by: "ip" })
  responseStatus(@Param("slug", SlugParam) slug: string) {
    return this.analyticsService.publicResponseStatus(slug);
  }
}

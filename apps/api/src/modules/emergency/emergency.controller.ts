import type { User } from "@fleettrust/db";
import {
  closeIncidentSchema,
  createIncidentSchema,
  emergencyAssistSettingsSchema,
  type EmergencyGuidance,
  type IncidentDto,
  inviteTrustedContactSchema,
  muteTrustedContactSchema,
  type ProviderAlertDto,
  providerOfferSchema,
  type TrustedContactDto,
  updateIncidentLocationSchema,
  updateTrustedContactSchema,
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
import { TrustedContactsService } from "./contacts.service.js";
import { IncidentsService } from "./incidents.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** The first screen: official emergency guidance. Public, so it works before sign-in. */
@Controller("v1/emergency/guidance")
export class EmergencyGuidanceController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  @Public()
  guidance(@Query("country") country: unknown): Promise<EmergencyGuidance> {
    const code =
      typeof country === "string" && /^[A-Za-z]{2}$/.test(country) ? country.toUpperCase() : null;
    return this.incidents.guidance(code);
  }
}

/** Trusted contacts with mutual consent (F-061). */
@Controller("v1/me/trusted-contacts")
export class TrustedContactsController {
  constructor(private readonly contacts: TrustedContactsService) {}

  @Get()
  list(@CurrentUser() user: User): Promise<TrustedContactDto[]> {
    return this.contacts.list(user);
  }

  @Post()
  @RateLimit({ name: "trusted-contact-invite", limit: 20, windowSeconds: 86_400, by: "user" })
  invite(@CurrentUser() user: User, @Body() body: unknown): Promise<TrustedContactDto> {
    const input = parseBody(inviteTrustedContactSchema, body);
    return this.contacts.invite(user, input.userId, input.priority);
  }

  @Patch(":contactId")
  update(
    @CurrentUser() user: User,
    @Param("contactId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<TrustedContactDto> {
    return this.contacts.setPriority(
      user,
      id,
      parseBody(updateTrustedContactSchema, body).priority,
    );
  }

  @Post(":contactId/accept")
  @HttpCode(200)
  accept(
    @CurrentUser() user: User,
    @Param("contactId", IdParam) id: string,
  ): Promise<TrustedContactDto> {
    return this.contacts.respond(user, id, true);
  }

  @Post(":contactId/decline")
  @HttpCode(200)
  decline(
    @CurrentUser() user: User,
    @Param("contactId", IdParam) id: string,
  ): Promise<TrustedContactDto> {
    return this.contacts.respond(user, id, false);
  }

  /** The contact pauses or resumes alerts (AB-03). */
  @Post(":contactId/mute")
  @HttpCode(200)
  mute(
    @CurrentUser() user: User,
    @Param("contactId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<TrustedContactDto> {
    return this.contacts.setMuted(user, id, parseBody(muteTrustedContactSchema, body).muted);
  }

  @Delete(":contactId")
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param("contactId", IdParam) id: string): Promise<void> {
    await this.contacts.remove(user, id);
  }
}

/**
 * Emergency incidents (F-060, F-062, F-064). Deliberately no rate limit or quota on creation
 * (ADR-0010): repeated alerts are flagged for review, never refused.
 */
@Controller("v1/emergency/incidents")
export class IncidentsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Post()
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<IncidentDto> {
    return this.incidents.create(user, parseBody(createIncidentSchema, body));
  }

  @Get()
  mine(@CurrentUser() user: User): Promise<IncidentDto[]> {
    return this.incidents.listMine(user);
  }

  @Get(":incidentId")
  get(@CurrentUser() user: User, @Param("incidentId", IdParam) id: string): Promise<IncidentDto> {
    return this.incidents.get(user, id);
  }

  @Post(":incidentId/location")
  @HttpCode(200)
  location(
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<IncidentDto> {
    return this.incidents.updateLocation(
      user,
      id,
      parseBody(updateIncidentLocationSchema, body).location,
    );
  }

  @Post(":incidentId/acknowledge")
  @HttpCode(200)
  acknowledge(
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) id: string,
  ): Promise<IncidentDto> {
    return this.incidents.acknowledge(user, id);
  }

  /** "I'm safe". */
  @Post(":incidentId/resolve")
  @HttpCode(200)
  resolve(
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<IncidentDto> {
    parseBody(closeIncidentSchema, body ?? {});
    return this.incidents.close(user, id, "resolved");
  }

  /** "False alarm". */
  @Post(":incidentId/cancel")
  @HttpCode(200)
  cancel(
    @CurrentUser() user: User,
    @Param("incidentId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<IncidentDto> {
    parseBody(closeIncidentSchema, body ?? {});
    return this.incidents.close(user, id, "cancelled");
  }
}

/** Alerts where you are a trusted contact. */
@Controller("v1/emergency/alerts")
export class EmergencyAlertsController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get()
  alerts(@CurrentUser() user: User): Promise<IncidentDto[]> {
    return this.incidents.alerts(user);
  }
}

/** Providers: opt in to nearby alerts and offer help (F-063). */
@Controller("v1/orgs/:orgId")
export class ProviderEmergencyController {
  constructor(private readonly incidents: IncidentsService) {}

  @Get("emergency-assist")
  @OrgPermission("profile.manage")
  settings(@CurrentTenant() access: TenantAccess) {
    return this.incidents.assistSettings(access);
  }

  @Put("emergency-assist")
  @OrgPermission("profile.manage")
  update(@CurrentTenant() access: TenantAccess, @CurrentUser() user: User, @Body() body: unknown) {
    return this.incidents.setAssist(access, user, parseBody(emergencyAssistSettingsSchema, body));
  }

  @Get("emergency-alerts")
  @OrgPermission("requests.respond")
  alerts(@CurrentTenant() access: TenantAccess): Promise<ProviderAlertDto[]> {
    return this.incidents.providerAlerts(access);
  }

  @Post("emergency-alerts/:recipientId/offer")
  @HttpCode(200)
  @OrgPermission("requests.respond")
  offer(
    @CurrentTenant() access: TenantAccess,
    @CurrentUser() user: User,
    @Param("recipientId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ProviderAlertDto> {
    return this.incidents.offer(
      access,
      user,
      id,
      parseBody(providerOfferSchema, body ?? {}).message,
    );
  }
}

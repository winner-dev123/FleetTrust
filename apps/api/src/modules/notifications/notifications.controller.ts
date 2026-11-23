import type { User } from "@fleettrust/db";
import {
  type InboxDto,
  type MessagingPreferences,
  registerDeviceSchema,
  unregisterDeviceSchema,
  updateMessagingPreferencesSchema,
} from "@fleettrust/types";
import {
  Body,
  Controller,
  Get,
  HttpCode,
  Injectable,
  NotFoundException,
  Param,
  Patch,
  type PipeTransform,
  Post,
  Put,
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser } from "../identity/index.js";
import { MessagingService } from "../messaging/index.js";
import { NotificationsService } from "./notifications.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** Inbox, notification opt-outs and push devices (F-054). */
@Controller("v1/me")
export class NotificationsController {
  constructor(
    private readonly notifications: NotificationsService,
    private readonly messaging: MessagingService,
  ) {}

  @Get("inbox")
  inbox(@CurrentUser() user: User): Promise<InboxDto> {
    return this.notifications.inbox(user);
  }

  @Post("notifications/read-all")
  @HttpCode(204)
  async readAll(@CurrentUser() user: User): Promise<void> {
    await this.notifications.markRead(user, null);
  }

  @Post("notifications/:notificationId/read")
  @HttpCode(204)
  async read(
    @CurrentUser() user: User,
    @Param("notificationId", IdParam) id: string,
  ): Promise<void> {
    await this.notifications.markRead(user, id);
  }

  @Get("messaging-preferences")
  preferences(@CurrentUser() user: User): Promise<MessagingPreferences> {
    return this.messaging.preferencesFor(user.id);
  }

  @Patch("messaging-preferences")
  update(@CurrentUser() user: User, @Body() body: unknown): Promise<MessagingPreferences> {
    return this.messaging.updatePreferences(
      user,
      parseBody(updateMessagingPreferencesSchema, body),
    );
  }

  @Put("devices")
  @HttpCode(204)
  @RateLimit({ name: "device-register", limit: 30, windowSeconds: 3600, by: "user" })
  async register(@CurrentUser() user: User, @Body() body: unknown): Promise<void> {
    const { fid, platform } = parseBody(registerDeviceSchema, body);
    await this.notifications.registerDevice(user, fid, platform);
  }

  /** Sign-out on a device: stop pushing to it. */
  @Post("devices/unregister")
  @HttpCode(204)
  async unregister(@CurrentUser() user: User, @Body() body: unknown): Promise<void> {
    const { fid } = parseBody(unregisterDeviceSchema, body);
    await this.notifications.unregisterDevice(user, fid);
  }
}

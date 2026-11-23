import type { ServerResponse } from "node:http";

import type { User } from "@fleettrust/db";
import {
  type ConversationDto,
  conversationSettingsSchema,
  createMessageAttachmentSchema,
  markReadSchema,
  type MessageDto,
  type MessagePage,
  messagesQuerySchema,
  openDirectConversationSchema,
  reportMessageSchema,
  sendMessageSchema,
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
  Query,
  Res,
} from "@nestjs/common";
import { z } from "zod";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser } from "../identity/index.js";
import { ModerationService } from "../moderation/index.js";
import { MessageAttachmentsService } from "./message-attachments.service.js";
import { MessagingService, messagingError, notFound } from "./messaging.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** Direct, request-linked and group conversations (F-053, F-123). */
@Controller("v1/conversations")
export class ConversationsController {
  constructor(
    private readonly messaging: MessagingService,
    private readonly attachments: MessageAttachmentsService,
    private readonly moderation: ModerationService,
  ) {}

  @Get()
  list(@CurrentUser() user: User): Promise<ConversationDto[]> {
    return this.messaging.list(user);
  }

  @Post("direct")
  @RateLimit({ name: "conversation-open", limit: 60, windowSeconds: 3600, by: "user" })
  openDirect(@CurrentUser() user: User, @Body() body: unknown): Promise<ConversationDto> {
    return this.messaging.openDirect(user, parseBody(openDirectConversationSchema, body).userId);
  }

  @Post("request")
  openRequest(@CurrentUser() user: User, @Body() body: unknown): Promise<ConversationDto> {
    const { recipientId } = parseBody(z.object({ recipientId: z.uuid() }).strict(), body);
    return this.messaging.openRequest(user, recipientId);
  }

  @Post("group")
  openGroup(@CurrentUser() user: User, @Body() body: unknown): Promise<ConversationDto> {
    const { groupId } = parseBody(z.object({ groupId: z.uuid() }).strict(), body);
    return this.messaging.openGroup(user, groupId);
  }

  @Get(":conversationId")
  get(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
  ): Promise<ConversationDto> {
    return this.messaging.get(user, id);
  }

  @Patch(":conversationId")
  settings(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<ConversationDto> {
    return this.messaging.setMuted(user, id, parseBody(conversationSettingsSchema, body).muted);
  }

  @Get(":conversationId/messages")
  history(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Query() query: unknown,
  ): Promise<MessagePage> {
    return this.messaging.history(user, id, parseBody(messagesQuerySchema, query));
  }

  @Post(":conversationId/messages")
  @RateLimit({ name: "message-send", limit: 60, windowSeconds: 60, by: "user" })
  send(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<MessageDto> {
    return this.messaging.send(user, id, parseBody(sendMessageSchema, body));
  }

  @Delete(":conversationId/messages/:messageId")
  remove(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Param("messageId", IdParam) messageId: string,
  ): Promise<MessageDto> {
    return this.messaging.remove(user, id, messageId);
  }

  /** Reports a message you can see to the trust and safety team (F-055). */
  @Post(":conversationId/messages/:messageId/report")
  @RateLimit({ name: "content-report", limit: 20, windowSeconds: 86_400, by: "user" })
  async report(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Param("messageId", IdParam) messageId: string,
    @Body() body: unknown,
  ): Promise<{ id: string; status: "open" }> {
    const input = parseBody(reportMessageSchema, body);
    await this.messaging.requireAccess(user, id);
    const message = await this.messaging.messageFor(user, id, messageId);
    if (!message) throw notFound();
    if (message.sender.mine) throw messagingError(400, "not_allowed");
    return this.moderation.report(
      user,
      { targetType: "message", targetId: messageId, reason: input.reason, details: input.details },
      { conversationAccessChecked: true },
    );
  }

  @Post(":conversationId/read")
  @HttpCode(200)
  read(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<{ lastReadSeq: number }> {
    return this.messaging.markRead(user, id, parseBody(markReadSchema, body).seq);
  }

  @Post(":conversationId/attachments")
  @RateLimit({ name: "message-attachment", limit: 60, windowSeconds: 3600, by: "user" })
  createAttachment(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Body() body: unknown,
  ) {
    return this.attachments.create(user, id, parseBody(createMessageAttachmentSchema, body));
  }

  @Post(":conversationId/attachments/:attachmentId/complete")
  @HttpCode(200)
  completeAttachment(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Param("attachmentId", IdParam) attachmentId: string,
  ) {
    return this.attachments.complete(user, id, attachmentId);
  }

  @Get(":conversationId/attachments/:attachmentId")
  async download(
    @CurrentUser() user: User,
    @Param("conversationId", IdParam) id: string,
    @Param("attachmentId", IdParam) attachmentId: string,
    @Res() res: ServerResponse,
  ): Promise<void> {
    const file = await this.attachments.read(user, id, attachmentId);
    res.writeHead(200, {
      "Content-Type": file.contentType,
      "Content-Length": String(file.data.length),
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Disposition": file.contentType === "application/pdf" ? "attachment" : "inline",
    });
    res.end(file.data);
  }
}

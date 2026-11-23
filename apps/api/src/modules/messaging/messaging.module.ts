import { Module } from "@nestjs/common";

import { CommunityModule } from "../community/index.js";
import { ModerationModule } from "../moderation/index.js";
import { MessageAttachmentsService } from "./message-attachments.service.js";
import { ConversationsController } from "./messaging.controller.js";
import { MessagingService } from "./messaging.service.js";
import { RealtimeGateway } from "./realtime.gateway.js";

/**
 * Direct, request-linked and group messaging with durable history, WebSocket delivery and
 * cursor replay (SRS F-053..F-055, F-123, ADR-0024).
 */
@Module({
  imports: [CommunityModule, ModerationModule],
  controllers: [ConversationsController],
  providers: [MessagingService, MessageAttachmentsService, RealtimeGateway],
  exports: [MessagingService],
})
export class MessagingModule {}

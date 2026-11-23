import { Module } from "@nestjs/common";

import { CommunityModule } from "../community/index.js";
import { MessagingModule } from "../messaging/index.js";
import { VehiclesModule } from "../vehicles/index.js";
import { NotificationsController } from "./notifications.controller.js";
import { NotificationsService } from "./notifications.service.js";
import { OutboxRelay } from "./outbox-relay.js";

/**
 * Inbox notifications, push (FCM) and opt-outs, fed by the transactional outbox relay
 * (SRS F-054, ADR-0007, ADR-0024).
 */
@Module({
  imports: [MessagingModule, CommunityModule, VehiclesModule],
  controllers: [NotificationsController],
  providers: [NotificationsService, OutboxRelay],
  exports: [OutboxRelay],
})
export class NotificationsModule {}

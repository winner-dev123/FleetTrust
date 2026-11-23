import { Module } from "@nestjs/common";

import { EntitlementsModule } from "../entitlements/index.js";
import {
  FriendsController,
  GroupsController,
  PeopleController,
  SocialSettingsController,
} from "./community.controller.js";
import { GroupsService } from "./groups.service.js";
import { SocialService } from "./social.service.js";

/**
 * Friendships, social privacy, blocks and community groups (SRS J7, F-120..F-122, ADR-0023).
 * `SocialService` is exported so messaging (Prompt 17) can apply the same block rules.
 */
@Module({
  imports: [EntitlementsModule],
  controllers: [SocialSettingsController, FriendsController, PeopleController, GroupsController],
  providers: [SocialService, GroupsService],
  exports: [SocialService],
})
export class CommunityModule {}

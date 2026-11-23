import type { User } from "@fleettrust/db";
import {
  type BlockedUserDto,
  createGroupSchema,
  type FriendDto,
  type FriendRequestDto,
  type GroupDto,
  type GroupMemberDto,
  groupMemberRoleSchema,
  type GroupPage,
  type PersonDto,
  type PersonProfile,
  searchGroupsQuerySchema,
  searchPeopleQuerySchema,
  sendFriendRequestSchema,
  type SendFriendRequestResult,
  type SocialSettings,
  updateGroupSchema,
  updateSocialSettingsSchema,
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
import { CurrentUser, Public, RequireDisplayName } from "../identity/index.js";
import { GroupsService } from "./groups.service.js";
import { SocialService } from "./social.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

@Injectable()
class SlugParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (value.length > 80 || !SLUG.test(value)) {
      throw new NotFoundException({ statusCode: 404, error: "not_found" });
    }
    return value;
  }
}

/** Social privacy settings (F-121). */
@Controller("v1/me/social-settings")
export class SocialSettingsController {
  constructor(private readonly social: SocialService) {}

  @Get()
  get(@CurrentUser() user: User): Promise<SocialSettings> {
    return this.social.getSettings(user);
  }

  @Patch()
  update(@CurrentUser() user: User, @Body() body: unknown): Promise<SocialSettings> {
    return this.social.updateSettings(user, parseBody(updateSocialSettingsSchema, body));
  }
}

/** Friends and friend requests (F-120). */
@Controller("v1/me")
export class FriendsController {
  constructor(
    private readonly social: SocialService,
    private readonly groupsService: GroupsService,
  ) {}

  @Get("friends")
  friends(@CurrentUser() user: User): Promise<FriendDto[]> {
    return this.social.friends(user);
  }

  @Delete("friends/:userId")
  @HttpCode(204)
  async unfriend(@CurrentUser() user: User, @Param("userId", IdParam) id: string): Promise<void> {
    await this.social.unfriend(user, id);
  }

  @Post("friend-requests")
  @RequireDisplayName()
  @RateLimit({ name: "friend-request", limit: 60, windowSeconds: 3600, by: "user" })
  send(@CurrentUser() user: User, @Body() body: unknown): Promise<SendFriendRequestResult> {
    return this.social.send(user, parseBody(sendFriendRequestSchema, body).userId);
  }

  @Get("friend-requests")
  requests(
    @CurrentUser() user: User,
    @Query("direction") direction: unknown,
  ): Promise<FriendRequestDto[]> {
    return this.social.requests(user, direction === "outgoing" ? "outgoing" : "incoming");
  }

  @Post("friend-requests/:requestId/accept")
  @HttpCode(200)
  accept(@CurrentUser() user: User, @Param("requestId", IdParam) id: string): Promise<FriendDto> {
    return this.social.accept(user, id);
  }

  @Post("friend-requests/:requestId/decline")
  @HttpCode(204)
  async decline(@CurrentUser() user: User, @Param("requestId", IdParam) id: string): Promise<void> {
    await this.social.decline(user, id);
  }

  @Post("friend-requests/:requestId/cancel")
  @HttpCode(204)
  async cancel(@CurrentUser() user: User, @Param("requestId", IdParam) id: string): Promise<void> {
    await this.social.cancel(user, id);
  }

  @Get("blocks")
  blocks(@CurrentUser() user: User): Promise<BlockedUserDto[]> {
    return this.social.blocks(user);
  }

  @Put("blocks/:userId")
  @HttpCode(204)
  async block(@CurrentUser() user: User, @Param("userId", IdParam) id: string): Promise<void> {
    await this.social.block(user, id);
  }

  @Delete("blocks/:userId")
  @HttpCode(204)
  async unblock(@CurrentUser() user: User, @Param("userId", IdParam) id: string): Promise<void> {
    await this.social.unblock(user, id);
  }

  @Get("groups")
  groups(@CurrentUser() user: User): Promise<GroupDto[]> {
    return this.groupsService.mine(user);
  }
}

/** Member cards and opt-in people search. */
@Controller("v1/people")
export class PeopleController {
  constructor(private readonly social: SocialService) {}

  @Get()
  @RateLimit({ name: "people-search", limit: 60, windowSeconds: 60, by: "user" })
  search(@CurrentUser() user: User, @Query() query: unknown): Promise<PersonDto[]> {
    const { q, limit } = parseBody(searchPeopleQuerySchema, query);
    return this.social.search(user, q, limit);
  }

  @Get(":userId")
  profile(@CurrentUser() user: User, @Param("userId", IdParam) id: string): Promise<PersonProfile> {
    return this.social.profile(user, id);
  }

  @Get(":userId/friends")
  friends(@CurrentUser() user: User, @Param("userId", IdParam) id: string): Promise<FriendDto[]> {
    return this.social.friendsOf(user, id);
  }
}

/** Community groups by region, route or specialty (F-122). Listing and details are public. */
@Controller("v1/groups")
export class GroupsController {
  constructor(private readonly groups: GroupsService) {}

  @Get()
  @Public()
  @RateLimit({ name: "groups-read", limit: 120, windowSeconds: 60, by: "ip" })
  search(@Query() query: unknown): Promise<GroupPage> {
    return this.groups.search(parseBody(searchGroupsQuerySchema, query));
  }

  @Get(":slug")
  @Public()
  @RateLimit({ name: "groups-read", limit: 120, windowSeconds: 60, by: "ip" })
  get(@Param("slug", SlugParam) slug: string): Promise<GroupDto> {
    return this.groups.getPublic(slug);
  }

  @Post()
  @RequireDisplayName()
  @RateLimit({ name: "group-create", limit: 10, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<GroupDto> {
    return this.groups.create(user, parseBody(createGroupSchema, body));
  }

  @Patch(":groupId")
  update(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Body() body: unknown,
  ): Promise<GroupDto> {
    return this.groups.update(user, id, parseBody(updateGroupSchema, body));
  }

  @Post(":groupId/archive")
  @HttpCode(204)
  async archive(@CurrentUser() user: User, @Param("groupId", IdParam) id: string): Promise<void> {
    await this.groups.archive(user, id);
  }

  @Post(":groupId/join")
  @HttpCode(200)
  @RequireDisplayName()
  @RateLimit({ name: "group-join", limit: 30, windowSeconds: 3600, by: "user" })
  join(@CurrentUser() user: User, @Param("groupId", IdParam) id: string): Promise<GroupDto> {
    return this.groups.join(user, id);
  }

  @Post(":groupId/leave")
  @HttpCode(204)
  async leave(@CurrentUser() user: User, @Param("groupId", IdParam) id: string): Promise<void> {
    await this.groups.leave(user, id);
  }

  @Get(":groupId/members")
  members(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Query("status") status: unknown,
  ): Promise<GroupMemberDto[]> {
    const which = status === "pending" || status === "banned" ? status : "active";
    return this.groups.members(user, id, which);
  }

  @Post(":groupId/members/:userId/approve")
  @HttpCode(204)
  async approve(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.groups.approve(user, id, userId);
  }

  @Post(":groupId/members/:userId/reject")
  @HttpCode(204)
  async reject(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.groups.reject(user, id, userId);
  }

  @Patch(":groupId/members/:userId")
  @HttpCode(204)
  async setRole(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
    @Body() body: unknown,
  ): Promise<void> {
    await this.groups.setRole(user, id, userId, parseBody(groupMemberRoleSchema, body).role);
  }

  @Delete(":groupId/members/:userId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.groups.remove(user, id, userId);
  }

  @Put(":groupId/bans/:userId")
  @HttpCode(204)
  async ban(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.groups.ban(user, id, userId);
  }

  @Delete(":groupId/bans/:userId")
  @HttpCode(204)
  async unban(
    @CurrentUser() user: User,
    @Param("groupId", IdParam) id: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.groups.unban(user, id, userId);
  }
}

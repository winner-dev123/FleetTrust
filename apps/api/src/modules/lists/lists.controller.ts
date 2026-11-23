import type { User } from "@fleettrust/db";
import {
  createListRequestSchema,
  createShareLinkRequestSchema,
  joinListRequestSchema,
  listItemRequestSchema,
  memberRoleRequestSchema,
  type SavedListDto,
  type SavedListSummary,
  updateListRequestSchema,
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
} from "@nestjs/common";

import { RateLimit } from "../../platform/rate-limit/index.js";
import { parseBody } from "../../platform/validation.js";
import { CurrentUser } from "../identity/index.js";
import { ListsService } from "./lists.service.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

@Injectable()
class IdParam implements PipeTransform<string, string> {
  transform(value: string): string {
    if (!UUID.test(value)) throw new NotFoundException({ statusCode: 404, error: "not_found" });
    return value.toLowerCase();
  }
}

/** Favorites: the caller's own built-in list. */
@Controller("v1/me/favorites")
export class FavoritesController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  get(@CurrentUser() user: User): Promise<SavedListDto> {
    return this.lists.getFavorites(user);
  }

  @Put(":organizationId")
  @RateLimit({ name: "lists-write", limit: 300, windowSeconds: 3600, by: "user" })
  add(
    @CurrentUser() user: User,
    @Param("organizationId", IdParam) organizationId: string,
  ): Promise<SavedListDto> {
    return this.lists.addFavorite(user, organizationId);
  }

  @Delete(":organizationId")
  @HttpCode(204)
  async remove(
    @CurrentUser() user: User,
    @Param("organizationId", IdParam) organizationId: string,
  ): Promise<void> {
    await this.lists.removeFavorite(user, organizationId);
  }
}

/** Named lists the caller owns or has joined (SRS F-101). */
@Controller("v1/me/lists")
export class ListsController {
  constructor(private readonly lists: ListsService) {}

  @Get()
  mine(@CurrentUser() user: User): Promise<SavedListSummary[]> {
    return this.lists.mine(user);
  }

  @Post()
  @RateLimit({ name: "lists-write", limit: 300, windowSeconds: 3600, by: "user" })
  create(@CurrentUser() user: User, @Body() body: unknown): Promise<SavedListDto> {
    return this.lists.create(user, parseBody(createListRequestSchema, body));
  }

  @Get(":listId")
  get(@CurrentUser() user: User, @Param("listId", IdParam) listId: string): Promise<SavedListDto> {
    return this.lists.get(user, listId);
  }

  @Patch(":listId")
  update(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Body() body: unknown,
  ): Promise<SavedListDto> {
    return this.lists.update(user, listId, parseBody(updateListRequestSchema, body));
  }

  @Delete(":listId")
  @HttpCode(204)
  async remove(@CurrentUser() user: User, @Param("listId", IdParam) listId: string): Promise<void> {
    await this.lists.remove(user, listId);
  }

  @Put(":listId/items/:organizationId")
  @RateLimit({ name: "lists-write", limit: 300, windowSeconds: 3600, by: "user" })
  putItem(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Param("organizationId", IdParam) organizationId: string,
    @Body() body: unknown,
  ): Promise<SavedListDto> {
    const { note } = parseBody(listItemRequestSchema, body ?? {});
    return this.lists.putItem(user, listId, organizationId, note);
  }

  @Delete(":listId/items/:organizationId")
  @HttpCode(204)
  async removeItem(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Param("organizationId", IdParam) organizationId: string,
  ): Promise<void> {
    await this.lists.removeItem(user, listId, organizationId);
  }

  @Post(":listId/share-links")
  @RateLimit({ name: "lists-share", limit: 30, windowSeconds: 3600, by: "user" })
  createShareLink(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Body() body: unknown,
  ) {
    return this.lists.createShareLink(
      user,
      listId,
      parseBody(createShareLinkRequestSchema, body ?? {}),
    );
  }

  @Get(":listId/share-links")
  shareLinks(@CurrentUser() user: User, @Param("listId", IdParam) listId: string) {
    return this.lists.shareLinks(user, listId);
  }

  @Delete(":listId/share-links/:linkId")
  @HttpCode(204)
  async revokeShareLink(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Param("linkId", IdParam) linkId: string,
  ): Promise<void> {
    await this.lists.revokeShareLink(user, listId, linkId);
  }

  @Patch(":listId/members/:userId")
  @HttpCode(204)
  async setMemberRole(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Param("userId", IdParam) userId: string,
    @Body() body: unknown,
  ): Promise<void> {
    const { role } = parseBody(memberRoleRequestSchema, body);
    await this.lists.setMemberRole(user, listId, userId, role);
  }

  /** The owner removes a member, or a member leaves by passing their own user ID. */
  @Delete(":listId/members/:userId")
  @HttpCode(204)
  async removeMember(
    @CurrentUser() user: User,
    @Param("listId", IdParam) listId: string,
    @Param("userId", IdParam) userId: string,
  ): Promise<void> {
    await this.lists.removeMember(user, listId, userId);
  }
}

/** Joining a shared list from a link (token in the body, never in the URL). */
@Controller("v1/lists")
export class JoinListController {
  constructor(private readonly lists: ListsService) {}

  @Post("join")
  @HttpCode(200)
  @RateLimit({ name: "lists-join", limit: 20, windowSeconds: 3600, by: "user" })
  join(@CurrentUser() user: User, @Body() body: unknown): Promise<SavedListSummary> {
    return this.lists.join(user, parseBody(joinListRequestSchema, body).token);
  }
}

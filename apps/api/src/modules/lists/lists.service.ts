import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  count,
  type Database,
  eq,
  type Executor,
  gt,
  inArray,
  isNull,
  organizations,
  providerMedia,
  providerProfiles,
  recordAuditEvent,
  type SavedList,
  savedListItems,
  savedListMembers,
  savedLists,
  savedListShareLinks,
  type User,
  users,
} from "@fleettrust/db";
import {
  type createListRequestSchema,
  type createShareLinkRequestSchema,
  type ListErrorReason,
  MAX_ACTIVE_SHARE_LINKS,
  MAX_ITEMS_PER_LIST,
  MAX_LISTS_PER_USER,
  MAX_MEMBERS_PER_LIST,
  type ProviderCategory,
  type SavedListDto,
  type SavedListItemDto,
  type SavedListSummary,
  type updateListRequestSchema,
} from "@fleettrust/types";
import type { z } from "zod";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";

type Role = "owner" | "editor" | "viewer";
type ListRole = "editor" | "viewer";

export function listError(status: 400 | 403 | 409 | 410, reason: ListErrorReason): Error {
  const error = { 400: "bad_request", 403: "forbidden", 409: "conflict", 410: "gone" }[status];
  const body = { statusCode: status, error, reason };
  if (status === 409) return new ConflictException(body);
  if (status === 403) return new ForbiddenException(body);
  if (status === 410) return new GoneException(body);
  return new BadRequestException(body);
}

const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });
const insufficient = () =>
  new ForbiddenException({ statusCode: 403, error: "forbidden", reason: "insufficient_role" });

const hashToken = (token: string) => createHash("sha256").update(token, "utf8").digest("hex");

/**
 * Favorites and named provider lists with sharing (SRS F-101, ADR-0020). Lists belong to a
 * user. Members are viewers (read) or editors (add and remove providers); only the owner
 * renames, deletes, shares and manages members. Non-members get 404 so list IDs can't be probed.
 */
@Injectable()
export class ListsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Access ----------------------------------------------------------------------------------

  /** The list and the caller's role in it; 404 when the caller has no access. */
  private async access(
    executor: Executor,
    actor: User,
    listId: string,
  ): Promise<{ list: SavedList; role: Role }> {
    const [list] = await executor.select().from(savedLists).where(eq(savedLists.id, listId));
    if (!list) throw notFound();
    if (list.ownerUserId === actor.id) return { list, role: "owner" };
    const [member] = await executor
      .select()
      .from(savedListMembers)
      .where(and(eq(savedListMembers.listId, listId), eq(savedListMembers.userId, actor.id)));
    if (!member) throw notFound();
    return { list, role: member.role };
  }

  private async require(executor: Executor, actor: User, listId: string, needed: Role[]) {
    const found = await this.access(executor, actor, listId);
    if (!needed.includes(found.role)) throw insufficient();
    return found;
  }

  /** The caller's favorites list, created on first use. */
  private async favorites(executor: Executor, actor: User): Promise<SavedList> {
    await executor
      .insert(savedLists)
      .values({ ownerUserId: actor.id, kind: "favorites", name: "Favorites" })
      .onConflictDoNothing();
    const [list] = await executor
      .select()
      .from(savedLists)
      .where(and(eq(savedLists.ownerUserId, actor.id), eq(savedLists.kind, "favorites")));
    if (!list) throw new Error("favorites list missing after upsert");
    return list;
  }

  // --- Reading ---------------------------------------------------------------------------------

  private async summaries(
    lists: readonly { list: SavedList; role: Role }[],
  ): Promise<SavedListSummary[]> {
    const ids = lists.map((l) => l.list.id);
    if (ids.length === 0) return [];
    const [items, members] = await Promise.all([
      this.db
        .select({ listId: savedListItems.listId, n: count() })
        .from(savedListItems)
        .where(inArray(savedListItems.listId, ids))
        .groupBy(savedListItems.listId),
      this.db
        .select({ listId: savedListMembers.listId, n: count() })
        .from(savedListMembers)
        .where(inArray(savedListMembers.listId, ids))
        .groupBy(savedListMembers.listId),
    ]);
    return lists.map(({ list, role }) => ({
      id: list.id,
      kind: list.kind,
      name: list.name,
      description: list.description,
      role,
      itemCount: items.find((i) => i.listId === list.id)?.n ?? 0,
      memberCount: members.find((m) => m.listId === list.id)?.n ?? 0,
      updatedAt: list.updatedAt.toISOString(),
    }));
  }

  /** Favorites first, then own lists, then lists shared with the caller. */
  async mine(actor: User): Promise<SavedListSummary[]> {
    await this.favorites(this.db, actor);
    const own = await this.db
      .select()
      .from(savedLists)
      .where(eq(savedLists.ownerUserId, actor.id))
      .orderBy(asc(savedLists.createdAt));
    const shared = await this.db
      .select({ list: savedLists, role: savedListMembers.role })
      .from(savedListMembers)
      .innerJoin(savedLists, eq(savedLists.id, savedListMembers.listId))
      .where(eq(savedListMembers.userId, actor.id))
      .orderBy(asc(savedListMembers.createdAt));
    const ordered = [
      ...own.filter((l) => l.kind === "favorites"),
      ...own.filter((l) => l.kind === "custom"),
    ].map((list) => ({ list, role: "owner" as const }));
    return this.summaries([...ordered, ...shared]);
  }

  async get(actor: User, listId: string): Promise<SavedListDto> {
    const found = await this.access(this.db, actor, listId);
    return this.detail(found);
  }

  async getFavorites(actor: User): Promise<SavedListDto> {
    const list = await this.favorites(this.db, actor);
    return this.detail({ list, role: "owner" });
  }

  private async detail(found: { list: SavedList; role: Role }): Promise<SavedListDto> {
    const [summary] = await this.summaries([found]);
    if (!summary) throw notFound();
    const items = await this.items(found.list.id);
    const members =
      found.role === "owner"
        ? (
            await this.db
              .select({ member: savedListMembers, displayName: users.displayName })
              .from(savedListMembers)
              .innerJoin(users, eq(users.id, savedListMembers.userId))
              .where(eq(savedListMembers.listId, found.list.id))
              .orderBy(asc(savedListMembers.createdAt))
          ).map((m) => ({
            userId: m.member.userId,
            displayName: m.displayName,
            role: m.member.role,
            joinedAt: m.member.createdAt.toISOString(),
          }))
        : null;
    return { ...summary, items, members };
  }

  /** Items with live provider details; unpublished or suspended providers are shown as unavailable. */
  private async items(listId: string): Promise<SavedListItemDto[]> {
    const rows = await this.db
      .select({ item: savedListItems, profile: providerProfiles, orgStatus: organizations.status })
      .from(savedListItems)
      .innerJoin(
        providerProfiles,
        eq(providerProfiles.organizationId, savedListItems.providerOrganizationId),
      )
      .innerJoin(organizations, eq(organizations.id, savedListItems.providerOrganizationId))
      .where(eq(savedListItems.listId, listId))
      .orderBy(asc(savedListItems.addedAt), asc(savedListItems.providerOrganizationId));
    const orgIds = rows.map((r) => r.item.providerOrganizationId);
    const logos = orgIds.length
      ? await this.db
          .select()
          .from(providerMedia)
          .where(
            and(
              inArray(providerMedia.organizationId, orgIds),
              eq(providerMedia.kind, "logo"),
              eq(providerMedia.status, "available"),
            ),
          )
      : [];
    return rows.map(({ item, profile, orgStatus }) => {
      const snapshot = profile.publishedSnapshot as {
        tradingName?: string;
        categories?: string[];
        branches?: { locality: string | null }[];
      } | null;
      const available =
        profile.status === "published" && orgStatus === "active" && snapshot !== null;
      const logo = logos.find((m) => m.organizationId === item.providerOrganizationId);
      return {
        organizationId: item.providerOrganizationId,
        available,
        slug: available ? profile.slug : null,
        tradingName: available ? (snapshot.tradingName ?? null) : null,
        categories: available ? ((snapshot.categories ?? []) as ProviderCategory[]) : [],
        locality: available ? (snapshot.branches?.[0]?.locality ?? null) : null,
        logoUrl: available && logo?.storageKey ? this.storage.publicUrl(logo.storageKey) : null,
        note: item.note,
        addedAt: item.addedAt.toISOString(),
      };
    });
  }

  // --- Lists -----------------------------------------------------------------------------------

  async create(
    actor: User,
    input: z.output<typeof createListRequestSchema>,
  ): Promise<SavedListDto> {
    const list = await this.db.transaction(async (tx) => {
      // Serialise per user so the cap holds under concurrency.
      await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.id)).for("update");
      const [owned] = await tx
        .select({ n: count() })
        .from(savedLists)
        .where(and(eq(savedLists.ownerUserId, actor.id), eq(savedLists.kind, "custom")));
      if ((owned?.n ?? 0) >= MAX_LISTS_PER_USER) throw listError(409, "too_many_lists");
      const [row] = await tx
        .insert(savedLists)
        .values({ ownerUserId: actor.id, kind: "custom", ...input })
        .returning();
      if (!row) throw new Error("list insert returned no row");
      await this.audit(tx, actor, "list.created", row.id);
      return row;
    });
    return this.detail({ list, role: "owner" });
  }

  async update(
    actor: User,
    listId: string,
    input: z.output<typeof updateListRequestSchema>,
  ): Promise<SavedListDto> {
    const { list } = await this.require(this.db, actor, listId, ["owner"]);
    if (list.kind === "favorites") throw listError(400, "favorites_locked");
    const [row] = await this.db
      .update(savedLists)
      .set({
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.description === undefined ? {} : { description: input.description }),
      })
      .where(eq(savedLists.id, listId))
      .returning();
    if (!row) throw notFound();
    return this.detail({ list: row, role: "owner" });
  }

  async remove(actor: User, listId: string): Promise<void> {
    const { list } = await this.require(this.db, actor, listId, ["owner"]);
    if (list.kind === "favorites") throw listError(400, "favorites_locked");
    await this.db.transaction(async (tx) => {
      await tx.delete(savedLists).where(eq(savedLists.id, listId));
      await this.audit(tx, actor, "list.deleted", listId);
    });
  }

  // --- Items -----------------------------------------------------------------------------------

  /** Only providers with a live published profile can be added. */
  private async assertProviderAvailable(executor: Executor, organizationId: string) {
    const [row] = await executor
      .select({ status: providerProfiles.status, orgStatus: organizations.status })
      .from(providerProfiles)
      .innerJoin(organizations, eq(organizations.id, providerProfiles.organizationId))
      .where(eq(providerProfiles.organizationId, organizationId));
    if (row?.status !== "published" || row.orgStatus !== "active") {
      throw listError(400, "provider_unavailable");
    }
  }

  async putItem(
    actor: User,
    listId: string,
    organizationId: string,
    note: string | null,
  ): Promise<SavedListDto> {
    await this.db.transaction(async (tx) => {
      await this.require(tx, actor, listId, ["owner", "editor"]);
      await tx
        .select({ id: savedLists.id })
        .from(savedLists)
        .where(eq(savedLists.id, listId))
        .for("update");
      await this.addItem(tx, actor, listId, organizationId, note);
    });
    return this.get(actor, listId);
  }

  private async addItem(
    executor: Executor,
    actor: User,
    listId: string,
    organizationId: string,
    note: string | null,
  ) {
    const [existing] = await executor
      .select()
      .from(savedListItems)
      .where(
        and(
          eq(savedListItems.listId, listId),
          eq(savedListItems.providerOrganizationId, organizationId),
        ),
      );
    if (existing) {
      await executor
        .update(savedListItems)
        .set({ note })
        .where(
          and(
            eq(savedListItems.listId, listId),
            eq(savedListItems.providerOrganizationId, organizationId),
          ),
        );
      return;
    }
    await this.assertProviderAvailable(executor, organizationId);
    const [items] = await executor
      .select({ n: count() })
      .from(savedListItems)
      .where(eq(savedListItems.listId, listId));
    if ((items?.n ?? 0) >= MAX_ITEMS_PER_LIST) throw listError(409, "list_full");
    await executor.insert(savedListItems).values({
      listId,
      providerOrganizationId: organizationId,
      note,
      addedBy: actor.id,
    });
    await executor
      .update(savedLists)
      .set({ updatedAt: this.clock.now() })
      .where(eq(savedLists.id, listId));
  }

  async removeItem(actor: User, listId: string, organizationId: string): Promise<void> {
    await this.require(this.db, actor, listId, ["owner", "editor"]);
    const deleted = await this.db
      .delete(savedListItems)
      .where(
        and(
          eq(savedListItems.listId, listId),
          eq(savedListItems.providerOrganizationId, organizationId),
        ),
      )
      .returning({ id: savedListItems.listId });
    if (deleted.length === 0) throw notFound();
  }

  async addFavorite(actor: User, organizationId: string): Promise<SavedListDto> {
    const list = await this.db.transaction(async (tx) => {
      const favorites = await this.favorites(tx, actor);
      await tx
        .select({ id: savedLists.id })
        .from(savedLists)
        .where(eq(savedLists.id, favorites.id))
        .for("update");
      await this.addItem(tx, actor, favorites.id, organizationId, null);
      return favorites;
    });
    return this.detail({ list, role: "owner" });
  }

  async removeFavorite(actor: User, organizationId: string): Promise<void> {
    const favorites = await this.favorites(this.db, actor);
    await this.removeItem(actor, favorites.id, organizationId);
  }

  // --- Sharing ---------------------------------------------------------------------------------

  async createShareLink(
    actor: User,
    listId: string,
    input: z.output<typeof createShareLinkRequestSchema>,
  ) {
    const { list } = await this.require(this.db, actor, listId, ["owner"]);
    if (list.kind === "favorites") throw listError(400, "favorites_locked");
    const now = this.clock.now();
    const token = randomBytes(32).toString("base64url");
    const link = await this.db.transaction(async (tx) => {
      await tx
        .select({ id: savedLists.id })
        .from(savedLists)
        .where(eq(savedLists.id, listId))
        .for("update");
      const [active] = await tx
        .select({ n: count() })
        .from(savedListShareLinks)
        .where(
          and(
            eq(savedListShareLinks.listId, listId),
            isNull(savedListShareLinks.revokedAt),
            gt(savedListShareLinks.expiresAt, now),
          ),
        );
      if ((active?.n ?? 0) >= MAX_ACTIVE_SHARE_LINKS) throw listError(409, "too_many_links");
      const [row] = await tx
        .insert(savedListShareLinks)
        .values({
          listId,
          tokenHash: hashToken(token),
          role: input.role,
          createdBy: actor.id,
          expiresAt: new Date(now.getTime() + input.expiresInDays * 86_400_000),
        })
        .returning();
      if (!row) throw new Error("share link insert returned no row");
      await this.audit(tx, actor, "list.share_link_created", listId, { role: input.role });
      return row;
    });
    return { link: this.linkDto(link), token, joinPath: `/lists/join#token=${token}` };
  }

  private linkDto(link: typeof savedListShareLinks.$inferSelect) {
    return {
      id: link.id,
      role: link.role,
      expiresAt: link.expiresAt.toISOString(),
      revokedAt: link.revokedAt?.toISOString() ?? null,
      createdAt: link.createdAt.toISOString(),
    };
  }

  async shareLinks(actor: User, listId: string) {
    await this.require(this.db, actor, listId, ["owner"]);
    const rows = await this.db
      .select()
      .from(savedListShareLinks)
      .where(eq(savedListShareLinks.listId, listId))
      .orderBy(asc(savedListShareLinks.createdAt));
    return rows.map((r) => this.linkDto(r));
  }

  async revokeShareLink(actor: User, listId: string, linkId: string): Promise<void> {
    await this.require(this.db, actor, listId, ["owner"]);
    const rows = await this.db
      .update(savedListShareLinks)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(
          eq(savedListShareLinks.id, linkId),
          eq(savedListShareLinks.listId, listId),
          isNull(savedListShareLinks.revokedAt),
        ),
      )
      .returning({ id: savedListShareLinks.id });
    if (rows.length === 0) throw notFound();
    await this.audit(this.db, actor, "list.share_link_revoked", listId);
  }

  /** Joins via a link. Re-joining never lowers an existing role. */
  async join(actor: User, token: string): Promise<SavedListSummary> {
    const now = this.clock.now();
    const listId = await this.db.transaction(async (tx) => {
      const [link] = await tx
        .select()
        .from(savedListShareLinks)
        .where(eq(savedListShareLinks.tokenHash, hashToken(token)));
      if (link?.revokedAt !== null || link.expiresAt <= now) {
        throw listError(410, "link_invalid");
      }
      const [list] = await tx
        .select()
        .from(savedLists)
        .where(eq(savedLists.id, link.listId))
        .for("update");
      if (!list) throw listError(410, "link_invalid");
      if (list.ownerUserId === actor.id) throw listError(409, "owner_cannot_join");
      const [existing] = await tx
        .select()
        .from(savedListMembers)
        .where(and(eq(savedListMembers.listId, list.id), eq(savedListMembers.userId, actor.id)));
      if (existing) {
        if (existing.role === "viewer" && link.role === "editor") {
          await tx
            .update(savedListMembers)
            .set({ role: "editor" })
            .where(
              and(eq(savedListMembers.listId, list.id), eq(savedListMembers.userId, actor.id)),
            );
        }
        return list.id;
      }
      const [members] = await tx
        .select({ n: count() })
        .from(savedListMembers)
        .where(eq(savedListMembers.listId, list.id));
      if ((members?.n ?? 0) >= MAX_MEMBERS_PER_LIST) throw listError(409, "too_many_members");
      await tx
        .insert(savedListMembers)
        .values({ listId: list.id, userId: actor.id, role: link.role });
      await this.audit(tx, actor, "list.joined", list.id, { role: link.role });
      return list.id;
    });
    const found = await this.access(this.db, actor, listId);
    const [summary] = await this.summaries([found]);
    if (!summary) throw notFound();
    return summary;
  }

  async setMemberRole(actor: User, listId: string, userId: string, role: ListRole): Promise<void> {
    await this.require(this.db, actor, listId, ["owner"]);
    const rows = await this.db
      .update(savedListMembers)
      .set({ role })
      .where(and(eq(savedListMembers.listId, listId), eq(savedListMembers.userId, userId)))
      .returning({ id: savedListMembers.userId });
    if (rows.length === 0) throw notFound();
    await this.audit(this.db, actor, "list.member_role_changed", listId, { userId, role });
  }

  /** The owner removes a member, or a member leaves (userId = themselves). */
  async removeMember(actor: User, listId: string, userId: string): Promise<void> {
    const { role } = await this.access(this.db, actor, listId);
    if (role !== "owner" && userId !== actor.id) throw insufficient();
    const rows = await this.db
      .delete(savedListMembers)
      .where(and(eq(savedListMembers.listId, listId), eq(savedListMembers.userId, userId)))
      .returning({ id: savedListMembers.userId });
    if (rows.length === 0) throw notFound();
    await this.audit(
      this.db,
      actor,
      userId === actor.id ? "list.left" : "list.member_removed",
      listId,
      {
        userId,
      },
    );
  }

  private async audit(
    executor: Executor,
    actor: User,
    action: string,
    listId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      action,
      targetType: "saved_list",
      targetId: listId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }
}

import { createHash, randomBytes } from "node:crypto";

import {
  and,
  type CommunityGroup,
  type CommunityGroupMember,
  communityGroupMembers,
  communityGroups,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  inArray,
  memberships,
  organizations,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
  userBlocks,
  users,
} from "@fleettrust/db";
import {
  type createGroupSchema,
  type GroupDto,
  type GroupMemberDto,
  type GroupPage,
  type GroupRole,
  type GroupSummary,
  hasPermission,
  MAX_GROUP_MEMBERSHIPS,
  type Role,
  type searchGroupsQuerySchema,
  type updateGroupSchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import {
  EntitlementsService,
  subjectOfOrganization,
  subjectOfUser,
} from "../entitlements/index.js";
import { communityError, likeEscape, notFound } from "./shared.js";

type CreateInput = z.output<typeof createGroupSchema>;
type UpdateInput = z.output<typeof updateGroupSchema>;
type SearchInput = z.output<typeof searchGroupsQuerySchema>;

const FALLBACK_NAME = "FleetTrust member";
const MAX_SEARCH_OFFSET = 1_000;
const RANK: Record<GroupRole, number> = { owner: 3, moderator: 2, member: 1 };

function slugify(name: string): string {
  const base = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  const suffix = randomBytes(4).readUInt32BE(0).toString(36).padStart(6, "0").slice(0, 6);
  return `${base === "" ? "group" : base}-${suffix}`;
}

/**
 * Community groups by region, route or specialty (F-122, ADR-0023): creation with the
 * `groups.daily` quota, open or approval-based joining, owner and moderator roles, removals and
 * bans. Every moderation action inside a group is audited. Group messaging is Prompt 17.
 */
@Injectable()
export class GroupsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    private readonly entitlements: EntitlementsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async audit(
    executor: Executor,
    actor: User,
    group: CommunityGroup,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: group.organizationId,
      action: `group.${action}`,
      targetType: "group",
      targetId: group.id,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  private async activeMemberships(executor: Executor, userId: string): Promise<number> {
    const [row] = await queryRows<{ n: number }>(
      executor,
      sql`SELECT count(*)::int AS n FROM community_group_members
          WHERE user_id = ${userId} AND status IN ('active', 'pending')`,
    );
    return row?.n ?? 0;
  }

  /** The caller may host for this organization (`groups.host`, active organization). */
  private async hostOrganization(executor: Executor, user: User, organizationId: string) {
    const [row] = await executor
      .select({ organization: organizations, role: memberships.role })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(and(eq(memberships.organizationId, organizationId), eq(memberships.userId, user.id)));
    if (row?.organization.status !== "active") throw notFound();
    if (!hasPermission(row.role as Role, "groups.host")) throw notFound();
    return row.organization;
  }

  /** Active (or, for owners tidying up, archived) group; hidden groups are 404. */
  private async group(executor: Executor, id: string, lock = false): Promise<CommunityGroup> {
    const query = executor.select().from(communityGroups).where(eq(communityGroups.id, id));
    const [row] = lock ? await query.for("update") : await query;
    if (row?.status !== "active") throw notFound();
    return row;
  }

  private async member(
    executor: Executor,
    groupId: string,
    userId: string,
  ): Promise<CommunityGroupMember | undefined> {
    const [row] = await executor
      .select()
      .from(communityGroupMembers)
      .where(
        and(eq(communityGroupMembers.groupId, groupId), eq(communityGroupMembers.userId, userId)),
      );
    return row;
  }

  /** The caller's active role, at least `minimum` (403 otherwise; 404 if not a member). */
  private async actorRole(
    executor: Executor,
    groupId: string,
    user: User,
    minimum: GroupRole,
  ): Promise<GroupRole> {
    const row = await this.member(executor, groupId, user.id);
    if (row?.status !== "active") throw notFound();
    if (RANK[row.role] < RANK[minimum]) throw communityError(403, "not_allowed");
    return row.role;
  }

  // -------------------------------------------------------------------------------------------
  // Groups
  // -------------------------------------------------------------------------------------------

  async create(user: User, input: CreateInput): Promise<GroupDto> {
    const row = await this.db.transaction(async (tx) => {
      const host =
        input.organizationId === null
          ? null
          : await this.hostOrganization(tx, user, input.organizationId);
      if ((await this.activeMemberships(tx, user.id)) >= MAX_GROUP_MEMBERSHIPS) {
        throw communityError(409, "too_many_groups", { limit: MAX_GROUP_MEMBERSHIPS });
      }
      const [inserted] = await tx
        .insert(communityGroups)
        .values({
          slug: slugify(input.name),
          name: input.name,
          description: input.description,
          kind: input.kind,
          specialty: input.specialty,
          locationLabel: input.locationLabel,
          location: input.location,
          joinPolicy: input.joinPolicy,
          createdBy: user.id,
          organizationId: host?.id ?? null,
        })
        .returning();
      if (!inserted) throw new Error("group insert returned no row");
      await tx
        .insert(communityGroupMembers)
        .values({ groupId: inserted.id, userId: user.id, role: "owner", status: "active" });
      await this.entitlements.consume(
        tx,
        host === null ? subjectOfUser(user) : subjectOfOrganization(host),
        "groups.daily",
        { idempotencyKey: `group:${inserted.id}` },
      );
      await this.audit(tx, user, inserted, "created", { kind: inserted.kind });
      return inserted;
    });
    return this.dto(row, { role: "owner", status: "active" });
  }

  async search(query: SearchInput): Promise<GroupPage> {
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify([
          query.q,
          query.kind,
          query.specialty,
          query.lng,
          query.lat,
          query.radiusKm,
        ]),
      )
      .digest("hex")
      .slice(0, 12);
    let offset = 0;
    if (query.cursor !== undefined) {
      try {
        const parsed = JSON.parse(Buffer.from(query.cursor, "base64url").toString()) as {
          o?: unknown;
          f?: unknown;
        };
        if (typeof parsed.o !== "number" || !Number.isInteger(parsed.o) || parsed.f !== fingerprint)
          throw new Error("mismatch");
        offset = parsed.o;
      } catch {
        throw communityError(400, "invalid_cursor");
      }
      if (offset < 0 || offset > MAX_SEARCH_OFFSET) throw communityError(400, "invalid_cursor");
    }
    const near =
      query.lng === undefined || query.lat === undefined
        ? null
        : sql`ST_SetSRID(ST_MakePoint(${query.lng}::float8, ${query.lat}::float8), 4326)::geography`;
    const pattern = query.q === undefined ? null : `%${likeEscape(query.q)}%`;
    const filters = [
      sql`g.status = 'active'`,
      pattern === null
        ? null
        : sql`(g.name ILIKE ${pattern} OR g.location_label ILIKE ${pattern} OR g.description ILIKE ${pattern})`,
      query.kind === undefined ? null : sql`g.kind = ${query.kind}`,
      query.specialty === undefined ? null : sql`g.specialty = ${query.specialty}`,
      near === null ? null : sql`ST_DWithin(g.location, ${near}, ${query.radiusKm * 1000}::float8)`,
    ].filter((f) => f !== null);
    const order =
      near === null
        ? sql`g.created_at DESC, g.id DESC`
        : sql`ST_Distance(g.location, ${near}) ASC, g.id DESC`;
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`SELECT g.id FROM community_groups g WHERE ${sql.join(filters, sql` AND `)}
          ORDER BY ${order} LIMIT ${query.limit + 1} OFFSET ${offset}`,
    );
    const ids = rows.slice(0, query.limit).map((r) => r.id);
    const groups =
      ids.length === 0
        ? []
        : await this.db.select().from(communityGroups).where(inArray(communityGroups.id, ids));
    const byId = new Map(groups.map((g) => [g.id, g]));
    const ordered = ids
      .map((id) => byId.get(id))
      .filter((g): g is CommunityGroup => g !== undefined);
    const next = offset + query.limit;
    return {
      items: await this.summaries(ordered),
      nextCursor:
        rows.length > query.limit && next <= MAX_SEARCH_OFFSET
          ? Buffer.from(JSON.stringify({ o: next, f: fingerprint })).toString("base64url")
          : null,
    };
  }

  async getPublic(slug: string): Promise<GroupDto> {
    const [row] = await this.db
      .select()
      .from(communityGroups)
      .where(and(eq(communityGroups.slug, slug), eq(communityGroups.status, "active")));
    if (!row) throw notFound();
    return this.dto(row, null);
  }

  async mine(user: User): Promise<GroupDto[]> {
    const rows = await this.db
      .select({ group: communityGroups, member: communityGroupMembers })
      .from(communityGroupMembers)
      .innerJoin(communityGroups, eq(communityGroups.id, communityGroupMembers.groupId))
      .where(
        and(
          eq(communityGroupMembers.userId, user.id),
          inArray(communityGroupMembers.status, ["active", "pending"]),
          inArray(communityGroups.status, ["active", "archived"]),
        ),
      )
      .orderBy(desc(communityGroupMembers.createdAt));
    const summaries = await this.summaries(rows.map((r) => r.group));
    return summaries.map((s, i) => {
      const r = rows[i];
      if (!r) throw new Error("row mismatch");
      return {
        ...s,
        status: r.group.status,
        membership: { role: r.member.role, status: r.member.status as "active" | "pending" },
      };
    });
  }

  async update(user: User, groupId: string, change: UpdateInput): Promise<GroupDto> {
    const row = await this.db.transaction(async (tx) => {
      const current = await this.group(tx, groupId, true);
      const role = await this.actorRole(tx, current.id, user, "moderator");
      if (change.locationLabel !== undefined && current.kind === "specialty") {
        throw communityError(400, "not_allowed");
      }
      const [updated] = await tx
        .update(communityGroups)
        .set({
          ...(change.name === undefined ? {} : { name: change.name }),
          ...(change.description === undefined ? {} : { description: change.description }),
          ...(change.locationLabel === undefined ? {} : { locationLabel: change.locationLabel }),
          ...(change.location === undefined ? {} : { location: change.location }),
          ...(change.joinPolicy === undefined ? {} : { joinPolicy: change.joinPolicy }),
        })
        .where(eq(communityGroups.id, current.id))
        .returning();
      if (!updated) throw notFound();
      await this.audit(tx, user, updated, "updated", { fields: Object.keys(change), role });
      return { updated, role };
    });
    return this.dto(row.updated, { role: row.role, status: "active" });
  }

  /** Owner only. Archived groups leave search and accept no new members. */
  async archive(user: User, groupId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.group(tx, groupId, true);
      await this.actorRole(tx, current.id, user, "owner");
      await tx
        .update(communityGroups)
        .set({ status: "archived" })
        .where(eq(communityGroups.id, current.id));
      await this.audit(tx, user, current, "archived");
    });
  }

  // -------------------------------------------------------------------------------------------
  // Membership
  // -------------------------------------------------------------------------------------------

  /** Open groups: joined at once. Approval groups: a pending request for the moderators. */
  async join(user: User, groupId: string): Promise<GroupDto> {
    const result = await this.db.transaction(async (tx) => {
      const group = await this.group(tx, groupId, true);
      const existing = await this.member(tx, group.id, user.id);
      if (existing?.status === "banned") throw communityError(403, "cannot_join");
      if (existing) throw communityError(409, "already_member");
      // Someone the owner has blocked can't join their group (AB-05).
      const owner = await tx
        .select({ id: communityGroupMembers.userId })
        .from(communityGroupMembers)
        .where(
          and(eq(communityGroupMembers.groupId, group.id), eq(communityGroupMembers.role, "owner")),
        );
      const ownerId = owner[0]?.id;
      if (ownerId !== undefined) {
        const [blocked] = await tx
          .select({ id: userBlocks.blockedId })
          .from(userBlocks)
          .where(and(eq(userBlocks.blockerId, ownerId), eq(userBlocks.blockedId, user.id)));
        if (blocked) throw communityError(403, "cannot_join");
      }
      if ((await this.activeMemberships(tx, user.id)) >= MAX_GROUP_MEMBERSHIPS) {
        throw communityError(409, "too_many_groups", { limit: MAX_GROUP_MEMBERSHIPS });
      }
      const status = group.joinPolicy === "open" ? ("active" as const) : ("pending" as const);
      await tx.insert(communityGroupMembers).values({ groupId: group.id, userId: user.id, status });
      if (status === "pending") {
        await enqueueOutboxEvent(tx, {
          aggregateType: "group",
          aggregateId: group.id,
          eventType: "GroupJoinRequested",
          payload: { groupId: group.id, userId: user.id },
        });
      }
      return { group, status };
    });
    return this.dto(result.group, { role: "member", status: result.status });
  }

  /** Owners must hand over ownership (or archive the group) first. */
  async leave(user: User, groupId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.member(tx, groupId, user.id);
      if (!row || row.status === "banned") throw notFound();
      if (row.role === "owner") throw communityError(409, "owner_must_transfer");
      await tx
        .delete(communityGroupMembers)
        .where(
          and(
            eq(communityGroupMembers.groupId, groupId),
            eq(communityGroupMembers.userId, user.id),
          ),
        );
    });
  }

  /** Members only. People you blocked, or who blocked you, aren't listed. */
  async members(
    user: User,
    groupId: string,
    status: "active" | "pending" | "banned",
  ): Promise<GroupMemberDto[]> {
    await this.group(this.db, groupId);
    await this.actorRole(this.db, groupId, user, status === "active" ? "member" : "moderator");
    const rows = await this.db
      .select({ member: communityGroupMembers, name: users.displayName, userStatus: users.status })
      .from(communityGroupMembers)
      .innerJoin(users, eq(users.id, communityGroupMembers.userId))
      .where(
        and(eq(communityGroupMembers.groupId, groupId), eq(communityGroupMembers.status, status)),
      )
      .orderBy(communityGroupMembers.createdAt)
      .limit(1_000);
    const blocked = await this.blockedIds(user.id);
    return rows
      .filter(
        (r) => r.userStatus === "active" && (status !== "active" || !blocked.has(r.member.userId)),
      )
      .map((r) => ({
        userId: r.member.userId,
        displayName: r.name ?? FALLBACK_NAME,
        role: r.member.role,
        status: r.member.status,
        since: r.member.createdAt.toISOString(),
      }));
  }

  private async blockedIds(userId: string): Promise<Set<string>> {
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`SELECT blocked_id AS id FROM user_blocks WHERE blocker_id = ${userId}
          UNION SELECT blocker_id FROM user_blocks WHERE blocked_id = ${userId}`,
    );
    return new Set(rows.map((r) => r.id));
  }

  /**
   * Moderator actions on another member. Moderators act on members; the owner on anyone but
   * themselves.
   */
  private async moderate(
    user: User,
    groupId: string,
    targetId: string,
    action: (
      tx: Executor,
      group: CommunityGroup,
      target: CommunityGroupMember | undefined,
    ) => Promise<string>,
  ): Promise<void> {
    if (targetId === user.id) throw communityError(400, "not_allowed");
    await this.db.transaction(async (tx) => {
      const group = await this.group(tx, groupId, true);
      const role = await this.actorRole(tx, group.id, user, "moderator");
      const target = await this.member(tx, group.id, targetId);
      if (target && target.status !== "pending" && RANK[target.role] >= RANK[role]) {
        throw communityError(403, "not_allowed");
      }
      const audited = await action(tx, group, target);
      await this.audit(tx, user, group, audited, { userId: targetId, by: role });
    });
  }

  async approve(user: User, groupId: string, targetId: string): Promise<void> {
    await this.moderate(user, groupId, targetId, async (tx, group, target) => {
      if (target?.status !== "pending") throw notFound();
      await tx
        .update(communityGroupMembers)
        .set({ status: "active", decidedBy: user.id })
        .where(
          and(
            eq(communityGroupMembers.groupId, group.id),
            eq(communityGroupMembers.userId, targetId),
          ),
        );
      await enqueueOutboxEvent(tx, {
        aggregateType: "group",
        aggregateId: group.id,
        eventType: "GroupMemberApproved",
        payload: { groupId: group.id, userId: targetId },
      });
      return "member_approved";
    });
  }

  async reject(user: User, groupId: string, targetId: string): Promise<void> {
    await this.moderate(user, groupId, targetId, async (tx, group, target) => {
      if (target?.status !== "pending") throw notFound();
      await tx
        .delete(communityGroupMembers)
        .where(
          and(
            eq(communityGroupMembers.groupId, group.id),
            eq(communityGroupMembers.userId, targetId),
          ),
        );
      return "member_rejected";
    });
  }

  async remove(user: User, groupId: string, targetId: string): Promise<void> {
    await this.moderate(user, groupId, targetId, async (tx, group, target) => {
      if (target?.status !== "active") throw notFound();
      await tx
        .delete(communityGroupMembers)
        .where(
          and(
            eq(communityGroupMembers.groupId, group.id),
            eq(communityGroupMembers.userId, targetId),
          ),
        );
      return "member_removed";
    });
  }

  /** Bans a member (or anyone, pre-emptively): they can't rejoin until unbanned. */
  async ban(user: User, groupId: string, targetId: string): Promise<void> {
    await this.moderate(user, groupId, targetId, async (tx, group, target) => {
      if (target?.status === "banned") return "member_banned";
      const [exists] = await tx.select({ id: users.id }).from(users).where(eq(users.id, targetId));
      if (!exists) throw notFound();
      await tx
        .insert(communityGroupMembers)
        .values({
          groupId: group.id,
          userId: targetId,
          role: "member",
          status: "banned",
          decidedBy: user.id,
        })
        .onConflictDoUpdate({
          target: [communityGroupMembers.groupId, communityGroupMembers.userId],
          set: { role: "member", status: "banned", decidedBy: user.id },
        });
      return "member_banned";
    });
  }

  async unban(user: User, groupId: string, targetId: string): Promise<void> {
    await this.moderate(user, groupId, targetId, async (tx, group, target) => {
      if (target?.status !== "banned") throw notFound();
      await tx
        .delete(communityGroupMembers)
        .where(
          and(
            eq(communityGroupMembers.groupId, group.id),
            eq(communityGroupMembers.userId, targetId),
          ),
        );
      return "member_unbanned";
    });
  }

  /** Owner only. Making someone owner hands over ownership; the old owner becomes a moderator. */
  async setRole(user: User, groupId: string, targetId: string, role: GroupRole): Promise<void> {
    if (targetId === user.id) throw communityError(400, "not_allowed");
    await this.db.transaction(async (tx) => {
      const group = await this.group(tx, groupId, true);
      await this.actorRole(tx, group.id, user, "owner");
      const target = await this.member(tx, group.id, targetId);
      if (target?.status !== "active") throw notFound();
      const where = (id: string) =>
        and(eq(communityGroupMembers.groupId, group.id), eq(communityGroupMembers.userId, id));
      if (role === "owner") {
        await tx
          .update(communityGroupMembers)
          .set({ role: "moderator", decidedBy: user.id })
          .where(where(user.id));
      }
      await tx
        .update(communityGroupMembers)
        .set({ role, decidedBy: user.id })
        .where(where(targetId));
      await this.audit(
        tx,
        user,
        group,
        role === "owner" ? "ownership_transferred" : "role_changed",
        {
          userId: targetId,
          from: target.role,
          to: role,
        },
      );
    });
  }

  // -------------------------------------------------------------------------------------------
  // DTOs
  // -------------------------------------------------------------------------------------------

  private async summaries(rows: readonly CommunityGroup[]): Promise<GroupSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((r) => r.id);
    const orgIds = [
      ...new Set(rows.map((r) => r.organizationId).filter((v): v is string => v !== null)),
    ];
    const [counts, orgs] = await Promise.all([
      queryRows<{ group_id: string; n: number }>(
        this.db,
        sql`SELECT group_id, count(*)::int AS n FROM community_group_members
            WHERE status = 'active' AND group_id IN (${sql.join(
              ids.map((id) => sql`${id}::uuid`),
              sql`, `,
            )}) GROUP BY group_id`,
      ),
      orgIds.length === 0
        ? Promise.resolve([])
        : this.db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, orgIds)),
    ]);
    const count = new Map(counts.map((c) => [c.group_id, c.n]));
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return rows.map((row) => ({
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      kind: row.kind,
      specialty: row.specialty,
      locationLabel: row.locationLabel,
      joinPolicy: row.joinPolicy,
      memberCount: count.get(row.id) ?? 0,
      host:
        row.organizationId === null
          ? null
          : { id: row.organizationId, name: orgName.get(row.organizationId) ?? "" },
      createdAt: row.createdAt.toISOString(),
    }));
  }

  private async dto(row: CommunityGroup, membership: GroupDto["membership"]): Promise<GroupDto> {
    const [summary] = await this.summaries([row]);
    if (!summary) throw notFound();
    return { ...summary, status: row.status, membership };
  }
}

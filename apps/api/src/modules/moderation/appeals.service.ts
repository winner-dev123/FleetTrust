import {
  and,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  inArray,
  type ModerationAppeal,
  moderationActions,
  moderationAppeals,
  memberSanctions,
  type User,
} from "@fleettrust/db";
import {
  MODERATION_APPEAL_WINDOW_DAYS,
  type ModerationAppealDto,
  type moderationAppealDecisionSchema,
  type moderationAppealQuerySchema,
  type moderationAppealRequestSchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { PowerUserService, trustError } from "../power-user/index.js";
import { ModerationService } from "./moderation.service.js";
import { SanctionsService } from "./sanctions.service.js";
import { notFound } from "./shared.js";

type AppealInput = z.output<typeof moderationAppealRequestSchema>;
type DecisionInput = z.output<typeof moderationAppealDecisionSchema>;
type AppealQuery = z.output<typeof moderationAppealQuerySchema>;
const DAY_MS = 86_400_000;

/**
 * Appeals of moderator decisions (SRS J9, F-160, ADR-0030): a sanction, a Power User
 * revocation, or a reject/hide decision about your content. Filed within
 * MODERATION_APPEAL_WINDOW_DAYS, once per decision, and decided by a different moderator than
 * the one who made the decision. Overturning undoes the decision.
 */
@Injectable()
export class AppealsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly moderation: ModerationService,
    private readonly sanctions: SanctionsService,
    private readonly powerUsers: PowerUserService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private withinWindow(decidedAt: Date): boolean {
    return (
      this.clock.now().getTime() - decidedAt.getTime() <= MODERATION_APPEAL_WINDOW_DAYS * DAY_MS
    );
  }

  async file(user: User, input: AppealInput): Promise<ModerationAppealDto> {
    let values: typeof moderationAppeals.$inferInsert;
    if (input.kind === "sanction") {
      const [sanction] = await this.db
        .select()
        .from(memberSanctions)
        .where(and(eq(memberSanctions.id, input.sanctionId), eq(memberSanctions.userId, user.id)));
      if (!sanction) throw notFound();
      if (sanction.overturned) throw trustError("not_appealable");
      if (!this.withinWindow(sanction.startsAt)) throw trustError("appeal_window_closed");
      values = {
        userId: user.id,
        kind: "sanction",
        sanctionId: sanction.id,
        statement: input.statement,
      };
    } else if (input.kind === "power_user") {
      const status = await this.powerUsers.statusOf(this.db, user.id);
      if (status?.status !== "revoked" || status.revokedAt === null)
        throw trustError("not_appealable");
      if (!this.withinWindow(status.revokedAt)) throw trustError("appeal_window_closed");
      values = {
        userId: user.id,
        kind: "power_user",
        powerUserRevokedAt: status.revokedAt,
        statement: input.statement,
      };
    } else {
      const [action] = await this.db
        .select()
        .from(moderationActions)
        .where(eq(moderationActions.id, input.moderationActionId));
      // Only reject and hide decisions about your own content can be appealed.
      if (action?.metadata["authorUserId"] !== user.id) throw notFound();
      if (action.action !== "reject" && action.action !== "hide")
        throw trustError("not_appealable");
      if (!this.withinWindow(action.createdAt)) throw trustError("appeal_window_closed");
      values = {
        userId: user.id,
        kind: "content",
        moderationActionId: action.id,
        statement: input.statement,
      };
    }
    try {
      const [row] = await this.db.insert(moderationAppeals).values(values).returning();
      if (!row) throw new Error("appeal insert returned no row");
      const [dto] = await this.dtos([row]);
      if (!dto) throw notFound();
      return dto;
    } catch (error) {
      if (String((error as { cause?: unknown }).cause ?? error).includes("moderation_appeals_")) {
        throw trustError("already_appealed");
      }
      throw error;
    }
  }

  async mine(user: User): Promise<ModerationAppealDto[]> {
    const rows = await this.db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.userId, user.id))
      .orderBy(desc(moderationAppeals.createdAt));
    return this.dtos(rows);
  }

  async list(query: AppealQuery): Promise<ModerationAppealDto[]> {
    const rows = await this.db
      .select()
      .from(moderationAppeals)
      .where(
        and(
          query.status ? eq(moderationAppeals.status, query.status) : undefined,
          query.kind ? eq(moderationAppeals.kind, query.kind) : undefined,
        ),
      )
      .orderBy(moderationAppeals.createdAt)
      .limit(200);
    return this.dtos(rows);
  }

  async forUser(userId: string): Promise<ModerationAppealDto[]> {
    const rows = await this.db
      .select()
      .from(moderationAppeals)
      .where(eq(moderationAppeals.userId, userId))
      .orderBy(desc(moderationAppeals.createdAt));
    return this.dtos(rows);
  }

  async decide(
    moderator: User,
    appealId: string,
    input: DecisionInput,
  ): Promise<ModerationAppealDto> {
    const row = await this.db.transaction(async (tx) => {
      const [appeal] = await tx
        .select()
        .from(moderationAppeals)
        .where(eq(moderationAppeals.id, appealId))
        .for("update");
      if (!appeal) throw notFound();
      if (appeal.status !== "open") throw trustError("invalid_transition");
      if (appeal.userId === moderator.id) throw trustError("own_account");
      const overturn = input.outcome === "overturned";

      // A second pair of eyes: whoever made the decision can't decide its appeal.
      if (appeal.kind === "sanction" && appeal.sanctionId) {
        const [sanction] = await tx
          .select()
          .from(memberSanctions)
          .where(eq(memberSanctions.id, appeal.sanctionId))
          .for("update");
        if (!sanction) throw notFound();
        if (sanction.createdBy === moderator.id) throw trustError("own_decision");
        if (overturn) {
          await this.sanctions.liftRow(tx, sanction, moderator, "Overturned on appeal", true);
        }
      } else if (appeal.kind === "power_user" && appeal.powerUserRevokedAt) {
        const status = await this.powerUsers.statusOf(tx, appeal.userId);
        if (status?.revokedBy === moderator.id) throw trustError("own_decision");
        if (overturn) {
          await this.powerUsers.reinstate(tx, moderator, appeal.userId, appeal.powerUserRevokedAt);
        }
      } else if (appeal.kind === "content" && appeal.moderationActionId) {
        const [action] = await tx
          .select()
          .from(moderationActions)
          .where(eq(moderationActions.id, appeal.moderationActionId));
        if (!action) throw notFound();
        if (action.moderatorUserId === moderator.id) throw trustError("own_decision");
        if (overturn) {
          await this.moderation.restoreAfterAppeal(
            tx,
            moderator,
            action.targetType,
            action.targetId,
          );
        }
      }

      const [decided] = await tx
        .update(moderationAppeals)
        .set({
          status: input.outcome,
          decidedBy: moderator.id,
          decidedAt: this.clock.now(),
          decisionReason: input.reason,
        })
        .where(eq(moderationAppeals.id, appeal.id))
        .returning();
      if (!decided) throw notFound();
      await this.moderation.record(
        tx,
        moderator,
        "user",
        appeal.userId,
        overturn ? "appeal_overturned" : "appeal_upheld",
        input.reason,
        { appealId: appeal.id, kind: appeal.kind },
      );
      await enqueueOutboxEvent(tx, {
        aggregateType: "moderation_appeal",
        aggregateId: appeal.id,
        eventType: "AppealDecided",
        payload: { userId: appeal.userId, outcome: input.outcome, kind: appeal.kind },
      });
      return decided;
    });
    const [dto] = await this.dtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  private async dtos(rows: readonly ModerationAppeal[]): Promise<ModerationAppealDto[]> {
    const actionIds = rows.flatMap((r) => (r.moderationActionId ? [r.moderationActionId] : []));
    const actions = actionIds.length
      ? await this.db
          .select({
            id: moderationActions.id,
            targetType: moderationActions.targetType,
            targetId: moderationActions.targetId,
          })
          .from(moderationActions)
          .where(inArray(moderationActions.id, actionIds))
      : [];
    const target = new Map(actions.map((a) => [a.id, a]));
    return rows.map((r) => {
      const t = r.moderationActionId ? target.get(r.moderationActionId) : undefined;
      return {
        id: r.id,
        userId: r.userId,
        kind: r.kind,
        sanctionId: r.sanctionId,
        moderationActionId: r.moderationActionId,
        target: t ? { type: t.targetType, id: t.targetId } : null,
        statement: r.statement,
        status: r.status,
        decisionReason: r.decisionReason,
        decidedAt: r.decidedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      };
    });
  }
}

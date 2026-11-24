import {
  and,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  gt,
  isNull,
  type MemberSanction,
  memberSanctions,
  ne,
  or,
  type User,
  users,
} from "@fleettrust/db";
import type { SanctionDto, sanctionRequestSchema } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { PowerUserService, trustError } from "../power-user/index.js";
import { ModerationService } from "./moderation.service.js";
import { notFound } from "./shared.js";

type SanctionInput = z.output<typeof sanctionRequestSchema>;
const DAY_MS = 86_400_000;

export function sanctionDto(row: MemberSanction): SanctionDto {
  return {
    id: row.id,
    userId: row.userId,
    kind: row.kind,
    reason: row.reason,
    startsAt: row.startsAt.toISOString(),
    endsAt: row.endsAt?.toISOString() ?? null,
    liftedAt: row.liftedAt?.toISOString() ?? null,
    liftReason: row.liftReason,
    overturned: row.overturned,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Member sanctions (SRS J9, ADR-0030): warnings and suspensions by trust and safety moderators.
 * A sanction resolves open reports about the member, revokes Power User status, is recorded in
 * the moderation history and audit log, and the member is told and can appeal.
 */
@Injectable()
export class SanctionsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly moderation: ModerationService,
    private readonly powerUsers: PowerUserService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** Suspensions still in force at `now`. */
  private activeSuspension(userId: string, now: Date) {
    return and(
      eq(memberSanctions.userId, userId),
      eq(memberSanctions.kind, "suspension"),
      isNull(memberSanctions.liftedAt),
      or(isNull(memberSanctions.endsAt), gt(memberSanctions.endsAt, now)),
    );
  }

  async sanction(moderator: User, userId: string, input: SanctionInput): Promise<SanctionDto> {
    if (userId === moderator.id) throw trustError("own_account");
    const now = this.clock.now();
    const row = await this.db.transaction(async (tx) => {
      const [member] = await tx.select().from(users).where(eq(users.id, userId)).for("update");
      if (!member) throw notFound();
      if (input.kind === "suspension") {
        const [active] = await tx
          .select({ id: memberSanctions.id })
          .from(memberSanctions)
          .where(this.activeSuspension(userId, now));
        if (active) throw trustError("already_suspended");
      }
      const [created] = await tx
        .insert(memberSanctions)
        .values({
          userId,
          kind: input.kind,
          reason: input.reason,
          startsAt: now,
          endsAt:
            input.kind === "suspension" && input.days !== null
              ? new Date(now.getTime() + input.days * DAY_MS)
              : null,
          createdBy: moderator.id,
        })
        .returning();
      if (!created) throw new Error("sanction insert returned no row");
      if (created.kind === "suspension") {
        await tx.update(users).set({ status: "suspended" }).where(eq(users.id, userId));
      }
      const resolved = await this.moderation.resolveReports(tx, moderator, "user", userId, true);
      await this.moderation.record(
        tx,
        moderator,
        "user",
        userId,
        created.kind === "warning" ? "warn" : "suspend",
        input.reason,
        {
          sanctionId: created.id,
          endsAt: created.endsAt?.toISOString() ?? null,
          reports: resolved,
        },
      );
      if (
        await this.powerUsers.revoke(tx, moderator, userId, `Moderation sanction: ${input.reason}`)
      ) {
        await this.moderation.record(
          tx,
          moderator,
          "user",
          userId,
          "revoke_power_user",
          input.reason,
          {
            sanctionId: created.id,
          },
        );
      }
      await enqueueOutboxEvent(tx, {
        aggregateType: "member_sanction",
        aggregateId: created.id,
        eventType: "MemberSanctioned",
        payload: { userId, kind: created.kind },
      });
      return created;
    });
    return sanctionDto(row);
  }

  async lift(moderator: User, sanctionId: string, reason: string): Promise<SanctionDto> {
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(memberSanctions)
        .where(eq(memberSanctions.id, sanctionId))
        .for("update");
      if (!current) throw notFound();
      if (current.kind !== "suspension" || current.liftedAt !== null) {
        throw trustError("invalid_transition");
      }
      const lifted = await this.liftRow(tx, current, moderator, reason);
      await this.moderation.record(
        tx,
        moderator,
        "user",
        current.userId,
        "lift_suspension",
        reason,
        {
          sanctionId: current.id,
        },
      );
      return lifted;
    });
    return sanctionDto(row);
  }

  /** Lifts a suspension and reactivates the account if nothing else keeps it suspended. */
  async liftRow(
    executor: Executor,
    sanction: MemberSanction,
    moderator: User,
    reason: string,
    overturned = false,
  ): Promise<MemberSanction> {
    const now = this.clock.now();
    const [lifted] = await executor
      .update(memberSanctions)
      .set({
        liftedAt: sanction.kind === "suspension" ? (sanction.liftedAt ?? now) : null,
        liftedBy: sanction.kind === "suspension" ? moderator.id : null,
        liftReason: sanction.kind === "suspension" ? reason : null,
        overturned: overturned || sanction.overturned,
      })
      .where(eq(memberSanctions.id, sanction.id))
      .returning();
    if (!lifted) throw notFound();
    const [other] = await executor
      .select({ id: memberSanctions.id })
      .from(memberSanctions)
      .where(and(this.activeSuspension(sanction.userId, now), ne(memberSanctions.id, sanction.id)));
    if (!other) {
      await executor.update(users).set({ status: "active" }).where(eq(users.id, sanction.userId));
    }
    return lifted;
  }

  async forUser(userId: string): Promise<SanctionDto[]> {
    const rows = await this.db
      .select()
      .from(memberSanctions)
      .where(eq(memberSanctions.userId, userId))
      .orderBy(desc(memberSanctions.createdAt));
    return rows.map(sanctionDto);
  }
}

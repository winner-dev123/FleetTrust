import { and, eq, sql } from "drizzle-orm";

import type { Executor } from "./database.js";
import { quotaConsumptions, quotaCounters, type SubjectType } from "./schema/plans.js";

/** Local calendar day (`YYYY-MM-DD`) of an instant in an IANA timezone (OQ-08). */
export function localDate(at: Date, timeZone: string): string {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(at);
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface QuotaSubject {
  type: SubjectType;
  id: string;
}

export interface ConsumeDailyQuotaInput {
  subject: QuotaSubject;
  key: string;
  /** From localDate(now, subject timezone). */
  periodStart: string;
  /** null = unlimited (still counted, for usage meters). */
  limit: number | null;
  amount?: number;
  /**
   * Retries with the same key are counted once (SRS FR-03). Use a client-supplied
   * Idempotency-Key or the ID of the thing being created.
   */
  idempotencyKey?: string;
}

export type ConsumeResult =
  { allowed: true; used: number; replayed: boolean } | { allowed: false; used: number };

class QuotaDenied extends Error {}

/**
 * Atomically consumes daily quota. One conditional upsert decides: it only increments when
 * the result stays within the limit, and Postgres serialises concurrent upserts on the same
 * row, so parallel requests can't overshoot (SRS AB-18). Runs in a savepoint: call it inside
 * the transaction that creates the thing being counted, so a failed creation releases it.
 */
export async function consumeDailyQuota(
  executor: Executor,
  input: ConsumeDailyQuotaInput,
): Promise<ConsumeResult> {
  const amount = input.amount ?? 1;
  if (!Number.isInteger(amount) || amount < 1)
    throw new RangeError("amount must be a positive integer");
  const where = and(
    eq(quotaCounters.subjectType, input.subject.type),
    eq(quotaCounters.subjectId, input.subject.id),
    eq(quotaCounters.key, input.key),
    eq(quotaCounters.periodStart, input.periodStart),
  );
  const currentUsage = async (on: Executor = executor) =>
    (await on.select({ used: quotaCounters.used }).from(quotaCounters).where(where))[0]?.used ?? 0;

  if (input.limit !== null && amount > input.limit) {
    return { allowed: false, used: await currentUsage() };
  }

  try {
    return await executor.transaction(async (tx) => {
      if (input.idempotencyKey !== undefined) {
        const inserted = await tx
          .insert(quotaConsumptions)
          .values({
            subjectType: input.subject.type,
            subjectId: input.subject.id,
            key: input.key,
            periodStart: input.periodStart,
            idempotencyKey: input.idempotencyKey,
            amount,
          })
          .onConflictDoNothing()
          .returning({ id: quotaConsumptions.id });
        if (inserted.length === 0) {
          return { allowed: true as const, used: await currentUsage(tx), replayed: true };
        }
      }

      const [row] = await tx
        .insert(quotaCounters)
        .values({
          subjectType: input.subject.type,
          subjectId: input.subject.id,
          key: input.key,
          periodStart: input.periodStart,
          used: amount,
        })
        .onConflictDoUpdate({
          target: [
            quotaCounters.subjectType,
            quotaCounters.subjectId,
            quotaCounters.key,
            quotaCounters.periodStart,
          ],
          set: { used: sql`${quotaCounters.used} + excluded.used` },
          ...(input.limit === null
            ? {}
            : { setWhere: sql`${quotaCounters.used} + excluded.used <= ${input.limit}` }),
        })
        .returning({ used: quotaCounters.used });
      // No row: the WHERE refused the increment. Roll back the savepoint (and the
      // idempotency record) so a later retry can succeed if capacity frees up.
      if (!row) throw new QuotaDenied();
      return { allowed: true as const, used: row.used, replayed: false };
    });
  } catch (error) {
    if (error instanceof QuotaDenied) return { allowed: false, used: await currentUsage() };
    throw error;
  }
}

/** Usage of daily quotas for a subject on one day, keyed by capability. */
export async function dailyUsage(
  executor: Executor,
  subject: QuotaSubject,
  periodStart: string,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({ key: quotaCounters.key, used: quotaCounters.used })
    .from(quotaCounters)
    .where(
      and(
        eq(quotaCounters.subjectType, subject.type),
        eq(quotaCounters.subjectId, subject.id),
        eq(quotaCounters.periodStart, periodStart),
      ),
    );
  return new Map(rows.map((row) => [row.key, row.used]));
}

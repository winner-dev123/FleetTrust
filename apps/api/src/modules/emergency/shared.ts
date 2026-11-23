import { and, eq, type Executor, or, userBlocks } from "@fleettrust/db";
import type { EmergencyErrorReason } from "@fleettrust/types";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

export function emergencyError(status: 400 | 409, reason: EmergencyErrorReason): Error {
  const body = { statusCode: status, error: status === 400 ? "bad_request" : "conflict", reason };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** Blocks either way end emergency links too (a blocked person is never alerted). */
export async function blockedEitherWay(executor: Executor, a: string, b: string): Promise<boolean> {
  const rows = await executor
    .select({ blocker: userBlocks.blockerId })
    .from(userBlocks)
    .where(
      or(
        and(eq(userBlocks.blockerId, a), eq(userBlocks.blockedId, b)),
        and(eq(userBlocks.blockerId, b), eq(userBlocks.blockedId, a)),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

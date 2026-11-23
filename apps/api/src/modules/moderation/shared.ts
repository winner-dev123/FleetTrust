import type { ModerationErrorReason } from "@fleettrust/types";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";

export function moderationError(status: 400 | 409, reason: ModerationErrorReason): Error {
  const body = { statusCode: status, error: status === 400 ? "bad_request" : "conflict", reason };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** True when a unique index with this name rejected the statement. */
export function violates(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause;
  return String(cause ?? error).includes(constraint);
}

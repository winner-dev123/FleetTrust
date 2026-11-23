import type { CommunityErrorReason } from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

export function communityError(
  status: 400 | 403 | 409,
  reason: CommunityErrorReason,
  extra: Record<string, unknown> = {},
): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason, ...extra };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** True when a unique index with this name rejected the statement. */
export function violates(error: unknown, constraint: string): boolean {
  const cause = (error as { cause?: unknown }).cause;
  return String(cause ?? error).includes(constraint);
}

/** Escapes LIKE wildcards in user input. */
export const likeEscape = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

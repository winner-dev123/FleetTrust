import type { OrganizationErrorReason } from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  type HttpException,
  NotFoundException,
} from "@nestjs/common";

type Status = 400 | 403 | 404 | 409 | 410;

const ERROR_NAMES: Record<Status, string> = {
  400: "bad_request",
  403: "forbidden",
  404: "not_found",
  409: "conflict",
  410: "gone",
};

const EXCEPTIONS: Record<Status, new (body: object) => HttpException> = {
  400: BadRequestException,
  403: ForbiddenException,
  404: NotFoundException,
  409: ConflictException,
  410: GoneException,
};

/** `{ statusCode, error, reason }`, the same shape as the auth errors, so clients branch on `reason`. */
export function orgError(status: Status, reason: OrganizationErrorReason): HttpException {
  return new EXCEPTIONS[status]({ statusCode: status, error: ERROR_NAMES[status], reason });
}

/** Not a member, or no such organization: indistinguishable on purpose (no tenant enumeration). */
export function notFound(): HttpException {
  return new NotFoundException({ statusCode: 404, error: "not_found" });
}

/** Postgres SQLSTATE of a driver error that Drizzle wrapped (or not). */
export function sqlState(error: unknown): string | undefined {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current !== null && typeof current === "object"; depth++) {
    const code = (current as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

export const UNIQUE_VIOLATION = "23505";
/** Still referenced: 23503 (NO ACTION foreign keys) or 23001 (ON DELETE RESTRICT). */
export const REFERENCED = new Set(["23503", "23001"]);

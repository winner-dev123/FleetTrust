import {
  type VerificationAppeal,
  type VerificationBadge,
  type VerificationCase,
  type VerificationDocument,
} from "@fleettrust/db";
import {
  type BadgeDto,
  REVERIFICATION_WINDOW_DAYS,
  type VerificationCaseDto,
  type VerificationDocumentDto,
  type VerificationErrorReason,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  type HttpException,
  NotFoundException,
} from "@nestjs/common";

export const DAY_MS = 24 * 60 * 60 * 1000;

type Status = 400 | 403 | 409 | 410;
const EXCEPTIONS: Record<Status, new (body: object) => HttpException> = {
  400: BadRequestException,
  403: ForbiddenException,
  409: ConflictException,
  410: GoneException,
};
const NAMES: Record<Status, string> = {
  400: "bad_request",
  403: "forbidden",
  409: "conflict",
  410: "gone",
};

export function verificationError(status: Status, reason: VerificationErrorReason): HttpException {
  return new EXCEPTIONS[status]({ statusCode: status, error: NAMES[status], reason });
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

export function subjectIdOf(row: { organizationId: string | null; userId: string | null }): string {
  const id = row.organizationId ?? row.userId;
  if (id === null) throw new Error("row has no subject");
  return id;
}

/** Applicant view: metadata only. Content, keys and storage locations are never exposed. */
export function toDocumentDto(document: VerificationDocument): VerificationDocumentDto {
  return {
    id: document.id,
    kind: document.kind,
    status: document.status,
    contentType: document.contentType,
    size: document.size,
    createdAt: document.createdAt.toISOString(),
  };
}

export function toCaseDto(
  row: VerificationCase,
  documents: readonly VerificationDocument[],
  appeal: VerificationAppeal | undefined,
): VerificationCaseDto {
  return {
    id: row.id,
    subject: { type: row.subjectType, id: subjectIdOf(row) },
    badgeType: row.badgeType,
    status: row.status,
    renewsBadgeId: row.renewsBadgeId,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionReason: row.decisionReason,
    documents: documents.map(toDocumentDto),
    appeal: appeal ? { id: appeal.id, status: appeal.status } : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function badgeStatus(badge: VerificationBadge, now: Date): BadgeDto["status"] {
  if (badge.endReason === "revoked") return "revoked";
  if (badge.endReason === "superseded") return "superseded";
  return badge.expiresAt > now ? "active" : "expired";
}

export function toBadgeDto(
  badge: VerificationBadge,
  appeal: VerificationAppeal | undefined,
  now: Date,
): BadgeDto {
  const status = badgeStatus(badge, now);
  return {
    id: badge.id,
    badgeType: badge.badgeType,
    grantedAt: badge.grantedAt.toISOString(),
    expiresAt: badge.expiresAt.toISOString(),
    status,
    reverificationDue:
      status === "expired" ||
      (status === "active" &&
        badge.expiresAt.getTime() - now.getTime() <= REVERIFICATION_WINDOW_DAYS * DAY_MS),
    revocationReason: badge.endReason === "revoked" ? badge.endNote : null,
    appeal: appeal ? { id: appeal.id, status: appeal.status } : null,
  };
}

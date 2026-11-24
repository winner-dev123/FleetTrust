import { type Part, type PartCompatibility, type PartInquiry } from "@fleettrust/db";
import {
  hasPermission,
  type PartDto,
  type PartInquiryDto,
  PARTS_DISCLAIMER,
  type PartsErrorReason,
  priceDto,
  type StockDto,
  stockFreshness,
  stockLabel,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { TenantAccess } from "../organizations/index.js";
import { priceOf } from "../providers/index.js";

export function partsError(status: 400 | 403 | 409, reason: PartsErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

export function assertProvider(access: TenantAccess): void {
  if (access.organization.kind !== "provider") throw partsError(400, "not_a_provider");
}

/** Whether a listing (or an inquiry about it) is inside the caller's branch scope. */
export function inScope(access: TenantAccess, branchId: string | null): boolean {
  return access.branchScope === null || access.branchScope === branchId;
}

/** Listing editors: `parts.manage`, within their branch scope. */
export function assertCanEdit(access: TenantAccess, branchId: string | null): void {
  if (!hasPermission(access.role, "parts.manage") || !inScope(access, branchId)) {
    throw partsError(403, "not_allowed");
  }
}

/** Stock confirmation: editors, or counter staff (`requests.respond`) at the stock's branch. */
export function assertCanConfirmStock(access: TenantAccess, branchId: string | null): void {
  const allowed =
    hasPermission(access.role, "parts.manage") || hasPermission(access.role, "requests.respond");
  if (!allowed || !inScope(access, branchId)) throw partsError(403, "not_allowed");
}

export function stockDto(part: Part, now: Date, publicView: boolean): StockDto {
  const freshness = stockFreshness(part.stockConfirmedAt, now);
  return {
    status: part.stockStatus,
    // A count is only shown while it's reasonably current.
    quantity:
      publicView && (freshness === "stale" || freshness === "expired") ? null : part.stockQuantity,
    confirmedAt: part.stockConfirmedAt.toISOString(),
    freshness,
    label: stockLabel(part.stockStatus, part.stockConfirmedAt, now),
  };
}

export function compatibilityDto(rows: readonly PartCompatibility[]): PartDto["compatibility"] {
  return rows.map((c) => ({
    vehicleType: c.vehicleType as PartDto["compatibility"][number]["vehicleType"],
    make: c.make,
    model: c.model,
    yearFrom: c.yearFrom,
    yearTo: c.yearTo,
  }));
}

export function partDto(
  part: Part,
  compatibility: readonly PartCompatibility[],
  now: Date,
): PartDto {
  return {
    id: part.id,
    name: part.name,
    brand: part.brand,
    partNumber: part.partNumber,
    category: part.category,
    condition: part.condition,
    description: part.description,
    branchId: part.branchId,
    price: priceDto(priceOf(part)),
    compatibility: compatibilityDto(compatibility),
    stock: stockDto(part, now, false),
    status: part.status,
    createdAt: part.createdAt.toISOString(),
    updatedAt: part.updatedAt.toISOString(),
    disclaimer: PARTS_DISCLAIMER,
  };
}

export function inquiryDto(
  row: PartInquiry,
  names: { provider: { name: string; slug: string | null }; requester: string },
  now: Date,
): PartInquiryDto {
  const expired = row.status === "open" && row.expiresAt <= now;
  return {
    id: row.id,
    partId: row.partId,
    partName: row.partName,
    partNumber: row.partNumber,
    provider: { organizationId: row.organizationId, ...names.provider },
    branchId: row.branchId,
    requester: {
      kind: row.requesterOrganizationId === null ? "user" : "organization",
      name: names.requester,
      organizationId: row.requesterOrganizationId,
    },
    quantity: row.quantity,
    message: row.message,
    vehicle:
      row.vehicleType === null
        ? null
        : {
            vehicleType: row.vehicleType as NonNullable<PartInquiryDto["vehicle"]>["vehicleType"],
            make: row.vehicleMake,
            model: row.vehicleModel,
            year: row.vehicleYear,
          },
    status: expired ? "expired" : row.status,
    answer:
      row.availability === null || row.answeredAt === null
        ? null
        : {
            availability: row.availability,
            quantityAvailable: row.quantityAvailable,
            etaDays: row.etaDays,
            message: row.answerMessage,
            answeredAt: row.answeredAt.toISOString(),
          },
    expiresAt: row.expiresAt.toISOString(),
    createdAt: row.createdAt.toISOString(),
    disclaimer: PARTS_DISCLAIMER,
  };
}

/** Escapes `%`, `_` and `\` for a LIKE pattern. */
export function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (c) => `\\${c}`);
}

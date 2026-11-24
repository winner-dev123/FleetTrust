import type { Vehicle } from "@fleettrust/db";
import { type FleetErrorReason, hasPermission } from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

import type { TenantAccess } from "../organizations/index.js";

export function fleetError(status: 400 | 403 | 409, reason: FleetErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

export function assertFleet(access: TenantAccess): void {
  if (access.organization.kind !== "fleet") throw fleetError(400, "not_a_fleet");
}

/** Fleet managers: `vehicles.manage`, within their branch scope. */
export function isManager(access: TenantAccess): boolean {
  return hasPermission(access.role, "vehicles.manage");
}

export function inScope(access: TenantAccess, branchId: string | null): boolean {
  return access.branchScope === null || access.branchScope === branchId;
}

export function vehicleName(v: Pick<Vehicle, "nickname" | "registration" | "make" | "model">) {
  return v.nickname ?? v.registration ?? ([v.make, v.model].filter(Boolean).join(" ") || "Vehicle");
}

/** "1234.5" → 123450 cents (amounts have at most two decimals). */
export function toCents(amount: string): number {
  const [whole = "0", fraction = ""] = amount.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0").slice(0, 2));
}

export function fromCents(cents: number): string {
  const whole = Math.floor(cents / 100);
  const rest = cents % 100;
  return trimDecimal(`${String(whole)}.${String(rest).padStart(2, "0")}`);
}

/** `450.00` → `450`, `12.50` → `12.5`: numeric columns come back padded. */
export function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

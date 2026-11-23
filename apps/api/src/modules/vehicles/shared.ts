import type { VehicleErrorReason } from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from "@nestjs/common";

export function vehicleError(status: 400 | 403 | 409, reason: VehicleErrorReason): Error {
  const error = status === 400 ? "bad_request" : status === 403 ? "forbidden" : "conflict";
  const body = { statusCode: status, error, reason };
  if (status === 403) return new ForbiddenException(body);
  if (status === 409) return new ConflictException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** Days between two ISO dates (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

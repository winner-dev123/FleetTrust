import type { ProviderErrorReason } from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from "@nestjs/common";

import type { TenantAccess } from "../organizations/index.js";

export function providerError(
  status: 400 | 409 | 422,
  reason: ProviderErrorReason,
  extra: object = {},
): Error {
  const body = {
    statusCode: status,
    error: status === 422 ? "unprocessable" : status === 409 ? "conflict" : "bad_request",
    reason,
    ...extra,
  };
  if (status === 409) return new ConflictException(body);
  if (status === 422) return new UnprocessableEntityException(body);
  return new BadRequestException(body);
}

export const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });

/** Profiles, catalogs and hours exist only for provider organizations. */
export function assertProvider(access: TenantAccess): void {
  if (access.organization.kind !== "provider") throw providerError(400, "not_a_provider");
}

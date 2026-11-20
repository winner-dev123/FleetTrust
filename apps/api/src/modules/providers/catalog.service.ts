import {
  and,
  asc,
  branches,
  currencies,
  type Database,
  eq,
  type Executor,
  inArray,
  type ProviderOffering,
  providerOfferingBranches,
  providerOfferings,
  providerProfiles,
  recordAuditEvent,
  type User,
} from "@fleettrust/db";
import {
  type CatalogErrorReason,
  formatIndicativePrice,
  fractionDigits,
  type IndicativePrice,
  MAX_OFFERINGS,
  type OfferingDto,
  type offeringRequestSchema,
  type ProviderCategory,
  type PublicOffering,
} from "@fleettrust/types";
import type { z } from "zod";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
} from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import type { TenantAccess } from "../organizations/index.js";
import { assertProvider, notFound } from "./shared.js";

type OfferingInput = z.output<typeof offeringRequestSchema>;
interface Issue {
  path: string;
  message: string;
}

export function catalogError(status: 400 | 403 | 409, reason: CatalogErrorReason): Error {
  const error = status === 409 ? "conflict" : status === 403 ? "forbidden" : "bad_request";
  const body = { statusCode: status, error, reason };
  if (status === 409) return new ConflictException(body);
  if (status === 403) return new ForbiddenException(body);
  return new BadRequestException(body);
}

/** `450.5000` → `450.5`: numeric columns come back padded to their scale. */
function trimDecimal(value: string): string {
  return value.includes(".") ? value.replace(/\.?0+$/, "") : value;
}

function priceOf(row: ProviderOffering): IndicativePrice {
  const currency = row.currency ?? "";
  const unit = (row.priceUnit ?? "job") as Extract<IndicativePrice, { unit: string }>["unit"];
  switch (row.priceType) {
    case "fixed":
    case "from":
      return { type: row.priceType, currency, amount: trimDecimal(row.priceAmount ?? "0"), unit };
    case "range":
      return {
        type: "range",
        currency,
        min: trimDecimal(row.priceAmount ?? "0"),
        max: trimDecimal(row.priceMax ?? "0"),
        unit,
      };
    case "quote_required":
      return { type: "quote_required" };
  }
}

function priceColumns(price: IndicativePrice) {
  switch (price.type) {
    case "fixed":
    case "from":
      return {
        priceType: price.type,
        currency: price.currency,
        priceAmount: price.amount,
        priceMax: null,
        priceUnit: price.unit,
      };
    case "range":
      return {
        priceType: price.type,
        currency: price.currency,
        priceAmount: price.min,
        priceMax: price.max,
        priceUnit: price.unit,
      };
    case "quote_required":
      return {
        priceType: price.type,
        currency: null,
        priceAmount: null,
        priceMax: null,
        priceUnit: null,
      };
  }
}

/** An offering as frozen into the published snapshot. */
export type SnapshotOffering = Omit<OfferingDto, "updatedAt" | "sortOrder">;

/**
 * Service catalog (SRS F-033, F-034): offerings with vehicle compatibility, branch availability
 * and indicative prices. Part of the profile draft, published with the snapshot (ADR-0018).
 */
@Injectable()
export class CatalogService {
  constructor(@Inject(DATABASE) private readonly database: DatabaseProvider) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async offerings(executor: Executor, organizationId: string): Promise<OfferingDto[]> {
    const rows = await executor
      .select()
      .from(providerOfferings)
      .where(eq(providerOfferings.organizationId, organizationId))
      .orderBy(asc(providerOfferings.sortOrder), asc(providerOfferings.createdAt));
    const links = rows.length
      ? await executor
          .select()
          .from(providerOfferingBranches)
          .where(
            inArray(
              providerOfferingBranches.offeringId,
              rows.map((r) => r.id),
            ),
          )
      : [];
    return rows.map((row) => ({
      id: row.id,
      category: row.category as ProviderCategory,
      name: row.name,
      description: row.description,
      vehicleTypes: row.vehicleTypes as OfferingDto["vehicleTypes"],
      serviceLocation: row.serviceLocation,
      branchIds: links
        .filter((l) => l.offeringId === row.id)
        .map((l) => l.branchId)
        .sort(),
      price: priceOf(row),
      sortOrder: row.sortOrder,
      updatedAt: row.updatedAt.toISOString(),
    }));
  }

  list(access: TenantAccess): Promise<OfferingDto[]> {
    assertProvider(access);
    return this.offerings(this.db, access.tenant.organizationId);
  }

  /** Branch-scoped managers may only touch offerings limited to their own branch. */
  private assertScope(access: TenantAccess, branchIds: readonly string[]): void {
    if (access.branchScope === null) return;
    if (branchIds.length !== 1 || branchIds[0] !== access.branchScope) {
      throw catalogError(403, "outside_branch_scope");
    }
  }

  private async validate(executor: Executor, orgId: string, input: OfferingInput): Promise<void> {
    if (input.price.type !== "quote_required") {
      const [currency] = await executor
        .select()
        .from(currencies)
        .where(eq(currencies.code, input.price.currency));
      if (!currency?.isActive) throw catalogError(400, "unknown_currency");
      const amounts =
        input.price.type === "range" ? [input.price.min, input.price.max] : [input.price.amount];
      if (amounts.some((a) => fractionDigits(a) > currency.displayDecimals)) {
        throw catalogError(400, "too_many_decimals");
      }
    }
    const wanted = [...new Set(input.branchIds)];
    if (wanted.length > 0) {
      const found = await executor
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.organizationId, orgId), inArray(branches.id, wanted)));
      if (found.length !== wanted.length) throw catalogError(400, "unknown_branch");
    }
  }

  private async writeBranches(
    executor: Executor,
    orgId: string,
    offeringId: string,
    branchIds: readonly string[],
  ): Promise<void> {
    await executor
      .delete(providerOfferingBranches)
      .where(eq(providerOfferingBranches.offeringId, offeringId));
    const unique = [...new Set(branchIds)];
    if (unique.length > 0) {
      await executor
        .insert(providerOfferingBranches)
        .values(unique.map((branchId) => ({ offeringId, organizationId: orgId, branchId })));
    }
  }

  private async find(executor: Executor, orgId: string, id: string): Promise<OfferingDto> {
    const offering = (await this.offerings(executor, orgId)).find((o) => o.id === id);
    if (!offering) throw notFound();
    return offering;
  }

  async create(access: TenantAccess, actor: User, input: OfferingInput): Promise<OfferingDto> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    this.assertScope(access, input.branchIds);
    const id = await this.db.transaction(async (tx) => {
      // Profile row first: offerings reference it (which also rules out fleets).
      await tx.insert(providerProfiles).values({ organizationId: orgId }).onConflictDoNothing();
      // Serialise creations per organization so the cap holds under concurrency.
      await tx
        .select({ id: providerProfiles.organizationId })
        .from(providerProfiles)
        .where(eq(providerProfiles.organizationId, orgId))
        .for("update");
      const existing = await tx
        .select({ id: providerOfferings.id })
        .from(providerOfferings)
        .where(eq(providerOfferings.organizationId, orgId));
      if (existing.length >= MAX_OFFERINGS) throw catalogError(409, "too_many_offerings");
      await this.validate(tx, orgId, input);
      const [row] = await tx
        .insert(providerOfferings)
        .values({
          organizationId: orgId,
          category: input.category,
          name: input.name,
          description: input.description,
          vehicleTypes: [...new Set(input.vehicleTypes)],
          serviceLocation: input.serviceLocation,
          sortOrder: input.sortOrder,
          ...priceColumns(input.price),
        })
        .returning({ id: providerOfferings.id });
      if (!row) throw new Error("offering insert returned no row");
      await this.writeBranches(tx, orgId, row.id, input.branchIds);
      await this.audit(tx, actor, orgId, "catalog.offering_created", row.id, input);
      return row.id;
    });
    return this.find(this.db, orgId, id);
  }

  async replace(
    access: TenantAccess,
    actor: User,
    id: string,
    input: OfferingInput,
  ): Promise<OfferingDto> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      const current = await this.find(tx, orgId, id);
      this.assertScope(access, current.branchIds);
      this.assertScope(access, input.branchIds);
      await this.validate(tx, orgId, input);
      await tx
        .update(providerOfferings)
        .set({
          category: input.category,
          name: input.name,
          description: input.description,
          vehicleTypes: [...new Set(input.vehicleTypes)],
          serviceLocation: input.serviceLocation,
          sortOrder: input.sortOrder,
          ...priceColumns(input.price),
        })
        .where(and(eq(providerOfferings.id, id), eq(providerOfferings.organizationId, orgId)));
      await this.writeBranches(tx, orgId, id, input.branchIds);
      await this.audit(tx, actor, orgId, "catalog.offering_updated", id, input);
    });
    return this.find(this.db, orgId, id);
  }

  async remove(access: TenantAccess, actor: User, id: string): Promise<void> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      const current = await this.find(tx, orgId, id);
      this.assertScope(access, current.branchIds);
      await tx
        .delete(providerOfferings)
        .where(and(eq(providerOfferings.id, id), eq(providerOfferings.organizationId, orgId)));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        organizationId: orgId,
        action: "catalog.offering_deleted",
        targetType: "provider_offering",
        targetId: id,
        requestId: currentRequestContext()?.requestId,
        metadata: { name: current.name },
      });
    });
  }

  /**
   * Publication checks for the catalog step. Offerings are validated in full when saved; what
   * can go stale is how they fit the rest of the profile (categories, vehicle types, branches).
   */
  issues(
    offerings: readonly OfferingDto[],
    profile: { categories: readonly string[]; vehicleTypes: readonly string[] },
    publishable: readonly { id: string; serviceRadiusKm: number | null }[],
  ): Issue[] {
    const issues: Issue[] = [];
    for (const offering of offerings) {
      const path = `catalog.${offering.id}`;
      if (!profile.categories.includes(offering.category)) {
        issues.push({
          path: `${path}.category`,
          message: `"${offering.name}" is in a category you don't offer`,
        });
      }
      const unsupported = offering.vehicleTypes.filter((v) => !profile.vehicleTypes.includes(v));
      if (unsupported.length > 0) {
        issues.push({
          path: `${path}.vehicleTypes`,
          message: `Not among the vehicle types you serve: ${unsupported.join(", ")}`,
        });
      }
      const where = this.publishedBranches(offering, publishable);
      if (where.length === 0) {
        issues.push({
          path: `${path}.branchIds`,
          message: "None of its branches are ready to publish",
        });
      } else if (
        offering.serviceLocation === "at_customer" &&
        where.some((b) => b.serviceRadiusKm === null)
      ) {
        issues.push({
          path: `${path}.serviceLocation`,
          message:
            "Set a service radius on every branch that travels to customers for this service",
        });
      }
    }
    return issues;
  }

  private publishedBranches<T extends { id: string }>(
    offering: OfferingDto,
    publishable: readonly T[],
  ): T[] {
    return offering.branchIds.length === 0
      ? [...publishable]
      : publishable.filter((b) => offering.branchIds.includes(b.id));
  }

  snapshot(
    offerings: readonly OfferingDto[],
    publishable: readonly { id: string }[],
  ): SnapshotOffering[] {
    return offerings.map((o) => ({
      id: o.id,
      category: o.category,
      name: o.name,
      description: o.description,
      vehicleTypes: o.vehicleTypes,
      serviceLocation: o.serviceLocation,
      // Empty stays empty ("every branch"); otherwise only branches that are published.
      branchIds:
        o.branchIds.length === 0 ? [] : this.publishedBranches(o, publishable).map((b) => b.id),
      price: o.price,
    }));
  }

  /** Public form: every price is labelled with its type and marked indicative (FR-07). */
  present(offerings: readonly SnapshotOffering[]): PublicOffering[] {
    return offerings.map((o) => ({
      ...o,
      price: { ...o.price, indicative: true as const, label: formatIndicativePrice(o.price) },
    }));
  }

  private async audit(
    executor: Executor,
    actor: User,
    organizationId: string,
    action: string,
    offeringId: string,
    input: OfferingInput,
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId,
      action,
      targetType: "provider_offering",
      targetId: offeringId,
      requestId: currentRequestContext()?.requestId,
      metadata: { category: input.category, priceType: input.price.type },
    });
  }
}

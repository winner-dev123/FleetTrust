import {
  and,
  asc,
  branches,
  count,
  type Database,
  desc,
  eq,
  type Executor,
  ilike,
  inArray,
  isNull,
  lte,
  or,
  organizations,
  type Part,
  partCompatibility,
  parts,
  providerProfiles,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
} from "@fleettrust/db";
import {
  type createPartRequestSchema,
  MAX_PARTS,
  normalizePartNumber,
  type PartDto,
  type partListQuerySchema,
  type partRequestSchema,
  PARTS_DISCLAIMER,
  type partSearchQuerySchema,
  type PartSearchResult,
  type PublicPart,
  priceDto,
  STOCK_HIDDEN_DAYS,
  STOCK_STALE_DAYS,
  type stockRequestSchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { assertPriceAllowed, priceColumns, priceOf } from "../providers/index.js";
import { VehiclesService } from "../vehicles/index.js";
import {
  assertCanConfirmStock,
  assertCanEdit,
  assertProvider,
  compatibilityDto,
  inScope,
  likeEscape,
  notFound,
  partDto,
  partsError,
  stockDto,
} from "./shared.js";

type PartInput = z.output<typeof partRequestSchema>;
type CreateInput = z.output<typeof createPartRequestSchema>;
type StockInput = z.output<typeof stockRequestSchema>;
type ListQuery = z.output<typeof partListQuerySchema>;
type SearchQuery = z.output<typeof partSearchQuerySchema>;

const DAY_MS = 86_400_000;

interface SearchRow {
  id: string;
  distance_m: number | null;
}

/**
 * Parts listings (SRS F-140, ADR-0028). Live data: a listing is public while the provider is
 * published and active, the listing is active and its stock was confirmed within
 * STOCK_HIDDEN_DAYS. Stock older than STOCK_STALE_DAYS stays visible but is labelled stale.
 */
@Injectable()
export class PartsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly vehicles: VehiclesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Provider side ---------------------------------------------------------------------------

  private async own(executor: Executor, access: TenantAccess, partId: string): Promise<Part> {
    assertProvider(access);
    const [row] = await executor
      .select()
      .from(parts)
      .where(and(eq(parts.id, partId), eq(parts.organizationId, access.tenant.organizationId)));
    // Branch-scoped members see their branch's stock and the organization-wide listings.
    if (!row || (row.branchId !== null && !inScope(access, row.branchId))) throw notFound();
    return row;
  }

  private async compatibilityOf(partIds: readonly string[]) {
    if (partIds.length === 0) return new Map<string, (typeof partCompatibility.$inferSelect)[]>();
    const rows = await this.db
      .select()
      .from(partCompatibility)
      .where(inArray(partCompatibility.partId, [...partIds]))
      .orderBy(
        asc(partCompatibility.vehicleType),
        asc(partCompatibility.make),
        asc(partCompatibility.id),
      );
    const byPart = new Map<string, typeof rows>();
    for (const row of rows) byPart.set(row.partId, [...(byPart.get(row.partId) ?? []), row]);
    return byPart;
  }

  private async assertBranch(executor: Executor, access: TenantAccess, branchId: string | null) {
    if (branchId === null) return;
    const [branch] = await executor
      .select({ id: branches.id })
      .from(branches)
      .where(
        and(eq(branches.id, branchId), eq(branches.organizationId, access.tenant.organizationId)),
      );
    if (!branch) throw partsError(400, "invalid_branch");
  }

  private columns(input: PartInput) {
    return {
      name: input.name,
      brand: input.brand,
      partNumber: input.partNumber,
      partNumberNormalized:
        input.partNumber === null ? null : normalizePartNumber(input.partNumber),
      category: input.category,
      condition: input.condition,
      description: input.description,
      branchId: input.branchId,
      status: input.status,
      ...priceColumns(input.price),
    };
  }

  private async writeCompatibility(executor: Executor, part: Part, input: PartInput) {
    await executor.delete(partCompatibility).where(eq(partCompatibility.partId, part.id));
    if (input.compatibility.length === 0) return;
    await executor.insert(partCompatibility).values(
      input.compatibility.map((c) => ({
        organizationId: part.organizationId,
        partId: part.id,
        vehicleType: c.vehicleType,
        make: c.make,
        model: c.model,
        yearFrom: c.yearFrom,
        yearTo: c.yearTo,
      })),
    );
  }

  private async audit(executor: Executor, actor: User, part: Part, action: string) {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: part.organizationId,
      action,
      targetType: "part",
      targetId: part.id,
      requestId: currentRequestContext()?.requestId,
      metadata: { name: part.name, branchId: part.branchId },
    });
  }

  async list(access: TenantAccess, query: ListQuery): Promise<PartDto[]> {
    assertProvider(access);
    const now = this.clock.now();
    const staleBefore = new Date(now.getTime() - STOCK_STALE_DAYS * DAY_MS);
    const pattern = query.q ? `%${likeEscape(query.q)}%` : null;
    const rows = await this.db
      .select()
      .from(parts)
      .where(
        and(
          eq(parts.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : or(isNull(parts.branchId), eq(parts.branchId, access.branchScope)),
          query.status ? eq(parts.status, query.status) : undefined,
          query.branchId ? eq(parts.branchId, query.branchId) : undefined,
          query.stale ? lte(parts.stockConfirmedAt, staleBefore) : undefined,
          pattern
            ? or(
                ilike(parts.name, pattern),
                ilike(parts.brand, pattern),
                ilike(parts.partNumber, pattern),
              )
            : undefined,
        ),
      )
      // The least recently confirmed first when looking for stale stock; otherwise by name.
      .orderBy(...(query.stale ? [asc(parts.stockConfirmedAt)] : [asc(parts.name)]), asc(parts.id))
      .limit(MAX_PARTS);
    const compat = await this.compatibilityOf(rows.map((r) => r.id));
    return rows.map((r) => partDto(r, compat.get(r.id) ?? [], now));
  }

  async get(access: TenantAccess, partId: string): Promise<PartDto> {
    const part = await this.own(this.db, access, partId);
    const compat = await this.compatibilityOf([part.id]);
    return partDto(part, compat.get(part.id) ?? [], this.clock.now());
  }

  async create(access: TenantAccess, actor: User, input: CreateInput): Promise<PartDto> {
    assertProvider(access);
    assertCanEdit(access, input.branchId);
    const now = this.clock.now();
    const part = await this.db.transaction(async (tx) => {
      await this.assertBranch(tx, access, input.branchId);
      await assertPriceAllowed(tx, input.price);
      // Serialise creations per organization so the cap holds under concurrency.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtextextended(${`parts:${access.tenant.organizationId}`}, 0))`,
      );
      const [existing] = await tx
        .select({ n: count() })
        .from(parts)
        .where(eq(parts.organizationId, access.tenant.organizationId));
      if ((existing?.n ?? 0) >= MAX_PARTS) throw partsError(409, "too_many_parts");
      const [row] = await tx
        .insert(parts)
        .values({
          organizationId: access.tenant.organizationId,
          ...this.columns(input),
          stockStatus: input.stock.status,
          stockQuantity: input.stock.quantity,
          stockConfirmedAt: now,
          stockConfirmedBy: actor.id,
          createdBy: actor.id,
        })
        .returning();
      if (!row) throw new Error("part insert returned no row");
      await this.writeCompatibility(tx, row, input);
      await this.audit(tx, actor, row, "part.created");
      return row;
    });
    return this.get(access, part.id);
  }

  async replace(
    access: TenantAccess,
    actor: User,
    partId: string,
    input: PartInput,
  ): Promise<PartDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, partId);
      assertCanEdit(access, current.branchId);
      assertCanEdit(access, input.branchId);
      await this.assertBranch(tx, access, input.branchId);
      await assertPriceAllowed(tx, input.price);
      const [row] = await tx
        .update(parts)
        .set(this.columns(input))
        .where(eq(parts.id, current.id))
        .returning();
      if (!row) throw notFound();
      await this.writeCompatibility(tx, row, input);
      await this.audit(tx, actor, row, "part.updated");
    });
    return this.get(access, partId);
  }

  async remove(access: TenantAccess, actor: User, partId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, partId);
      assertCanEdit(access, current.branchId);
      await tx.delete(parts).where(eq(parts.id, current.id));
      await this.audit(tx, actor, current, "part.deleted");
    });
  }

  /** Records a stock check, even when nothing changed ("still in stock"). */
  async confirmStock(
    access: TenantAccess,
    actor: User,
    partId: string,
    input: StockInput,
  ): Promise<PartDto> {
    const current = await this.own(this.db, access, partId);
    assertCanConfirmStock(access, current.branchId);
    await this.db
      .update(parts)
      .set({
        stockStatus: input.status,
        stockQuantity: input.quantity,
        stockConfirmedAt: this.clock.now(),
        stockConfirmedBy: actor.id,
      })
      .where(eq(parts.id, current.id));
    return this.get(access, partId);
  }

  // --- Public ----------------------------------------------------------------------------------

  /** SQL condition: the listing is publicly visible at `now`. */
  private visible(now: Date) {
    const hiddenBefore = new Date(now.getTime() - STOCK_HIDDEN_DAYS * DAY_MS).toISOString();
    return sql`p.status = 'active'
      AND p.stock_confirmed_at > ${hiddenBefore}::timestamptz
      AND o.status = 'active'
      AND pp.status = 'published'
      AND EXISTS (SELECT 1 FROM provider_search_entries e
                  WHERE e.organization_id = p.organization_id
                    AND (p.branch_id IS NULL OR e.branch_id = p.branch_id))`;
  }

  /** Public search. Visitors get distances from approximate locations only (OQ-11). */
  async search(query: SearchQuery, user: User | null): Promise<PartSearchResult> {
    const now = this.clock.now();
    let vehicle: PartSearchResult["vehicle"] = null;
    if (query.vehicleId !== undefined) {
      if (user === null) throw partsError(403, "not_allowed");
      const access = await this.vehicles.access(this.db, user, query.vehicleId);
      if (!access) throw notFound();
      vehicle = {
        vehicleType: access.vehicle.vehicleType as NonNullable<
          PartSearchResult["vehicle"]
        >["vehicleType"],
        make: access.vehicle.make,
        model: access.vehicle.model,
        year: access.vehicle.year,
      };
    } else if (query.vehicleType !== undefined) {
      vehicle = {
        vehicleType: query.vehicleType,
        make: query.make ?? null,
        model: query.model ?? null,
        year: query.year ?? null,
      };
    }

    const conditions = [this.visible(now)];
    if (query.q !== undefined) {
      const pattern = `%${likeEscape(query.q)}%`;
      const number = normalizePartNumber(query.q);
      conditions.push(
        sql`(p.name ILIKE ${pattern} OR p.brand ILIKE ${pattern}${
          number.length >= 2 ? sql` OR p.part_number_normalized LIKE ${`${number}%`}` : sql``
        })`,
      );
    }
    if (query.partNumber !== undefined) {
      conditions.push(
        sql`p.part_number_normalized LIKE ${`${likeEscape(normalizePartNumber(query.partNumber))}%`}`,
      );
    }
    if (query.category !== undefined) conditions.push(sql`p.category = ${query.category}`);
    if (query.condition !== undefined) conditions.push(sql`p.condition = ${query.condition}`);
    if (query.provider !== undefined)
      conditions.push(sql`pp.slug = ${query.provider.toLowerCase()}`);
    if (query.inStockOnly) {
      const staleBefore = new Date(now.getTime() - STOCK_STALE_DAYS * DAY_MS).toISOString();
      conditions.push(
        sql`p.stock_status IN ('in_stock', 'low_stock') AND p.stock_confirmed_at > ${staleBefore}::timestamptz`,
      );
    }
    if (vehicle !== null) {
      // A listed range fits when every field it names matches; unnamed fields match anything.
      const make = vehicle.make;
      const model = vehicle.model;
      const year = vehicle.year;
      conditions.push(sql`EXISTS (SELECT 1 FROM part_compatibility c
        WHERE c.part_id = p.id AND c.vehicle_type = ${vehicle.vehicleType}
          AND (c.make IS NULL${make === null ? sql`` : sql` OR lower(c.make) = lower(${make})`})
          AND (c.model IS NULL${model === null ? sql`` : sql` OR lower(c.model) = lower(${model})`})
          ${
            year === null
              ? sql``
              : sql`AND (c.year_from IS NULL OR c.year_from <= ${year}) AND (c.year_to IS NULL OR c.year_to >= ${year})`
          })`);
    }

    const near = query.lat !== undefined && query.lng !== undefined;
    const point = near
      ? sql`ST_SetSRID(ST_MakePoint(${query.lng}::float8, ${query.lat}::float8), 4326)::geography`
      : sql`NULL::geography`;
    const column = user === null ? sql.raw("e.approx_location") : sql.raw("e.location");
    const distance = near
      ? sql`(SELECT round(ST_Distance(${column}, ${point}))::int FROM provider_search_entries e
             WHERE e.organization_id = p.organization_id
               AND (p.branch_id IS NULL OR e.branch_id = p.branch_id)
             ORDER BY ST_Distance(${column}, ${point}) LIMIT 1)`
      : sql`NULL::int`;
    if (near) {
      conditions.push(sql`EXISTS (SELECT 1 FROM provider_search_entries e
        WHERE e.organization_id = p.organization_id
          AND (p.branch_id IS NULL OR e.branch_id = p.branch_id)
          AND ST_DWithin(${column}, ${point}, ${query.radiusKm * 1000}::float8))`);
    }

    const rows = await queryRows<SearchRow>(
      this.db,
      sql`SELECT p.id, ${distance} AS distance_m
          FROM parts p
          JOIN organizations o ON o.id = p.organization_id
          JOIN provider_profiles pp ON pp.organization_id = p.organization_id
          WHERE ${sql.join(conditions, sql` AND `)}
          ORDER BY ${near ? sql`distance_m ASC,` : sql``} p.stock_confirmed_at DESC, p.id
          LIMIT ${query.limit + 1} OFFSET ${query.offset}`,
    );
    const page = rows.slice(0, query.limit);
    const items = await this.publicParts(
      page.map((r) => r.id),
      now,
    );
    const distances = new Map(page.map((r) => [r.id, r.distance_m]));
    return {
      items: page.flatMap((r) => {
        const item = items.get(r.id);
        if (!item) return [];
        const meters = distances.get(r.id) ?? null;
        return [
          {
            ...item,
            distanceKm: meters === null ? null : Math.round(meters / 100) / 10,
            fits: vehicle === null ? null : true,
          },
        ];
      }),
      vehicle,
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
      disclaimer: PARTS_DISCLAIMER,
    };
  }

  /** One public listing (any visitor). */
  async publicPart(partId: string): Promise<PublicPart> {
    const now = this.clock.now();
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`SELECT p.id FROM parts p
          JOIN organizations o ON o.id = p.organization_id
          JOIN provider_profiles pp ON pp.organization_id = p.organization_id
          WHERE p.id = ${partId}::uuid AND ${this.visible(now)}`,
    );
    if (rows.length === 0) throw notFound();
    const item = (await this.publicParts([partId], now)).get(partId);
    if (!item) throw notFound();
    return { ...item, distanceKm: null, fits: null };
  }

  /** Whether a listing can be asked about right now (same rule as public visibility). */
  async askable(executor: Executor, partId: string): Promise<Part | null> {
    const now = this.clock.now();
    const rows = await queryRows<{ id: string }>(
      executor,
      sql`SELECT p.id FROM parts p
          JOIN organizations o ON o.id = p.organization_id
          JOIN provider_profiles pp ON pp.organization_id = p.organization_id
          WHERE p.id = ${partId}::uuid AND ${this.visible(now)}`,
    );
    if (rows.length === 0) return null;
    const [part] = await executor.select().from(parts).where(eq(parts.id, partId));
    return part ?? null;
  }

  private async publicParts(
    ids: readonly string[],
    now: Date,
  ): Promise<Map<string, Omit<PublicPart, "distanceKm" | "fits">>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({
        part: parts,
        slug: providerProfiles.slug,
        snapshot: providerProfiles.publishedSnapshot,
        orgName: organizations.name,
        branchName: branches.name,
        locality: branches.locality,
      })
      .from(parts)
      .innerJoin(providerProfiles, eq(providerProfiles.organizationId, parts.organizationId))
      .innerJoin(organizations, eq(organizations.id, parts.organizationId))
      .leftJoin(branches, eq(branches.id, parts.branchId))
      .where(inArray(parts.id, [...ids]))
      .orderBy(desc(parts.stockConfirmedAt));
    const compat = await this.compatibilityOf(ids);
    const result = new Map<string, Omit<PublicPart, "distanceKm" | "fits">>();
    for (const row of rows) {
      const { part } = row;
      result.set(part.id, {
        id: part.id,
        name: part.name,
        brand: part.brand,
        partNumber: part.partNumber,
        category: part.category,
        condition: part.condition,
        description: part.description,
        price: priceDto(priceOf(part)),
        compatibility: compatibilityDto(compat.get(part.id) ?? []),
        stock: stockDto(part, now, true),
        disclaimer: PARTS_DISCLAIMER,
        provider: {
          organizationId: part.organizationId,
          slug: row.slug ?? "",
          name: (row.snapshot as { tradingName?: string } | null)?.tradingName ?? row.orgName,
        },
        branch:
          part.branchId === null || row.branchName === null
            ? null
            : { id: part.branchId, name: row.branchName, locality: row.locality },
      });
    }
    return result;
  }
}

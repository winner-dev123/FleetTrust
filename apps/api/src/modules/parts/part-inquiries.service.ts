import {
  and,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  inArray,
  isNull,
  memberships,
  organizations,
  type PartInquiry,
  partInquiries,
  parts,
  providerProfiles,
  type User,
  users,
} from "@fleettrust/db";
import {
  type answerPartInquirySchema,
  type createPartInquirySchema,
  hasPermission,
  PART_INQUIRY_OPEN_DAYS,
  type PartInquiryDto,
  type partInquiryQuerySchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { VehiclesService } from "../vehicles/index.js";
import { PartsService } from "./parts.service.js";
import { assertProvider, inquiryDto, inScope, notFound, partsError } from "./shared.js";

type CreateInput = z.output<typeof createPartInquirySchema>;
type AnswerInput = z.output<typeof answerPartInquirySchema>;
type ListQuery = z.output<typeof partInquiryQuerySchema>;

/** Who asks: a person for themselves, or a fleet member for the fleet. */
export type PartAsker =
  { kind: "user"; user: User } | { kind: "organization"; user: User; access: TenantAccess };

const DAY_MS = 86_400_000;
const FALLBACK_NAME = "FleetTrust user";

/**
 * Parts availability inquiries (SRS F-141, ADR-0028): ask a provider whether it has a part.
 * The answer is information only. There is no hold, reservation, order or payment.
 * Answering is a stock check, so it also refreshes the listing's stock confirmation.
 */
@Injectable()
export class PartInquiriesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly partsService: PartsService,
    private readonly vehicles: VehiclesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Asking ----------------------------------------------------------------------------------

  private askerScope(asker: PartAsker) {
    if (asker.kind === "user") {
      return and(
        eq(partInquiries.requesterUserId, asker.user.id),
        isNull(partInquiries.requesterOrganizationId),
      );
    }
    const { access, user } = asker;
    const org = eq(partInquiries.requesterOrganizationId, access.tenant.organizationId);
    // Fleet managers for the whole organization see every inquiry; everyone else their own.
    if (hasPermission(access.role, "requests.manage") && access.branchScope === null) return org;
    return and(org, eq(partInquiries.createdBy, user.id));
  }

  async create(asker: PartAsker, input: CreateInput): Promise<PartInquiryDto> {
    if (asker.kind === "organization" && asker.access.organization.kind !== "fleet") {
      throw partsError(400, "not_a_fleet");
    }
    const part = await this.partsService.askable(this.db, input.partId);
    if (!part) throw partsError(409, "part_unavailable");

    // People can't ask their own business.
    const [member] = await this.db
      .select({ id: memberships.userId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, part.organizationId),
          eq(memberships.userId, asker.user.id),
        ),
      );
    if (member) throw partsError(400, "own_part");

    let vehicle = input.vehicle;
    if (input.vehicleId !== null) {
      const row = await this.vehicles.forRequest(
        asker.user,
        input.vehicleId,
        asker.kind === "organization" ? asker.access.tenant.organizationId : null,
      );
      vehicle = {
        vehicleType: row.vehicleType as NonNullable<CreateInput["vehicle"]>["vehicleType"],
        make: row.make,
        model: row.model,
        year: row.year,
      };
    }

    const now = this.clock.now();
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(partInquiries)
          .values({
            organizationId: part.organizationId,
            partId: part.id,
            branchId: part.branchId,
            requesterUserId: asker.kind === "user" ? asker.user.id : null,
            requesterOrganizationId:
              asker.kind === "organization" ? asker.access.tenant.organizationId : null,
            requesterOrganizationKind: asker.kind === "organization" ? "fleet" : null,
            createdBy: asker.user.id,
            partName: part.name,
            partNumber: part.partNumber,
            quantity: input.quantity,
            message: input.message,
            vehicleType: vehicle?.vehicleType ?? null,
            vehicleMake: vehicle?.make ?? null,
            vehicleModel: vehicle?.model ?? null,
            vehicleYear: vehicle?.year ?? null,
            expiresAt: new Date(now.getTime() + PART_INQUIRY_OPEN_DAYS * DAY_MS),
          })
          .returning();
        if (!row) throw new Error("part inquiry insert returned no row");
        await enqueueOutboxEvent(tx, {
          aggregateType: "part_inquiry",
          aggregateId: row.id,
          eventType: "PartInquiryCreated",
          payload: { organizationId: row.organizationId, branchId: row.branchId },
        });
        return row.id;
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes("part_inquiries_one_open")
      ) {
        throw partsError(409, "already_asked");
      }
      throw error;
    }
    return this.mine(asker, id);
  }

  async listMine(asker: PartAsker, query: ListQuery): Promise<PartInquiryDto[]> {
    const rows = await this.db
      .select()
      .from(partInquiries)
      .where(this.askerScope(asker))
      .orderBy(desc(partInquiries.createdAt))
      .limit(200);
    return this.filter(await this.dtos(rows), query);
  }

  async mine(asker: PartAsker, inquiryId: string): Promise<PartInquiryDto> {
    const [row] = await this.db
      .select()
      .from(partInquiries)
      .where(and(eq(partInquiries.id, inquiryId), this.askerScope(asker)));
    if (!row) throw notFound();
    const [dto] = await this.dtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  /** The asker closes the question (found it elsewhere, got the answer). */
  async close(asker: PartAsker, inquiryId: string): Promise<PartInquiryDto> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(partInquiries)
        .where(and(eq(partInquiries.id, inquiryId), this.askerScope(asker)))
        .for("update");
      if (!row) throw notFound();
      if (row.status === "closed") throw partsError(409, "invalid_transition");
      await tx
        .update(partInquiries)
        .set({ status: "closed", closedAt: this.clock.now() })
        .where(eq(partInquiries.id, row.id));
    });
    return this.mine(asker, inquiryId);
  }

  // --- Answering (provider) --------------------------------------------------------------------

  private async received(
    executor: Executor,
    access: TenantAccess,
    inquiryId: string,
    lock = false,
  ) {
    assertProvider(access);
    const query = executor
      .select()
      .from(partInquiries)
      .where(
        and(
          eq(partInquiries.id, inquiryId),
          eq(partInquiries.organizationId, access.tenant.organizationId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    if (!row || !inScope(access, row.branchId)) throw notFound();
    return row;
  }

  async listReceived(access: TenantAccess, query: ListQuery): Promise<PartInquiryDto[]> {
    assertProvider(access);
    const rows = await this.db
      .select()
      .from(partInquiries)
      .where(
        and(
          eq(partInquiries.organizationId, access.tenant.organizationId),
          access.branchScope === null ? undefined : eq(partInquiries.branchId, access.branchScope),
        ),
      )
      .orderBy(desc(partInquiries.createdAt))
      .limit(200);
    return this.filter(await this.dtos(rows), query);
  }

  async getReceived(access: TenantAccess, inquiryId: string): Promise<PartInquiryDto> {
    const row = await this.received(this.db, access, inquiryId);
    const [dto] = await this.dtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  /** Answer (or correct an earlier answer) while the question is open or answered. */
  async answer(
    access: TenantAccess,
    actor: User,
    inquiryId: string,
    input: AnswerInput,
  ): Promise<PartInquiryDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const row = await this.received(tx, access, inquiryId, true);
      const expired = row.status === "open" && row.expiresAt <= now;
      if (row.status === "closed" || expired) throw partsError(409, "invalid_transition");
      await tx
        .update(partInquiries)
        .set({
          status: "answered",
          availability: input.availability,
          quantityAvailable: input.quantityAvailable,
          etaDays: input.etaDays,
          answerMessage: input.message,
          answeredAt: now,
          answeredBy: actor.id,
        })
        .where(eq(partInquiries.id, row.id));
      // The provider just checked the shelf: that is a stock confirmation.
      if (row.partId !== null) {
        const [part] = await tx
          .select()
          .from(parts)
          .where(and(eq(parts.id, row.partId), eq(parts.organizationId, row.organizationId)))
          .for("update");
        if (part) {
          const stocked = part.stockStatus === "in_stock" || part.stockStatus === "low_stock";
          const stock =
            input.availability === "available"
              ? {
                  stockStatus: stocked ? part.stockStatus : ("in_stock" as const),
                  stockQuantity: input.quantityAvailable ?? (stocked ? part.stockQuantity : null),
                }
              : input.availability === "can_order"
                ? { stockStatus: "on_order" as const, stockQuantity: null }
                : { stockStatus: "out_of_stock" as const, stockQuantity: null };
          await tx
            .update(parts)
            .set({ ...stock, stockConfirmedAt: now, stockConfirmedBy: actor.id })
            .where(eq(parts.id, part.id));
        }
      }
      await enqueueOutboxEvent(tx, {
        aggregateType: "part_inquiry",
        aggregateId: row.id,
        eventType: "PartInquiryAnswered",
        payload: { organizationId: row.organizationId, availability: input.availability },
      });
    });
    return this.getReceived(access, inquiryId);
  }

  // --- DTOs ------------------------------------------------------------------------------------

  private filter(items: PartInquiryDto[], query: ListQuery): PartInquiryDto[] {
    return query.status === undefined ? items : items.filter((i) => i.status === query.status);
  }

  private async dtos(rows: readonly PartInquiry[]): Promise<PartInquiryDto[]> {
    if (rows.length === 0) return [];
    const now = this.clock.now();
    const providerIds = [...new Set(rows.map((r) => r.organizationId))];
    const fleetIds = [
      ...new Set(
        rows.flatMap((r) => (r.requesterOrganizationId ? [r.requesterOrganizationId] : [])),
      ),
    ];
    const personIds = [...new Set(rows.map((r) => r.createdBy))];
    const [providers, fleets, people] = await Promise.all([
      this.db
        .select({
          id: organizations.id,
          name: organizations.name,
          slug: providerProfiles.slug,
          snapshot: providerProfiles.publishedSnapshot,
        })
        .from(organizations)
        .innerJoin(providerProfiles, eq(providerProfiles.organizationId, organizations.id))
        .where(inArray(organizations.id, providerIds)),
      fleetIds.length
        ? this.db
            .select({ id: organizations.id, name: organizations.name })
            .from(organizations)
            .where(inArray(organizations.id, fleetIds))
        : Promise.resolve([]),
      this.db
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, personIds)),
    ]);
    const providerOf = new Map(providers.map((p) => [p.id, p]));
    const fleetName = new Map(fleets.map((f) => [f.id, f.name]));
    const personName = new Map(people.map((p) => [p.id, p.name]));
    return rows.map((row) => {
      const provider = providerOf.get(row.organizationId);
      return inquiryDto(
        row,
        {
          provider: {
            name:
              (provider?.snapshot as { tradingName?: string } | null)?.tradingName ??
              provider?.name ??
              "Provider",
            slug: provider?.slug ?? null,
          },
          requester:
            row.requesterOrganizationId === null
              ? (personName.get(row.createdBy) ?? FALLBACK_NAME)
              : (fleetName.get(row.requesterOrganizationId) ?? "Fleet"),
        },
        now,
      );
    });
  }
}

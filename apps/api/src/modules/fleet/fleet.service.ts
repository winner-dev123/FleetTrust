import {
  and,
  asc,
  branches,
  currencies,
  type Database,
  desc,
  eq,
  type Executor,
  type FleetExpense,
  fleetExpenses,
  type FleetIncident,
  fleetIncidents,
  fleetPreferredProviders,
  gte,
  inArray,
  isNull,
  lte,
  or,
  organizations,
  providerProfiles,
  recordAuditEvent,
  type User,
  users,
  type Vehicle,
  vehicles,
} from "@fleettrust/db";
import {
  type createFleetIncidentSchema,
  type ExpenseDto,
  type expenseQuerySchema,
  type expenseRequestSchema,
  type FleetIncidentDto,
  type fleetIncidentQuerySchema,
  type PreferredProviderDto,
  type preferredProviderRequestSchema,
  SPENDING_DISCLAIMER,
  type updateFleetIncidentSchema,
  type updatePreferredProviderSchema,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { VehiclesService } from "../vehicles/index.js";
import {
  assertFleet,
  fleetError,
  inScope,
  isManager,
  notFound,
  trimDecimal,
  vehicleName,
} from "./shared.js";

type IncidentInput = z.output<typeof createFleetIncidentSchema>;
type IncidentChange = z.output<typeof updateFleetIncidentSchema>;
type IncidentQuery = z.output<typeof fleetIncidentQuerySchema>;
type ExpenseInput = z.output<typeof expenseRequestSchema>;
type ExpenseQuery = z.output<typeof expenseQuerySchema>;
type PreferredInput = z.output<typeof preferredProviderRequestSchema>;
type PreferredChange = z.output<typeof updatePreferredProviderSchema>;

const FALLBACK_NAME = "FleetTrust member";

/**
 * Fleet incidents, spending records and preferred providers (SRS F-150..F-152, ADR-0029).
 *
 * - Managers (`vehicles.manage`) see and change everything in their branch scope.
 * - The driver assigned to a vehicle records incidents and spending for it, and sees their own.
 * - Preferred providers: everyone who raises requests sees them; `requests.manage` edits them.
 */
@Injectable()
export class FleetService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly vehicles: VehiclesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /**
   * A vehicle of this fleet the caller may record against: managers in scope, or its current
   * driver. 404 for vehicles of other organizations or out of reach.
   */
  private async recordableVehicle(
    executor: Executor,
    access: TenantAccess,
    user: User,
    vehicleId: string,
  ): Promise<Vehicle> {
    const found = await this.vehicles.access(executor, user, vehicleId);
    if (found?.vehicle.organizationId !== access.tenant.organizationId) throw notFound();
    const manager = isManager(access) && inScope(access, found.vehicle.branchId);
    if (!manager && found.role !== "driver") throw notFound();
    if (found.vehicle.status !== "active") throw fleetError(409, "vehicle_archived");
    return found.vehicle;
  }

  private async audit(
    executor: Executor,
    actor: User,
    organizationId: string,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId,
      action,
      targetType,
      targetId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  private async names(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, name: users.displayName })
      .from(users)
      .where(inArray(users.id, [...new Set(ids)]));
    return new Map(rows.map((r) => [r.id, r.name ?? FALLBACK_NAME]));
  }

  private async vehicleNames(ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const rows = await this.db
      .select()
      .from(vehicles)
      .where(inArray(vehicles.id, [...new Set(ids)]));
    return new Map(rows.map((v) => [v.id, vehicleName(v)]));
  }

  // --- Incidents -------------------------------------------------------------------------------

  async createIncident(
    access: TenantAccess,
    actor: User,
    input: IncidentInput,
  ): Promise<FleetIncidentDto> {
    assertFleet(access);
    const occurredAt = new Date(input.occurredAt);
    if (occurredAt.getTime() > this.clock.now().getTime() + 5 * 60_000) {
      throw fleetError(400, "invalid_range");
    }
    const row = await this.db.transaction(async (tx) => {
      const vehicle = await this.recordableVehicle(tx, access, actor, input.vehicleId);
      const [created] = await tx
        .insert(fleetIncidents)
        .values({
          organizationId: access.tenant.organizationId,
          vehicleId: vehicle.id,
          branchId: vehicle.branchId,
          kind: input.kind,
          severity: input.severity,
          occurredAt,
          location: input.location,
          description: input.description,
          reportedBy: actor.id,
        })
        .returning();
      if (!created) throw new Error("incident insert returned no row");
      await this.audit(
        tx,
        actor,
        created.organizationId,
        "fleet.incident_reported",
        "fleet_incident",
        created.id,
        {
          vehicleId: vehicle.id,
          kind: created.kind,
          severity: created.severity,
        },
      );
      return created;
    });
    return this.incident(access, actor, row.id);
  }

  /** Managers: everything in scope. Drivers: incidents they reported. */
  private incidentScope(access: TenantAccess, actor: User) {
    const org = eq(fleetIncidents.organizationId, access.tenant.organizationId);
    if (!isManager(access)) return and(org, eq(fleetIncidents.reportedBy, actor.id));
    if (access.branchScope === null) return org;
    return and(
      org,
      or(eq(fleetIncidents.branchId, access.branchScope), eq(fleetIncidents.reportedBy, actor.id)),
    );
  }

  async incidents(
    access: TenantAccess,
    actor: User,
    query: IncidentQuery,
  ): Promise<FleetIncidentDto[]> {
    assertFleet(access);
    const rows = await this.db
      .select()
      .from(fleetIncidents)
      .where(
        and(
          this.incidentScope(access, actor),
          query.status ? eq(fleetIncidents.status, query.status) : undefined,
          query.vehicleId ? eq(fleetIncidents.vehicleId, query.vehicleId) : undefined,
        ),
      )
      .orderBy(desc(fleetIncidents.occurredAt), desc(fleetIncidents.id))
      .limit(500);
    return this.incidentDtos(rows);
  }

  async incident(access: TenantAccess, actor: User, incidentId: string): Promise<FleetIncidentDto> {
    assertFleet(access);
    const [row] = await this.db
      .select()
      .from(fleetIncidents)
      .where(and(eq(fleetIncidents.id, incidentId), this.incidentScope(access, actor)));
    if (!row) throw notFound();
    const [dto] = await this.incidentDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  /** Managers update severity and resolve or reopen. */
  async updateIncident(
    access: TenantAccess,
    actor: User,
    incidentId: string,
    change: IncidentChange,
  ): Promise<FleetIncidentDto> {
    const current = await this.incident(access, actor, incidentId);
    if (!isManager(access) || !inScope(access, current.branchId)) {
      throw fleetError(403, "not_allowed");
    }
    const status = change.status ?? current.status;
    const resolved = status === "resolved";
    await this.db.transaction(async (tx) => {
      await tx
        .update(fleetIncidents)
        .set({
          severity: change.severity ?? current.severity,
          status,
          resolutionNote:
            change.resolutionNote === undefined ? current.resolutionNote : change.resolutionNote,
          resolvedAt: resolved
            ? current.resolvedAt
              ? new Date(current.resolvedAt)
              : this.clock.now()
            : null,
          resolvedBy: resolved ? actor.id : null,
        })
        .where(eq(fleetIncidents.id, incidentId));
      if (status !== current.status) {
        await this.audit(
          tx,
          actor,
          access.tenant.organizationId,
          resolved ? "fleet.incident_resolved" : "fleet.incident_reopened",
          "fleet_incident",
          incidentId,
        );
      }
    });
    return this.incident(access, actor, incidentId);
  }

  private async incidentDtos(rows: readonly FleetIncident[]): Promise<FleetIncidentDto[]> {
    const [people, vehicleNames] = await Promise.all([
      this.names(rows.map((r) => r.reportedBy)),
      this.vehicleNames(rows.map((r) => r.vehicleId)),
    ]);
    return rows.map((r) => ({
      id: r.id,
      vehicle: { id: r.vehicleId, name: vehicleNames.get(r.vehicleId) ?? "Vehicle" },
      branchId: r.branchId,
      kind: r.kind,
      severity: r.severity,
      occurredAt: r.occurredAt.toISOString(),
      location: r.location,
      description: r.description,
      status: r.status,
      resolutionNote: r.resolutionNote,
      resolvedAt: r.resolvedAt?.toISOString() ?? null,
      reportedBy: { userId: r.reportedBy, name: people.get(r.reportedBy) ?? FALLBACK_NAME },
      createdAt: r.createdAt.toISOString(),
    }));
  }

  // --- Spending records ------------------------------------------------------------------------

  private async assertCurrency(executor: Executor, code: string) {
    const [row] = await executor.select().from(currencies).where(eq(currencies.code, code));
    if (!row?.isActive) throw fleetError(400, "unknown_currency");
  }

  /** Managers: everything in scope (and organization-level costs if unscoped). Others: their own. */
  private expenseScope(access: TenantAccess, actor: User) {
    const org = eq(fleetExpenses.organizationId, access.tenant.organizationId);
    if (!isManager(access)) return and(org, eq(fleetExpenses.enteredBy, actor.id));
    if (access.branchScope === null) return org;
    return and(
      org,
      or(eq(fleetExpenses.branchId, access.branchScope), eq(fleetExpenses.enteredBy, actor.id)),
    );
  }

  async createExpense(access: TenantAccess, actor: User, input: ExpenseInput): Promise<ExpenseDto> {
    assertFleet(access);
    const row = await this.db.transaction(async (tx) => {
      await this.assertCurrency(tx, input.currency);
      let vehicle: Vehicle | null = null;
      if (input.vehicleId !== null) {
        vehicle = await this.recordableVehicle(tx, access, actor, input.vehicleId);
      } else if (!isManager(access) || access.branchScope !== null) {
        // Organization-level costs belong to organization-wide managers.
        throw fleetError(403, "not_allowed");
      }
      const [created] = await tx
        .insert(fleetExpenses)
        .values({
          organizationId: access.tenant.organizationId,
          vehicleId: vehicle?.id ?? null,
          branchId: vehicle?.branchId ?? null,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          spentOn: input.spentOn,
          vendor: input.vendor,
          description: input.description,
          odometerKm: input.odometerKm,
          litres: input.litres,
          enteredBy: actor.id,
        })
        .returning();
      if (!created) throw new Error("expense insert returned no row");
      return created;
    });
    return this.expense(access, actor, row.id);
  }

  async expenses(access: TenantAccess, actor: User, query: ExpenseQuery): Promise<ExpenseDto[]> {
    assertFleet(access);
    if (query.from && query.to && query.from > query.to) throw fleetError(400, "invalid_range");
    const rows = await this.db
      .select()
      .from(fleetExpenses)
      .where(
        and(
          this.expenseScope(access, actor),
          query.from ? gte(fleetExpenses.spentOn, query.from) : undefined,
          query.to ? lte(fleetExpenses.spentOn, query.to) : undefined,
          query.vehicleId ? eq(fleetExpenses.vehicleId, query.vehicleId) : undefined,
          query.category ? eq(fleetExpenses.category, query.category) : undefined,
        ),
      )
      .orderBy(desc(fleetExpenses.spentOn), desc(fleetExpenses.createdAt))
      .limit(1000);
    return this.expenseDtos(rows);
  }

  async expense(access: TenantAccess, actor: User, expenseId: string): Promise<ExpenseDto> {
    assertFleet(access);
    const [row] = await this.db
      .select()
      .from(fleetExpenses)
      .where(and(eq(fleetExpenses.id, expenseId), this.expenseScope(access, actor)));
    if (!row) throw notFound();
    const [dto] = await this.expenseDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  /** The person who entered it, or a manager in scope, corrects or deletes it. */
  private async editableExpense(
    executor: Executor,
    access: TenantAccess,
    actor: User,
    expenseId: string,
  ): Promise<FleetExpense> {
    assertFleet(access);
    const [row] = await executor
      .select()
      .from(fleetExpenses)
      .where(and(eq(fleetExpenses.id, expenseId), this.expenseScope(access, actor)));
    if (!row) throw notFound();
    const manager = isManager(access) && inScope(access, row.branchId);
    if (!manager && row.enteredBy !== actor.id) throw fleetError(403, "not_allowed");
    return row;
  }

  async replaceExpense(
    access: TenantAccess,
    actor: User,
    expenseId: string,
    input: ExpenseInput,
  ): Promise<ExpenseDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.editableExpense(tx, access, actor, expenseId);
      await this.assertCurrency(tx, input.currency);
      let vehicle: Vehicle | null = null;
      if (input.vehicleId !== null) {
        vehicle =
          input.vehicleId === current.vehicleId
            ? ((await tx.select().from(vehicles).where(eq(vehicles.id, input.vehicleId)))[0] ??
              null)
            : await this.recordableVehicle(tx, access, actor, input.vehicleId);
      } else if (!isManager(access) || access.branchScope !== null) {
        throw fleetError(403, "not_allowed");
      }
      await tx
        .update(fleetExpenses)
        .set({
          vehicleId: vehicle?.id ?? null,
          branchId: vehicle?.branchId ?? null,
          category: input.category,
          amount: input.amount,
          currency: input.currency,
          spentOn: input.spentOn,
          vendor: input.vendor,
          description: input.description,
          odometerKm: input.odometerKm,
          litres: input.litres,
        })
        .where(eq(fleetExpenses.id, current.id));
    });
    return this.expense(access, actor, expenseId);
  }

  async removeExpense(access: TenantAccess, actor: User, expenseId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.editableExpense(tx, access, actor, expenseId);
      await tx.delete(fleetExpenses).where(eq(fleetExpenses.id, current.id));
      await this.audit(
        tx,
        actor,
        current.organizationId,
        "fleet.expense_deleted",
        "fleet_expense",
        current.id,
        {
          amount: current.amount,
          currency: current.currency,
          category: current.category,
        },
      );
    });
  }

  private async expenseDtos(rows: readonly FleetExpense[]): Promise<ExpenseDto[]> {
    const [people, vehicleNames] = await Promise.all([
      this.names(rows.map((r) => r.enteredBy)),
      this.vehicleNames(rows.flatMap((r) => (r.vehicleId ? [r.vehicleId] : []))),
    ]);
    return rows.map((r) => ({
      id: r.id,
      vehicle:
        r.vehicleId === null
          ? null
          : { id: r.vehicleId, name: vehicleNames.get(r.vehicleId) ?? "Vehicle" },
      branchId: r.branchId,
      category: r.category,
      amount: trimDecimal(r.amount),
      currency: r.currency,
      spentOn: r.spentOn,
      vendor: r.vendor,
      description: r.description,
      odometerKm: r.odometerKm,
      litres: r.litres === null ? null : trimDecimal(r.litres),
      enteredBy: { userId: r.enteredBy, name: people.get(r.enteredBy) ?? FALLBACK_NAME },
      verified: false as const,
      source: "entered_by_user" as const,
      createdAt: r.createdAt.toISOString(),
      disclaimer: SPENDING_DISCLAIMER,
    }));
  }

  // --- Preferred providers ---------------------------------------------------------------------

  async preferred(access: TenantAccess): Promise<PreferredProviderDto[]> {
    assertFleet(access);
    const rows = await this.db
      .select({
        entry: fleetPreferredProviders,
        slug: providerProfiles.slug,
        status: providerProfiles.status,
        snapshot: providerProfiles.publishedSnapshot,
        categories: providerProfiles.categories,
        orgName: organizations.name,
        orgStatus: organizations.status,
      })
      .from(fleetPreferredProviders)
      .innerJoin(
        providerProfiles,
        eq(providerProfiles.organizationId, fleetPreferredProviders.providerOrganizationId),
      )
      .innerJoin(
        organizations,
        eq(organizations.id, fleetPreferredProviders.providerOrganizationId),
      )
      .where(
        and(
          eq(fleetPreferredProviders.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : or(
                isNull(fleetPreferredProviders.branchId),
                eq(fleetPreferredProviders.branchId, access.branchScope),
              ),
        ),
      )
      .orderBy(asc(organizations.name), asc(fleetPreferredProviders.id));
    return rows.map((r) => {
      const snapshot = r.snapshot as { tradingName?: string; categories?: string[] } | null;
      return {
        id: r.entry.id,
        provider: {
          organizationId: r.entry.providerOrganizationId,
          slug: r.slug,
          name: snapshot?.tradingName ?? r.orgName,
          categories: snapshot?.categories ?? r.categories,
          available: r.status === "published" && r.orgStatus === "active",
        },
        branchId: r.entry.branchId,
        categories: r.entry.categories as PreferredProviderDto["categories"],
        note: r.entry.note,
        addedBy: r.entry.addedBy,
        createdAt: r.entry.createdAt.toISOString(),
      };
    });
  }

  async addPreferred(
    access: TenantAccess,
    actor: User,
    input: PreferredInput,
  ): Promise<PreferredProviderDto[]> {
    assertFleet(access);
    if (!inScope(access, input.branchId)) throw fleetError(403, "not_allowed");
    if (input.branchId !== null) {
      const [branch] = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.id, input.branchId),
            eq(branches.organizationId, access.tenant.organizationId),
          ),
        );
      if (!branch) throw fleetError(400, "invalid_branch");
    }
    const [provider] = await this.db
      .select({ organizationId: providerProfiles.organizationId })
      .from(providerProfiles)
      .innerJoin(organizations, eq(organizations.id, providerProfiles.organizationId))
      .where(
        and(
          eq(providerProfiles.slug, input.providerSlug),
          eq(providerProfiles.status, "published"),
          eq(organizations.status, "active"),
        ),
      );
    if (!provider) throw fleetError(400, "provider_not_found");
    try {
      await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(fleetPreferredProviders)
          .values({
            organizationId: access.tenant.organizationId,
            providerOrganizationId: provider.organizationId,
            branchId: input.branchId,
            categories: input.categories,
            note: input.note,
            addedBy: actor.id,
          })
          .returning();
        if (!row) throw new Error("preferred provider insert returned no row");
        await this.audit(
          tx,
          actor,
          row.organizationId,
          "fleet.preferred_provider_added",
          "fleet_preferred_provider",
          row.id,
          {
            providerOrganizationId: provider.organizationId,
            branchId: input.branchId,
          },
        );
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes(
          "fleet_preferred_providers_key",
        )
      ) {
        throw fleetError(409, "already_preferred");
      }
      throw error;
    }
    return this.preferred(access);
  }

  private async preferredEntry(executor: Executor, access: TenantAccess, entryId: string) {
    assertFleet(access);
    const [row] = await executor
      .select()
      .from(fleetPreferredProviders)
      .where(
        and(
          eq(fleetPreferredProviders.id, entryId),
          eq(fleetPreferredProviders.organizationId, access.tenant.organizationId),
        ),
      );
    if (!row) throw notFound();
    if (!inScope(access, row.branchId)) {
      // Branch-scoped managers see organization-wide entries but don't change them.
      if (row.branchId === null) throw fleetError(403, "not_allowed");
      throw notFound();
    }
    return row;
  }

  async updatePreferred(
    access: TenantAccess,
    entryId: string,
    change: PreferredChange,
  ): Promise<PreferredProviderDto[]> {
    const entry = await this.preferredEntry(this.db, access, entryId);
    await this.db
      .update(fleetPreferredProviders)
      .set({
        categories: change.categories ?? entry.categories,
        note: change.note === undefined ? entry.note : change.note,
      })
      .where(eq(fleetPreferredProviders.id, entry.id));
    return this.preferred(access);
  }

  async removePreferred(access: TenantAccess, actor: User, entryId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const entry = await this.preferredEntry(tx, access, entryId);
      await tx.delete(fleetPreferredProviders).where(eq(fleetPreferredProviders.id, entry.id));
      await this.audit(
        tx,
        actor,
        entry.organizationId,
        "fleet.preferred_provider_removed",
        "fleet_preferred_provider",
        entry.id,
        {
          providerOrganizationId: entry.providerOrganizationId,
        },
      );
    });
  }

  /** A provider sees how many fleets prefer it, never which ones. */
  async preferredByCount(access: TenantAccess): Promise<{ fleets: number }> {
    if (access.organization.kind !== "provider") throw fleetError(400, "not_a_provider");
    const rows = await this.db
      .selectDistinct({ org: fleetPreferredProviders.organizationId })
      .from(fleetPreferredProviders)
      .where(eq(fleetPreferredProviders.providerOrganizationId, access.tenant.organizationId));
    return { fleets: rows.length };
  }
}

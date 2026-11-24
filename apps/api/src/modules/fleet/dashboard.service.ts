import {
  and,
  branches,
  type Database,
  eq,
  fleetExpenses,
  fleetIncidents,
  gte,
  inArray,
  isNotNull,
  isNull,
  maintenanceSchedules,
  serviceRecords,
  serviceRequests,
  vehicleAssignments,
  vehicleDocuments,
  vehicles,
} from "@fleettrust/db";
import {
  type dashboardQuerySchema,
  FLEET_INCIDENT_KINDS,
  type FleetDashboardDto,
  SPENDING_DISCLAIMER,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { scheduleStatus } from "../vehicles/index.js";
import { assertFleet, fleetError, fromCents, toCents, vehicleName } from "./shared.js";

type Query = z.output<typeof dashboardQuerySchema>;

const DAY_MS = 86_400_000;

interface SpendLine {
  total: number;
  categories: Map<string, number>;
  expenses: number;
  records: number;
}
const isoDate = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The fleet dashboard (SRS J5, F-150, ADR-0029): maintenance due, expiring documents, incidents,
 * open service requests and user-entered spending, for managers in their branch scope.
 * Spending is summed per currency, never converted, and always labelled as unverified.
 */
@Injectable()
export class DashboardService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async dashboard(access: TenantAccess, query: Query): Promise<FleetDashboardDto> {
    assertFleet(access);
    const org = access.tenant.organizationId;
    let branchId = access.branchScope;
    if (query.branchId !== undefined) {
      if (access.branchScope !== null && query.branchId !== access.branchScope) {
        throw fleetError(403, "not_allowed");
      }
      const [branch] = await this.db
        .select({ id: branches.id })
        .from(branches)
        .where(and(eq(branches.id, query.branchId), eq(branches.organizationId, org)));
      if (!branch) throw fleetError(400, "invalid_branch");
      branchId = query.branchId;
    }

    const now = this.clock.now();
    const today = isoDate(now);
    const from = new Date(now.getTime() - query.days * DAY_MS);
    const fromDate = isoDate(from);
    const in30 = isoDate(new Date(now.getTime() + 30 * DAY_MS));

    const fleet = await this.db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, org),
          eq(vehicles.status, "active"),
          branchId === null ? undefined : eq(vehicles.branchId, branchId),
        ),
      );
    const ids = fleet.map((v) => v.id);
    const byId = new Map(fleet.map((v) => [v.id, v]));

    const [assigned, schedules, documents, incidents, requests, expenses, records] =
      await Promise.all([
        ids.length
          ? this.db
              .select({ vehicleId: vehicleAssignments.vehicleId })
              .from(vehicleAssignments)
              .where(
                and(inArray(vehicleAssignments.vehicleId, ids), isNull(vehicleAssignments.endsAt)),
              )
          : Promise.resolve([]),
        ids.length
          ? this.db
              .select()
              .from(maintenanceSchedules)
              .where(
                and(
                  inArray(maintenanceSchedules.vehicleId, ids),
                  eq(maintenanceSchedules.active, true),
                ),
              )
          : Promise.resolve([]),
        ids.length
          ? this.db
              .select({ expiresOn: vehicleDocuments.expiresOn })
              .from(vehicleDocuments)
              .where(
                and(
                  inArray(vehicleDocuments.vehicleId, ids),
                  eq(vehicleDocuments.status, "available"),
                  isNotNull(vehicleDocuments.expiresOn),
                ),
              )
          : Promise.resolve([]),
        this.db
          .select({
            kind: fleetIncidents.kind,
            severity: fleetIncidents.severity,
            status: fleetIncidents.status,
            occurredAt: fleetIncidents.occurredAt,
          })
          .from(fleetIncidents)
          .where(
            and(
              eq(fleetIncidents.organizationId, org),
              branchId === null ? undefined : eq(fleetIncidents.branchId, branchId),
            ),
          ),
        this.db
          .select({ status: serviceRequests.status, expiresAt: serviceRequests.expiresAt })
          .from(serviceRequests)
          .where(
            and(
              eq(serviceRequests.requesterOrganizationId, org),
              branchId === null ? undefined : eq(serviceRequests.fleetBranchId, branchId),
              inArray(serviceRequests.status, ["open", "accepted"]),
            ),
          ),
        this.db
          .select({
            category: fleetExpenses.category,
            amount: fleetExpenses.amount,
            currency: fleetExpenses.currency,
          })
          .from(fleetExpenses)
          .where(
            and(
              eq(fleetExpenses.organizationId, org),
              gte(fleetExpenses.spentOn, fromDate),
              branchId === null ? undefined : eq(fleetExpenses.branchId, branchId),
            ),
          ),
        ids.length
          ? this.db
              .select({
                category: serviceRecords.category,
                amount: serviceRecords.costAmount,
                currency: serviceRecords.costCurrency,
              })
              .from(serviceRecords)
              .where(
                and(
                  inArray(serviceRecords.vehicleId, ids),
                  gte(serviceRecords.performedOn, fromDate),
                  isNotNull(serviceRecords.costAmount),
                ),
              )
          : Promise.resolve([]),
      ]);

    // Maintenance.
    const counts = { overdue: 0, due_soon: 0, ok: 0, unknown: 0 };
    const due: FleetDashboardDto["maintenance"]["items"] = [];
    for (const schedule of schedules) {
      const vehicle = byId.get(schedule.vehicleId);
      if (!vehicle) continue;
      const s = scheduleStatus(schedule, vehicle.odometerKm, today);
      counts[s.status] += 1;
      if (s.status === "overdue" || s.status === "due_soon") {
        due.push({
          scheduleId: schedule.id,
          vehicle: { id: vehicle.id, name: vehicleName(vehicle) },
          title: schedule.title,
          status: s.status,
          nextDueOn: s.nextDueOn,
          nextDueKm: s.nextDueKm,
        });
      }
    }
    due.sort(
      (a, b) =>
        (a.status === b.status ? 0 : a.status === "overdue" ? -1 : 1) ||
        (a.nextDueOn ?? "9999").localeCompare(b.nextDueOn ?? "9999"),
    );

    // Spending, per currency, from both sources.
    const lines = new Map<string, SpendLine>();
    const add = (
      currency: string,
      category: string,
      amount: string,
      source: "expenses" | "records",
    ) => {
      const cents = toCents(amount);
      const line: SpendLine = lines.get(currency) ?? {
        total: 0,
        categories: new Map<string, number>(),
        expenses: 0,
        records: 0,
      };
      line.total += cents;
      line[source] += cents;
      line.categories.set(category, (line.categories.get(category) ?? 0) + cents);
      lines.set(currency, line);
    };
    for (const e of expenses) add(e.currency, e.category, e.amount, "expenses");
    for (const r of records) {
      if (r.amount !== null && r.currency !== null)
        add(r.currency, r.category, r.amount, "records");
    }

    const inWindow = incidents.filter((i) => i.occurredAt >= from);
    return {
      window: { days: query.days, from: fromDate, to: today },
      branchId,
      vehicles: {
        active: fleet.length,
        withDriver: new Set(assigned.map((a) => a.vehicleId)).size,
      },
      maintenance: {
        overdue: counts.overdue,
        dueSoon: counts.due_soon,
        ok: counts.ok,
        unknown: counts.unknown,
        items: due.slice(0, 20),
      },
      documents: {
        expired: documents.filter((d) => d.expiresOn !== null && d.expiresOn < today).length,
        expiringWithin30Days: documents.filter(
          (d) => d.expiresOn !== null && d.expiresOn >= today && d.expiresOn <= in30,
        ).length,
      },
      incidents: {
        open: incidents.filter((i) => i.status === "open").length,
        inWindow: inWindow.length,
        byKind: FLEET_INCIDENT_KINDS.map((kind) => ({
          kind,
          count: inWindow.filter((i) => i.kind === kind).length,
        })).filter((k) => k.count > 0),
        highSeverityOpen: incidents.filter((i) => i.status === "open" && i.severity === "high")
          .length,
      },
      serviceRequests: {
        open: requests.filter((r) => r.status === "open" && r.expiresAt > now).length,
        accepted: requests.filter((r) => r.status === "accepted").length,
      },
      spending: {
        lines: [...lines.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([currency, line]) => ({
            currency,
            total: fromCents(line.total),
            byCategory: [...line.categories.entries()]
              .sort(([, a], [, b]) => b - a)
              .map(([category, cents]) => ({ category, total: fromCents(cents) })),
            bySource: {
              expenses: fromCents(line.expenses),
              serviceRecords: fromCents(line.records),
            },
          })),
        verified: false as const,
        disclaimer: SPENDING_DISCLAIMER,
      },
    };
  }
}

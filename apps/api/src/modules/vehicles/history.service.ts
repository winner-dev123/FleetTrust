import {
  and,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type MaintenanceSchedule,
  maintenanceSchedules,
  organizations,
  providerProfiles,
  type ServiceRecord,
  serviceRecords,
  type User,
  users,
  vehicleDocuments,
  vehicles,
} from "@fleettrust/db";
import {
  type completeScheduleSchema,
  type createServiceRecordSchema,
  type MaintenanceScheduleDto,
  type providerServiceRecordSchema,
  type scheduleSchema,
  SERVICE_RECORD_NOTICE,
  SERVICE_RECORD_SOURCE_LABELS,
  type ServiceHistory,
  type ServiceRecordDto,
  type ServiceRecordSource,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { scheduleStatus } from "./maintenance.js";
import { notFound, vehicleError } from "./shared.js";
import { type VehicleAccess, VehiclesService } from "./vehicles.service.js";

type RecordInput = z.output<typeof createServiceRecordSchema>;
type ProviderRecordInput = z.output<typeof providerServiceRecordSchema>;
type ScheduleInput = z.output<typeof scheduleSchema>;
type CompleteInput = z.output<typeof completeScheduleSchema>;

const FALLBACK_NAME = "FleetTrust member";
const OVERDUE_REPEAT_DAYS = 7;

/**
 * Service history (F-072) and maintenance schedules with reminders (F-073). The source of a
 * record follows from who entered it (owner, fleet, driver, provider) or what it was taken from
 * (a vault document). Nothing here can mark a record verified.
 */
@Injectable()
export class HistoryService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly vehiclesService: VehiclesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  // -------------------------------------------------------------------------------------------
  // Service records
  // -------------------------------------------------------------------------------------------

  async history(user: User, vehicleId: string): Promise<ServiceHistory> {
    await this.vehiclesService.require(user, vehicleId);
    const rows = await this.db
      .select()
      .from(serviceRecords)
      .where(eq(serviceRecords.vehicleId, vehicleId))
      .orderBy(desc(serviceRecords.performedOn), desc(serviceRecords.createdAt))
      .limit(500);
    return {
      items: await Promise.all(rows.map((r) => this.recordDto(r))),
      notice: SERVICE_RECORD_NOTICE,
    };
  }

  /** Owners, fleet managers and drivers add records; the source follows from their role. */
  async addRecord(user: User, vehicleId: string, input: RecordInput): Promise<ServiceRecordDto> {
    const access = await this.vehiclesService.require(user, vehicleId);
    if (access.vehicle.status !== "active") throw vehicleError(409, "vehicle_archived");
    let source: ServiceRecordSource =
      access.role === "owner" ? "owner" : access.role === "manager" ? "fleet" : "driver";
    if (input.fromDocumentId !== null) {
      const [doc] = await this.db
        .select({
          id: vehicleDocuments.id,
          status: vehicleDocuments.status,
          driverVisible: vehicleDocuments.driverVisible,
        })
        .from(vehicleDocuments)
        .where(
          and(
            eq(vehicleDocuments.id, input.fromDocumentId),
            eq(vehicleDocuments.vehicleId, vehicleId),
          ),
        );
      if (doc?.status !== "available" || (access.role === "driver" && !doc.driverVisible)) {
        throw vehicleError(400, "document_not_ready");
      }
      source = "document";
    }
    if (input.scheduleId !== null) await this.schedule(vehicleId, input.scheduleId);
    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(serviceRecords)
        .values({
          vehicleId,
          performedOn: input.performedOn,
          odometerKm: input.odometerKm,
          category: input.category,
          title: input.title,
          description: input.description,
          costAmount: input.cost?.amount ?? null,
          costCurrency: input.cost?.currency ?? null,
          source,
          providerName: input.providerName,
          enteredBy: user.id,
          scheduleId: input.scheduleId,
          documentId: input.fromDocumentId,
        })
        .returning();
      if (!inserted) throw new Error("service record insert returned no row");
      if (input.scheduleId !== null) {
        await tx
          .update(maintenanceSchedules)
          .set({
            lastDoneOn: input.performedOn,
            lastDoneKm: input.odometerKm,
            remindedStatus: null,
            remindedAt: null,
          })
          .where(eq(maintenanceSchedules.id, input.scheduleId));
      }
      await this.raiseOdometer(tx, access, input.odometerKm);
      await this.vehiclesService.audit(tx, user, access.vehicle, "service_record_added", {
        recordId: inserted.id,
        source,
      });
      return inserted;
    });
    return this.recordDto(row);
  }

  /** A provider's record for the vehicle on its accepted service request (source "provider"). */
  async addProviderRecord(
    user: User,
    providerOrganizationId: string,
    vehicleId: string,
    serviceRequestId: string,
    input: ProviderRecordInput,
  ): Promise<ServiceRecordDto> {
    const [vehicle] = await this.db.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    if (!vehicle) throw notFound();
    const [profile] = await this.db
      .select({ tradingName: providerProfiles.tradingName, name: organizations.name })
      .from(organizations)
      .leftJoin(providerProfiles, eq(providerProfiles.organizationId, organizations.id))
      .where(eq(organizations.id, providerOrganizationId));
    const row = await this.db.transaction(async (tx) => {
      const [inserted] = await tx
        .insert(serviceRecords)
        .values({
          vehicleId,
          performedOn: input.performedOn,
          odometerKm: input.odometerKm,
          category: input.category,
          title: input.title,
          description: input.description,
          costAmount: input.cost?.amount ?? null,
          costCurrency: input.cost?.currency ?? null,
          source: "provider",
          providerOrganizationId,
          providerName: profile?.tradingName ?? profile?.name ?? null,
          enteredBy: user.id,
          serviceRequestId,
        })
        .returning();
      if (!inserted) throw new Error("service record insert returned no row");
      await this.vehiclesService.audit(tx, user, vehicle, "service_record_added", {
        recordId: inserted.id,
        source: "provider",
        providerOrganizationId,
      });
      return inserted;
    });
    return this.recordDto(row);
  }

  /** Only the person who entered a record can delete it (the history stays trustworthy). */
  async deleteRecord(user: User, vehicleId: string, recordId: string): Promise<void> {
    const access = await this.vehiclesService.require(user, vehicleId);
    const [row] = await this.db
      .select()
      .from(serviceRecords)
      .where(and(eq(serviceRecords.id, recordId), eq(serviceRecords.vehicleId, vehicleId)));
    if (!row) throw notFound();
    if (row.enteredBy !== user.id) throw vehicleError(403, "not_allowed");
    await this.db.delete(serviceRecords).where(eq(serviceRecords.id, row.id));
    await this.vehiclesService.audit(this.db, user, access.vehicle, "service_record_deleted", {
      recordId: row.id,
      source: row.source,
    });
  }

  private async raiseOdometer(
    executor: Parameters<VehiclesService["audience"]>[0],
    access: VehicleAccess,
    km: number | null,
  ) {
    if (km === null) return;
    const current = access.vehicle.odometerKm;
    if (current === null || km > current) {
      await executor
        .update(vehicles)
        .set({ odometerKm: km, odometerUpdatedAt: this.clock.now() })
        .where(eq(vehicles.id, access.vehicle.id));
    }
  }

  private async recordDto(row: ServiceRecord): Promise<ServiceRecordDto> {
    const [author] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.enteredBy));
    const label = SERVICE_RECORD_SOURCE_LABELS[row.source];
    const providerName = row.providerName;
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      performedOn: row.performedOn,
      odometerKm: row.odometerKm,
      category: row.category,
      title: row.title,
      description: row.description,
      cost:
        row.costAmount === null || row.costCurrency === null
          ? null
          : { amount: row.costAmount, currency: row.costCurrency },
      source: row.source,
      sourceLabel:
        row.source === "provider" && providerName !== null ? `${label} · ${providerName}` : label,
      provider:
        providerName === null && row.providerOrganizationId === null
          ? null
          : { organizationId: row.providerOrganizationId, name: providerName ?? "" },
      enteredBy: { displayName: author?.name ?? FALLBACK_NAME },
      scheduleId: row.scheduleId,
      documentId: row.documentId,
      serviceRequestId: row.serviceRequestId,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // -------------------------------------------------------------------------------------------
  // Schedules
  // -------------------------------------------------------------------------------------------

  private async schedule(vehicleId: string, scheduleId: string): Promise<MaintenanceSchedule> {
    const [row] = await this.db
      .select()
      .from(maintenanceSchedules)
      .where(
        and(
          eq(maintenanceSchedules.id, scheduleId),
          eq(maintenanceSchedules.vehicleId, vehicleId),
          eq(maintenanceSchedules.active, true),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  async schedules(user: User, vehicleId: string): Promise<MaintenanceScheduleDto[]> {
    const { vehicle } = await this.vehiclesService.require(user, vehicleId);
    const rows = await this.db
      .select()
      .from(maintenanceSchedules)
      .where(
        and(eq(maintenanceSchedules.vehicleId, vehicleId), eq(maintenanceSchedules.active, true)),
      );
    return rows.map((r) => this.scheduleDto(r, vehicle.odometerKm));
  }

  async addSchedule(
    user: User,
    vehicleId: string,
    input: ScheduleInput,
  ): Promise<MaintenanceScheduleDto> {
    const { vehicle } = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const [row] = await this.db
      .insert(maintenanceSchedules)
      .values({
        vehicleId,
        title: input.title,
        kind: input.kind,
        intervalKm: input.intervalKm,
        intervalDays: input.intervalDays,
        // Without a baseline, start counting from now.
        lastDoneKm: input.lastDoneKm ?? (input.intervalKm === null ? null : vehicle.odometerKm),
        lastDoneOn: input.lastDoneOn ?? (input.intervalDays === null ? null : this.today()),
        remindBeforeKm: input.remindBeforeKm,
        remindBeforeDays: input.remindBeforeDays,
        createdBy: user.id,
      })
      .returning();
    if (!row) throw new Error("schedule insert returned no row");
    return this.scheduleDto(row, vehicle.odometerKm);
  }

  async updateSchedule(
    user: User,
    vehicleId: string,
    scheduleId: string,
    input: ScheduleInput,
  ): Promise<MaintenanceScheduleDto> {
    const { vehicle } = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    await this.schedule(vehicleId, scheduleId);
    const [row] = await this.db
      .update(maintenanceSchedules)
      .set({
        title: input.title,
        kind: input.kind,
        intervalKm: input.intervalKm,
        intervalDays: input.intervalDays,
        lastDoneKm: input.lastDoneKm,
        lastDoneOn: input.lastDoneOn,
        remindBeforeKm: input.remindBeforeKm,
        remindBeforeDays: input.remindBeforeDays,
        remindedStatus: null,
        remindedAt: null,
      })
      .where(eq(maintenanceSchedules.id, scheduleId))
      .returning();
    if (!row) throw notFound();
    return this.scheduleDto(row, vehicle.odometerKm);
  }

  async removeSchedule(user: User, vehicleId: string, scheduleId: string): Promise<void> {
    await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    await this.schedule(vehicleId, scheduleId);
    await this.db
      .update(maintenanceSchedules)
      .set({ active: false })
      .where(eq(maintenanceSchedules.id, scheduleId));
  }

  /** Marks it done without a service record (e.g. a quick check). Drivers may do this too. */
  async completeSchedule(
    user: User,
    vehicleId: string,
    scheduleId: string,
    input: CompleteInput,
  ): Promise<MaintenanceScheduleDto> {
    const access = await this.vehiclesService.require(user, vehicleId);
    await this.schedule(vehicleId, scheduleId);
    const [row] = await this.db
      .update(maintenanceSchedules)
      .set({
        lastDoneOn: input.doneOn,
        lastDoneKm: input.odometerKm,
        remindedStatus: null,
        remindedAt: null,
      })
      .where(eq(maintenanceSchedules.id, scheduleId))
      .returning();
    if (!row) throw notFound();
    await this.raiseOdometer(this.db, access, input.odometerKm);
    const [vehicle] = await this.db
      .select({ km: vehicles.odometerKm })
      .from(vehicles)
      .where(eq(vehicles.id, vehicleId));
    return this.scheduleDto(row, vehicle?.km ?? null);
  }

  private scheduleDto(row: MaintenanceSchedule, odometerKm: number | null): MaintenanceScheduleDto {
    const computed = scheduleStatus(row, odometerKm, this.today());
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      title: row.title,
      kind: row.kind,
      intervalKm: row.intervalKm,
      intervalDays: row.intervalDays,
      lastDoneKm: row.lastDoneKm,
      lastDoneOn: row.lastDoneOn,
      nextDueKm: computed.nextDueKm,
      nextDueOn: computed.nextDueOn,
      remindBeforeKm: row.remindBeforeKm,
      remindBeforeDays: row.remindBeforeDays,
      status: computed.status,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Reminders (worker)
  // -------------------------------------------------------------------------------------------

  /**
   * Queues reminders (through the outbox, so the inbox and push follow the usual opt-outs):
   * once when a schedule becomes due soon, once when it becomes overdue, then weekly while it
   * stays overdue; and once per expiry date for documents expiring within 30 days.
   */
  async queueReminders(): Promise<{ maintenance: number; documents: number }> {
    const now = this.clock.now();
    const today = this.today();
    let maintenance = 0;
    const rows = await this.db
      .select({ schedule: maintenanceSchedules, vehicle: vehicles })
      .from(maintenanceSchedules)
      .innerJoin(vehicles, eq(vehicles.id, maintenanceSchedules.vehicleId))
      .where(and(eq(maintenanceSchedules.active, true), eq(vehicles.status, "active")));
    for (const { schedule, vehicle } of rows) {
      const { status, nextDueKm, nextDueOn } = scheduleStatus(schedule, vehicle.odometerKm, today);
      if (status !== "due_soon" && status !== "overdue") continue;
      const repeat =
        status === "overdue" &&
        schedule.remindedStatus === "overdue" &&
        schedule.remindedAt !== null &&
        now.getTime() - schedule.remindedAt.getTime() >= OVERDUE_REPEAT_DAYS * 86_400_000;
      if (schedule.remindedStatus === status && !repeat) continue;
      await this.db.transaction(async (tx) => {
        await tx
          .update(maintenanceSchedules)
          .set({ remindedStatus: status, remindedAt: now })
          .where(eq(maintenanceSchedules.id, schedule.id));
        await enqueueOutboxEvent(tx, {
          aggregateType: "vehicle",
          aggregateId: vehicle.id,
          eventType: "MaintenanceDue",
          payload: {
            vehicleId: vehicle.id,
            scheduleId: schedule.id,
            status,
            title: schedule.title,
            nextDueKm,
            nextDueOn,
          },
        });
      });
      maintenance += 1;
    }
    let documents = 0;
    const docs = await this.db
      .select({ doc: vehicleDocuments, vehicle: vehicles })
      .from(vehicleDocuments)
      .innerJoin(vehicles, eq(vehicles.id, vehicleDocuments.vehicleId))
      .where(and(eq(vehicleDocuments.status, "available"), eq(vehicles.status, "active")));
    for (const { doc, vehicle } of docs) {
      if (doc.expiresOn === null || doc.expiryRemindedFor === doc.expiresOn) continue;
      const days = Math.round(
        (Date.parse(`${doc.expiresOn}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000,
      );
      if (days > 30) continue;
      await this.db.transaction(async (tx) => {
        await tx
          .update(vehicleDocuments)
          .set({ expiryRemindedFor: doc.expiresOn })
          .where(eq(vehicleDocuments.id, doc.id));
        await enqueueOutboxEvent(tx, {
          aggregateType: "vehicle",
          aggregateId: vehicle.id,
          eventType: "VehicleDocumentExpiring",
          payload: {
            vehicleId: vehicle.id,
            documentId: doc.id,
            title: doc.title,
            expiresOn: doc.expiresOn,
          },
        });
      });
      documents += 1;
    }
    return { maintenance, documents };
  }
}

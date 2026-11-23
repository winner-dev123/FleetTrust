import {
  and,
  branches,
  type Database,
  desc,
  eq,
  type Executor,
  inArray,
  isNull,
  maintenanceSchedules,
  memberships,
  organizations,
  recordAuditEvent,
  type User,
  users,
  type Vehicle,
  vehicleAssignments,
  vehicles,
} from "@fleettrust/db";
import {
  type createVehicleSchema,
  hasPermission,
  type Role,
  type updateVehicleSchema,
  type VehicleDto,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { scheduleStatus } from "./maintenance.js";
import { notFound, vehicleError } from "./shared.js";

type CreateInput = z.output<typeof createVehicleSchema>;
type UpdateInput = z.output<typeof updateVehicleSchema>;

export type VehicleRole = "owner" | "manager" | "driver";

/** The caller's standing on a vehicle. */
export interface VehicleAccess {
  vehicle: Vehicle;
  role: VehicleRole;
}

const FALLBACK_NAME = "FleetTrust member";

/**
 * Vehicles and driver assignment (F-070, F-071, ADR-0026). Access is decided per vehicle:
 * - personal vehicles: their owner;
 * - fleet vehicles: owners and admins, managers with `vehicles.manage` (branch scope), and the
 *   currently assigned driver (read, odometer and service records only).
 * Anyone else gets 404.
 */
@Injectable()
export class VehiclesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async audit(
    executor: Executor,
    actor: User,
    vehicle: Vehicle,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: vehicle.organizationId,
      action: `vehicle.${action}`,
      targetType: "vehicle",
      targetId: vehicle.id,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Access
  // -------------------------------------------------------------------------------------------

  async access(executor: Executor, user: User, vehicleId: string): Promise<VehicleAccess | null> {
    const [vehicle] = await executor.select().from(vehicles).where(eq(vehicles.id, vehicleId));
    if (!vehicle || user.status !== "active") return null;
    if (vehicle.ownerUserId !== null)
      return vehicle.ownerUserId === user.id ? { vehicle, role: "owner" } : null;
    if (vehicle.organizationId === null) return null;
    const [member] = await executor
      .select({
        role: memberships.role,
        branchId: memberships.branchId,
        orgStatus: organizations.status,
      })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.organizationId, vehicle.organizationId),
          eq(memberships.userId, user.id),
        ),
      );
    if (member?.orgStatus !== "active") return null;
    if (
      hasPermission(member.role as Role, "vehicles.manage") &&
      (member.branchId === null || member.branchId === vehicle.branchId)
    ) {
      return { vehicle, role: "manager" };
    }
    const [assignment] = await executor
      .select({ id: vehicleAssignments.id })
      .from(vehicleAssignments)
      .where(
        and(
          eq(vehicleAssignments.vehicleId, vehicle.id),
          eq(vehicleAssignments.userId, user.id),
          isNull(vehicleAssignments.endsAt),
        ),
      );
    return assignment ? { vehicle, role: "driver" } : null;
  }

  /** 404 without access; 403 when the role isn't enough for the action. */
  async require(
    user: User,
    vehicleId: string,
    roles: readonly VehicleRole[] = ["owner", "manager", "driver"],
  ): Promise<VehicleAccess> {
    const access = await this.access(this.db, user, vehicleId);
    if (!access) throw notFound();
    if (!roles.includes(access.role)) throw vehicleError(403, "not_allowed");
    return access;
  }

  /** For service requests (Prompt 14): the requester must be able to use the vehicle. */
  async forRequest(user: User, vehicleId: string, organizationId: string | null): Promise<Vehicle> {
    const access = await this.access(this.db, user, vehicleId);
    if (!access) throw notFound();
    const { vehicle } = access;
    if ((organizationId ?? null) !== vehicle.organizationId) throw notFound();
    if (vehicle.status !== "active") throw vehicleError(409, "vehicle_archived");
    return vehicle;
  }

  // -------------------------------------------------------------------------------------------
  // Vehicles
  // -------------------------------------------------------------------------------------------

  private async createRow(
    user: User,
    input: CreateInput,
    owner: { userId: string } | { organizationId: string },
  ): Promise<Vehicle> {
    try {
      const [row] = await this.db
        .insert(vehicles)
        .values({
          ...("userId" in owner
            ? { ownerUserId: owner.userId }
            : { organizationId: owner.organizationId }),
          branchId: input.branchId,
          nickname: input.nickname,
          vehicleType: input.vehicleType,
          make: input.make,
          model: input.model,
          year: input.year,
          registration: input.registration,
          vin: input.vin,
          odometerKm: input.odometerKm,
          odometerUpdatedAt: input.odometerKm === null ? null : this.clock.now(),
          createdBy: user.id,
        })
        .returning();
      if (!row) throw new Error("vehicle insert returned no row");
      await this.audit(this.db, user, row, "created");
      return row;
    } catch (error) {
      if (String((error as { cause?: unknown }).cause ?? error).includes("_registration_key")) {
        throw vehicleError(409, "duplicate_registration");
      }
      throw error;
    }
  }

  async createPersonal(user: User, input: CreateInput): Promise<VehicleDto> {
    if (input.branchId !== null) throw vehicleError(400, "invalid_branch");
    const row = await this.createRow(user, input, { userId: user.id });
    return this.dto(row, "owner");
  }

  async createFleet(access: TenantAccess, user: User, input: CreateInput): Promise<VehicleDto> {
    if (access.organization.kind !== "fleet") throw vehicleError(400, "not_a_fleet");
    const orgId = access.tenant.organizationId;
    // Branch-scoped managers add vehicles to their own branch.
    const branchId = access.branchScope ?? input.branchId;
    if (
      access.branchScope !== null &&
      input.branchId !== null &&
      input.branchId !== access.branchScope
    ) {
      throw vehicleError(400, "invalid_branch");
    }
    await this.assertBranch(orgId, branchId);
    const row = await this.createRow(user, { ...input, branchId }, { organizationId: orgId });
    return this.dto(row, "manager");
  }

  private async assertBranch(orgId: string, branchId: string | null): Promise<void> {
    if (branchId === null) return;
    const [branch] = await this.db
      .select({ id: branches.id })
      .from(branches)
      .where(and(eq(branches.id, branchId), eq(branches.organizationId, orgId)));
    if (!branch) throw vehicleError(400, "invalid_branch");
  }

  /** Your personal vehicles and the fleet vehicles assigned to you. */
  async listMine(user: User): Promise<VehicleDto[]> {
    const own = await this.db
      .select()
      .from(vehicles)
      .where(and(eq(vehicles.ownerUserId, user.id), eq(vehicles.status, "active")))
      .orderBy(desc(vehicles.createdAt));
    const assigned = await this.db
      .select({ vehicle: vehicles })
      .from(vehicleAssignments)
      .innerJoin(vehicles, eq(vehicles.id, vehicleAssignments.vehicleId))
      .where(
        and(
          eq(vehicleAssignments.userId, user.id),
          isNull(vehicleAssignments.endsAt),
          eq(vehicles.status, "active"),
        ),
      );
    const result: VehicleDto[] = [];
    for (const v of own) result.push(await this.dto(v, "owner"));
    for (const { vehicle } of assigned) {
      // Still a member of the fleet?
      const access = await this.access(this.db, user, vehicle.id);
      if (access) result.push(await this.dto(vehicle, access.role));
    }
    return result;
  }

  /** The fleet's vehicles (branch-scoped managers: their branch). */
  async listFleet(access: TenantAccess, includeArchived: boolean): Promise<VehicleDto[]> {
    if (access.organization.kind !== "fleet") throw vehicleError(400, "not_a_fleet");
    const rows = await this.db
      .select()
      .from(vehicles)
      .where(
        and(
          eq(vehicles.organizationId, access.tenant.organizationId),
          access.branchScope === null ? undefined : eq(vehicles.branchId, access.branchScope),
          includeArchived ? undefined : eq(vehicles.status, "active"),
        ),
      )
      .orderBy(desc(vehicles.createdAt))
      .limit(500);
    return Promise.all(rows.map((v) => this.dto(v, "manager")));
  }

  async get(user: User, vehicleId: string): Promise<VehicleDto> {
    const access = await this.require(user, vehicleId);
    return this.dto(access.vehicle, access.role);
  }

  async update(user: User, vehicleId: string, change: UpdateInput): Promise<VehicleDto> {
    const { vehicle, role } = await this.require(user, vehicleId, ["owner", "manager"]);
    if (change.branchId !== undefined) {
      if (vehicle.organizationId === null) throw vehicleError(400, "invalid_branch");
      await this.assertBranch(vehicle.organizationId, change.branchId);
    }
    try {
      const [row] = await this.db
        .update(vehicles)
        .set({
          ...change,
          ...(change.odometerKm === undefined ? {} : { odometerUpdatedAt: this.clock.now() }),
        })
        .where(eq(vehicles.id, vehicle.id))
        .returning();
      if (!row) throw notFound();
      await this.audit(this.db, user, row, "updated", { fields: Object.keys(change) });
      return await this.dto(row, role);
    } catch (error) {
      if (String((error as { cause?: unknown }).cause ?? error).includes("_registration_key")) {
        throw vehicleError(409, "duplicate_registration");
      }
      throw error;
    }
  }

  async archive(user: User, vehicleId: string): Promise<VehicleDto> {
    const { vehicle, role } = await this.require(user, vehicleId, ["owner", "manager"]);
    const [row] = await this.db
      .update(vehicles)
      .set({ status: "archived" })
      .where(eq(vehicles.id, vehicle.id))
      .returning();
    if (!row) throw notFound();
    await this.db
      .update(vehicleAssignments)
      .set({ endsAt: this.clock.now() })
      .where(and(eq(vehicleAssignments.vehicleId, vehicle.id), isNull(vehicleAssignments.endsAt)));
    await this.audit(this.db, user, row, "archived");
    return this.dto(row, role);
  }

  /** Readings only go up; owners and managers correct mistakes with PATCH. */
  async reportOdometer(user: User, vehicleId: string, km: number): Promise<VehicleDto> {
    const { vehicle, role } = await this.require(user, vehicleId);
    if (vehicle.status !== "active") throw vehicleError(409, "vehicle_archived");
    const [row] = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(vehicles)
        .where(eq(vehicles.id, vehicle.id))
        .for("update");
      if (
        current?.odometerKm !== null &&
        current?.odometerKm !== undefined &&
        km < current.odometerKm
      ) {
        throw vehicleError(409, "odometer_decreased");
      }
      return tx
        .update(vehicles)
        .set({ odometerKm: km, odometerUpdatedAt: this.clock.now() })
        .where(eq(vehicles.id, vehicle.id))
        .returning();
    });
    if (!row) throw notFound();
    return this.dto(row, role);
  }

  // -------------------------------------------------------------------------------------------
  // Drivers
  // -------------------------------------------------------------------------------------------

  /** Assigns the vehicle's driver (replacing the current one). The driver must be a fleet member. */
  async assign(user: User, vehicleId: string, driverId: string): Promise<VehicleDto> {
    const { vehicle, role } = await this.require(user, vehicleId, ["manager"]);
    if (vehicle.organizationId === null) throw vehicleError(400, "not_a_fleet");
    if (vehicle.status !== "active") throw vehicleError(409, "vehicle_archived");
    const [member] = await this.db
      .select({ branchId: memberships.branchId })
      .from(memberships)
      .where(
        and(
          eq(memberships.organizationId, vehicle.organizationId),
          eq(memberships.userId, driverId),
        ),
      );
    if (!member) throw vehicleError(400, "not_a_member");
    if (
      member.branchId !== null &&
      vehicle.branchId !== null &&
      member.branchId !== vehicle.branchId
    ) {
      throw vehicleError(400, "invalid_branch");
    }
    await this.db.transaction(async (tx) => {
      await tx
        .update(vehicleAssignments)
        .set({ endsAt: this.clock.now() })
        .where(
          and(eq(vehicleAssignments.vehicleId, vehicle.id), isNull(vehicleAssignments.endsAt)),
        );
      await tx.insert(vehicleAssignments).values({
        vehicleId: vehicle.id,
        userId: driverId,
        assignedBy: user.id,
        startsAt: this.clock.now(),
      });
      await this.audit(tx, user, vehicle, "driver_assigned", { userId: driverId });
    });
    return this.dto(vehicle, role);
  }

  async unassign(user: User, vehicleId: string): Promise<VehicleDto> {
    const { vehicle, role } = await this.require(user, vehicleId, ["manager"]);
    const ended = await this.db
      .update(vehicleAssignments)
      .set({ endsAt: this.clock.now() })
      .where(and(eq(vehicleAssignments.vehicleId, vehicle.id), isNull(vehicleAssignments.endsAt)))
      .returning({ userId: vehicleAssignments.userId });
    if (ended.length === 0) throw notFound();
    await this.audit(this.db, user, vehicle, "driver_unassigned", { userId: ended[0]?.userId });
    return this.dto(vehicle, role);
  }

  /** Who should hear about a vehicle: the owner, or fleet managers in scope and the driver. */
  async audience(executor: Executor, vehicle: Vehicle): Promise<string[]> {
    if (vehicle.ownerUserId !== null) return [vehicle.ownerUserId];
    if (vehicle.organizationId === null) return [];
    const team = await executor
      .select({
        userId: memberships.userId,
        role: memberships.role,
        branchId: memberships.branchId,
      })
      .from(memberships)
      .where(eq(memberships.organizationId, vehicle.organizationId));
    const ids = new Set(
      team
        .filter(
          (m) =>
            hasPermission(m.role as Role, "vehicles.manage") &&
            (m.branchId === null || m.branchId === vehicle.branchId),
        )
        .map((m) => m.userId),
    );
    const [driver] = await executor
      .select({ userId: vehicleAssignments.userId })
      .from(vehicleAssignments)
      .where(and(eq(vehicleAssignments.vehicleId, vehicle.id), isNull(vehicleAssignments.endsAt)));
    if (driver) ids.add(driver.userId);
    return [...ids];
  }

  // -------------------------------------------------------------------------------------------
  // DTO
  // -------------------------------------------------------------------------------------------

  async dto(vehicle: Vehicle, role: VehicleRole): Promise<VehicleDto> {
    const [assignment] = await this.db
      .select({
        userId: vehicleAssignments.userId,
        since: vehicleAssignments.startsAt,
        name: users.displayName,
      })
      .from(vehicleAssignments)
      .innerJoin(users, eq(users.id, vehicleAssignments.userId))
      .where(and(eq(vehicleAssignments.vehicleId, vehicle.id), isNull(vehicleAssignments.endsAt)));
    const schedules = await this.db
      .select()
      .from(maintenanceSchedules)
      .where(
        and(eq(maintenanceSchedules.vehicleId, vehicle.id), eq(maintenanceSchedules.active, true)),
      );
    const today = this.clock.now().toISOString().slice(0, 10);
    const statuses = schedules.map((s) => scheduleStatus(s, vehicle.odometerKm, today).status);
    return {
      id: vehicle.id,
      owner: {
        kind: vehicle.ownerUserId === null ? "organization" : "user",
        userId: vehicle.ownerUserId,
        organizationId: vehicle.organizationId,
      },
      branchId: vehicle.branchId,
      nickname: vehicle.nickname,
      vehicleType: vehicle.vehicleType as VehicleDto["vehicleType"],
      make: vehicle.make,
      model: vehicle.model,
      year: vehicle.year,
      registration: vehicle.registration,
      vin: vehicle.vin,
      odometerKm: vehicle.odometerKm,
      odometerUpdatedAt: vehicle.odometerUpdatedAt?.toISOString() ?? null,
      status: vehicle.status,
      access: role,
      driver: assignment
        ? {
            userId: assignment.userId,
            displayName: assignment.name ?? FALLBACK_NAME,
            since: assignment.since.toISOString(),
          }
        : null,
      maintenance: {
        dueSoon: statuses.filter((s) => s === "due_soon").length,
        overdue: statuses.filter((s) => s === "overdue").length,
      },
      createdAt: vehicle.createdAt.toISOString(),
    };
  }

  /** Vehicles by IDs (for reminders). */
  async byIds(ids: readonly string[]): Promise<Vehicle[]> {
    if (ids.length === 0) return [];
    return this.db
      .select()
      .from(vehicles)
      .where(inArray(vehicles.id, [...ids]));
  }
}

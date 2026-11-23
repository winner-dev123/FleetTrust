import {
  and,
  conversations,
  type Database,
  desc,
  emergencyGuidance,
  type EmergencyIncident,
  emergencyIncidents,
  eq,
  type Executor,
  gt,
  incidentDeliveries,
  incidentRecipients,
  memberships,
  organizations,
  providerEmergencySettings,
  providerProfiles,
  queryRows,
  recordAuditEvent,
  sql,
  trustedContacts,
  type User,
  users,
} from "@fleettrust/db";
import {
  type createIncidentSchema,
  DEFAULT_EMERGENCY_GUIDANCE,
  EMERGENCY_DISCLAIMER,
  type EmergencyGuidance,
  hasPermission,
  INCIDENT_CATEGORY_LABELS,
  type IncidentDto,
  type ProviderAlertDto,
  type Role,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { EmergencyDispatcher } from "./dispatcher.js";
import { blockedEitherWay, emergencyError, notFound } from "./shared.js";

type CreateInput = z.output<typeof createIncidentSchema>;
interface Point {
  lng: number;
  lat: number;
  accuracyM: number | null;
}

const FALLBACK_NAME = "FleetTrust member";
const MAX_PROVIDERS = 10;
const HOUR_MS = 60 * 60 * 1000;

/**
 * Emergency incidents (SRS J3, F-060..F-064, ADR-0010, ADR-0025). This module never imports
 * entitlements: creating an incident, alerting contacts and the incident room never check or use
 * quotas (lint boundary + tests). Abuse controls are safety-oriented instead: mutual-consent
 * contacts, a soft per-user threshold that flags but never blocks, mute and reports.
 */
@Injectable()
export class IncidentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly dispatcher: EmergencyDispatcher,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async audit(
    executor: Executor,
    actor: User | null,
    incidentId: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    // Never coordinates or notes in audit metadata.
    await recordAuditEvent(executor, {
      actorType: actor === null ? "system" : "user",
      actorId: actor?.id ?? null,
      action: `emergency.${action}`,
      targetType: "emergency_incident",
      targetId: incidentId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  // -------------------------------------------------------------------------------------------
  // Guidance (public; the first screen)
  // -------------------------------------------------------------------------------------------

  async guidance(countryCode: string | null): Promise<EmergencyGuidance> {
    if (countryCode !== null) {
      const [row] = await this.db
        .select()
        .from(emergencyGuidance)
        .where(eq(emergencyGuidance.countryCode, countryCode));
      if (row) {
        return {
          countryCode,
          number: row.emergencyNumber,
          label: row.label,
          text: row.guidance,
          disclaimer: EMERGENCY_DISCLAIMER,
        };
      }
    }
    return {
      countryCode,
      number: null,
      label: "Local emergency services",
      text: DEFAULT_EMERGENCY_GUIDANCE,
      disclaimer: EMERGENCY_DISCLAIMER,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Creating
  // -------------------------------------------------------------------------------------------

  /**
   * Raises an incident and alerts contacts at once. Repeated taps return the same incident
   * (client ID, or the one already active). Never blocked by plans, quotas or rate limits.
   */
  async create(user: User, input: CreateInput): Promise<IncidentDto> {
    const now = this.clock.now();
    const result = await this.db.transaction(async (tx) => {
      const [byClient] = await tx
        .select()
        .from(emergencyIncidents)
        .where(
          and(
            eq(emergencyIncidents.ownerUserId, user.id),
            eq(emergencyIncidents.clientIncidentId, input.clientIncidentId),
          ),
        );
      if (byClient) return { incident: byClient, created: false };
      const [active] = await tx
        .select()
        .from(emergencyIncidents)
        .where(
          and(
            eq(emergencyIncidents.ownerUserId, user.id),
            eq(emergencyIncidents.status, "active"),
            gt(emergencyIncidents.expiresAt, now),
          ),
        )
        .for("update");
      if (active) return { incident: active, created: false };

      // Soft threshold (AB-03): flag for review, never block.
      const [recent] = await queryRows<{ n: number }>(
        tx,
        sql`SELECT count(*)::int AS n FROM emergency_incidents
            WHERE owner_user_id = ${user.id} AND created_at > ${new Date(now.getTime() - HOUR_MS)}`,
      );
      const flagged = (recent?.n ?? 0) >= this.env.EMERGENCY_SOFT_LIMIT_PER_HOUR;
      const location = input.shareLocation ? input.location : null;
      const [incident] = await tx
        .insert(emergencyIncidents)
        .values({
          ownerUserId: user.id,
          clientIncidentId: input.clientIncidentId,
          category: input.category,
          note: input.note,
          locationShared: location !== null,
          location: location === null ? null : { lng: location.lng, lat: location.lat },
          locationAccuracyM: location?.accuracyM ?? null,
          locationUpdatedAt: location === null ? null : now,
          countryCode: input.countryCode,
          notifyProviders: input.notifyNearbyProviders && location !== null,
          flagged,
          expiresAt: new Date(now.getTime() + this.env.EMERGENCY_INCIDENT_HOURS * HOUR_MS),
          createdAt: now,
        })
        .returning();
      if (!incident) throw new Error("incident insert returned no row");
      await tx.insert(conversations).values({ kind: "incident", incidentId: incident.id });

      // Wave 1: chosen (or all) active contacts, primaries first; backups wait for escalation.
      const pool = (
        await tx
          .select()
          .from(trustedContacts)
          .where(
            and(
              eq(trustedContacts.ownerUserId, user.id),
              eq(trustedContacts.status, "active"),
              eq(trustedContacts.muted, false),
            ),
          )
      ).filter((c) => input.contactIds === null || input.contactIds.includes(c.contactUserId));
      const eligible = [];
      for (const c of pool)
        if (!(await blockedEitherWay(tx, user.id, c.contactUserId))) eligible.push(c);
      const primaries = eligible.filter((c) => c.priority === "primary");
      const wave1 = primaries.length > 0 ? primaries : eligible;
      if (wave1.length > 0) {
        const inserted = await tx
          .insert(incidentRecipients)
          .values(
            wave1.map((c) => ({
              incidentId: incident.id,
              kind: "contact" as const,
              userId: c.contactUserId,
              priority: c.priority,
              wave: 1,
              notifiedAt: now,
            })),
          )
          .returning();
        for (const r of inserted) {
          if (r.userId !== null)
            await this.dispatcher.enqueue(tx, incident.id, r.id, [r.userId], "alert", 1);
        }
        await tx
          .update(emergencyIncidents)
          .set({
            nextEscalationAt: new Date(
              now.getTime() + this.env.EMERGENCY_ESCALATION_SECONDS * 1000,
            ),
          })
          .where(eq(emergencyIncidents.id, incident.id));
      }
      const providers =
        incident.notifyProviders && location !== null
          ? await this.alertProviders(tx, incident.id, location)
          : 0;
      if (flagged)
        await this.audit(tx, user, incident.id, "soft_limit_flagged", {
          recentIncidents: recent?.n ?? 0,
        });
      await this.audit(tx, user, incident.id, "incident_created", {
        category: incident.category,
        contacts: wave1.length,
        providers,
        locationShared: location !== null,
        flagged,
      });
      return { incident, created: true };
    });
    if (result.created) {
      // First push attempt right away (SRS: p95 ≤ 10 s); retries and fallback follow in the worker.
      await this.dispatcher.deliverDue(result.incident.id).catch(() => undefined);
    }
    return this.dto(user, result.incident.id);
  }

  /** Opted-in providers whose published branches are within their chosen radius. */
  private async alertProviders(tx: Executor, incidentId: string, at: Point): Promise<number> {
    const point = sql`ST_SetSRID(ST_MakePoint(${at.lng}::float8, ${at.lat}::float8), 4326)::geography`;
    const rows = await queryRows<{
      organization_id: string;
      branch_id: string;
      distance_m: number;
    }>(
      tx,
      sql`SELECT * FROM (
            SELECT DISTINCT ON (e.organization_id) e.organization_id, e.branch_id,
                   round(ST_Distance(e.location, ${point}))::int AS distance_m
            FROM provider_search_entries e
            JOIN provider_emergency_settings s ON s.organization_id = e.organization_id AND s.opted_in
            WHERE ST_DWithin(e.location, ${point}, s.radius_km * 1000)
            ORDER BY e.organization_id, ST_Distance(e.location, ${point})
          ) nearest ORDER BY distance_m LIMIT ${MAX_PROVIDERS}`,
    );
    for (const row of rows) {
      const [recipient] = await tx
        .insert(incidentRecipients)
        .values({
          incidentId,
          kind: "provider",
          organizationId: row.organization_id,
          distanceM: row.distance_m,
          notifiedAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      if (!recipient) continue;
      const team = await tx
        .select({
          userId: memberships.userId,
          role: memberships.role,
          branchId: memberships.branchId,
        })
        .from(memberships)
        .where(eq(memberships.organizationId, row.organization_id));
      const userIds = team
        .filter(
          (m) =>
            hasPermission(m.role as Role, "requests.respond") &&
            (m.branchId === null || m.branchId === row.branch_id),
        )
        .map((m) => m.userId);
      await this.dispatcher.enqueue(tx, incidentId, recipient.id, userIds, "alert", 1);
    }
    return rows.length;
  }

  // -------------------------------------------------------------------------------------------
  // Owner and contacts
  // -------------------------------------------------------------------------------------------

  private async owned(
    executor: Executor,
    user: User,
    id: string,
    lock = false,
  ): Promise<EmergencyIncident> {
    const query = executor
      .select()
      .from(emergencyIncidents)
      .where(and(eq(emergencyIncidents.id, id), eq(emergencyIncidents.ownerUserId, user.id)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  private isActive(incident: EmergencyIncident): boolean {
    return incident.status === "active" && incident.expiresAt > this.clock.now();
  }

  async listMine(user: User): Promise<IncidentDto[]> {
    const rows = await this.db
      .select({ id: emergencyIncidents.id })
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.ownerUserId, user.id))
      .orderBy(desc(emergencyIncidents.createdAt))
      .limit(20);
    return Promise.all(rows.map((r) => this.dto(user, r.id)));
  }

  /** Alerts where you are a trusted contact. */
  async alerts(user: User): Promise<IncidentDto[]> {
    const rows = await this.db
      .select({ id: incidentRecipients.incidentId })
      .from(incidentRecipients)
      .where(and(eq(incidentRecipients.kind, "contact"), eq(incidentRecipients.userId, user.id)))
      .orderBy(desc(incidentRecipients.createdAt))
      .limit(20);
    return Promise.all(rows.map((r) => this.dto(user, r.id)));
  }

  async get(user: User, id: string): Promise<IncidentDto> {
    return this.dto(user, id);
  }

  /** A contact says they've seen the alert. It stops escalation; it doesn't mean help is coming. */
  async acknowledge(user: User, id: string): Promise<IncidentDto> {
    await this.db.transaction(async (tx) => {
      const [recipient] = await tx
        .select()
        .from(incidentRecipients)
        .where(
          and(
            eq(incidentRecipients.incidentId, id),
            eq(incidentRecipients.kind, "contact"),
            eq(incidentRecipients.userId, user.id),
          ),
        )
        .for("update");
      if (!recipient) throw notFound();
      const [incident] = await tx
        .select()
        .from(emergencyIncidents)
        .where(eq(emergencyIncidents.id, id));
      if (!incident || !this.isActive(incident)) throw emergencyError(409, "incident_closed");
      if (recipient.acknowledgedAt !== null) return;
      await tx
        .update(incidentRecipients)
        .set({ acknowledgedAt: this.clock.now() })
        .where(eq(incidentRecipients.id, recipient.id));
      await tx
        .update(emergencyIncidents)
        .set({ nextEscalationAt: null })
        .where(eq(emergencyIncidents.id, id));
      await this.dispatcher.enqueue(
        tx,
        id,
        recipient.id,
        [incident.ownerUserId],
        "acknowledged",
        1,
      );
      await this.audit(tx, user, id, "acknowledged");
    });
    await this.dispatcher.deliverDue(id).catch(() => undefined);
    return this.dto(user, id);
  }

  /** Shares (or refreshes) the location for this incident only. */
  async updateLocation(user: User, id: string, location: Point): Promise<IncidentDto> {
    await this.db.transaction(async (tx) => {
      const incident = await this.owned(tx, user, id, true);
      if (!this.isActive(incident)) throw emergencyError(409, "incident_closed");
      await tx
        .update(emergencyIncidents)
        .set({
          locationShared: true,
          location: { lng: location.lng, lat: location.lat },
          locationAccuracyM: location.accuracyM,
          locationUpdatedAt: this.clock.now(),
        })
        .where(eq(emergencyIncidents.id, id));
      await this.audit(tx, user, id, "location_updated");
    });
    return this.dto(user, id);
  }

  /** "I'm safe" (resolved) or "false alarm" (cancelled). The location is erased. */
  async close(user: User, id: string, outcome: "resolved" | "cancelled"): Promise<IncidentDto> {
    await this.db.transaction(async (tx) => {
      const incident = await this.owned(tx, user, id, true);
      if (!this.isActive(incident)) throw emergencyError(409, "incident_closed");
      const now = this.clock.now();
      await tx
        .update(emergencyIncidents)
        .set({
          status: outcome,
          closedAt: now,
          location: null,
          locationAccuracyM: null,
          nextEscalationAt: null,
        })
        .where(eq(emergencyIncidents.id, id));
      await tx
        .update(incidentDeliveries)
        .set({ status: "skipped", lastError: `incident ${outcome}` })
        .where(
          and(eq(incidentDeliveries.incidentId, id), eq(incidentDeliveries.status, "pending")),
        );
      const contacts = await tx
        .select()
        .from(incidentRecipients)
        .where(and(eq(incidentRecipients.incidentId, id), eq(incidentRecipients.kind, "contact")));
      for (const r of contacts) {
        if (r.userId !== null) await this.dispatcher.enqueue(tx, id, r.id, [r.userId], "closed", 1);
      }
      await this.audit(tx, user, id, `incident_${outcome}`);
    });
    await this.dispatcher.deliverDue(id).catch(() => undefined);
    return this.dto(user, id);
  }

  // -------------------------------------------------------------------------------------------
  // Providers
  // -------------------------------------------------------------------------------------------

  private assertProvider(access: TenantAccess): void {
    if (access.organization.kind !== "provider") throw emergencyError(400, "not_a_provider");
  }

  async assistSettings(access: TenantAccess): Promise<{ optedIn: boolean; radiusKm: number }> {
    this.assertProvider(access);
    const [row] = await this.db
      .select()
      .from(providerEmergencySettings)
      .where(eq(providerEmergencySettings.organizationId, access.tenant.organizationId));
    return { optedIn: row?.optedIn ?? false, radiusKm: row?.radiusKm ?? 25 };
  }

  async setAssist(access: TenantAccess, user: User, input: { optedIn: boolean; radiusKm: number }) {
    this.assertProvider(access);
    const orgId = access.tenant.organizationId;
    if (input.optedIn) {
      const [profile] = await this.db
        .select({ status: providerProfiles.status })
        .from(providerProfiles)
        .where(eq(providerProfiles.organizationId, orgId));
      if (profile?.status !== "published") throw emergencyError(409, "not_published");
    }
    await this.db
      .insert(providerEmergencySettings)
      .values({
        organizationId: orgId,
        optedIn: input.optedIn,
        radiusKm: input.radiusKm,
        updatedBy: user.id,
      })
      .onConflictDoUpdate({
        target: providerEmergencySettings.organizationId,
        set: { optedIn: input.optedIn, radiusKm: input.radiusKm, updatedBy: user.id },
      });
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: user.id,
      organizationId: orgId,
      action: "emergency.provider_assist_updated",
      targetType: "organization",
      targetId: orgId,
      requestId: currentRequestContext()?.requestId,
      metadata: input,
    });
    return this.assistSettings(access);
  }

  /** What a provider sees: no identity, an approximate area (about 1 km), while active. */
  async providerAlerts(access: TenantAccess): Promise<ProviderAlertDto[]> {
    this.assertProvider(access);
    const rows = await this.db
      .select({ recipient: incidentRecipients, incident: emergencyIncidents })
      .from(incidentRecipients)
      .innerJoin(emergencyIncidents, eq(emergencyIncidents.id, incidentRecipients.incidentId))
      .where(
        and(
          eq(incidentRecipients.kind, "provider"),
          eq(incidentRecipients.organizationId, access.tenant.organizationId),
        ),
      )
      .orderBy(desc(incidentRecipients.createdAt))
      .limit(50);
    return rows.map(({ recipient, incident }) => {
      const status = this.isActive(incident)
        ? "active"
        : incident.status === "active"
          ? "expired"
          : incident.status;
      const loc = status === "active" ? incident.location : null;
      return {
        recipientId: recipient.id,
        incidentId: incident.id,
        status,
        category: incident.category,
        categoryLabel: INCIDENT_CATEGORY_LABELS[incident.category],
        approximateLocation:
          loc === null
            ? null
            : { lng: Math.round(loc.lng * 100) / 100, lat: Math.round(loc.lat * 100) / 100 },
        distanceKm:
          recipient.distanceM === null ? null : Math.round(recipient.distanceM / 100) / 10,
        offered: recipient.offeredAt !== null,
        createdAt: recipient.createdAt.toISOString(),
        disclaimer: EMERGENCY_DISCLAIMER,
      };
    });
  }

  /** The provider offers help; the person in need sees their name and phone and decides. */
  async offer(
    access: TenantAccess,
    user: User,
    recipientId: string,
    message: string | null,
  ): Promise<ProviderAlertDto> {
    this.assertProvider(access);
    await this.db.transaction(async (tx) => {
      const [recipient] = await tx
        .select()
        .from(incidentRecipients)
        .where(
          and(
            eq(incidentRecipients.id, recipientId),
            eq(incidentRecipients.kind, "provider"),
            eq(incidentRecipients.organizationId, access.tenant.organizationId),
          ),
        )
        .for("update");
      if (!recipient) throw notFound();
      const [incident] = await tx
        .select()
        .from(emergencyIncidents)
        .where(eq(emergencyIncidents.id, recipient.incidentId));
      if (!incident || !this.isActive(incident)) throw emergencyError(409, "incident_closed");
      if (recipient.offeredAt !== null) return;
      await tx
        .update(incidentRecipients)
        .set({ offeredAt: this.clock.now(), offerMessage: message })
        .where(eq(incidentRecipients.id, recipient.id));
      await this.dispatcher.enqueue(
        tx,
        incident.id,
        recipient.id,
        [incident.ownerUserId],
        "offer",
        1,
      );
      await this.audit(tx, user, incident.id, "provider_offered", {
        organizationId: access.tenant.organizationId,
      });
    });
    const alerts = await this.providerAlerts(access);
    const alert = alerts.find((a) => a.recipientId === recipientId);
    if (!alert) throw notFound();
    await this.dispatcher.deliverDue(alert.incidentId).catch(() => undefined);
    return alert;
  }

  // -------------------------------------------------------------------------------------------
  // DTO
  // -------------------------------------------------------------------------------------------

  /** Owner: everything. Contacts: the owner's name, note and shared location while active. */
  private async dto(user: User, id: string): Promise<IncidentDto> {
    const [incident] = await this.db
      .select()
      .from(emergencyIncidents)
      .where(eq(emergencyIncidents.id, id));
    if (!incident) throw notFound();
    const recipients = await this.db
      .select()
      .from(incidentRecipients)
      .where(eq(incidentRecipients.incidentId, id));
    const mine = incident.ownerUserId === user.id;
    const asContact = recipients.find((r) => r.kind === "contact" && r.userId === user.id);
    if (!mine && !asContact) throw notFound();
    const active = this.isActive(incident);
    const status = active ? "active" : incident.status === "active" ? "expired" : incident.status;
    const [owner] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, incident.ownerUserId));
    const contactRows = recipients.filter((r) => r.kind === "contact");
    const names = new Map<string, string>();
    for (const r of contactRows) {
      if (r.userId === null) continue;
      const [u] = await this.db
        .select({ name: users.displayName })
        .from(users)
        .where(eq(users.id, r.userId));
      names.set(r.userId, u?.name ?? FALLBACK_NAME);
    }
    const offers: IncidentDto["providerOffers"] = [];
    if (mine) {
      for (const r of recipients.filter((x) => x.kind === "provider" && x.offeredAt !== null)) {
        if (r.organizationId === null || r.offeredAt === null) continue;
        const [org] = await this.db
          .select({
            name: organizations.name,
            tradingName: providerProfiles.tradingName,
            phone: providerProfiles.contactPhone,
          })
          .from(organizations)
          .leftJoin(providerProfiles, eq(providerProfiles.organizationId, organizations.id))
          .where(eq(organizations.id, r.organizationId));
        offers.push({
          organizationId: r.organizationId,
          name: org?.tradingName ?? org?.name ?? "Provider",
          phone: org?.phone ?? null,
          distanceKm: r.distanceM === null ? null : Math.round(r.distanceM / 100) / 10,
          message: r.offerMessage,
          offeredAt: r.offeredAt.toISOString(),
        });
      }
    }
    const [room] = await this.db
      .select({ id: conversations.id })
      .from(conversations)
      .where(eq(conversations.incidentId, id));
    const showLocation = active && incident.location !== null;
    return {
      id: incident.id,
      status,
      category: incident.category,
      categoryLabel: INCIDENT_CATEGORY_LABELS[incident.category],
      note: incident.note,
      owner: { userId: incident.ownerUserId, displayName: owner?.name ?? FALLBACK_NAME, mine },
      location:
        showLocation && incident.location !== null
          ? { ...incident.location, accuracyM: incident.locationAccuracyM }
          : null,
      locationUpdatedAt: showLocation ? (incident.locationUpdatedAt?.toISOString() ?? null) : null,
      wave: incident.wave,
      contacts: contactRows.map((r) => ({
        userId: r.userId ?? "",
        displayName: names.get(r.userId ?? "") ?? FALLBACK_NAME,
        notifiedAt: r.notifiedAt?.toISOString() ?? null,
        acknowledgedAt: r.acknowledgedAt?.toISOString() ?? null,
      })),
      providerOffers: offers,
      conversationId: room?.id ?? null,
      flagged: mine && incident.flagged,
      createdAt: incident.createdAt.toISOString(),
      expiresAt: incident.expiresAt.toISOString(),
      closedAt: incident.closedAt?.toISOString() ?? null,
      guidance: await this.guidance(incident.countryCode),
      disclaimer: EMERGENCY_DISCLAIMER,
    };
  }
}

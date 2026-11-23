import {
  and,
  asc,
  branches,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  inArray,
  isNull,
  ne,
  or,
  organizations,
  providerProfiles,
  queryRows,
  recordAuditEvent,
  searchProviders,
  type ServiceQuote,
  serviceQuotes,
  type ServiceRequest,
  serviceRequestAttachments,
  serviceRequestEvents,
  type ServiceRequestRecipient,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  type User,
} from "@fleettrust/db";
import {
  type createServiceRequestSchema,
  type evidenceSchema,
  formatIndicativePrice,
  hasPermission,
  type InquiryDto,
  MAX_MATCHED_PROVIDERS,
  MAX_QUOTES_PER_PROVIDER,
  PAYMENT_DISCLAIMER,
  QUOTE_SCAM_WARNING,
  type QuoteDto,
  REQUEST_OPEN_DAYS,
  type ServiceRequestDto,
  type submitQuoteSchema,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import {
  EntitlementsService,
  subjectOfOrganization,
  subjectOfUser,
} from "../entitlements/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { assertPriceAllowed, priceColumns, priceOf } from "../providers/index.js";
import { AttachmentsService } from "./attachments.service.js";
import { membershipOf, notFound, type Requester, requestError } from "./shared.js";

type CreateInput = z.output<typeof createServiceRequestSchema>;
type QuoteInput = z.output<typeof submitQuoteSchema>;
type EvidenceInput = z.output<typeof evidenceSchema>;
type Side = "requester" | "provider" | "system";

const DAY_MS = 86_400_000;
const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Service requests and informational quotes (SRS J2, F-050..F-052, ADR-0021).
 *
 * Lifecycle: open → accepted → completed, or cancelled; open requests expire after
 * REQUEST_OPEN_DAYS. Providers quote while the request is open; the requester accepts one
 * quote, which only records what was agreed (no money moves). The accepted provider can cancel,
 * which reopens the request. Every change is an append-only event.
 */
@Injectable()
export class RequestsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly entitlements: EntitlementsService,
    private readonly attachments: AttachmentsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Access ----------------------------------------------------------------------------------

  /** Requester-side filter: own personal requests, or the fleet's (all with requests.manage). */
  private requesterScope(requester: Requester) {
    if (requester.kind === "user") {
      return and(
        eq(serviceRequests.requesterUserId, requester.user.id),
        isNull(serviceRequests.requesterOrganizationId),
      );
    }
    const { access, user } = requester;
    const org = eq(serviceRequests.requesterOrganizationId, access.tenant.organizationId);
    if (!hasPermission(access.role, "requests.manage")) {
      return and(org, eq(serviceRequests.createdBy, user.id));
    }
    if (access.branchScope === null) return org;
    return and(
      org,
      or(
        eq(serviceRequests.fleetBranchId, access.branchScope),
        eq(serviceRequests.createdBy, user.id),
      ),
    );
  }

  private async requestFor(
    executor: Executor,
    requester: Requester,
    requestId: string,
    lock = false,
  ): Promise<ServiceRequest> {
    const query = executor
      .select()
      .from(serviceRequests)
      .where(and(eq(serviceRequests.id, requestId), this.requesterScope(requester)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  /** The provider's recipient row, respecting branch scope; 404 otherwise. */
  private async recipientFor(
    executor: Executor,
    access: TenantAccess,
    recipientId: string,
  ): Promise<ServiceRequestRecipient> {
    if (access.organization.kind !== "provider") throw requestError(400, "not_a_provider");
    const [row] = await executor
      .select()
      .from(serviceRequestRecipients)
      .where(
        and(
          eq(serviceRequestRecipients.id, recipientId),
          eq(serviceRequestRecipients.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : eq(serviceRequestRecipients.branchId, access.branchScope),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  private async lockRequest(executor: Executor, requestId: string): Promise<ServiceRequest> {
    const [row] = await executor
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, requestId))
      .for("update");
    if (!row) throw notFound();
    return row;
  }

  private isExpired(request: ServiceRequest, now: Date): boolean {
    return request.status === "open" && request.expiresAt <= now;
  }

  private assertOpen(request: ServiceRequest, now: Date): void {
    if (request.status !== "open" || this.isExpired(request, now)) {
      throw requestError(409, "invalid_transition");
    }
  }

  // --- Events ----------------------------------------------------------------------------------

  private async event(
    executor: Executor,
    input: {
      requestId: string;
      type: string;
      side: Side;
      actor: User | null;
      organizationId?: string | null;
      note?: string | null;
      attachmentIds?: string[];
      metadata?: Record<string, unknown>;
    },
  ): Promise<void> {
    await executor.insert(serviceRequestEvents).values({
      requestId: input.requestId,
      type: input.type,
      actorSide: input.side,
      actorUserId: input.actor?.id ?? null,
      organizationId: input.organizationId ?? null,
      note: input.note ?? null,
      attachmentIds: input.attachmentIds ?? [],
      metadata: input.metadata ?? {},
    });
    await enqueueOutboxEvent(executor, {
      aggregateType: "service_request",
      aggregateId: input.requestId,
      // Outbox event types are PascalCase: created → ServiceRequestCreated.
      eventType: `ServiceRequest${input.type
        .split("_")
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join("")}`,
      payload: { organizationId: input.organizationId ?? null },
    });
  }

  // --- Creating --------------------------------------------------------------------------------

  /** Recipients for the request: chosen providers, or matching providers by relevance. */
  private async resolveRecipients(
    executor: Executor,
    input: CreateInput,
    at: Date,
  ): Promise<{ organizationId: string; branchId: string; distanceMeters: number }[]> {
    if (input.target.mode === "match") {
      const rows = await searchProviders(executor, {
        at,
        precise: true,
        area: {
          kind: "near",
          point: input.location,
          radiusMeters: input.target.radiusKm * 1000,
          coversLocationOnly: false,
        },
        categories: [input.category],
        vehicleType: input.vehicle.vehicleType,
        limit: 50,
      });
      const seen = new Set<string>();
      const result = [];
      for (const row of rows) {
        if (seen.has(row.organizationId)) continue;
        seen.add(row.organizationId);
        result.push({
          organizationId: row.organizationId,
          branchId: row.branchId,
          distanceMeters: row.distanceMeters,
        });
        if (result.length >= MAX_MATCHED_PROVIDERS) break;
      }
      return result;
    }
    const ids = [...new Set(input.target.providerIds)];
    // Nearest published branch of each chosen provider.
    const rows = await queryRows<{
      organization_id: string;
      branch_id: string;
      distance_m: number;
      categories: string[];
      vehicle_types: string[];
    }>(
      executor,
      sql`SELECT DISTINCT ON (e.organization_id) e.organization_id, e.branch_id, e.categories,
                 e.vehicle_types,
                 round(ST_Distance(e.location, ST_SetSRID(ST_MakePoint(${input.location.lng}::float8, ${input.location.lat}::float8), 4326)::geography))::int AS distance_m
          FROM provider_search_entries e
          JOIN organizations o ON o.id = e.organization_id AND o.status = 'active'
          WHERE e.organization_id IN (${sql.join(
            ids.map((id) => sql`${id}::uuid`),
            sql`, `,
          )})
          ORDER BY e.organization_id, distance_m`,
    );
    const matching = rows.filter(
      (r) =>
        r.categories.includes(input.category) &&
        r.vehicle_types.includes(input.vehicle.vehicleType),
    );
    if (matching.length !== ids.length) throw requestError(400, "provider_not_matching");
    return matching.map((r) => ({
      organizationId: r.organization_id,
      branchId: r.branch_id,
      distanceMeters: r.distance_m,
    }));
  }

  private async existing(requester: Requester, clientRequestId: string) {
    const [row] = await this.db
      .select({ id: serviceRequests.id })
      .from(serviceRequests)
      .where(
        requester.kind === "user"
          ? and(
              eq(serviceRequests.requesterUserId, requester.user.id),
              isNull(serviceRequests.requesterOrganizationId),
              eq(serviceRequests.clientRequestId, clientRequestId),
            )
          : and(
              eq(serviceRequests.requesterOrganizationId, requester.access.tenant.organizationId),
              eq(serviceRequests.clientRequestId, clientRequestId),
            ),
      );
    return row?.id;
  }

  /**
   * Creates and sends a request. Consumes one `service_requests.daily` unit in the same
   * transaction (atomic; idempotent per clientRequestId). A retry with the same
   * clientRequestId returns the original request without consuming again.
   */
  async create(requester: Requester, input: CreateInput): Promise<ServiceRequestDto> {
    const prior = await this.existing(requester, input.clientRequestId);
    if (prior) return this.get(requester, prior);

    let fleetBranchId: string | null = null;
    if (requester.kind === "organization") {
      const { access } = requester;
      if (access.organization.kind !== "fleet") throw requestError(400, "not_a_fleet");
      fleetBranchId = access.branchScope ?? input.fleetBranchId;
      if (
        access.branchScope !== null &&
        input.fleetBranchId !== null &&
        input.fleetBranchId !== access.branchScope
      ) {
        throw requestError(400, "unknown_branch");
      }
      if (fleetBranchId !== null) {
        const [branch] = await this.db
          .select({ id: branches.id })
          .from(branches)
          .where(
            and(
              eq(branches.id, fleetBranchId),
              eq(branches.organizationId, access.tenant.organizationId),
            ),
          );
        if (!branch) throw requestError(400, "unknown_branch");
      }
    } else if (input.fleetBranchId !== null) {
      throw requestError(400, "not_a_fleet");
    }

    const actor = requester.user;
    const now = this.clock.now();
    let requestId: string;
    try {
      requestId = await this.db.transaction(async (tx) => {
        const recipients = await this.resolveRecipients(tx, input, now);
        if (recipients.length === 0) throw requestError(422, "no_matching_providers");

        const photos = input.photoIds.length
          ? await tx
              .select()
              .from(serviceRequestAttachments)
              .where(inArray(serviceRequestAttachments.id, [...new Set(input.photoIds)]))
          : [];
        if (
          photos.length !== new Set(input.photoIds).size ||
          photos.some(
            (p) => p.uploadedBy !== actor.id || p.status !== "available" || p.requestId !== null,
          )
        ) {
          throw requestError(400, "attachment_not_ready");
        }

        // Atomic, idempotent quota use: rolls back with the request if anything later fails.
        await this.entitlements.consume(
          tx,
          requester.kind === "user"
            ? subjectOfUser(actor)
            : subjectOfOrganization(requester.access.organization),
          "service_requests.daily",
          { idempotencyKey: `service_request:${input.clientRequestId}` },
        );

        const [row] = await tx
          .insert(serviceRequests)
          .values({
            requesterUserId: requester.kind === "user" ? actor.id : null,
            requesterOrganizationId:
              requester.kind === "organization" ? requester.access.tenant.organizationId : null,
            requesterOrganizationKind: requester.kind === "organization" ? "fleet" : null,
            fleetBranchId,
            createdBy: actor.id,
            clientRequestId: input.clientRequestId,
            category: input.category,
            vehicleType: input.vehicle.vehicleType,
            vehicleMake: input.vehicle.make,
            vehicleModel: input.vehicle.model,
            vehicleYear: input.vehicle.year,
            vehicleRegistration: input.vehicle.registration,
            location: input.location,
            locationNote: input.locationNote,
            description: input.description,
            urgency: input.urgency,
            neededBy: input.neededBy ? new Date(input.neededBy) : null,
            expiresAt: new Date(now.getTime() + REQUEST_OPEN_DAYS * DAY_MS),
          })
          .returning();
        if (!row) throw new Error("request insert returned no row");
        await tx.insert(serviceRequestRecipients).values(
          recipients.map((r) => ({
            requestId: row.id,
            organizationId: r.organizationId,
            branchId: r.branchId,
            distanceMeters: r.distanceMeters,
          })),
        );
        if (photos.length) {
          await tx
            .update(serviceRequestAttachments)
            .set({ requestId: row.id })
            .where(
              inArray(
                serviceRequestAttachments.id,
                photos.map((p) => p.id),
              ),
            );
        }
        await this.event(tx, {
          requestId: row.id,
          type: "created",
          side: "requester",
          actor,
          attachmentIds: photos.map((p) => p.id),
          metadata: { recipients: recipients.length, target: input.target.mode },
        });
        for (const r of recipients) {
          await this.event(tx, {
            requestId: row.id,
            type: "sent",
            side: "system",
            actor: null,
            organizationId: r.organizationId,
          });
        }
        await recordAuditEvent(tx, {
          actorType: "user",
          actorId: actor.id,
          organizationId: row.requesterOrganizationId,
          action: "service_request.created",
          targetType: "service_request",
          targetId: row.id,
          requestId: currentRequestContext()?.requestId,
          metadata: { category: input.category, recipients: recipients.length },
        });
        return row.id;
      });
    } catch (error) {
      // A concurrent retry with the same clientRequestId won the race: return its request.
      if (String((error as { cause?: unknown }).cause ?? error).includes("_client_key")) {
        const winner = await this.existing(requester, input.clientRequestId);
        if (winner) return this.get(requester, winner);
      }
      throw error;
    }
    return this.get(requester, requestId);
  }

  // --- Requester views and actions -------------------------------------------------------------

  async list(requester: Requester): Promise<ServiceRequestDto[]> {
    const rows = await this.db
      .select()
      .from(serviceRequests)
      .where(this.requesterScope(requester))
      .orderBy(desc(serviceRequests.createdAt))
      .limit(50);
    const result = [];
    for (const row of rows) result.push(await this.requesterDto(row));
    return result;
  }

  async get(requester: Requester, requestId: string): Promise<ServiceRequestDto> {
    return this.requesterDto(await this.requestFor(this.db, requester, requestId));
  }

  async accept(
    requester: Requester,
    requestId: string,
    quoteId: string,
  ): Promise<ServiceRequestDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const request = await this.requestFor(tx, requester, requestId, true);
      this.assertOpen(request, now);
      const [quote] = await tx
        .select()
        .from(serviceQuotes)
        .where(and(eq(serviceQuotes.id, quoteId), eq(serviceQuotes.requestId, requestId)));
      if (!quote) throw notFound();
      if (quote.status !== "active" || quote.validUntil <= now) {
        throw requestError(409, "quote_not_active");
      }
      await tx
        .update(serviceQuotes)
        .set({ status: "accepted" })
        .where(eq(serviceQuotes.id, quote.id));
      await tx
        .update(serviceQuotes)
        .set({ status: "not_selected" })
        .where(and(eq(serviceQuotes.requestId, requestId), eq(serviceQuotes.status, "active")));
      await tx
        .update(serviceRequestRecipients)
        .set({ status: "accepted" })
        .where(eq(serviceRequestRecipients.id, quote.recipientId));
      const others = await tx
        .update(serviceRequestRecipients)
        .set({ status: "not_selected" })
        .where(
          and(
            eq(serviceRequestRecipients.requestId, requestId),
            ne(serviceRequestRecipients.id, quote.recipientId),
            inArray(serviceRequestRecipients.status, ["pending", "viewed", "quoted"]),
          ),
        )
        .returning();
      await tx
        .update(serviceRequests)
        .set({ status: "accepted", acceptedQuoteId: quote.id })
        .where(eq(serviceRequests.id, requestId));
      await this.event(tx, {
        requestId,
        type: "quote_accepted",
        side: "requester",
        actor: requester.user,
        organizationId: quote.organizationId,
        metadata: { quoteId: quote.id },
      });
      for (const other of others) {
        await this.event(tx, {
          requestId,
          type: "not_selected",
          side: "system",
          actor: null,
          organizationId: other.organizationId,
        });
      }
    });
    return this.get(requester, requestId);
  }

  async cancel(
    requester: Requester,
    requestId: string,
    reason: string,
  ): Promise<ServiceRequestDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const request = await this.requestFor(tx, requester, requestId, true);
      if (!["open", "accepted"].includes(request.status) || this.isExpired(request, now)) {
        throw requestError(409, "invalid_transition");
      }
      await tx
        .update(serviceRequests)
        .set({ status: "cancelled", closedAt: now })
        .where(eq(serviceRequests.id, requestId));
      await tx
        .update(serviceQuotes)
        .set({ status: "not_selected" })
        .where(and(eq(serviceQuotes.requestId, requestId), eq(serviceQuotes.status, "active")));
      await this.event(tx, {
        requestId,
        type: "cancelled",
        side: "requester",
        actor: requester.user,
        note: reason,
      });
    });
    return this.get(requester, requestId);
  }

  async complete(requester: Requester, requestId: string): Promise<ServiceRequestDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const request = await this.requestFor(tx, requester, requestId, true);
      if (request.status !== "accepted") throw requestError(409, "invalid_transition");
      await tx
        .update(serviceRequests)
        .set({ status: "completed", closedAt: now })
        .where(eq(serviceRequests.id, requestId));
      await this.event(tx, {
        requestId,
        type: "completed",
        side: "requester",
        actor: requester.user,
      });
    });
    return this.get(requester, requestId);
  }

  async requesterEvidence(
    requester: Requester,
    requestId: string,
    input: EvidenceInput,
  ): Promise<ServiceRequestDto> {
    await this.db.transaction(async (tx) => {
      const request = await this.requestFor(tx, requester, requestId, true);
      const ids = await this.claimAttachments(tx, requester.user, request.id, input.photoIds, null);
      const accepted = request.acceptedQuoteId
        ? (
            await tx
              .select()
              .from(serviceQuotes)
              .where(eq(serviceQuotes.id, request.acceptedQuoteId))
          )[0]
        : undefined;
      await this.event(tx, {
        requestId,
        type: "evidence_added",
        side: "requester",
        actor: requester.user,
        // After acceptance, the requester's evidence goes to the accepted provider only.
        organizationId: accepted?.organizationId ?? null,
        note: input.note,
        attachmentIds: ids,
      });
    });
    return this.get(requester, requestId);
  }

  /** Attaches the caller's finished uploads to a request. */
  private async claimAttachments(
    executor: Executor,
    actor: User,
    requestId: string,
    photoIds: readonly string[],
    organizationId: string | null,
  ): Promise<string[]> {
    const ids = [...new Set(photoIds)];
    if (ids.length === 0) return [];
    const rows = await executor
      .select()
      .from(serviceRequestAttachments)
      .where(inArray(serviceRequestAttachments.id, ids));
    if (
      rows.length !== ids.length ||
      rows.some(
        (p) => p.uploadedBy !== actor.id || p.status !== "available" || p.requestId !== null,
      )
    ) {
      throw requestError(400, "attachment_not_ready");
    }
    await executor
      .update(serviceRequestAttachments)
      .set({ requestId, organizationId })
      .where(inArray(serviceRequestAttachments.id, ids));
    return ids;
  }

  // --- Provider views and actions --------------------------------------------------------------

  async inquiries(access: TenantAccess): Promise<InquiryDto[]> {
    if (access.organization.kind !== "provider") throw requestError(400, "not_a_provider");
    const rows = await this.db
      .select()
      .from(serviceRequestRecipients)
      .where(
        and(
          eq(serviceRequestRecipients.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : eq(serviceRequestRecipients.branchId, access.branchScope),
        ),
      )
      .orderBy(desc(serviceRequestRecipients.createdAt))
      .limit(50);
    const result = [];
    for (const row of rows) result.push(await this.inquiryDto(row));
    return result;
  }

  /** Opening an inquiry marks it viewed. */
  async inquiry(access: TenantAccess, actor: User, recipientId: string): Promise<InquiryDto> {
    const recipient = await this.recipientFor(this.db, access, recipientId);
    if (recipient.status === "pending") {
      await this.db.transaction(async (tx) => {
        const updated = await tx
          .update(serviceRequestRecipients)
          .set({ status: "viewed" })
          .where(
            and(
              eq(serviceRequestRecipients.id, recipient.id),
              eq(serviceRequestRecipients.status, "pending"),
            ),
          )
          .returning();
        if (updated.length) {
          await this.event(tx, {
            requestId: recipient.requestId,
            type: "viewed",
            side: "provider",
            actor,
            organizationId: recipient.organizationId,
          });
        }
      });
    }
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  async submitQuote(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    input: QuoteInput,
  ): Promise<InquiryDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      const request = await this.lockRequest(tx, recipient.requestId);
      this.assertOpen(request, now);
      if (!["pending", "viewed", "quoted"].includes(recipient.status)) {
        throw requestError(409, "invalid_transition");
      }
      await assertPriceAllowed(tx, input.price);
      const previous = await tx
        .select({ id: serviceQuotes.id })
        .from(serviceQuotes)
        .where(eq(serviceQuotes.recipientId, recipient.id));
      if (previous.length >= MAX_QUOTES_PER_PROVIDER) throw requestError(409, "too_many_quotes");
      await tx
        .update(serviceQuotes)
        .set({ status: "superseded" })
        .where(
          and(eq(serviceQuotes.recipientId, recipient.id), eq(serviceQuotes.status, "active")),
        );
      const [quote] = await tx
        .insert(serviceQuotes)
        .values({
          recipientId: recipient.id,
          organizationId: recipient.organizationId,
          requestId: request.id,
          createdBy: actor.id,
          ...priceColumns(input.price),
          message: input.message,
          availableFrom: input.availableFrom ? new Date(input.availableFrom) : null,
          validUntil: new Date(now.getTime() + input.validDays * DAY_MS),
        })
        .returning();
      if (!quote) throw new Error("quote insert returned no row");
      await tx
        .update(serviceRequestRecipients)
        .set({ status: "quoted" })
        .where(eq(serviceRequestRecipients.id, recipient.id));
      await this.event(tx, {
        requestId: request.id,
        type: previous.length ? "quote_revised" : "quote_submitted",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
        metadata: { quoteId: quote.id, priceType: input.price.type },
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  async withdrawQuote(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    quoteId: string,
  ): Promise<InquiryDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      const request = await this.lockRequest(tx, recipient.requestId);
      this.assertOpen(request, now);
      const updated = await tx
        .update(serviceQuotes)
        .set({ status: "withdrawn" })
        .where(
          and(
            eq(serviceQuotes.id, quoteId),
            eq(serviceQuotes.recipientId, recipient.id),
            eq(serviceQuotes.status, "active"),
          ),
        )
        .returning();
      if (updated.length === 0) throw requestError(409, "quote_not_active");
      await tx
        .update(serviceRequestRecipients)
        .set({ status: "viewed" })
        .where(eq(serviceRequestRecipients.id, recipient.id));
      await this.event(tx, {
        requestId: request.id,
        type: "quote_withdrawn",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
        metadata: { quoteId },
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  async decline(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    reason: string | null,
  ): Promise<InquiryDto> {
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      await this.lockRequest(tx, recipient.requestId);
      if (!["pending", "viewed", "quoted"].includes(recipient.status)) {
        throw requestError(409, "invalid_transition");
      }
      await tx
        .update(serviceQuotes)
        .set({ status: "withdrawn" })
        .where(
          and(eq(serviceQuotes.recipientId, recipient.id), eq(serviceQuotes.status, "active")),
        );
      await tx
        .update(serviceRequestRecipients)
        .set({ status: "declined" })
        .where(eq(serviceRequestRecipients.id, recipient.id));
      await this.event(tx, {
        requestId: recipient.requestId,
        type: "declined",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
        note: reason,
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  /**
   * The accepted provider cancels the agreement. The request reopens: other providers' quotes
   * that are still valid become active again, so the requester can pick another.
   */
  async providerCancel(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    reason: string,
  ): Promise<InquiryDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      const request = await this.lockRequest(tx, recipient.requestId);
      if (request.status !== "accepted" || recipient.status !== "accepted") {
        throw requestError(409, "invalid_transition");
      }
      await tx
        .update(serviceQuotes)
        .set({ status: "withdrawn" })
        .where(
          and(eq(serviceQuotes.recipientId, recipient.id), eq(serviceQuotes.status, "accepted")),
        );
      await tx
        .update(serviceRequestRecipients)
        .set({ status: "cancelled" })
        .where(eq(serviceRequestRecipients.id, recipient.id));
      const others = await tx
        .select()
        .from(serviceRequestRecipients)
        .where(
          and(
            eq(serviceRequestRecipients.requestId, request.id),
            eq(serviceRequestRecipients.status, "not_selected"),
          ),
        );
      for (const other of others) {
        const [latest] = await tx
          .select()
          .from(serviceQuotes)
          .where(eq(serviceQuotes.recipientId, other.id))
          .orderBy(desc(serviceQuotes.createdAt))
          .limit(1);
        const revive = latest?.status === "not_selected" && latest.validUntil > now;
        if (revive) {
          await tx
            .update(serviceQuotes)
            .set({ status: "active" })
            .where(eq(serviceQuotes.id, latest.id));
        }
        await tx
          .update(serviceRequestRecipients)
          .set({ status: revive ? "quoted" : "viewed" })
          .where(eq(serviceRequestRecipients.id, other.id));
      }
      await tx
        .update(serviceRequests)
        .set({
          status: "open",
          acceptedQuoteId: null,
          // Give the requester time to choose again.
          expiresAt: new Date(Math.max(request.expiresAt.getTime(), now.getTime() + 3 * DAY_MS)),
        })
        .where(eq(serviceRequests.id, request.id));
      await this.event(tx, {
        requestId: request.id,
        type: "provider_cancelled",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
        note: reason,
      });
      await this.event(tx, {
        requestId: request.id,
        type: "reopened",
        side: "system",
        actor: null,
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  async providerComplete(
    access: TenantAccess,
    actor: User,
    recipientId: string,
  ): Promise<InquiryDto> {
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      const request = await this.lockRequest(tx, recipient.requestId);
      if (request.status !== "accepted" || recipient.status !== "accepted") {
        throw requestError(409, "invalid_transition");
      }
      await tx
        .update(serviceRequests)
        .set({ status: "completed", closedAt: now })
        .where(eq(serviceRequests.id, request.id));
      await this.event(tx, {
        requestId: request.id,
        type: "completed",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  async providerEvidence(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    input: EvidenceInput,
  ): Promise<InquiryDto> {
    await this.db.transaction(async (tx) => {
      const recipient = await this.recipientFor(tx, access, recipientId);
      await this.lockRequest(tx, recipient.requestId);
      const ids = await this.claimAttachments(
        tx,
        actor,
        recipient.requestId,
        input.photoIds,
        recipient.organizationId,
      );
      await this.event(tx, {
        requestId: recipient.requestId,
        type: "evidence_added",
        side: "provider",
        actor,
        organizationId: recipient.organizationId,
        note: input.note,
        attachmentIds: ids,
      });
    });
    return this.inquiryDto(await this.recipientFor(this.db, access, recipientId));
  }

  // --- Attachments -----------------------------------------------------------------------------

  /** Requester side, or a member of a recipient provider (branch scope applies), may download. */
  async attachment(actor: User, requestId: string, attachmentId: string) {
    const [row] = await this.db
      .select({ attachment: serviceRequestAttachments, request: serviceRequests })
      .from(serviceRequestAttachments)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestAttachments.requestId))
      .where(
        and(
          eq(serviceRequestAttachments.id, attachmentId),
          eq(serviceRequestAttachments.requestId, requestId),
        ),
      );
    if (!row) throw notFound();
    const { attachment, request } = row;

    let allowed = false;
    if (request.requesterUserId !== null) {
      allowed = request.requesterUserId === actor.id;
    } else if (request.requesterOrganizationId !== null) {
      const member = await membershipOf(
        this.db,
        actor,
        request.requesterOrganizationId,
        "requests.create",
      );
      if (member) {
        allowed =
          request.createdBy === actor.id ||
          (hasPermission(member.role, "requests.manage") &&
            (member.branchScope === null || member.branchScope === request.fleetBranchId));
      }
    }
    if (!allowed) {
      const recipients = await this.db
        .select()
        .from(serviceRequestRecipients)
        .where(eq(serviceRequestRecipients.requestId, requestId));
      for (const recipient of recipients) {
        // Another provider's evidence is never shown.
        if (
          attachment.organizationId !== null &&
          attachment.organizationId !== recipient.organizationId
        )
          continue;
        const member = await membershipOf(
          this.db,
          actor,
          recipient.organizationId,
          "requests.respond",
        );
        if (member && (member.branchScope === null || member.branchScope === recipient.branchId)) {
          allowed = true;
          break;
        }
      }
    }
    if (!allowed) throw notFound();
    return this.attachments.read(attachment);
  }

  // --- DTOs ------------------------------------------------------------------------------------

  private quoteDto(quote: ServiceQuote, now: Date): QuoteDto {
    const price = priceOf(quote);
    return {
      id: quote.id,
      recipientId: quote.recipientId,
      providerOrganizationId: quote.organizationId,
      price: { ...price, indicative: true as const, label: formatIndicativePrice(price) },
      message: quote.message,
      availableFrom: quote.availableFrom?.toISOString() ?? null,
      validUntil: quote.validUntil.toISOString(),
      status: quote.status === "active" && quote.validUntil <= now ? "expired" : quote.status,
      createdAt: quote.createdAt.toISOString(),
      disclaimer: PAYMENT_DISCLAIMER,
      scamWarning: QUOTE_SCAM_WARNING,
    };
  }

  private core(request: ServiceRequest, now: Date) {
    return {
      id: request.id,
      category: request.category as ServiceRequestDto["category"],
      description: request.description,
      urgency: request.urgency,
      neededBy: request.neededBy?.toISOString() ?? null,
      status: this.isExpired(request, now) ? ("expired" as const) : request.status,
      expiresAt: request.expiresAt.toISOString(),
      createdAt: request.createdAt.toISOString(),
    };
  }

  private vehicle(request: ServiceRequest, withRegistration: boolean) {
    return {
      vehicleType: request.vehicleType as ServiceRequestDto["vehicle"]["vehicleType"],
      make: request.vehicleMake,
      model: request.vehicleModel,
      year: request.vehicleYear,
      registration: withRegistration ? request.vehicleRegistration : null,
    };
  }

  private async eventsAndAttachments(requestId: string, organizationId: string | null) {
    // organizationId null = requester view (everything); otherwise a provider's view.
    const visible = (
      column:
        | typeof serviceRequestEvents.organizationId
        | typeof serviceRequestAttachments.organizationId,
    ) => (organizationId === null ? undefined : or(isNull(column), eq(column, organizationId)));
    const [events, attachments] = await Promise.all([
      this.db
        .select()
        .from(serviceRequestEvents)
        .where(
          and(
            eq(serviceRequestEvents.requestId, requestId),
            visible(serviceRequestEvents.organizationId),
          ),
        )
        .orderBy(asc(serviceRequestEvents.createdAt), asc(serviceRequestEvents.id)),
      this.db
        .select()
        .from(serviceRequestAttachments)
        .where(
          and(
            eq(serviceRequestAttachments.requestId, requestId),
            eq(serviceRequestAttachments.status, "available"),
            visible(serviceRequestAttachments.organizationId),
          ),
        )
        .orderBy(asc(serviceRequestAttachments.createdAt)),
    ]);
    return {
      events: events.map((e) => ({
        id: e.id,
        type: e.type,
        actorSide: e.actorSide,
        providerOrganizationId: e.organizationId,
        note: e.note,
        attachmentIds: e.attachmentIds,
        createdAt: e.createdAt.toISOString(),
      })),
      attachments: attachments.map((a) => ({
        id: a.id,
        contentType: a.contentType,
        path: `/v1/service-requests/${requestId}/attachments/${a.id}`,
        uploadedBySide: a.organizationId === null ? ("requester" as const) : ("provider" as const),
      })),
    };
  }

  private async requesterDto(request: ServiceRequest): Promise<ServiceRequestDto> {
    const now = this.clock.now();
    const recipients = await this.db
      .select({
        recipient: serviceRequestRecipients,
        profile: providerProfiles,
        orgName: organizations.name,
      })
      .from(serviceRequestRecipients)
      .innerJoin(
        providerProfiles,
        eq(providerProfiles.organizationId, serviceRequestRecipients.organizationId),
      )
      .innerJoin(organizations, eq(organizations.id, serviceRequestRecipients.organizationId))
      .where(eq(serviceRequestRecipients.requestId, request.id))
      .orderBy(asc(serviceRequestRecipients.distanceMeters), asc(serviceRequestRecipients.id));
    const quotes = await this.db
      .select()
      .from(serviceQuotes)
      .where(and(eq(serviceQuotes.requestId, request.id), ne(serviceQuotes.status, "superseded")))
      .orderBy(asc(serviceQuotes.createdAt));
    const accepted = quotes.find((q) => q.id === request.acceptedQuoteId);
    const { events, attachments } = await this.eventsAndAttachments(request.id, null);
    return {
      ...this.core(request, now),
      vehicle: this.vehicle(request, true),
      requester: {
        kind: request.requesterOrganizationId === null ? "user" : "organization",
        organizationId: request.requesterOrganizationId,
        createdBy: request.createdBy,
        fleetBranchId: request.fleetBranchId,
      },
      location: request.location,
      locationNote: request.locationNote,
      attachments,
      events,
      recipients: recipients.map(({ recipient, profile, orgName }) => ({
        id: recipient.id,
        providerOrganizationId: recipient.organizationId,
        providerName:
          (profile.publishedSnapshot as { tradingName?: string } | null)?.tradingName ?? orgName,
        providerSlug: profile.slug,
        status: recipient.status,
        quotes: quotes
          .filter((q) => q.recipientId === recipient.id)
          .map((q) => this.quoteDto(q, now)),
      })),
      acceptedQuoteId: request.acceptedQuoteId,
      agreement: accepted
        ? {
            quoteId: accepted.id,
            providerOrganizationId: accepted.organizationId,
            priceLabel: formatIndicativePrice(priceOf(accepted)),
            informational: true as const,
            disclaimer: PAYMENT_DISCLAIMER,
          }
        : null,
    };
  }

  private async inquiryDto(recipient: ServiceRequestRecipient): Promise<InquiryDto> {
    const now = this.clock.now();
    const [request] = await this.db
      .select()
      .from(serviceRequests)
      .where(eq(serviceRequests.id, recipient.requestId));
    if (!request) throw notFound();
    const quotes = await this.db
      .select()
      .from(serviceQuotes)
      .where(
        and(eq(serviceQuotes.recipientId, recipient.id), ne(serviceQuotes.status, "superseded")),
      )
      .orderBy(asc(serviceQuotes.createdAt));
    // Exact location, address note and registration only once this provider is accepted.
    const chosen = recipient.status === "accepted";
    const { events, attachments } = await this.eventsAndAttachments(
      request.id,
      recipient.organizationId,
    );
    return {
      ...this.core(request, now),
      vehicle: this.vehicle(request, chosen),
      recipientId: recipient.id,
      recipientStatus: recipient.status,
      branchId: recipient.branchId,
      location: chosen
        ? { ...request.location, approximate: false }
        : {
            lng: round2(request.location.lng),
            lat: round2(request.location.lat),
            approximate: true,
          },
      locationNote: chosen ? request.locationNote : null,
      distanceKm:
        recipient.distanceMeters === null ? null : Math.round(recipient.distanceMeters / 100) / 10,
      quotes: quotes.map((q) => this.quoteDto(q, now)),
      attachments,
      events,
    };
  }
}

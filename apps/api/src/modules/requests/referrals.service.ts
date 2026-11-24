import {
  and,
  auditEvents,
  count,
  type Database,
  desc,
  eq,
  type Executor,
  inArray,
  organizations,
  providerProfiles,
  type ProviderReferral,
  providerReferrals,
  queryRows,
  recordAuditEvent,
  type ServiceRequest,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  type User,
} from "@fleettrust/db";
import {
  type createReferralSchema,
  MAX_REFERRALS_PER_INQUIRY,
  REFERRAL_CONSENT_TEXT_VERSION,
  REFERRAL_RELATIONSHIP_LABELS,
  referralConsentText,
  type ReferralDto,
  type ReferralErrorReason,
  type referralConsentSchema,
  type referralListQuerySchema,
} from "@fleettrust/types";
import { BadRequestException, ConflictException, Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { RequestsService } from "./requests.service.js";
import { notFound, type Requester } from "./shared.js";

type CreateInput = z.output<typeof createReferralSchema>;
type ConsentInput = z.output<typeof referralConsentSchema>;
type ListQuery = z.output<typeof referralListQuerySchema>;
type View = "customer" | "referrer" | "receiver";

export function referralError(status: 400 | 409, reason: ReferralErrorReason): Error {
  const body = { statusCode: status, error: status === 409 ? "conflict" : "bad_request", reason };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

/** Inquiry states from which a provider may still refer the customer elsewhere. */
const REFERABLE = new Set(["pending", "viewed", "quoted", "declined"]);

const HISTORY: Record<
  string,
  { action: ReferralDto["history"][number]["action"]; side: "referrer" | "customer" }
> = {
  "referral.proposed": { action: "proposed", side: "referrer" },
  "referral.withdrawn": { action: "withdrawn", side: "referrer" },
  "referral.consented": { action: "consented", side: "customer" },
  "referral.declined": { action: "declined", side: "customer" },
};

/**
 * Provider-to-provider referrals (SRS F-142, AB-17, ADR-0028).
 *
 * 1. A provider that received a request suggests another provider, with a reason and a declared
 *    relationship (none, partner, same owner, or a referral fee). The other provider learns
 *    nothing yet.
 * 2. The customer sees exactly what will be shared and consents (choosing whether photos go too
 *    and whether the referrer may see the outcome), or declines.
 * 3. On consent the other provider receives the request as a normal inquiry.
 *
 * Every step is an audit event and a request event; the disclosure can't change afterwards
 * (database trigger).
 */
@Injectable()
export class ReferralsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    private readonly requests: RequestsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async audit(
    executor: Executor,
    actor: User,
    referral: ProviderReferral,
    action: string,
    organizationId: string | null,
    metadata: Record<string, unknown> = {},
  ) {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId,
      action,
      targetType: "provider_referral",
      targetId: referral.id,
      requestId: currentRequestContext()?.requestId,
      metadata: {
        requestId: referral.requestId,
        fromOrganizationId: referral.fromOrganizationId,
        toOrganizationId: referral.toOrganizationId,
        relationship: referral.relationship,
        ...metadata,
      },
    });
  }

  /** The target's nearest published branch that offers the request's category and vehicle type. */
  private async matchingBranch(
    executor: Executor,
    organizationId: string,
    request: ServiceRequest,
  ): Promise<{ branchId: string; distanceMeters: number } | null> {
    const [row] = await queryRows<{ branch_id: string; distance_m: number }>(
      executor,
      sql`SELECT e.branch_id,
                 round(ST_Distance(e.location, ST_SetSRID(ST_MakePoint(${request.location.lng}::float8, ${request.location.lat}::float8), 4326)::geography))::int AS distance_m
          FROM provider_search_entries e
          JOIN organizations o ON o.id = e.organization_id AND o.status = 'active'
          JOIN provider_profiles pp ON pp.organization_id = e.organization_id AND pp.status = 'published'
          WHERE e.organization_id = ${organizationId}::uuid
            AND ${request.category} = ANY(e.categories)
            AND ${request.vehicleType} = ANY(e.vehicle_types)
          ORDER BY distance_m
          LIMIT 1`,
    );
    return row ? { branchId: row.branch_id, distanceMeters: row.distance_m } : null;
  }

  private async isRecipient(executor: Executor, requestId: string, organizationId: string) {
    const [row] = await executor
      .select({ id: serviceRequestRecipients.id })
      .from(serviceRequestRecipients)
      .where(
        and(
          eq(serviceRequestRecipients.requestId, requestId),
          eq(serviceRequestRecipients.organizationId, organizationId),
        ),
      );
    return row !== undefined;
  }

  // --- Referring provider ----------------------------------------------------------------------

  async create(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    input: CreateInput,
  ): Promise<ReferralDto> {
    const recipient = await this.requests.recipientFor(this.db, access, recipientId);
    const now = this.clock.now();
    let referralId: string;
    try {
      referralId = await this.db.transaction(async (tx) => {
        const request = await this.requests.lockRequest(tx, recipient.requestId);
        this.requests.assertOpen(request, now);
        const [current] = await tx
          .select()
          .from(serviceRequestRecipients)
          .where(eq(serviceRequestRecipients.id, recipient.id));
        if (!current || !REFERABLE.has(current.status)) {
          throw referralError(409, "invalid_transition");
        }

        const [target] = await tx
          .select({ organizationId: providerProfiles.organizationId })
          .from(providerProfiles)
          .innerJoin(organizations, eq(organizations.id, providerProfiles.organizationId))
          .where(
            and(
              eq(providerProfiles.slug, input.toProvider),
              eq(providerProfiles.status, "published"),
              eq(organizations.status, "active"),
            ),
          );
        if (!target) throw referralError(400, "provider_not_found");
        if (target.organizationId === recipient.organizationId) {
          throw referralError(400, "self_referral");
        }
        if (!(await this.matchingBranch(tx, target.organizationId, request))) {
          throw referralError(400, "provider_not_matching");
        }
        if (await this.isRecipient(tx, request.id, target.organizationId)) {
          throw referralError(409, "already_recipient");
        }
        const [open] = await tx
          .select({ n: count() })
          .from(providerReferrals)
          .where(
            and(
              eq(providerReferrals.fromRecipientId, recipient.id),
              inArray(providerReferrals.status, ["pending_consent", "consented"]),
            ),
          );
        if ((open?.n ?? 0) >= MAX_REFERRALS_PER_INQUIRY) {
          throw referralError(409, "too_many_referrals");
        }

        const [row] = await tx
          .insert(providerReferrals)
          .values({
            requestId: request.id,
            fromOrganizationId: recipient.organizationId,
            fromRecipientId: recipient.id,
            toOrganizationId: target.organizationId,
            createdBy: actor.id,
            message: input.message,
            relationship: input.relationship,
            relationshipDetails: input.relationshipDetails,
          })
          .returning();
        if (!row) throw new Error("referral insert returned no row");
        await this.requests.event(tx, {
          requestId: request.id,
          type: "referral_proposed",
          side: "provider",
          actor,
          organizationId: recipient.organizationId,
          metadata: { referralId: row.id, toOrganizationId: target.organizationId },
          payload: { referralId: row.id },
        });
        await this.audit(tx, actor, row, "referral.proposed", recipient.organizationId, {
          relationshipDetails: row.relationshipDetails,
        });
        return row.id;
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes(
          "provider_referrals_open_key",
        )
      ) {
        throw referralError(409, "already_referred");
      }
      throw error;
    }
    return this.getForProvider(access, referralId);
  }

  /** The referrer takes it back before the customer decides. */
  async withdraw(access: TenantAccess, actor: User, referralId: string): Promise<ReferralDto> {
    await this.db.transaction(async (tx) => {
      const referral = await this.sentBy(tx, access, referralId, true);
      if (referral.status !== "pending_consent") throw referralError(409, "invalid_transition");
      const [row] = await tx
        .update(providerReferrals)
        .set({ status: "withdrawn", decidedAt: this.clock.now(), decidedBy: actor.id })
        .where(eq(providerReferrals.id, referral.id))
        .returning();
      if (!row) throw notFound();
      await this.requests.event(tx, {
        requestId: row.requestId,
        type: "referral_withdrawn",
        side: "provider",
        actor,
        organizationId: row.fromOrganizationId,
        metadata: { referralId: row.id },
        payload: { referralId: row.id },
      });
      await this.audit(tx, actor, row, "referral.withdrawn", row.fromOrganizationId);
    });
    return this.getForProvider(access, referralId);
  }

  /** A referral this organization sent, within the caller's branch scope. */
  private async sentBy(
    executor: Executor,
    access: TenantAccess,
    referralId: string,
    lock = false,
  ): Promise<ProviderReferral> {
    const query = executor
      .select()
      .from(providerReferrals)
      .where(
        and(
          eq(providerReferrals.id, referralId),
          eq(providerReferrals.fromOrganizationId, access.tenant.organizationId),
        ),
      );
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    await this.requests.recipientFor(executor, access, row.fromRecipientId);
    return row;
  }

  // --- Provider views --------------------------------------------------------------------------

  /** Sent referrals, or received ones (only after consent: before it, the receiver knows nothing). */
  async listForProvider(access: TenantAccess, query: ListQuery): Promise<ReferralDto[]> {
    if (access.organization.kind !== "provider") throw referralError(400, "not_a_provider");
    const org = access.tenant.organizationId;
    const sent = query.direction === "sent";
    const rows = await this.db
      .select({ referral: providerReferrals, branchId: serviceRequestRecipients.branchId })
      .from(providerReferrals)
      .innerJoin(
        serviceRequestRecipients,
        eq(
          serviceRequestRecipients.id,
          sent ? providerReferrals.fromRecipientId : providerReferrals.recipientId,
        ),
      )
      .where(
        sent
          ? eq(providerReferrals.fromOrganizationId, org)
          : and(
              eq(providerReferrals.toOrganizationId, org),
              eq(providerReferrals.status, "consented"),
            ),
      )
      .orderBy(desc(providerReferrals.createdAt))
      .limit(200);
    const visible = rows
      .filter((r) => access.branchScope === null || r.branchId === access.branchScope)
      .map((r) => r.referral);
    const dtos = await this.dtos(visible, sent ? "referrer" : "receiver");
    return query.status === undefined ? dtos : dtos.filter((d) => d.status === query.status);
  }

  async getForProvider(access: TenantAccess, referralId: string): Promise<ReferralDto> {
    if (access.organization.kind !== "provider") throw referralError(400, "not_a_provider");
    const [row] = await this.db
      .select()
      .from(providerReferrals)
      .where(eq(providerReferrals.id, referralId));
    if (!row) throw notFound();
    const org = access.tenant.organizationId;
    let view: View;
    if (row.fromOrganizationId === org) {
      await this.requests.recipientFor(this.db, access, row.fromRecipientId);
      view = "referrer";
    } else if (row.toOrganizationId === org && row.status === "consented" && row.recipientId) {
      await this.requests.recipientFor(this.db, access, row.recipientId);
      view = "receiver";
    } else {
      throw notFound();
    }
    const [dto] = await this.dtos([row], view);
    if (!dto) throw notFound();
    return dto;
  }

  // --- Customer --------------------------------------------------------------------------------

  async listForRequest(requester: Requester, requestId: string): Promise<ReferralDto[]> {
    const request = await this.requests.requestFor(this.db, requester, requestId);
    const rows = await this.db
      .select()
      .from(providerReferrals)
      .where(eq(providerReferrals.requestId, request.id))
      .orderBy(desc(providerReferrals.createdAt));
    return this.dtos(rows, "customer");
  }

  private async customerReferral(executor: Executor, request: ServiceRequest, referralId: string) {
    const [row] = await executor
      .select()
      .from(providerReferrals)
      .where(and(eq(providerReferrals.id, referralId), eq(providerReferrals.requestId, request.id)))
      .for("update");
    if (!row) throw notFound();
    return row;
  }

  /** Explicit consent: the other provider receives the request as a normal inquiry. */
  async consent(
    requester: Requester,
    requestId: string,
    referralId: string,
    input: ConsentInput,
  ): Promise<ReferralDto> {
    const actor = requester.user;
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const request = await this.requests.requestFor(tx, requester, requestId, true);
      const referral = await this.customerReferral(tx, request, referralId);
      if (referral.status !== "pending_consent") throw referralError(409, "invalid_transition");
      this.requests.assertOpen(request, now);
      if (await this.isRecipient(tx, request.id, referral.toOrganizationId)) {
        throw referralError(409, "already_recipient");
      }
      const branch = await this.matchingBranch(tx, referral.toOrganizationId, request);
      if (!branch) throw referralError(409, "provider_not_matching");
      const [toName] = await this.names(tx, [referral.toOrganizationId]);
      const consentText = referralConsentText({
        toName: toName?.name ?? "the suggested provider",
        sharePhotos: input.sharePhotos,
        shareOutcomeWithReferrer: input.shareOutcomeWithReferrer,
      });

      const [recipient] = await tx
        .insert(serviceRequestRecipients)
        .values({
          requestId: request.id,
          organizationId: referral.toOrganizationId,
          branchId: branch.branchId,
          distanceMeters: branch.distanceMeters,
        })
        .returning();
      if (!recipient) throw new Error("recipient insert returned no row");
      const [row] = await tx
        .update(providerReferrals)
        .set({
          status: "consented",
          sharePhotos: input.sharePhotos,
          shareOutcome: input.shareOutcomeWithReferrer,
          consentText,
          consentVersion: REFERRAL_CONSENT_TEXT_VERSION,
          decidedAt: now,
          decidedBy: actor.id,
          recipientId: recipient.id,
        })
        .where(eq(providerReferrals.id, referral.id))
        .returning();
      if (!row) throw notFound();
      await this.requests.event(tx, {
        requestId: request.id,
        type: "referral_consented",
        side: "requester",
        actor,
        organizationId: referral.fromOrganizationId,
        metadata: { referralId: referral.id },
        payload: { referralId: referral.id },
      });
      await this.requests.event(tx, {
        requestId: request.id,
        type: "sent",
        side: "system",
        actor: null,
        organizationId: referral.toOrganizationId,
        metadata: { referralId: referral.id },
      });
      await this.audit(tx, actor, row, "referral.consented", request.requesterOrganizationId, {
        sharePhotos: input.sharePhotos,
        shareOutcomeWithReferrer: input.shareOutcomeWithReferrer,
        consentVersion: REFERRAL_CONSENT_TEXT_VERSION,
        recipientId: recipient.id,
      });
    });
    return this.customerView(requester, requestId, referralId);
  }

  async decline(requester: Requester, requestId: string, referralId: string): Promise<ReferralDto> {
    const actor = requester.user;
    await this.db.transaction(async (tx) => {
      const request = await this.requests.requestFor(tx, requester, requestId, true);
      const referral = await this.customerReferral(tx, request, referralId);
      if (referral.status !== "pending_consent") throw referralError(409, "invalid_transition");
      const [row] = await tx
        .update(providerReferrals)
        .set({ status: "declined", decidedAt: this.clock.now(), decidedBy: actor.id })
        .where(eq(providerReferrals.id, referral.id))
        .returning();
      if (!row) throw notFound();
      await this.requests.event(tx, {
        requestId: request.id,
        type: "referral_declined",
        side: "requester",
        actor,
        organizationId: referral.fromOrganizationId,
        metadata: { referralId: referral.id },
        payload: { referralId: referral.id },
      });
      await this.audit(tx, actor, row, "referral.declined", request.requesterOrganizationId);
    });
    return this.customerView(requester, requestId, referralId);
  }

  private async customerView(requester: Requester, requestId: string, referralId: string) {
    const all = await this.listForRequest(requester, requestId);
    const dto = all.find((r) => r.id === referralId);
    if (!dto) throw notFound();
    return dto;
  }

  // --- DTOs ------------------------------------------------------------------------------------

  private async names(executor: Executor, ids: readonly string[]) {
    if (ids.length === 0) return [];
    const rows = await executor
      .select({
        id: organizations.id,
        name: organizations.name,
        slug: providerProfiles.slug,
        snapshot: providerProfiles.publishedSnapshot,
      })
      .from(organizations)
      .innerJoin(providerProfiles, eq(providerProfiles.organizationId, organizations.id))
      .where(inArray(organizations.id, [...ids]));
    return rows.map((r) => ({
      id: r.id,
      name: (r.snapshot as { tradingName?: string } | null)?.tradingName ?? r.name,
      slug: r.slug,
    }));
  }

  private async dtos(rows: readonly ProviderReferral[], view: View): Promise<ReferralDto[]> {
    if (rows.length === 0) return [];
    const now = this.clock.now();
    const ids = rows.map((r) => r.id);
    const orgIds = [...new Set(rows.flatMap((r) => [r.fromOrganizationId, r.toOrganizationId]))];
    const requestIds = [...new Set(rows.map((r) => r.requestId))];
    const recipientIds = rows.flatMap((r) => (r.recipientId ? [r.recipientId] : []));
    const [names, requests, recipients, history] = await Promise.all([
      this.names(this.db, orgIds),
      this.db.select().from(serviceRequests).where(inArray(serviceRequests.id, requestIds)),
      recipientIds.length
        ? this.db
            .select({ id: serviceRequestRecipients.id, status: serviceRequestRecipients.status })
            .from(serviceRequestRecipients)
            .where(inArray(serviceRequestRecipients.id, recipientIds))
        : Promise.resolve([]),
      this.db
        .select({
          targetId: auditEvents.targetId,
          action: auditEvents.action,
          at: auditEvents.occurredAt,
        })
        .from(auditEvents)
        .where(
          and(eq(auditEvents.targetType, "provider_referral"), inArray(auditEvents.targetId, ids)),
        )
        .orderBy(auditEvents.occurredAt, auditEvents.id),
    ]);
    const nameOf = new Map(names.map((n) => [n.id, n]));
    const requestOf = new Map(requests.map((r) => [r.id, r]));
    const recipientStatus = new Map(recipients.map((r) => [r.id, r.status]));
    const party = (id: string) => {
      const n = nameOf.get(id);
      return { organizationId: id, name: n?.name ?? "Provider", slug: n?.slug ?? null };
    };
    return rows.map((r) => {
      const request = requestOf.get(r.requestId);
      const closed = request?.status !== "open" || this.requests.isExpired(request, now);
      const outcomeVisible = view === "customer" || (view === "referrer" && r.shareOutcome);
      return {
        id: r.id,
        requestId: r.requestId,
        from: party(r.fromOrganizationId),
        to: party(r.toOrganizationId),
        message: r.message,
        relationship: r.relationship,
        relationshipLabel: REFERRAL_RELATIONSHIP_LABELS[r.relationship],
        relationshipDetails: r.relationshipDetails,
        status: r.status === "pending_consent" && closed ? "expired" : r.status,
        sharing:
          r.status === "consented" && r.consentText !== null
            ? {
                photos: r.sharePhotos,
                outcomeWithReferrer: r.shareOutcome,
                consentText: r.consentText,
              }
            : null,
        outcome:
          outcomeVisible && r.recipientId ? (recipientStatus.get(r.recipientId) ?? null) : null,
        recipientId: view === "referrer" ? null : r.recipientId,
        createdAt: r.createdAt.toISOString(),
        decidedAt: r.decidedAt?.toISOString() ?? null,
        history: history.flatMap((h) => {
          const entry = HISTORY[h.action];
          return h.targetId === r.id && entry ? [{ ...entry, at: h.at.toISOString() }] : [];
        }),
      };
    });
  }
}

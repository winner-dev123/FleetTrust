import {
  and,
  appointments,
  type Database,
  eq,
  gte,
  inArray,
  lte,
  organizations,
  providerProfiles,
  serviceQuotes,
  serviceRequestEvents,
  serviceRequestRecipients,
  serviceRequests,
  sql,
} from "@fleettrust/db";
import {
  type analyticsQuerySchema,
  PIPELINE_STAGES,
  type PipelineStage,
  type ProviderAnalyticsDto,
  RESPONSE_LEVEL_LABELS,
  RESPONSE_STATUS_NOTE,
  RESPONSE_STATUS_WINDOW_DAYS,
  responseLevel,
  type ResponseStatusDto,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import {
  assertManager,
  assertProvider,
  crmError,
  notFound,
  responseDueAt,
  stageOf,
} from "./shared.js";

type AnalyticsQuery = z.output<typeof analyticsQuerySchema>;

const DAY_MS = 86_400_000;
const RESPONSE_EVENTS = ["quote_submitted", "declined"];

interface InquiryStat {
  stage: PipelineStage;
  status: string;
  createdAt: Date;
  dueAt: Date;
  firstResponse: Date | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const value =
    sorted.length % 2 === 1
      ? (sorted[mid] ?? 0)
      : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return Math.round(value);
}

const ratio = (part: number, whole: number) =>
  whole === 0 ? null : Math.round((part / whole) * 1000) / 1000;

/**
 * Provider analytics and public response status (F-132, ADR-0027). Response time is from when
 * an inquiry arrived to the provider's first quote or decline. Everything is computed from the
 * request history, so nothing can be edited to look better.
 */
@Injectable()
export class AnalyticsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async inquiryStats(
    organizationId: string,
    since: Date,
    branchId: string | null,
  ): Promise<InquiryStat[]> {
    const now = this.clock.now();
    const rows = await this.db
      .select({ recipient: serviceRequestRecipients, request: serviceRequests })
      .from(serviceRequestRecipients)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .where(
        and(
          eq(serviceRequestRecipients.organizationId, organizationId),
          gte(serviceRequestRecipients.createdAt, since),
          branchId === null ? undefined : eq(serviceRequestRecipients.branchId, branchId),
        ),
      );
    if (rows.length === 0) return [];
    const firsts = await this.db
      .select({
        requestId: serviceRequestEvents.requestId,
        first: sql<Date | string>`min(${serviceRequestEvents.createdAt})`,
      })
      .from(serviceRequestEvents)
      .where(
        and(
          eq(serviceRequestEvents.organizationId, organizationId),
          inArray(
            serviceRequestEvents.requestId,
            rows.map((r) => r.request.id),
          ),
          inArray(serviceRequestEvents.type, RESPONSE_EVENTS),
        ),
      )
      .groupBy(serviceRequestEvents.requestId);
    const firstBy = new Map(firsts.map((f) => [f.requestId, new Date(f.first)]));
    return rows.map(({ recipient, request }) => ({
      stage: stageOf(recipient, request, now),
      status: recipient.status,
      createdAt: recipient.createdAt,
      dueAt: responseDueAt(recipient.createdAt, request.urgency),
      firstResponse: firstBy.get(request.id) ?? null,
    }));
  }

  private responseMinutes(stats: readonly InquiryStat[]): number[] {
    return stats
      .filter((s) => s.firstResponse !== null)
      .map((s) =>
        Math.max(0, ((s.firstResponse?.getTime() ?? 0) - s.createdAt.getTime()) / 60_000),
      );
  }

  private async responseStatusOf(organizationId: string): Promise<ResponseStatusDto> {
    const since = new Date(this.clock.now().getTime() - RESPONSE_STATUS_WINDOW_DAYS * DAY_MS);
    const stats = await this.inquiryStats(organizationId, since, null);
    const minutes = this.responseMinutes(stats);
    const level = responseLevel(median(minutes), stats.length);
    return {
      level,
      label: RESPONSE_LEVEL_LABELS[level],
      responseRate: level === "not_enough_data" ? null : ratio(minutes.length, stats.length),
      basedOnInquiries: stats.length,
      windowDays: RESPONSE_STATUS_WINDOW_DAYS,
      note: RESPONSE_STATUS_NOTE,
    };
  }

  async analytics(access: TenantAccess, query: AnalyticsQuery): Promise<ProviderAnalyticsDto> {
    assertProvider(access);
    assertManager(access);
    if (
      access.branchScope !== null &&
      query.branchId !== undefined &&
      query.branchId !== access.branchScope
    ) {
      throw crmError(400, "invalid_branch");
    }
    const branchId = access.branchScope ?? query.branchId ?? null;
    const orgId = access.tenant.organizationId;
    const now = this.clock.now();
    const since = new Date(now.getTime() - query.days * DAY_MS);
    const stats = await this.inquiryStats(orgId, since, branchId);
    const minutes = this.responseMinutes(stats);

    const quoteRows = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(serviceQuotes)
      .innerJoin(
        serviceRequestRecipients,
        eq(serviceRequestRecipients.id, serviceQuotes.recipientId),
      )
      .where(
        and(
          eq(serviceQuotes.organizationId, orgId),
          gte(serviceQuotes.createdAt, since),
          branchId === null ? undefined : eq(serviceRequestRecipients.branchId, branchId),
        ),
      );
    const won = stats.filter((s) => s.status === "accepted").length;
    const lost = stats.filter((s) => s.status === "not_selected").length;

    const appointmentRows = await this.db
      .select({ status: appointments.status, startsAt: appointments.startsAt })
      .from(appointments)
      .where(
        and(
          eq(appointments.organizationId, orgId),
          gte(appointments.startsAt, since),
          lte(appointments.startsAt, new Date(now.getTime() + query.days * DAY_MS)),
          branchId === null ? undefined : eq(appointments.branchId, branchId),
        ),
      );
    const count = (status: string, upcoming?: boolean) =>
      appointmentRows.filter(
        (r) => r.status === status && (upcoming === undefined || r.startsAt > now === upcoming),
      ).length;

    const pipeline = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<
      PipelineStage,
      number
    >;
    for (const s of stats) pipeline[s.stage] += 1;

    return {
      periodDays: query.days,
      since: since.toISOString(),
      branchId,
      inquiries: {
        received: stats.length,
        responded: minutes.length,
        responseRate: ratio(minutes.length, stats.length),
        medianFirstResponseMinutes: median(minutes),
        respondedWithinTarget: stats.filter(
          (s) => s.firstResponse !== null && s.firstResponse <= s.dueAt,
        ).length,
      },
      quotes: {
        sent: quoteRows[0]?.count ?? 0,
        won,
        lost,
        winRate: ratio(won, won + lost),
      },
      appointments: {
        booked: count("booked") + count("completed") + count("no_show"),
        completed: count("completed"),
        noShow: count("no_show"),
        cancelled: count("cancelled"),
        upcoming: count("booked", true),
      },
      pipeline,
      responseStatus: await this.responseStatusOf(orgId),
    };
  }

  /** Public: how quickly a published provider usually replies. */
  async publicResponseStatus(slug: string): Promise<ResponseStatusDto> {
    const [row] = await this.db
      .select({ organizationId: providerProfiles.organizationId })
      .from(providerProfiles)
      .innerJoin(organizations, eq(organizations.id, providerProfiles.organizationId))
      .where(
        and(
          eq(providerProfiles.slug, slug),
          eq(providerProfiles.status, "published"),
          eq(organizations.status, "active"),
        ),
      );
    if (!row) throw notFound();
    return this.responseStatusOf(row.organizationId);
  }
}

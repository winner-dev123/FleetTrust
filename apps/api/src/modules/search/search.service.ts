import { createHash } from "node:crypto";

import {
  and,
  branches,
  type Database,
  eq,
  gt,
  inArray,
  isNull,
  organizations,
  providerMedia,
  providerProfiles,
  type ProviderSearchRow,
  type SearchArea,
  type SearchCursor,
  searchProviders,
  verificationBadges,
} from "@fleettrust/db";
import {
  formatIndicativePrice,
  type IndicativePrice,
  INDICATIVE_PRICE_DISCLAIMER,
  ORGANIZATION_BADGE_TYPES,
  type ProviderSearchPage,
  type ProviderSearchResult,
  type searchProvidersQuerySchema,
} from "@fleettrust/types";
import type { z } from "zod";
import { BadRequestException, Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { type BranchSchedule, HoursService } from "../providers/index.js";

type SearchQuery = z.output<typeof searchProvidersQuerySchema>;

interface CursorPayload {
  v: 1;
  /** Evaluation instant of the first page, reused so "open now" ranking stays consistent. */
  at: string;
  s: string;
  d: number;
  id: string;
  /** Fingerprint of the query: a cursor only continues the search that produced it. */
  h: string;
}

const invalidCursor = () =>
  new BadRequestException({ statusCode: 400, error: "bad_request", reason: "invalid_cursor" });

/** Centre of a viewport, correct across the antimeridian. */
function centre(box: { west: number; south: number; east: number; north: number }) {
  const width = box.west <= box.east ? box.east - box.west : 360 - (box.west - box.east);
  let lng = box.west + width / 2;
  if (lng > 180) lng -= 360;
  return { lng, lat: (box.south + box.north) / 2 };
}

/**
 * Provider search (SRS F-040..F-042, ADR-0019). Ranking is relevance only and takes no plan or
 * entitlement input (ADR-0009; this module may not import entitlements). Visitors are served
 * only from rounded locations.
 */
@Injectable()
export class SearchService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly hours: HoursService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private fingerprint(query: SearchQuery, signedIn: boolean): string {
    const { cursor: _cursor, limit: _limit, ...rest } = query;
    return createHash("sha256")
      .update(JSON.stringify({ ...rest, signedIn }))
      .digest("base64url")
      .slice(0, 16);
  }

  private decodeCursor(raw: string, fingerprint: string): CursorPayload {
    let payload: unknown;
    try {
      payload = JSON.parse(Buffer.from(raw, "base64url").toString("utf8"));
    } catch {
      throw invalidCursor();
    }
    const p = payload as Partial<CursorPayload>;
    if (
      p.v !== 1 ||
      typeof p.at !== "string" ||
      Number.isNaN(Date.parse(p.at)) ||
      typeof p.s !== "string" ||
      !/^\d+(\.\d+)?$/.test(p.s) ||
      typeof p.d !== "number" ||
      !Number.isInteger(p.d) ||
      typeof p.id !== "string" ||
      !/^[0-9a-f-]{36}$/.test(p.id) ||
      p.h !== fingerprint
    ) {
      throw invalidCursor();
    }
    return p as CursorPayload;
  }

  private encodeCursor(at: Date, row: ProviderSearchRow, fingerprint: string): string {
    const payload: CursorPayload = {
      v: 1,
      at: at.toISOString(),
      s: row.score,
      d: row.distanceMeters,
      id: row.branchId,
      h: fingerprint,
    };
    return Buffer.from(JSON.stringify(payload)).toString("base64url");
  }

  async search(query: SearchQuery, signedIn: boolean): Promise<ProviderSearchPage> {
    const fingerprint = this.fingerprint(query, signedIn);
    let at = this.clock.now();
    let after: SearchCursor | undefined;
    if (query.cursor !== undefined) {
      const cursor = this.decodeCursor(query.cursor, fingerprint);
      at = new Date(cursor.at);
      after = { score: cursor.s, distanceMeters: cursor.d, branchId: cursor.id };
    }
    const area: SearchArea = query.bbox
      ? { kind: "bbox", box: query.bbox, origin: centre(query.bbox) }
      : {
          kind: "near",
          point: { lng: query.lng ?? 0, lat: query.lat ?? 0 },
          radiusMeters: query.radiusKm * 1000,
          coversLocationOnly: query.coversLocation === true,
        };
    const rows = await searchProviders(this.db, {
      at,
      precise: signedIn,
      area,
      ...(query.category ? { categories: query.category } : {}),
      ...(query.vehicleType ? { vehicleType: query.vehicleType } : {}),
      ...(query.verified ? { verification: query.verified } : {}),
      ...(query.openNow ? { openNow: true } : {}),
      ...(query.q ? { text: query.q } : {}),
      ...(after ? { after } : {}),
      limit: query.limit + 1,
    });
    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    return {
      results: await this.enrich(page, at, signedIn, query.category),
      nextCursor:
        rows.length > query.limit && last ? this.encodeCursor(at, last, fingerprint) : null,
      ranking: "relevance",
      priceDisclaimer: INDICATIVE_PRICE_DISCLAIMER,
    };
  }

  /** Card details for one page: live hours, live badges, logo and indicative price highlights. Shared with route search. */
  async enrich(
    rows: readonly ProviderSearchRow[],
    at: Date,
    signedIn: boolean,
    categories: readonly string[] | undefined,
  ): Promise<ProviderSearchResult[]> {
    if (rows.length === 0) return [];
    const orgIds = [...new Set(rows.map((r) => r.organizationId))];
    const [branchRows, orgRows, badges, logos, snapshots] = await Promise.all([
      this.db
        .select()
        .from(branches)
        .where(
          inArray(
            branches.id,
            rows.map((r) => r.branchId),
          ),
        ),
      this.db
        .select({ id: organizations.id, timezone: organizations.timezone })
        .from(organizations)
        .where(inArray(organizations.id, orgIds)),
      this.db
        .select({
          organizationId: verificationBadges.organizationId,
          badgeType: verificationBadges.badgeType,
        })
        .from(verificationBadges)
        .where(
          and(
            inArray(verificationBadges.organizationId, orgIds),
            isNull(verificationBadges.endedAt),
            gt(verificationBadges.expiresAt, at),
          ),
        ),
      this.db
        .select()
        .from(providerMedia)
        .where(
          and(
            inArray(providerMedia.organizationId, orgIds),
            eq(providerMedia.kind, "logo"),
            eq(providerMedia.status, "available"),
          ),
        ),
      this.db
        .select({
          organizationId: providerProfiles.organizationId,
          snapshot: providerProfiles.publishedSnapshot,
        })
        .from(providerProfiles)
        .where(inArray(providerProfiles.organizationId, orgIds)),
    ]);

    const timeZoneOf = new Map(orgRows.map((o) => [o.id, o.timezone]));
    const schedules = new Map<string, BranchSchedule>();
    for (const orgId of orgIds) {
      const forOrg = await this.hours.schedules(
        timeZoneOf.get(orgId) ?? "UTC",
        branchRows.filter((b) => b.organizationId === orgId),
      );
      for (const [id, schedule] of forOrg) schedules.set(id, schedule);
    }

    return rows.map((row) => {
      const schedule = schedules.get(row.branchId) ?? {
        timeZone: timeZoneOf.get(row.organizationId) ?? "UTC",
        weekly: null,
        exceptions: [],
      };
      const offerings =
        (
          snapshots.find((s) => s.organizationId === row.organizationId)?.snapshot as
            | { offerings?: { name: string; category: string; price: IndicativePrice }[] }
            | null
            | undefined
        )?.offerings ?? [];
      const preferred = categories?.length
        ? [
            ...offerings.filter((o) => categories.includes(o.category)),
            ...offerings.filter((o) => !categories.includes(o.category)),
          ]
        : offerings;
      const logo = logos.find((m) => m.organizationId === row.organizationId && m.storageKey);
      return {
        branchId: row.branchId,
        organizationId: row.organizationId,
        slug: row.slug,
        tradingName: row.tradingName,
        branchName: row.branchName,
        locality: row.locality,
        countryCode: row.countryCode,
        categories: row.categories as ProviderSearchResult["categories"],
        vehicleTypes: row.vehicleTypes as ProviderSearchResult["vehicleTypes"],
        location: { lng: row.lng, lat: row.lat, approximate: !signedIn },
        // Visitors' distances come from the rounded point, so they can't be used to triangulate.
        distanceKm: signedIn
          ? Math.round(row.distanceMeters / 10) / 100
          : Math.round(row.distanceMeters / 100) / 10,
        serviceRadiusKm: row.serviceRadiusKm,
        coversSearchLocation: row.coversLocation,
        hours: this.hours.present(schedule, at).status,
        verification: ORGANIZATION_BADGE_TYPES.map((badgeType) => ({
          badgeType,
          status: badges.some(
            (b) => b.organizationId === row.organizationId && b.badgeType === badgeType,
          )
            ? ("verified" as const)
            : ("unverified" as const),
        })),
        priceHighlights: preferred.slice(0, 3).map((o) => ({
          name: o.name,
          label: formatIndicativePrice(o.price),
        })),
        logoUrl: logo?.storageKey ? this.storage.publicUrl(logo.storageKey) : null,
      };
    });
  }
}

import { randomUUID } from "node:crypto";

import {
  and,
  asc,
  type Branch,
  branches,
  type Database,
  eq,
  type Executor,
  inArray,
  organizations,
  type ProviderMedia,
  providerMedia,
  type ProviderProfile,
  providerProfiles,
  recordAuditEvent,
  type User,
} from "@fleettrust/db";
import {
  type BranchDto,
  CATEGORY_DETAIL_SCHEMAS,
  INDICATIVE_PRICE_DISCLAIMER,
  MAX_GALLERY_IMAGES,
  type ProviderCategory,
  type ProviderErrorReason,
  type OfferingDto,
  type ProviderProfileDto,
  type PublicProviderProfile,
  RADIUS_CATEGORIES,
  type UpdateProviderProfileRequest,
  WIZARD_STEPS,
  type branchLocationRequestSchema,
  type wizardStepSchema,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { stripImageMetadata } from "../../platform/scanning/image-metadata.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { VerificationService } from "../verification/index.js";
import { CatalogService, type SnapshotOffering } from "./catalog.service.js";
import { HoursService } from "./hours.service.js";
import { assertProvider, notFound, providerError } from "./shared.js";

type WizardStep = z.infer<typeof wizardStepSchema>;
type Issue = WizardStep["issues"][number];
type BranchLocation = z.infer<typeof branchLocationRequestSchema>;

const requestId = () => currentRequestContext()?.requestId;
const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/** Published branches need these; street address too unless the provider only travels. */
function branchIssues(branch: Branch, categories: readonly ProviderCategory[]): Issue[] {
  const path = `branches.${branch.id}`;
  const issues: Issue[] = [];
  const travelsOnly = categories.length > 0 && categories.every((c) => c === "mobile_mechanic");
  if (!travelsOnly && !branch.addressLine1)
    issues.push({ path: `${path}.addressLine1`, message: "Street address is required" });
  if (!branch.locality)
    issues.push({ path: `${path}.locality`, message: "Town or city is required" });
  if (!branch.countryCode)
    issues.push({ path: `${path}.countryCode`, message: "Country is required" });
  if (!branch.location)
    issues.push({ path: `${path}.location`, message: "Pin the location on the map" });
  if (categories.some((c) => RADIUS_CATEGORIES.includes(c)) && branch.serviceRadiusKm === null) {
    issues.push({
      path: `${path}.serviceRadiusKm`,
      message: "How far do you travel to customers?",
    });
  }
  return issues;
}

/** Deterministic JSON (sorted keys) for comparing draft and published snapshots. */
function stable(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === "object" && !Array.isArray(v)
      ? Object.fromEntries(
          Object.entries(v as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)),
        )
      : v,
  );
}

interface Snapshot {
  organizationId: string;
  slug: string;
  tradingName: string;
  legalName: string;
  description: string | null;
  categories: ProviderCategory[];
  categoryDetails: Record<string, Record<string, unknown>>;
  vehicleTypes: string[];
  contact: { phone: string | null; email: string | null; website: string | null };
  branches: {
    id: string;
    name: string;
    addressLine1: string | null;
    addressLine2: string | null;
    locality: string | null;
    region: string | null;
    postalCode: string | null;
    countryCode: string | null;
    location: { lng: number; lat: number };
    serviceRadiusKm: number | null;
    phone: string | null;
  }[];
  mediaIds: string[];
  /** Added in Prompt 11; snapshots published earlier have none. */
  offerings?: SnapshotOffering[];
}

/**
 * Provider profiles (SRS J4, F-030..F-032): a resumable draft, per-step completeness,
 * category-specific rules, publication as a frozen snapshot, and public views that hide
 * contact details and exact location from visitors who aren't signed in (OQ-11).
 */
@Injectable()
export class ProviderProfilesService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    private readonly verification: VerificationService,
    private readonly catalog: CatalogService,
    private readonly hours: HoursService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  /** The profile row, created empty on first use (that's the wizard's "start"). */
  private async profile(executor: Executor, organizationId: string): Promise<ProviderProfile> {
    await executor.insert(providerProfiles).values({ organizationId }).onConflictDoNothing();
    const [row] = await executor
      .select()
      .from(providerProfiles)
      .where(eq(providerProfiles.organizationId, organizationId));
    if (!row) throw new Error("provider profile missing after upsert");
    return row;
  }

  private async load(executor: Executor, organizationId: string) {
    const profile = await this.profile(executor, organizationId);
    const branchRows = await executor
      .select()
      .from(branches)
      .where(eq(branches.organizationId, organizationId))
      .orderBy(asc(branches.createdAt), asc(branches.id));
    const media = await executor
      .select()
      .from(providerMedia)
      .where(
        and(
          eq(providerMedia.organizationId, organizationId),
          eq(providerMedia.status, "available"),
        ),
      )
      .orderBy(asc(providerMedia.kind), asc(providerMedia.sortOrder), asc(providerMedia.createdAt));
    const offerings = await this.catalog.offerings(executor, organizationId);
    return { profile, branches: branchRows, media, offerings };
  }

  /** Branches complete enough to publish. */
  private publishable(profile: ProviderProfile, branchRows: readonly Branch[]): Branch[] {
    const categories = profile.categories as ProviderCategory[];
    return branchRows.filter(
      (b) => branchIssues(b, categories).length === 0 && b.location !== null,
    );
  }

  /** Per-step completeness for the wizard. Publishing requires every step complete. */
  steps(
    profile: ProviderProfile,
    branchRows: readonly Branch[],
    offerings: readonly OfferingDto[],
  ): WizardStep[] {
    const categories = profile.categories as ProviderCategory[];
    const result: Record<(typeof WIZARD_STEPS)[number], Issue[]> = {
      basics: [],
      categories: [],
      vehicles: [],
      contact: [],
      branches: [],
      catalog: [],
      hours: [],
      media: [],
    };
    if (!profile.slug) result.basics.push({ path: "slug", message: "Choose a profile address" });
    if (!profile.legalName || profile.legalName.length < 2)
      result.basics.push({ path: "legalName", message: "Legal name is required" });
    if (!profile.tradingName || profile.tradingName.length < 2)
      result.basics.push({ path: "tradingName", message: "Trading name is required" });

    if (categories.length === 0)
      result.categories.push({ path: "categories", message: "Choose at least one category" });
    for (const category of categories) {
      const parsed = CATEGORY_DETAIL_SCHEMAS[category].safeParse(
        profile.categoryDetails[category] ?? {},
      );
      if (!parsed.success) {
        for (const issue of parsed.error.issues) {
          result.categories.push({
            path: ["categoryDetails", category, ...issue.path.map(String)].join("."),
            message:
              issue.code === "invalid_type" && issue.input === undefined
                ? "Required"
                : issue.message,
          });
        }
      }
    }
    if (profile.vehicleTypes.length === 0)
      result.vehicles.push({ path: "vehicleTypes", message: "Choose at least one vehicle type" });
    if (!profile.contactPhone && !profile.contactEmail && !profile.website) {
      result.contact.push({ path: "contact", message: "Add a phone number, email or website" });
    }
    const branchProblems = branchRows.map((b) => branchIssues(b, categories));
    if (!branchProblems.some((issues) => issues.length === 0)) {
      result.branches.push(
        ...(branchRows.length === 0
          ? [{ path: "branches", message: "Add at least one branch with its location" }]
          : branchProblems.flat()),
      );
    }
    // The catalog is optional, but every offering must fit the rest of the profile.
    result.catalog.push(
      ...this.catalog.issues(offerings, profile, this.publishable(profile, branchRows)),
    );
    return WIZARD_STEPS.map((id) => ({
      id,
      complete: result[id].length === 0,
      issues: result[id],
    }));
  }

  private snapshot(
    profile: ProviderProfile,
    branchRows: readonly Branch[],
    media: readonly ProviderMedia[],
    offerings: readonly OfferingDto[],
  ): Snapshot {
    const categories = profile.categories as ProviderCategory[];
    const publishable = this.publishable(profile, branchRows);
    return {
      organizationId: profile.organizationId,
      slug: profile.slug ?? "",
      tradingName: profile.tradingName ?? "",
      legalName: profile.legalName ?? "",
      description: profile.description,
      categories,
      // Only details of chosen categories, normalised through the full schema when valid.
      categoryDetails: Object.fromEntries(
        categories.map((c) => {
          const parsed = CATEGORY_DETAIL_SCHEMAS[c].safeParse(profile.categoryDetails[c] ?? {});
          return [c, parsed.success ? parsed.data : (profile.categoryDetails[c] ?? {})];
        }),
      ),
      vehicleTypes: profile.vehicleTypes,
      contact: {
        phone: profile.contactPhone,
        email: profile.contactEmail,
        website: profile.website,
      },
      branches: publishable.map((b) => ({
        id: b.id,
        name: b.name,
        addressLine1: b.addressLine1,
        addressLine2: b.addressLine2,
        locality: b.locality,
        region: b.region,
        postalCode: b.postalCode,
        countryCode: b.countryCode,
        location: b.location ?? { lng: 0, lat: 0 },
        serviceRadiusKm: b.serviceRadiusKm,
        phone: b.phone,
      })),
      mediaIds: media.map((m) => m.id),
      offerings: this.catalog.snapshot(offerings, publishable),
    };
  }

  private toDto(
    profile: ProviderProfile,
    branchRows: readonly Branch[],
    media: readonly ProviderMedia[],
    offerings: readonly OfferingDto[],
  ): ProviderProfileDto {
    const steps = this.steps(profile, branchRows, offerings);
    const draft = this.snapshot(profile, branchRows, media, offerings);
    return {
      organizationId: profile.organizationId,
      status: profile.status,
      slug: profile.slug,
      legalName: profile.legalName,
      tradingName: profile.tradingName,
      description: profile.description,
      categories: profile.categories as ProviderCategory[],
      vehicleTypes: profile.vehicleTypes as ProviderProfileDto["vehicleTypes"],
      categoryDetails: profile.categoryDetails,
      contactPhone: profile.contactPhone,
      contactEmail: profile.contactEmail,
      website: profile.website,
      steps,
      canPublish: steps.every((s) => s.complete),
      hasUnpublishedChanges:
        profile.publishedSnapshot === null || stable(draft) !== stable(profile.publishedSnapshot),
      publishedAt: profile.publishedAt?.toISOString() ?? null,
      updatedAt: profile.updatedAt.toISOString(),
    };
  }

  // --- Draft (save and resume) ----------------------------------------------------------------

  async get(access: TenantAccess): Promise<ProviderProfileDto> {
    assertProvider(access);
    const {
      profile,
      branches: rows,
      media,
      offerings,
    } = await this.load(this.db, access.tenant.organizationId);
    return this.toDto(profile, rows, media, offerings);
  }

  async update(
    access: TenantAccess,
    actor: User,
    change: UpdateProviderProfileRequest,
  ): Promise<ProviderProfileDto> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    try {
      await this.db.transaction(async (tx) => {
        const current = await this.profile(tx, orgId);
        const details = { ...current.categoryDetails };
        // Each category's details object is replaced as a whole, so the wizard can clear fields.
        for (const [category, value] of Object.entries(change.categoryDetails ?? {})) {
          details[category] = value;
        }
        await tx
          .update(providerProfiles)
          .set({
            ...(change.slug === undefined ? {} : { slug: change.slug }),
            ...(change.legalName === undefined ? {} : { legalName: change.legalName }),
            ...(change.tradingName === undefined ? {} : { tradingName: change.tradingName }),
            ...(change.description === undefined ? {} : { description: change.description }),
            ...(change.categories === undefined
              ? {}
              : { categories: [...new Set(change.categories)] }),
            ...(change.vehicleTypes === undefined
              ? {}
              : { vehicleTypes: [...new Set(change.vehicleTypes)] }),
            ...(change.categoryDetails === undefined ? {} : { categoryDetails: details }),
            ...(change.contactPhone === undefined ? {} : { contactPhone: change.contactPhone }),
            ...(change.contactEmail === undefined ? {} : { contactEmail: change.contactEmail }),
            ...(change.website === undefined ? {} : { website: change.website }),
          })
          .where(eq(providerProfiles.organizationId, orgId));
        await this.audit(tx, actor, orgId, "provider_profile.draft_saved", {
          fields: Object.keys(change),
        });
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes("provider_profiles_slug_key")
      ) {
        throw providerError(409, "slug_taken");
      }
      throw error;
    }
    return this.get(access);
  }

  async updateBranchLocation(
    access: TenantAccess,
    actor: User,
    branchId: string,
    change: BranchLocation,
  ): Promise<BranchDto> {
    assertProvider(access);
    const [row] = await this.db
      .update(branches)
      .set({
        ...(change.addressLine1 === undefined ? {} : { addressLine1: change.addressLine1 }),
        ...(change.addressLine2 === undefined ? {} : { addressLine2: change.addressLine2 }),
        ...(change.locality === undefined ? {} : { locality: change.locality }),
        ...(change.region === undefined ? {} : { region: change.region }),
        ...(change.postalCode === undefined ? {} : { postalCode: change.postalCode }),
        ...(change.countryCode === undefined ? {} : { countryCode: change.countryCode }),
        ...(change.location === undefined ? {} : { location: change.location }),
        ...(change.serviceRadiusKm === undefined
          ? {}
          : { serviceRadiusKm: change.serviceRadiusKm }),
        ...(change.phone === undefined ? {} : { phone: change.phone }),
      })
      .where(
        and(eq(branches.organizationId, access.tenant.organizationId), eq(branches.id, branchId)),
      )
      .returning();
    if (!row) throw notFound();
    await this.audit(
      this.db,
      actor,
      access.tenant.organizationId,
      "provider_profile.branch_location_saved",
      {
        branchId,
        fields: Object.keys(change),
      },
    );
    return {
      id: row.id,
      organizationId: row.organizationId,
      name: row.name,
      addressLine1: row.addressLine1,
      addressLine2: row.addressLine2,
      locality: row.locality,
      region: row.region,
      postalCode: row.postalCode,
      countryCode: row.countryCode,
      location: row.location,
      serviceRadiusKm: row.serviceRadiusKm,
      phone: row.phone,
      createdAt: row.createdAt.toISOString(),
    };
  }

  // --- Publication ------------------------------------------------------------------------------

  /** Publishes the draft as an immutable snapshot. 422 profile_incomplete lists what's missing. */
  async publish(access: TenantAccess, actor: User): Promise<ProviderProfileDto> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      await tx
        .select({ id: organizations.id })
        .from(organizations)
        .where(eq(organizations.id, orgId))
        .for("update");
      const { profile, branches: rows, media, offerings } = await this.load(tx, orgId);
      const steps = this.steps(profile, rows, offerings);
      const issues = steps.flatMap((s) => s.issues);
      if (issues.length > 0) throw providerError(422, "profile_incomplete", { issues });
      const snapshot = this.snapshot(profile, rows, media, offerings);
      await tx
        .update(providerProfiles)
        .set({
          status: "published",
          publishedSnapshot: snapshot as unknown as Record<string, unknown>,
          publishedAt: new Date(),
          publishedBy: actor.id,
        })
        .where(eq(providerProfiles.organizationId, orgId));
      await this.audit(tx, actor, orgId, "provider_profile.published", {
        slug: snapshot.slug,
        branches: snapshot.branches.length,
        offerings: snapshot.offerings?.length ?? 0,
      });
    });
    return this.get(access);
  }

  async unpublish(access: TenantAccess, actor: User): Promise<ProviderProfileDto> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    await this.db.transaction(async (tx) => {
      const profile = await this.profile(tx, orgId);
      if (profile.status !== "published") return;
      await tx
        .update(providerProfiles)
        .set({ status: "hidden" })
        .where(eq(providerProfiles.organizationId, orgId));
      await this.audit(tx, actor, orgId, "provider_profile.unpublished");
    });
    return this.get(access);
  }

  /** What the public would see if the draft were published now, for both audiences. */
  async preview(
    access: TenantAccess,
  ): Promise<{ visitor: PublicProviderProfile; signedIn: PublicProviderProfile; issues: Issue[] }> {
    assertProvider(access);
    const {
      profile,
      branches: rows,
      media,
      offerings,
    } = await this.load(this.db, access.tenant.organizationId);
    const snapshot = this.snapshot(profile, rows, media, offerings);
    const now = new Date();
    return {
      visitor: await this.present(snapshot, now, false, access.organization.timezone),
      signedIn: await this.present(snapshot, now, true, access.organization.timezone),
      issues: this.steps(profile, rows, offerings).flatMap((s) => s.issues),
    };
  }

  /** The published profile. Visitors get approximate locations and no contact details (OQ-11). */
  async getPublic(slug: string, signedIn: boolean): Promise<PublicProviderProfile> {
    const [row] = await this.db
      .select({ profile: providerProfiles, org: organizations })
      .from(providerProfiles)
      .innerJoin(organizations, eq(organizations.id, providerProfiles.organizationId))
      .where(eq(providerProfiles.slug, slug.toLowerCase()))
      .limit(1);
    if (
      row?.profile.status !== "published" ||
      row.org.status !== "active" ||
      !row.profile.publishedSnapshot ||
      !row.profile.publishedAt
    ) {
      throw notFound();
    }
    return this.present(
      row.profile.publishedSnapshot as unknown as Snapshot,
      row.profile.publishedAt,
      signedIn,
      row.org.timezone,
    );
  }

  private async present(
    snapshot: Snapshot,
    publishedAt: Date,
    signedIn: boolean,
    organizationTimeZone: string,
  ): Promise<PublicProviderProfile> {
    // Hours and timezones are live, read from the branches named in the snapshot.
    const branchIds = snapshot.branches.map((b) => b.id);
    const liveBranches = branchIds.length
      ? await this.db
          .select()
          .from(branches)
          .where(
            and(
              eq(branches.organizationId, snapshot.organizationId),
              inArray(branches.id, branchIds),
            ),
          )
      : [];
    const schedules = await this.hours.schedules(organizationTimeZone, liveBranches);
    // Media is resolved live so removed images disappear immediately.
    const media = snapshot.mediaIds.length
      ? await this.db
          .select()
          .from(providerMedia)
          .where(
            and(
              inArray(providerMedia.id, snapshot.mediaIds),
              eq(providerMedia.status, "available"),
            ),
          )
          .orderBy(asc(providerMedia.kind), asc(providerMedia.sortOrder))
      : [];
    const labels = await this.verification.labels({
      type: "organization",
      id: snapshot.organizationId,
    });
    const round = (n: number) => Math.round(n * 100) / 100; // ~1 km
    return {
      organizationId: snapshot.organizationId,
      slug: snapshot.slug,
      tradingName: snapshot.tradingName,
      legalName: snapshot.legalName,
      description: snapshot.description,
      categories: snapshot.categories,
      categoryDetails: snapshot.categoryDetails,
      vehicleTypes: snapshot.vehicleTypes as PublicProviderProfile["vehicleTypes"],
      contact: signedIn ? snapshot.contact : null,
      branches: snapshot.branches.map((b) => {
        const schedule = schedules.get(b.id) ?? {
          timeZone: organizationTimeZone,
          weekly: null,
          exceptions: [],
        };
        return {
          ...b,
          timeZone: schedule.timeZone,
          hours: this.hours.present(schedule),
          addressLine1: signedIn ? b.addressLine1 : null,
          addressLine2: signedIn ? b.addressLine2 : null,
          postalCode: signedIn ? b.postalCode : null,
          phone: signedIn ? b.phone : null,
          location: signedIn
            ? { ...b.location, approximate: false }
            : { lng: round(b.location.lng), lat: round(b.location.lat), approximate: true },
        };
      }),
      catalog: {
        disclaimer: INDICATIVE_PRICE_DISCLAIMER,
        offerings: this.catalog.present(snapshot.offerings ?? []),
      },
      media: media
        .filter((m) => m.storageKey !== null)
        .map((m) => ({
          id: m.id,
          kind: m.kind,
          url: this.storage.publicUrl(m.storageKey ?? ""),
          altText: m.altText,
        })),
      verification: labels.labels,
      publishedAt: publishedAt.toISOString(),
    };
  }

  // --- Media --------------------------------------------------------------------------------------

  async addMedia(
    access: TenantAccess,
    actor: User,
    input: {
      kind: "logo" | "cover" | "gallery";
      contentType: string;
      size: number;
      altText: string | null;
    },
  ) {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    const row = await this.db.transaction(async (tx) => {
      if (input.kind === "gallery") {
        const existing = await tx
          .select({ id: providerMedia.id })
          .from(providerMedia)
          .where(
            and(
              eq(providerMedia.organizationId, orgId),
              eq(providerMedia.kind, "gallery"),
              inArray(providerMedia.status, ["pending_upload", "available"]),
            ),
          );
        if (existing.length >= MAX_GALLERY_IMAGES) throw providerError(409, "too_many_images");
      }
      const [inserted] = await tx
        .insert(providerMedia)
        .values({
          organizationId: orgId,
          kind: input.kind,
          declaredContentType: input.contentType,
          declaredSize: input.size,
          altText: input.altText,
          quarantineKey: `uploads/${randomUUID()}`,
          uploadedBy: actor.id,
        })
        .returning();
      if (!inserted) throw new Error("media insert returned no row");
      return inserted;
    });
    const upload = await this.storage.createUploadUrl("quarantine", row.quarantineKey, {
      contentType: input.contentType,
      maxBytes: input.size,
      expiresInSeconds: 15 * 60,
    });
    return { mediaId: row.id, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
  }

  /** Checks, scans and strips metadata, then publishes the image. Logo/cover replace the old one. */
  async completeMedia(
    access: TenantAccess,
    actor: User,
    mediaId: string,
  ): Promise<{ id: string; url: string }> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    const [media] = await this.db
      .select()
      .from(providerMedia)
      .where(and(eq(providerMedia.id, mediaId), eq(providerMedia.organizationId, orgId)))
      .limit(1);
    if (!media) throw notFound();
    if (media.status === "available" && media.storageKey) {
      return { id: media.id, url: this.storage.publicUrl(media.storageKey) };
    }
    if (media.status !== "pending_upload") throw notFound();

    const reject = async (reason: string, error: ProviderErrorReason) => {
      await this.storage.delete("quarantine", media.quarantineKey);
      await this.db
        .update(providerMedia)
        .set({ status: "rejected", rejectionReason: reason })
        .where(eq(providerMedia.id, media.id));
      return providerError(400, error);
    };
    const info = await this.storage.head("quarantine", media.quarantineKey);
    if (!info) throw providerError(409, "upload_missing");
    if (info.size !== media.declaredSize)
      throw await reject("size_mismatch", "upload_size_mismatch");
    const data = await this.storage.read("quarantine", media.quarantineKey);
    if (sniffContentType(data) !== media.declaredContentType)
      throw await reject("type_mismatch", "content_type_mismatch");
    const scan = await this.scanner.scan(data);
    if (!scan.clean) throw await reject(`infected:${scan.signature}`, "malware_detected");
    let clean: Buffer;
    try {
      clean = stripImageMetadata(data, media.declaredContentType);
    } catch {
      throw await reject("malformed_image", "content_type_mismatch");
    }

    const storageKey = `media/${media.id}.${EXTENSIONS[media.declaredContentType] ?? "bin"}`;
    await this.storage.write("public_media", storageKey, clean, media.declaredContentType);
    await this.storage.delete("quarantine", media.quarantineKey);
    const replaced = await this.db.transaction(async (tx) => {
      const previous =
        media.kind === "gallery"
          ? []
          : await tx
              .update(providerMedia)
              .set({ status: "removed" })
              .where(
                and(
                  eq(providerMedia.organizationId, orgId),
                  eq(providerMedia.kind, media.kind),
                  eq(providerMedia.status, "available"),
                ),
              )
              .returning();
      await tx
        .update(providerMedia)
        .set({
          status: "available",
          storageKey,
          contentType: media.declaredContentType,
          size: clean.length,
          availableAt: new Date(),
        })
        .where(eq(providerMedia.id, media.id));
      await this.audit(tx, actor, orgId, "provider_profile.media_added", {
        mediaId: media.id,
        kind: media.kind,
      });
      return previous;
    });
    for (const old of replaced) {
      if (old.storageKey) await this.storage.delete("public_media", old.storageKey);
    }
    return { id: media.id, url: this.storage.publicUrl(storageKey) };
  }

  async removeMedia(access: TenantAccess, actor: User, mediaId: string): Promise<void> {
    assertProvider(access);
    const orgId = access.tenant.organizationId;
    const [row] = await this.db
      .update(providerMedia)
      .set({ status: "removed" })
      .where(
        and(
          eq(providerMedia.id, mediaId),
          eq(providerMedia.organizationId, orgId),
          inArray(providerMedia.status, ["pending_upload", "available"]),
        ),
      )
      .returning();
    if (!row) throw notFound();
    if (row.storageKey) await this.storage.delete("public_media", row.storageKey);
    await this.storage.delete("quarantine", row.quarantineKey);
    await this.audit(this.db, actor, orgId, "provider_profile.media_removed", { mediaId });
  }

  private async audit(
    executor: Executor,
    actor: User,
    organizationId: string,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId,
      action,
      targetType: "provider_profile",
      targetId: organizationId,
      requestId: requestId(),
      metadata,
    });
  }
}

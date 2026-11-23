import { createHash, randomBytes, randomUUID } from "node:crypto";

import {
  and,
  type Database,
  desc,
  eq,
  recordAuditEvent,
  type User,
  type VehicleDocument,
  vehicleDocuments,
  type VehicleDocumentShare,
  vehicleDocumentShares,
  vehicles,
} from "@fleettrust/db";
import {
  type CreatedDocumentShare,
  type createDocumentShareSchema,
  type createVehicleDocumentSchema,
  DOCUMENT_EXPIRY_NOTICE_DAYS,
  type DocumentShareDto,
  type updateVehicleDocumentSchema,
  type VehicleDocumentDto,
  type VehicleErrorReason,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import {
  decryptBlob,
  encryptBlob,
  KEY_WRAPPER,
  type KeyWrapper,
} from "../../platform/crypto/envelope.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { stripImageMetadata } from "../../platform/scanning/image-metadata.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { daysBetween, notFound, vehicleError } from "./shared.js";
import { type VehicleAccess, VehiclesService } from "./vehicles.service.js";

type CreateInput = z.output<typeof createVehicleDocumentSchema>;
type UpdateInput = z.output<typeof updateVehicleDocumentSchema>;
type ShareInput = z.output<typeof createDocumentShareSchema>;

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Private vehicle document vault (F-074, ADR-0026). Same protection as verification documents
 * (ADR-0016): quarantine, type check, malware scan, image metadata stripping, AES-256-GCM
 * envelope encryption (Cloud KMS when deployed) and the sensitive bucket. Drivers see only the
 * documents marked visible to them. Share links expire, have a view limit, can be revoked, and
 * store only a hash of the token. Every download is audited.
 */
@Injectable()
export class VehicleDocumentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    private readonly vehiclesService: VehiclesService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async document(access: VehicleAccess, documentId: string): Promise<VehicleDocument> {
    const [row] = await this.db
      .select()
      .from(vehicleDocuments)
      .where(
        and(eq(vehicleDocuments.id, documentId), eq(vehicleDocuments.vehicleId, access.vehicle.id)),
      );
    // Drivers only reach documents shared with drivers.
    if (!row || (access.role === "driver" && !row.driverVisible)) throw notFound();
    return row;
  }

  async list(user: User, vehicleId: string): Promise<VehicleDocumentDto[]> {
    const access = await this.vehiclesService.require(user, vehicleId);
    const rows = await this.db
      .select()
      .from(vehicleDocuments)
      .where(
        and(
          eq(vehicleDocuments.vehicleId, vehicleId),
          access.role === "driver" ? eq(vehicleDocuments.driverVisible, true) : undefined,
        ),
      )
      .orderBy(desc(vehicleDocuments.createdAt));
    return rows
      .filter((r) => r.status !== "rejected" || access.role !== "driver")
      .map((r) => this.dto(r));
  }

  async create(user: User, vehicleId: string, input: CreateInput) {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    if (access.vehicle.status !== "active") throw vehicleError(409, "vehicle_archived");
    const [row] = await this.db
      .insert(vehicleDocuments)
      .values({
        vehicleId,
        kind: input.kind,
        title: input.title,
        expiresOn: input.expiresOn,
        driverVisible: input.driverVisible,
        declaredContentType: input.contentType,
        declaredSize: input.size,
        quarantineKey: `uploads/${randomUUID()}`,
        uploadedBy: user.id,
      })
      .returning();
    if (!row) throw new Error("document insert returned no row");
    const upload = await this.storage.createUploadUrl("quarantine", row.quarantineKey, {
      contentType: input.contentType,
      maxBytes: input.size,
      expiresInSeconds: 15 * 60,
    });
    return {
      document: this.dto(row),
      upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
    };
  }

  async complete(user: User, vehicleId: string, documentId: string): Promise<VehicleDocumentDto> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    if (row.status === "available") return this.dto(row);
    if (row.status !== "pending_upload") throw notFound();
    const reject = async (reason: string, error: VehicleErrorReason) => {
      await this.storage.delete("quarantine", row.quarantineKey);
      await this.db
        .update(vehicleDocuments)
        .set({ status: "rejected", rejectionReason: reason })
        .where(eq(vehicleDocuments.id, row.id));
      return vehicleError(400, error);
    };
    const info = await this.storage.head("quarantine", row.quarantineKey);
    if (!info) throw vehicleError(409, "upload_missing");
    if (info.size !== row.declaredSize) throw await reject("size_mismatch", "upload_size_mismatch");
    let data = await this.storage.read("quarantine", row.quarantineKey);
    if (sniffContentType(data) !== row.declaredContentType)
      throw await reject("type_mismatch", "content_type_mismatch");
    const scan = await this.scanner.scan(data);
    if (!scan.clean) throw await reject(`infected:${scan.signature}`, "malware_detected");
    if (row.declaredContentType.startsWith("image/")) {
      try {
        data = stripImageMetadata(data, row.declaredContentType);
      } catch {
        throw await reject("malformed_image", "content_type_mismatch");
      }
    }
    const encrypted = await encryptBlob(this.keys, data, row.id);
    const storageKey = `vehicle-documents/${row.id}`;
    await this.storage.write(
      "sensitive",
      storageKey,
      encrypted.ciphertext,
      "application/octet-stream",
    );
    await this.storage.delete("quarantine", row.quarantineKey);
    const [updated] = await this.db
      .update(vehicleDocuments)
      .set({
        status: "available",
        storageKey,
        contentType: row.declaredContentType,
        size: data.length,
        sha256: createHash("sha256").update(data).digest("hex"),
        wrappedKey: encrypted.wrappedKey.toString("base64"),
        iv: encrypted.iv.toString("base64"),
        authTag: encrypted.authTag.toString("base64"),
        keyId: encrypted.keyId,
      })
      .where(eq(vehicleDocuments.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_added", {
      documentId: row.id,
      kind: row.kind,
    });
    return this.dto(updated);
  }

  async update(
    user: User,
    vehicleId: string,
    documentId: string,
    change: UpdateInput,
  ): Promise<VehicleDocumentDto> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    const [updated] = await this.db
      .update(vehicleDocuments)
      .set({ ...change, ...(change.expiresOn === undefined ? {} : { expiryRemindedFor: null }) })
      .where(eq(vehicleDocuments.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_updated", {
      documentId: row.id,
      fields: Object.keys(change),
    });
    return this.dto(updated);
  }

  async remove(user: User, vehicleId: string, documentId: string): Promise<void> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    if (row.storageKey !== null) await this.storage.delete("sensitive", row.storageKey);
    await this.db.delete(vehicleDocuments).where(eq(vehicleDocuments.id, row.id));
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_deleted", {
      documentId: row.id,
    });
  }

  private async decrypt(row: VehicleDocument): Promise<{ data: Buffer; contentType: string }> {
    if (
      row.status !== "available" ||
      !row.storageKey ||
      !row.wrappedKey ||
      !row.iv ||
      !row.authTag ||
      !row.contentType
    ) {
      throw notFound();
    }
    const ciphertext = await this.storage.read("sensitive", row.storageKey);
    const data = await decryptBlob(
      this.keys,
      {
        ciphertext,
        wrappedKey: Buffer.from(row.wrappedKey, "base64"),
        iv: Buffer.from(row.iv, "base64"),
        authTag: Buffer.from(row.authTag, "base64"),
      },
      row.id,
    );
    return { data, contentType: row.contentType };
  }

  async download(user: User, vehicleId: string, documentId: string) {
    const access = await this.vehiclesService.require(user, vehicleId);
    const row = await this.document(access, documentId);
    const file = await this.decrypt(row);
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_downloaded", {
      documentId: row.id,
      role: access.role,
    });
    return file;
  }

  // -------------------------------------------------------------------------------------------
  // Controlled sharing
  // -------------------------------------------------------------------------------------------

  async createShare(
    user: User,
    vehicleId: string,
    documentId: string,
    input: ShareInput,
  ): Promise<CreatedDocumentShare> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    if (row.status !== "available") throw vehicleError(400, "document_not_ready");
    const token = randomBytes(32).toString("base64url");
    const [share] = await this.db
      .insert(vehicleDocumentShares)
      .values({
        documentId: row.id,
        tokenHash: hashToken(token),
        label: input.label,
        expiresAt: new Date(this.clock.now().getTime() + input.expiresInHours * 3_600_000),
        maxViews: input.maxViews,
        createdBy: user.id,
      })
      .returning();
    if (!share) throw new Error("share insert returned no row");
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_shared", {
      documentId: row.id,
      shareId: share.id,
      label: input.label,
      expiresInHours: input.expiresInHours,
      maxViews: input.maxViews,
    });
    return { ...this.shareDto(share), token, path: `/v1/shared-documents/${token}` };
  }

  async shares(user: User, vehicleId: string, documentId: string): Promise<DocumentShareDto[]> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    const rows = await this.db
      .select()
      .from(vehicleDocumentShares)
      .where(eq(vehicleDocumentShares.documentId, row.id))
      .orderBy(desc(vehicleDocumentShares.createdAt));
    return rows.map((s) => this.shareDto(s));
  }

  async revokeShare(
    user: User,
    vehicleId: string,
    documentId: string,
    shareId: string,
  ): Promise<void> {
    const access = await this.vehiclesService.require(user, vehicleId, ["owner", "manager"]);
    const row = await this.document(access, documentId);
    const revoked = await this.db
      .update(vehicleDocumentShares)
      .set({ revokedAt: this.clock.now() })
      .where(
        and(eq(vehicleDocumentShares.id, shareId), eq(vehicleDocumentShares.documentId, row.id)),
      )
      .returning({ id: vehicleDocumentShares.id });
    if (revoked.length === 0) throw notFound();
    await this.vehiclesService.audit(this.db, user, access.vehicle, "document_share_revoked", {
      documentId: row.id,
      shareId,
    });
  }

  /** Public: anyone with a valid link, within its time and view limits. Every view is audited. */
  async openShare(token: string): Promise<{ data: Buffer; contentType: string }> {
    const result = await this.db.transaction(async (tx) => {
      const [share] = await tx
        .select()
        .from(vehicleDocumentShares)
        .where(eq(vehicleDocumentShares.tokenHash, hashToken(token)))
        .for("update");
      if (
        share?.revokedAt !== null ||
        share.expiresAt <= this.clock.now() ||
        share.views >= share.maxViews
      ) {
        throw notFound();
      }
      const [doc] = await tx
        .select()
        .from(vehicleDocuments)
        .where(eq(vehicleDocuments.id, share.documentId));
      if (!doc) throw notFound();
      const [vehicle] = await tx.select().from(vehicles).where(eq(vehicles.id, doc.vehicleId));
      if (vehicle?.status !== "active") throw notFound();
      await tx
        .update(vehicleDocumentShares)
        .set({ views: share.views + 1 })
        .where(eq(vehicleDocumentShares.id, share.id));
      await recordAuditEvent(tx, {
        actorType: "system",
        organizationId: vehicle.organizationId,
        action: "vehicle.document_share_opened",
        targetType: "vehicle",
        targetId: vehicle.id,
        requestId: currentRequestContext()?.requestId,
        metadata: {
          documentId: doc.id,
          shareId: share.id,
          label: share.label,
          view: share.views + 1,
        },
      });
      return doc;
    });
    return this.decrypt(result);
  }

  private dto(row: VehicleDocument): VehicleDocumentDto {
    const today = this.clock.now().toISOString().slice(0, 10);
    return {
      id: row.id,
      vehicleId: row.vehicleId,
      kind: row.kind,
      title: row.title,
      expiresOn: row.expiresOn,
      expiring:
        row.expiresOn !== null && daysBetween(today, row.expiresOn) <= DOCUMENT_EXPIRY_NOTICE_DAYS,
      driverVisible: row.driverVisible,
      status: row.status,
      contentType: row.contentType,
      size: row.size,
      createdAt: row.createdAt.toISOString(),
    };
  }

  private shareDto(share: VehicleDocumentShare): DocumentShareDto {
    return {
      id: share.id,
      documentId: share.documentId,
      label: share.label,
      expiresAt: share.expiresAt.toISOString(),
      maxViews: share.maxViews,
      views: share.views,
      revoked: share.revokedAt !== null,
      createdAt: share.createdAt.toISOString(),
    };
  }
}

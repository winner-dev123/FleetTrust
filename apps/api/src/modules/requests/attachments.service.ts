import { randomUUID } from "node:crypto";

import {
  and,
  type Database,
  eq,
  type ServiceRequestAttachment,
  serviceRequestAttachments,
  type User,
} from "@fleettrust/db";
import type { RequestErrorReason } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { stripImageMetadata } from "../../platform/scanning/image-metadata.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { notFound, requestError } from "./shared.js";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Private request photos and evidence (ADR-0021). Same pipeline as profile images (ADR-0006):
 * quarantine, size and type check, malware scan, metadata stripping (removes GPS), then the
 * private sensitive bucket. Never public; downloads go through an access check.
 */
@Injectable()
export class AttachmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async create(actor: User, input: { contentType: string; size: number }) {
    const [row] = await this.db
      .insert(serviceRequestAttachments)
      .values({
        uploadedBy: actor.id,
        declaredContentType: input.contentType,
        declaredSize: input.size,
        quarantineKey: `uploads/${randomUUID()}`,
      })
      .returning();
    if (!row) throw new Error("attachment insert returned no row");
    const upload = await this.storage.createUploadUrl("quarantine", row.quarantineKey, {
      contentType: input.contentType,
      maxBytes: input.size,
      expiresInSeconds: 15 * 60,
    });
    return {
      attachmentId: row.id,
      upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
    };
  }

  async complete(actor: User, attachmentId: string): Promise<{ id: string; status: "available" }> {
    const [row] = await this.db
      .select()
      .from(serviceRequestAttachments)
      .where(
        and(
          eq(serviceRequestAttachments.id, attachmentId),
          eq(serviceRequestAttachments.uploadedBy, actor.id),
        ),
      );
    if (!row) throw notFound();
    if (row.status === "available") return { id: row.id, status: "available" };
    if (row.status !== "pending_upload") throw notFound();

    const reject = async (reason: string, error: RequestErrorReason) => {
      await this.storage.delete("quarantine", row.quarantineKey);
      await this.db
        .update(serviceRequestAttachments)
        .set({ status: "rejected", rejectionReason: reason })
        .where(eq(serviceRequestAttachments.id, row.id));
      return requestError(400, error);
    };
    const info = await this.storage.head("quarantine", row.quarantineKey);
    if (!info) throw requestError(409, "upload_missing");
    if (info.size !== row.declaredSize) throw await reject("size_mismatch", "upload_size_mismatch");
    const data = await this.storage.read("quarantine", row.quarantineKey);
    if (sniffContentType(data) !== row.declaredContentType) {
      throw await reject("type_mismatch", "content_type_mismatch");
    }
    const scan = await this.scanner.scan(data);
    if (!scan.clean) throw await reject(`infected:${scan.signature}`, "malware_detected");
    let clean: Buffer;
    try {
      clean = stripImageMetadata(data, row.declaredContentType);
    } catch {
      throw await reject("malformed_image", "content_type_mismatch");
    }
    const storageKey = `request-photos/${row.id}.${EXTENSIONS[row.declaredContentType] ?? "bin"}`;
    await this.storage.write("sensitive", storageKey, clean, row.declaredContentType);
    await this.storage.delete("quarantine", row.quarantineKey);
    await this.db
      .update(serviceRequestAttachments)
      .set({ status: "available", storageKey, contentType: row.declaredContentType })
      .where(eq(serviceRequestAttachments.id, row.id));
    return { id: row.id, status: "available" };
  }

  /** Bytes of an attachment the caller has already been authorised to see. */
  async read(attachment: ServiceRequestAttachment): Promise<{ data: Buffer; contentType: string }> {
    if (attachment.status !== "available" || !attachment.storageKey || !attachment.contentType) {
      throw notFound();
    }
    return {
      data: await this.storage.read("sensitive", attachment.storageKey),
      contentType: attachment.contentType,
    };
  }
}

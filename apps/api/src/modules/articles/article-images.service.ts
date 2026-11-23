import { randomUUID } from "node:crypto";

import { and, articleImages, type Database, eq, type User } from "@fleettrust/db";
import type { ArticleErrorReason } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { stripImageMetadata } from "../../platform/scanning/image-metadata.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { articleError, notFound } from "./shared.js";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

/**
 * Article images (ADR-0022). Same pipeline as profile images (ADR-0006): quarantine, size and
 * type check, malware scan, metadata stripping (removes GPS), then the public media bucket under
 * an unguessable key. Only processed images can be referenced from an article.
 */
@Injectable()
export class ArticleImagesService {
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
      .insert(articleImages)
      .values({
        uploadedBy: actor.id,
        declaredContentType: input.contentType,
        declaredSize: input.size,
        quarantineKey: `uploads/${randomUUID()}`,
      })
      .returning();
    if (!row) throw new Error("article image insert returned no row");
    const upload = await this.storage.createUploadUrl("quarantine", row.quarantineKey, {
      contentType: input.contentType,
      maxBytes: input.size,
      expiresInSeconds: 15 * 60,
    });
    return { imageId: row.id, upload: { ...upload, expiresAt: upload.expiresAt.toISOString() } };
  }

  async complete(actor: User, imageId: string): Promise<{ id: string; url: string }> {
    const [row] = await this.db
      .select()
      .from(articleImages)
      .where(and(eq(articleImages.id, imageId), eq(articleImages.uploadedBy, actor.id)));
    if (!row) throw notFound();
    if (row.status === "available" && row.storageKey) {
      return { id: row.id, url: this.storage.publicUrl(row.storageKey) };
    }
    if (row.status !== "pending_upload") throw notFound();

    const reject = async (reason: string, error: ArticleErrorReason) => {
      await this.storage.delete("quarantine", row.quarantineKey);
      await this.db
        .update(articleImages)
        .set({ status: "rejected", rejectionReason: reason })
        .where(eq(articleImages.id, row.id));
      return articleError(400, error);
    };
    const info = await this.storage.head("quarantine", row.quarantineKey);
    if (!info) throw articleError(409, "upload_missing");
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
    const storageKey = `article-images/${randomUUID()}.${EXTENSIONS[row.declaredContentType] ?? "bin"}`;
    await this.storage.write("public_media", storageKey, clean, row.declaredContentType);
    await this.storage.delete("quarantine", row.quarantineKey);
    await this.db
      .update(articleImages)
      .set({ status: "available", storageKey, contentType: row.declaredContentType })
      .where(eq(articleImages.id, row.id));
    return { id: row.id, url: this.storage.publicUrl(storageKey) };
  }
}

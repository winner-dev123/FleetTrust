import { randomUUID } from "node:crypto";

import { and, type Database, eq, messageAttachments, messages, type User } from "@fleettrust/db";
import type { MessagingErrorReason } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { stripImageMetadata } from "../../platform/scanning/image-metadata.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import {
  KEY_WRAPPER,
  type KeyWrapper,
  openFile,
  sealFile,
} from "../../platform/crypto/envelope.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { MessagingService, messagingError, notFound } from "./messaging.service.js";

const EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "application/pdf": "pdf",
};

/**
 * Message attachments (ADR-0024). Uploaded into one conversation by someone who may send there,
 * then processed like other private uploads: quarantine, size and type check, malware scan,
 * image metadata stripping (removes GPS), then the private sensitive bucket. Downloads check
 * conversation access every time.
 */
@Injectable()
export class MessageAttachmentsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    private readonly messaging: MessagingService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async create(user: User, conversationId: string, input: { contentType: string; size: number }) {
    const access = await this.messaging.requireAccess(user, conversationId);
    if (access.readOnly === "cannot_message") throw messagingError(403, "cannot_message");
    if (access.readOnly !== null) throw messagingError(409, access.readOnly);
    const [row] = await this.db
      .insert(messageAttachments)
      .values({
        conversationId,
        uploadedBy: user.id,
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

  async complete(
    user: User,
    conversationId: string,
    attachmentId: string,
  ): Promise<{ id: string; status: "available" }> {
    const [row] = await this.db
      .select()
      .from(messageAttachments)
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
          eq(messageAttachments.uploadedBy, user.id),
        ),
      );
    if (!row) throw notFound();
    if (row.status === "available") return { id: row.id, status: "available" };
    if (row.status !== "pending_upload") throw notFound();

    const reject = async (reason: string, error: MessagingErrorReason) => {
      await this.storage.delete("quarantine", row.quarantineKey);
      await this.db
        .update(messageAttachments)
        .set({ status: "rejected", rejectionReason: reason })
        .where(eq(messageAttachments.id, row.id));
      return messagingError(400, error);
    };
    const info = await this.storage.head("quarantine", row.quarantineKey);
    if (!info) throw messagingError(409, "upload_missing");
    if (info.size !== row.declaredSize) throw await reject("size_mismatch", "upload_size_mismatch");
    const data = await this.storage.read("quarantine", row.quarantineKey);
    if (sniffContentType(data) !== row.declaredContentType) {
      throw await reject("type_mismatch", "content_type_mismatch");
    }
    const scan = await this.scanner.scan(data);
    if (!scan.clean) throw await reject(`infected:${scan.signature}`, "malware_detected");
    let clean = data;
    if (row.declaredContentType.startsWith("image/")) {
      try {
        clean = stripImageMetadata(data, row.declaredContentType);
      } catch {
        throw await reject("malformed_image", "content_type_mismatch");
      }
    }
    const storageKey = `message-attachments/${row.id}.${EXTENSIONS[row.declaredContentType] ?? "bin"}`;
    // Encrypted at rest with a per-file key (Prompt 27); the type is kept on the row.
    const sealed = await sealFile(this.keys, clean, row.id);
    await this.storage.write(
      "sensitive",
      storageKey,
      sealed.ciphertext,
      "application/octet-stream",
    );
    await this.storage.delete("quarantine", row.quarantineKey);
    await this.db
      .update(messageAttachments)
      .set({
        status: "available",
        storageKey,
        contentType: row.declaredContentType,
        size: clean.length,
        ...sealed.columns,
      })
      .where(eq(messageAttachments.id, row.id));
    return { id: row.id, status: "available" };
  }

  /**
   * Bytes for someone who can read the conversation now. The attachment must belong to a
   * visible message (or be the caller's own upload that isn't sent yet).
   */
  async read(
    user: User,
    conversationId: string,
    attachmentId: string,
  ): Promise<{ data: Buffer; contentType: string }> {
    await this.messaging.requireAccess(user, conversationId);
    const [row] = await this.db
      .select({ attachment: messageAttachments, status: messages.status })
      .from(messageAttachments)
      .leftJoin(messages, eq(messages.id, messageAttachments.messageId))
      .where(
        and(
          eq(messageAttachments.id, attachmentId),
          eq(messageAttachments.conversationId, conversationId),
        ),
      );
    if (!row) throw notFound();
    const { attachment } = row;
    const sentAndVisible = attachment.messageId !== null && row.status === "visible";
    const ownUnsent = attachment.messageId === null && attachment.uploadedBy === user.id;
    if (
      (!sentAndVisible && !ownUnsent) ||
      attachment.status !== "available" ||
      attachment.storageKey === null ||
      attachment.contentType === null
    ) {
      throw notFound();
    }
    return {
      data: await openFile(
        this.keys,
        await this.storage.read("sensitive", attachment.storageKey),
        attachment,
        attachment.id,
      ),
      contentType: attachment.contentType,
    };
  }
}

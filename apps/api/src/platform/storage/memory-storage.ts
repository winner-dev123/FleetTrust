import { randomBytes } from "node:crypto";

import type { BucketClass, ObjectInfo, ObjectStorage, UploadUrl } from "./object-storage.js";

interface PendingUpload {
  bucket: BucketClass;
  key: string;
  contentType: string;
  maxBytes: number;
  expiresAt: Date;
}

/**
 * In-process object storage for local development and tests (refused in deployed
 * environments). Upload URLs point at the API's local-only `PUT /v1/local-storage/:token`
 * route, which enforces the same constraints a V4 signed URL would: one use, exact content
 * type, size limit, expiry.
 */
export class MemoryObjectStorage implements ObjectStorage {
  private readonly objects = new Map<string, { data: Buffer; contentType: string }>();
  private readonly uploads = new Map<string, PendingUpload>();

  constructor(private readonly publicApiUrl: string) {}

  private static id(bucket: BucketClass, key: string): string {
    return `${bucket}/${key}`;
  }

  createUploadUrl(
    bucket: BucketClass,
    key: string,
    options: { contentType: string; maxBytes: number; expiresInSeconds: number },
  ): Promise<UploadUrl> {
    const token = randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + options.expiresInSeconds * 1000);
    this.uploads.set(token, {
      bucket,
      key,
      contentType: options.contentType,
      maxBytes: options.maxBytes,
      expiresAt,
    });
    return Promise.resolve({
      url: `${this.publicApiUrl.replace(/\/+$/, "")}/v1/local-storage/${token}`,
      method: "PUT",
      headers: { "Content-Type": options.contentType },
      expiresAt,
    });
  }

  /** Called by the local upload route. Returns an error code or null on success. */
  acceptUpload(
    token: string,
    contentType: string | undefined,
    data: Buffer,
  ): "not_found" | "expired" | "content_type" | "too_large" | null {
    const upload = this.uploads.get(token);
    if (!upload) return "not_found";
    this.uploads.delete(token); // one use, like a signed URL with a generation precondition
    if (upload.expiresAt.getTime() < Date.now()) return "expired";
    if (contentType?.split(";")[0]?.trim().toLowerCase() !== upload.contentType)
      return "content_type";
    if (data.length > upload.maxBytes) return "too_large";
    this.objects.set(MemoryObjectStorage.id(upload.bucket, upload.key), {
      data: Buffer.from(data),
      contentType: upload.contentType,
    });
    return null;
  }

  head(bucket: BucketClass, key: string): Promise<ObjectInfo | null> {
    const object = this.objects.get(MemoryObjectStorage.id(bucket, key));
    return Promise.resolve(
      object ? { size: object.data.length, contentType: object.contentType } : null,
    );
  }

  read(bucket: BucketClass, key: string): Promise<Buffer> {
    const object = this.objects.get(MemoryObjectStorage.id(bucket, key));
    if (!object) return Promise.reject(new Error(`object not found: ${bucket}/${key}`));
    return Promise.resolve(Buffer.from(object.data));
  }

  write(bucket: BucketClass, key: string, data: Buffer, contentType: string): Promise<void> {
    this.objects.set(MemoryObjectStorage.id(bucket, key), { data: Buffer.from(data), contentType });
    return Promise.resolve();
  }

  delete(bucket: BucketClass, key: string): Promise<void> {
    this.objects.delete(MemoryObjectStorage.id(bucket, key));
    return Promise.resolve();
  }

  publicUrl(key: string): string {
    return `${this.publicApiUrl.replace(/\/+$/, "")}/v1/local-storage/public/${key}`;
  }

  /** Serves public_media objects for the local-only GET route. */
  publicObject(key: string): { data: Buffer; contentType: string } | undefined {
    return this.objects.get(MemoryObjectStorage.id("public_media", key));
  }

  /** Test helper: raw stored bytes (to prove documents are encrypted at rest). */
  raw(bucket: BucketClass, key: string): Buffer | undefined {
    return this.objects.get(MemoryObjectStorage.id(bucket, key))?.data;
  }

  /** Test helper: every stored object key. */
  keys(): string[] {
    return [...this.objects.keys()];
  }
}

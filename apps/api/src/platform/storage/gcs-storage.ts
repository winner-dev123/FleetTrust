import { type Bucket, Storage } from "@google-cloud/storage";

import type { BucketClass, ObjectInfo, ObjectStorage, UploadUrl } from "./object-storage.js";

/**
 * Cloud Storage adapter (ADR-0006). Uses the runtime service account (no HMAC keys); V4
 * signing goes through the IAM signBlob API on Cloud Run. With STORAGE_EMULATOR_HOST set,
 * the client talks to the Firebase Storage emulator instead (read/write/delete only: the
 * emulator doesn't verify signatures, see ADR-0012).
 */
export class GcsObjectStorage implements ObjectStorage {
  private readonly buckets: Record<BucketClass, Bucket>;

  constructor(names: Record<BucketClass, string>, storage: Storage = new Storage()) {
    this.buckets = {
      quarantine: storage.bucket(names.quarantine),
      sensitive: storage.bucket(names.sensitive),
    };
  }

  async createUploadUrl(
    bucket: BucketClass,
    key: string,
    options: { contentType: string; maxBytes: number; expiresInSeconds: number },
  ): Promise<UploadUrl> {
    const expiresAt = new Date(Date.now() + options.expiresInSeconds * 1000);
    // x-goog-content-length-range is a signed header: GCS rejects bodies outside the range.
    const headers = {
      "Content-Type": options.contentType,
      "x-goog-content-length-range": `1,${String(options.maxBytes)}`,
    };
    const [url] = await this.buckets[bucket].file(key).getSignedUrl({
      version: "v4",
      action: "write",
      expires: expiresAt,
      contentType: options.contentType,
      extensionHeaders: { "x-goog-content-length-range": headers["x-goog-content-length-range"] },
    });
    return { url, method: "PUT", headers, expiresAt };
  }

  async head(bucket: BucketClass, key: string): Promise<ObjectInfo | null> {
    const file = this.buckets[bucket].file(key);
    const [exists] = await file.exists();
    if (!exists) return null;
    const [metadata] = await file.getMetadata();
    return { size: Number(metadata.size), contentType: metadata.contentType };
  }

  async read(bucket: BucketClass, key: string): Promise<Buffer> {
    const [data] = await this.buckets[bucket].file(key).download();
    return data;
  }

  async write(bucket: BucketClass, key: string, data: Buffer, contentType: string): Promise<void> {
    await this.buckets[bucket].file(key).save(data, {
      contentType,
      resumable: false,
      // Never let a CDN or browser cache sensitive objects.
      metadata: { cacheControl: "private, no-store" },
    });
  }

  async delete(bucket: BucketClass, key: string): Promise<void> {
    await this.buckets[bucket].file(key).delete({ ignoreNotFound: true });
  }
}

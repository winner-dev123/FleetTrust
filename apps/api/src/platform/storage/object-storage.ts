/**
 * Object storage port (ADR-0006). Production: Cloud Storage with V4 signed URLs and the
 * service account's IAM identity. Local and tests: an in-memory adapter.
 *
 * Buckets are addressed by sensitivity class, not by name, so domain code can't put a
 * document in the wrong bucket by typo.
 */
export type BucketClass = "quarantine" | "sensitive" | "public_media";

export interface UploadUrl {
  url: string;
  method: "PUT";
  /** Headers the client must send unchanged (they are part of the signature). */
  headers: Record<string, string>;
  expiresAt: Date;
}

export interface ObjectInfo {
  size: number;
  contentType: string | undefined;
}

export interface ObjectStorage {
  /** Short-lived URL that accepts one PUT of exactly this content type, up to maxBytes. */
  createUploadUrl(
    bucket: BucketClass,
    key: string,
    options: { contentType: string; maxBytes: number; expiresInSeconds: number },
  ): Promise<UploadUrl>;
  head(bucket: BucketClass, key: string): Promise<ObjectInfo | null>;
  read(bucket: BucketClass, key: string): Promise<Buffer>;
  write(bucket: BucketClass, key: string, data: Buffer, contentType: string): Promise<void>;
  /** Idempotent: deleting a missing object succeeds. */
  delete(bucket: BucketClass, key: string): Promise<void>;
  /** Public, cacheable URL of an object in the public_media bucket. */
  publicUrl(key: string): string;
}

export const OBJECT_STORAGE = Symbol("OBJECT_STORAGE");

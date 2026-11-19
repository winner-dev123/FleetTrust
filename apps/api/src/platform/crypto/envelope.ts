import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

/**
 * Wraps and unwraps per-file data keys (envelope encryption, FR-08). Production: Cloud KMS,
 * so the key-encryption key never leaves the HSM-backed service. Local/test: a static key.
 */
export interface KeyWrapper {
  /** Identifies the wrapping key (and version) so rotation can be detected. */
  readonly keyId: string;
  wrap(dataKey: Buffer): Promise<Buffer>;
  unwrap(wrapped: Buffer): Promise<Buffer>;
}

export const KEY_WRAPPER = Symbol("KEY_WRAPPER");

export interface EncryptedBlob {
  ciphertext: Buffer;
  wrappedKey: Buffer;
  iv: Buffer;
  authTag: Buffer;
  keyId: string;
}

/**
 * AES-256-GCM with a fresh random data key per file. `aad` (e.g. the document ID) binds the
 * ciphertext to its record, so swapping two stored objects makes decryption fail.
 */
export async function encryptBlob(
  wrapper: KeyWrapper,
  plaintext: Buffer,
  aad: string,
): Promise<EncryptedBlob> {
  const dataKey = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv("aes-256-gcm", dataKey, iv);
    cipher.setAAD(Buffer.from(aad, "utf8"));
    const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
    return {
      ciphertext,
      wrappedKey: await wrapper.wrap(dataKey),
      iv,
      authTag: cipher.getAuthTag(),
      keyId: wrapper.keyId,
    };
  } finally {
    dataKey.fill(0);
  }
}

export async function decryptBlob(
  wrapper: KeyWrapper,
  blob: Omit<EncryptedBlob, "keyId">,
  aad: string,
): Promise<Buffer> {
  const dataKey = await wrapper.unwrap(blob.wrappedKey);
  try {
    const decipher = createDecipheriv("aes-256-gcm", dataKey, blob.iv);
    decipher.setAAD(Buffer.from(aad, "utf8"));
    decipher.setAuthTag(blob.authTag);
    return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
  } finally {
    dataKey.fill(0);
  }
}

/** Local/test key wrapper: AES-256-GCM under a static key-encryption key. Refused when deployed. */
export class LocalKeyWrapper implements KeyWrapper {
  readonly keyId = "local";

  constructor(private readonly kek: Buffer) {
    if (kek.length !== 32) throw new Error("local key-encryption key must be 32 bytes");
  }

  wrap(dataKey: Buffer): Promise<Buffer> {
    const iv = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.kek, iv);
    const wrapped = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    return Promise.resolve(Buffer.concat([iv, cipher.getAuthTag(), wrapped]));
  }

  unwrap(wrapped: Buffer): Promise<Buffer> {
    const decipher = createDecipheriv("aes-256-gcm", this.kek, wrapped.subarray(0, 12));
    decipher.setAuthTag(wrapped.subarray(12, 28));
    return Promise.resolve(
      Buffer.concat([decipher.update(wrapped.subarray(28)), decipher.final()]),
    );
  }
}

/** Minimal surface of google-auth-library used here (injectable for tests). */
export interface AccessTokenSource {
  getAccessToken(): Promise<string | null | undefined>;
}

/**
 * Cloud KMS key wrapper over the REST API (`cryptoKeys.encrypt` / `decrypt`), authenticated
 * as the runtime service account. Needs roles/cloudkms.cryptoKeyEncrypterDecrypter on the key.
 */
export class KmsKeyWrapper implements KeyWrapper {
  constructor(
    /** projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k> */
    readonly keyId: string,
    private readonly tokens: AccessTokenSource,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async call(
    method: "encrypt" | "decrypt",
    body: object,
  ): Promise<Record<string, unknown>> {
    const token = await this.tokens.getAccessToken();
    if (!token) throw new Error("no access token for Cloud KMS");
    const response = await this.fetchImpl(
      `https://cloudkms.googleapis.com/v1/${this.keyId}:${method}`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      },
    );
    if (!response.ok)
      throw new Error(`Cloud KMS ${method} failed with status ${String(response.status)}`);
    return (await response.json()) as Record<string, unknown>;
  }

  async wrap(dataKey: Buffer): Promise<Buffer> {
    const result = await this.call("encrypt", { plaintext: dataKey.toString("base64") });
    if (typeof result["ciphertext"] !== "string")
      throw new Error("Cloud KMS returned no ciphertext");
    return Buffer.from(result["ciphertext"], "base64");
  }

  async unwrap(wrapped: Buffer): Promise<Buffer> {
    const result = await this.call("decrypt", { ciphertext: wrapped.toString("base64") });
    if (typeof result["plaintext"] !== "string") throw new Error("Cloud KMS returned no plaintext");
    return Buffer.from(result["plaintext"], "base64");
  }
}

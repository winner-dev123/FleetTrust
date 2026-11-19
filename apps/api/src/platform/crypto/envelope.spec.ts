import { randomBytes } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import { decryptBlob, encryptBlob, KmsKeyWrapper, LocalKeyWrapper } from "./envelope.js";

describe("envelope encryption", () => {
  const wrapper = new LocalKeyWrapper(randomBytes(32));
  const plaintext = Buffer.from("%PDF-1.7 identity document");

  it("round-trips, with a fresh data key and IV per file", async () => {
    const a = await encryptBlob(wrapper, plaintext, "doc-1");
    const b = await encryptBlob(wrapper, plaintext, "doc-1");
    expect(a.ciphertext.equals(plaintext)).toBe(false);
    expect(a.ciphertext.equals(b.ciphertext)).toBe(false);
    expect(a.wrappedKey.equals(b.wrappedKey)).toBe(false);
    expect((await decryptBlob(wrapper, a, "doc-1")).equals(plaintext)).toBe(true);
  });

  it("refuses tampered ciphertext, a swapped record (AAD) or the wrong key", async () => {
    const blob = await encryptBlob(wrapper, plaintext, "doc-1");
    const tampered = Buffer.from(blob.ciphertext);
    tampered[0] = (tampered[0] ?? 0) ^ 0xff;
    await expect(
      decryptBlob(wrapper, { ...blob, ciphertext: tampered }, "doc-1"),
    ).rejects.toThrow();
    await expect(decryptBlob(wrapper, blob, "doc-2")).rejects.toThrow();
    await expect(
      decryptBlob(new LocalKeyWrapper(randomBytes(32)), blob, "doc-1"),
    ).rejects.toThrow();
  });

  it("requires a 32-byte local key", () => {
    expect(() => new LocalKeyWrapper(randomBytes(16))).toThrow(/32 bytes/);
  });
});

describe("KmsKeyWrapper", () => {
  const key = "projects/p/locations/europe-west1/keyRings/r/cryptoKeys/k";

  it("wraps and unwraps through the Cloud KMS REST API with the service account's token", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockImplementation((url, init) => {
      const body = JSON.parse(init?.body as string) as { plaintext?: string; ciphertext?: string };
      const reply = (url as string).endsWith(":encrypt")
        ? { ciphertext: Buffer.from(`wrapped:${body.plaintext ?? ""}`).toString("base64") }
        : {
            plaintext: Buffer.from(body.ciphertext ?? "", "base64")
              .toString()
              .replace(/^wrapped:/, ""),
          };
      return Promise.resolve(new Response(JSON.stringify(reply), { status: 200 }));
    });
    const wrapper = new KmsKeyWrapper(
      key,
      { getAccessToken: () => Promise.resolve("token-1") },
      fetch,
    );
    const dataKey = randomBytes(32);
    const wrapped = await wrapper.wrap(dataKey);
    expect((await wrapper.unwrap(wrapped)).equals(dataKey)).toBe(true);
    expect(fetch.mock.calls[0]?.[0]).toBe(`https://cloudkms.googleapis.com/v1/${key}:encrypt`);
    expect(fetch.mock.calls[0]?.[1]?.headers).toMatchObject({ Authorization: "Bearer token-1" });
  });

  it("fails closed on KMS errors and missing credentials", async () => {
    const failing = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(new Response("denied", { status: 403 }));
    await expect(
      new KmsKeyWrapper(key, { getAccessToken: () => Promise.resolve("t") }, failing).wrap(
        randomBytes(32),
      ),
    ).rejects.toThrow(/403/);
    await expect(
      new KmsKeyWrapper(key, { getAccessToken: () => Promise.resolve(null) }, failing).wrap(
        randomBytes(32),
      ),
    ).rejects.toThrow(/access token/);
  });
});

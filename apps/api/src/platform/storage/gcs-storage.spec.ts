import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

import { CRC32C, Storage } from "@google-cloud/storage";
import { PassThroughClient } from "google-auth-library";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { GcsObjectStorage, storageClient } from "./gcs-storage.js";

/**
 * V4 signed upload URLs from the real client library, signed offline with a throwaway key.
 * The emulator doesn't verify signatures (ADR-0012), so this test checks the signature the
 * way Cloud Storage does: rebuild the canonical request, then verify it with the public key.
 * It guards client library upgrades that change how URLs are signed.
 */
describe("GcsObjectStorage signed upload URLs", () => {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const clientEmail = "api@demo-fleettrust.iam.gserviceaccount.com";

  beforeEach(() => {
    vi.stubEnv("STORAGE_EMULATOR_HOST", undefined);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  const adapter = () =>
    new GcsObjectStorage(
      { quarantine: "ft-quarantine", sensitive: "ft-sensitive", public_media: "ft-media" },
      new Storage({
        projectId: "demo-fleettrust",
        credentials: {
          client_email: clientEmail,
          private_key: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
        },
      }),
    );

  /** Whether Cloud Storage would accept this PUT (V4 signing process, rebuilt by hand). */
  const accepts = (signedUrl: string, headers: { contentType: string; range: string }) => {
    const url = new URL(signedUrl);
    const params = url.searchParams;
    const query = url.search
      .slice(1)
      .split("&")
      .filter((pair) => !pair.startsWith("X-Goog-Signature="))
      .sort()
      .join("&");
    const canonicalRequest = [
      "PUT",
      url.pathname,
      query,
      `content-type:${headers.contentType}`,
      `host:${url.host}`,
      `x-goog-content-length-range:${headers.range}`,
      "",
      params.get("X-Goog-SignedHeaders") ?? "",
      "UNSIGNED-PAYLOAD",
    ].join("\n");
    const stringToSign = [
      "GOOG4-RSA-SHA256",
      params.get("X-Goog-Date") ?? "",
      (params.get("X-Goog-Credential") ?? "").split("/").slice(1).join("/"),
      createHash("sha256").update(canonicalRequest).digest("hex"),
    ].join("\n");
    const signature = Buffer.from(params.get("X-Goog-Signature") ?? "", "hex");
    return createVerify("RSA-SHA256").update(stringToSign).verify(publicKey, signature);
  };

  it("signs a PUT to the right bucket and key, bound to the type and size limit", async () => {
    const upload = await adapter().createUploadUrl("quarantine", "uploads/abc/licence.pdf", {
      contentType: "application/pdf",
      maxBytes: 10_000_000,
      expiresInSeconds: 600,
    });

    expect(upload.method).toBe("PUT");
    expect(upload.headers).toEqual({
      "Content-Type": "application/pdf",
      "x-goog-content-length-range": "1,10000000",
    });
    const url = new URL(upload.url);
    expect(url.origin).toBe("https://storage.googleapis.com");
    expect(url.pathname).toBe("/ft-quarantine/uploads/abc/licence.pdf");
    const params = url.searchParams;
    expect(params.get("X-Goog-Algorithm")).toBe("GOOG4-RSA-SHA256");
    expect(params.get("X-Goog-Credential")).toMatch(
      new RegExp(`^${clientEmail}/\\d{8}/auto/storage/goog4_request$`),
    );
    expect(params.get("X-Goog-SignedHeaders")).toBe(
      "content-type;host;x-goog-content-length-range",
    );
    const expires = Number(params.get("X-Goog-Expires"));
    expect(expires).toBeGreaterThanOrEqual(599);
    expect(expires).toBeLessThanOrEqual(600);

    expect(accepts(upload.url, { contentType: "application/pdf", range: "1,10000000" })).toBe(true);
  });

  it("is rejected if the size limit or the file type is changed", async () => {
    const upload = await adapter().createUploadUrl("quarantine", "k", {
      contentType: "image/jpeg",
      maxBytes: 100,
      expiresInSeconds: 60,
    });
    expect(accepts(upload.url, { contentType: "image/jpeg", range: "1,100" })).toBe(true);
    expect(accepts(upload.url, { contentType: "image/jpeg", range: "1,999999999" })).toBe(false);
    expect(accepts(upload.url, { contentType: "text/html", range: "1,100" })).toBe(false);
  });
});

/**
 * Against the emulator the client must not look for Google credentials (none exist locally or
 * in CI). Client 9 sends every request through Google auth, so storageClient() opts out.
 * A stand-in server answers like the emulator for a missing object.
 */
describe("storageClient against the emulator", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("talks to STORAGE_EMULATOR_HOST without credentials", async () => {
    const seen: IncomingHttpHeaders[] = [];
    const server = createServer((req, res) => {
      seen.push(req.headers);
      res.writeHead(404, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: { code: 404, message: "Not Found" } }));
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    try {
      const { port } = server.address() as AddressInfo;
      vi.stubEnv("STORAGE_EMULATOR_HOST", `http://127.0.0.1:${String(port)}`);
      vi.stubEnv("GOOGLE_APPLICATION_CREDENTIALS", undefined);
      const bucket = "demo-fleettrust.appspot.com";
      const storage = new GcsObjectStorage(
        { quarantine: bucket, sensitive: bucket, public_media: bucket },
        storageClient("demo-fleettrust"),
      );

      expect(await storage.head("sensitive", "missing")).toBeNull();
      expect(seen).toHaveLength(1);
      expect(seen[0]?.authorization).toBeUndefined();
    } finally {
      server.close();
    }
  });
});

/**
 * How writes are uploaded. Production uses one multipart request (the client's default for small
 * files). The Firebase Storage emulator can't parse client 9's multipart boundary, so against the
 * emulator writes use a resumable upload. A stand-in server records what the client sends.
 */
describe("GcsObjectStorage writes", () => {
  const data = Buffer.from([0, 1, 2, 3, 255, 254]);
  const stored = {
    name: "k",
    bucket: "b",
    size: String(data.length),
    md5Hash: createHash("md5").update(data).digest("base64"),
    crc32c: (() => {
      const crc = new CRC32C();
      crc.update(data);
      return crc.toString();
    })(),
  };

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /** Records each request; `respond` answers it. */
  async function standIn(
    respond: (
      req: { method: string; url: string },
      base: string,
    ) => {
      status: number;
      headers?: Record<string, string>;
      body?: unknown;
    },
  ) {
    const requests: { method: string; url: string; contentType: string; body: Buffer }[] = [];
    const server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        const request = {
          method: req.method ?? "",
          url: req.url ?? "",
          contentType: req.headers["content-type"] ?? "",
          body: Buffer.concat(chunks),
        };
        requests.push(request);
        const reply = respond(request, base);
        res.writeHead(reply.status, { "content-type": "application/json", ...reply.headers });
        res.end(JSON.stringify(reply.body ?? {}));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const base = `http://127.0.0.1:${String((server.address() as AddressInfo).port)}`;
    return { base, requests, close: () => server.close() };
  }

  it("uses one multipart request in production", async () => {
    const server = await standIn(() => ({ status: 200, body: stored }));
    try {
      vi.stubEnv("STORAGE_EMULATOR_HOST", undefined);
      const client = new Storage({
        apiEndpoint: server.base,
        authClient: new PassThroughClient(),
        projectId: "demo",
      });
      await new GcsObjectStorage(
        { quarantine: "b", sensitive: "b", public_media: "b" },
        client,
      ).write("sensitive", "k", data, "application/octet-stream");

      expect(server.requests).toHaveLength(1);
      const [upload] = server.requests;
      expect(upload?.method).toBe("POST");
      expect(upload?.url).toContain("uploadType=multipart");
      expect(upload?.contentType).toMatch(/^multipart\/related; boundary=/);
      expect(upload?.body.includes(data)).toBe(true);
      expect(upload?.body.toString()).toContain('"cacheControl":"private, no-store"');
    } finally {
      server.close();
    }
  });

  it("uses a resumable upload against the emulator", async () => {
    const server = await standIn((req, base) =>
      req.method === "POST"
        ? { status: 200, headers: { location: `${base}/upload/session-1` } }
        : { status: 200, body: stored },
    );
    try {
      vi.stubEnv("STORAGE_EMULATOR_HOST", server.base);
      await new GcsObjectStorage(
        { quarantine: "b", sensitive: "b", public_media: "b" },
        storageClient("demo"),
      ).write("sensitive", "k", data, "application/octet-stream");

      const [start, ...rest] = server.requests;
      expect(start?.method).toBe("POST");
      expect(start?.url).toContain("uploadType=resumable");
      expect(start?.contentType).not.toMatch(/^multipart/);
      expect(rest.some((req) => req.method === "PUT" && req.body.equals(data))).toBe(true);
    } finally {
      server.close();
    }
  });
});

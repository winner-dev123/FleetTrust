import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { ClamAvHttpScanner, googleIdTokenAuth } from "./http-scanner.js";

type Handler = (req: IncomingMessage, body: Buffer) => { status: number; body: string };

let server: Server | undefined;
afterEach(() => {
  server?.close();
  server = undefined;
});

/** A fake scanner service that records each request and answers with the handler's reply. */
async function fakeService(handler: Handler) {
  const seen: { headers: IncomingMessage["headers"]; body: Buffer; path?: string }[] = [];
  server = createServer((req, res) => {
    const parts: Buffer[] = [];
    req.on("data", (c: Buffer) => parts.push(c));
    req.on("end", () => {
      const body = Buffer.concat(parts);
      seen.push({ headers: req.headers, body, path: req.url });
      const reply = handler(req, body);
      res.writeHead(reply.status, { "content-type": "application/json" });
      res.end(reply.body);
    });
  });
  await new Promise<void>((resolve) => server?.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, seen };
}

const noAuth = () => Promise.resolve({});

describe("ClamAvHttpScanner", () => {
  it("posts the file to /scan with the auth headers and reads a clean result", async () => {
    const service = await fakeService(() => ({ status: 200, body: '{"clean":true}' }));
    const scanner = new ClamAvHttpScanner(service.url, () =>
      Promise.resolve({ authorization: "Bearer test-token" }),
    );
    await expect(scanner.scan(Buffer.from("hello"))).resolves.toEqual({ clean: true });
    expect(service.seen[0]?.path).toBe("/scan");
    expect(service.seen[0]?.headers.authorization).toBe("Bearer test-token");
    expect(service.seen[0]?.body.toString()).toBe("hello");
    expect(scanner.name).toBe("clamav");
  });

  it("reports malware with its signature", async () => {
    const service = await fakeService(() => ({
      status: 200,
      body: '{"clean":false,"signature":"Eicar-Signature"}',
    }));
    await expect(
      new ClamAvHttpScanner(service.url, noAuth).scan(Buffer.from("x")),
    ).resolves.toEqual({
      clean: false,
      signature: "Eicar-Signature",
    });
  });

  it("fails closed on error statuses, unexpected bodies and timeouts", async () => {
    for (const reply of [
      { status: 503, body: '{"error":"scanner not ready"}' },
      { status: 502, body: '{"error":"scan failed"}' },
      { status: 200, body: '{"clean":"yes"}' },
      { status: 200, body: '{"clean":false}' },
    ]) {
      const service = await fakeService(() => reply);
      await expect(
        new ClamAvHttpScanner(service.url, noAuth).scan(Buffer.from("x")),
      ).rejects.toThrow();
      server?.close();
    }
    const slow = await fakeService(() => ({ status: 200, body: '{"clean":true}' }));
    server?.removeAllListeners("request");
    server?.on("request", () => {
      /* never answers */
    });
    await expect(
      new ClamAvHttpScanner(slow.url, noAuth, 200).scan(Buffer.from("x")),
    ).rejects.toThrow();
    server?.closeAllConnections();
  });

  it("fails closed when the service is unreachable", async () => {
    const scanner = new ClamAvHttpScanner("http://127.0.0.1:1", noAuth, 2_000);
    await expect(scanner.scan(Buffer.from("x"))).rejects.toThrow();
  });
});

describe("googleIdTokenAuth", () => {
  it("asks for a token with the service origin as audience, once per origin", async () => {
    const audiences: string[] = [];
    const auth = googleIdTokenAuth({
      getIdTokenClient: (audience) => {
        audiences.push(audience);
        return Promise.resolve({
          getRequestHeaders: () =>
            Promise.resolve(new Headers({ authorization: "Bearer id-token" })),
        });
      },
    });
    await expect(auth("https://scanner-abc-ew.a.run.app")).resolves.toEqual({
      authorization: "Bearer id-token",
    });
    await auth("https://scanner-abc-ew.a.run.app/");
    expect(audiences).toEqual(["https://scanner-abc-ew.a.run.app"]);
  });

  it("sends no token to a local http:// scanner, and retries after a failed lookup", async () => {
    let calls = 0;
    const auth = googleIdTokenAuth({
      getIdTokenClient: () => {
        calls += 1;
        return calls === 1
          ? Promise.reject(new Error("metadata server unavailable"))
          : Promise.resolve({
              getRequestHeaders: () => Promise.resolve({ authorization: "Bearer t" }),
            });
      },
    });
    await expect(auth("http://localhost:8080")).resolves.toEqual({});
    await expect(auth("https://scanner.example.test")).rejects.toThrow(/metadata/);
    await expect(auth("https://scanner.example.test")).resolves.toEqual({
      authorization: "Bearer t",
    });
  });
});

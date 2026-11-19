import { createServer, type Server } from "node:net";

import { afterEach, describe, expect, it } from "vitest";

import { sniffContentType } from "./file-type.js";
import { ClamAvScanner, EicarOnlyScanner } from "./malware-scanner.js";

/** A minimal clamd: parses zINSTREAM chunks and answers with `reply(received)`. */
async function fakeClamd(
  reply: (received: Buffer) => string | null,
): Promise<{ port: number; server: Server }> {
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on("data", (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      const command = "zINSTREAM\0";
      if (buffer.length < command.length) return;
      let offset = command.length;
      const parts: Buffer[] = [];
      while (offset + 4 <= buffer.length) {
        const length = buffer.readUInt32BE(offset);
        if (length === 0) {
          const answer = reply(Buffer.concat(parts));
          if (answer === null) {
            socket.destroy();
          } else {
            socket.end(`${answer}\0`);
          }
          return;
        }
        if (offset + 4 + length > buffer.length) return;
        parts.push(buffer.subarray(offset + 4, offset + 4 + length));
        offset += 4 + length;
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (address === null || typeof address === "string") throw new Error("no port");
  return { port: address.port, server };
}

const servers: Server[] = [];
afterEach(async () => {
  await Promise.all(servers.splice(0).map((s) => new Promise((resolve) => s.close(resolve))));
});

describe("ClamAvScanner (clamd INSTREAM protocol)", () => {
  it("streams the file in chunks and reports clean or the signature found", async () => {
    let seen = 0;
    const { port, server } = await fakeClamd((data) => {
      seen = data.length;
      return data.includes(Buffer.from("EVIL")) ? "stream: Win.Test.Evil FOUND" : "stream: OK";
    });
    servers.push(server);
    const scanner = new ClamAvScanner("127.0.0.1", port);
    const big = Buffer.alloc(200 * 1024, 7); // several 64 KiB chunks
    expect(await scanner.scan(big)).toEqual({ clean: true });
    expect(seen).toBe(big.length);
    expect(await scanner.scan(Buffer.from("xxEVILxx"))).toEqual({
      clean: false,
      signature: "Win.Test.Evil",
    });
  });

  it("fails closed on unexpected replies, dropped connections and unreachable clamd", async () => {
    const garbage = await fakeClamd(() => "INSTREAM size limit exceeded. ERROR");
    const dropped = await fakeClamd(() => null);
    servers.push(garbage.server, dropped.server);
    await expect(
      new ClamAvScanner("127.0.0.1", garbage.port).scan(Buffer.from("a")),
    ).rejects.toThrow(/unexpected clamd reply/);
    await expect(
      new ClamAvScanner("127.0.0.1", dropped.port).scan(Buffer.from("a")),
    ).rejects.toThrow();
    await expect(new ClamAvScanner("127.0.0.1", 1).scan(Buffer.from("a"))).rejects.toThrow();
  });
});

describe("EicarOnlyScanner", () => {
  it("flags the EICAR test file only", async () => {
    const scanner = new EicarOnlyScanner();
    const eicar = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";
    expect(await scanner.scan(Buffer.from(`prefix ${eicar}`, "latin1"))).toEqual({
      clean: false,
      signature: "Eicar-Test-Signature",
    });
    expect(await scanner.scan(Buffer.from("%PDF-1.7"))).toEqual({ clean: true });
  });
});

describe("sniffContentType", () => {
  it("detects accepted formats from their magic bytes", () => {
    expect(sniffContentType(Buffer.from("%PDF-1.4 ..."))).toBe("application/pdf");
    expect(sniffContentType(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("image/jpeg");
    expect(sniffContentType(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe(
      "image/png",
    );
    expect(sniffContentType(Buffer.from("RIFF\0\0\0\0WEBPVP8 "))).toBe("image/webp");
    expect(sniffContentType(Buffer.from("\0\0\0\x18ftypheic\0\0\0\0", "latin1"))).toBe(
      "image/heic",
    );
  });

  it("rejects everything else, including HTML and SVG pretending to be documents", () => {
    expect(sniffContentType(Buffer.from("<!doctype html><script>"))).toBeNull();
    expect(sniffContentType(Buffer.from("<svg onload=alert(1)>"))).toBeNull();
    expect(sniffContentType(Buffer.alloc(0))).toBeNull();
  });
});

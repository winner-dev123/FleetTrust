import assert from "node:assert/strict";
import { request } from "node:http";
import { createServer as createTcpServer } from "node:net";
import { after, before, describe, it } from "node:test";

import { ping } from "../src/clamd.mjs";
import { createScanServer } from "../src/server.mjs";

const EICAR = "X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*";

/** A fake clamd: PING → PONG; INSTREAM → FOUND when the stream contains EICAR, else OK. */
function fakeClamd({ reply } = {}) {
  const server = createTcpServer((socket) => {
    let buffer = Buffer.alloc(0);
    let command = null;
    const payload = [];
    socket.on("data", (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (command === null) {
        const end = buffer.indexOf(0);
        if (end < 0) return;
        command = buffer.subarray(0, end).toString();
        buffer = buffer.subarray(end + 1);
        if (command === "zPING") return socket.end("PONG\0");
      }
      while (command === "zINSTREAM" && buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          const data = Buffer.concat(payload).toString("latin1");
          const answer =
            reply ??
            (data.includes("EICAR-STANDARD") ? "stream: Eicar-Signature FOUND" : "stream: OK");
          return socket.end(`${answer}\0`);
        }
        if (buffer.length < 4 + length) return;
        payload.push(buffer.subarray(4, 4 + length));
        buffer = buffer.subarray(4 + length);
      }
    });
  });
  return new Promise((resolve) => server.listen(0, "127.0.0.1", () => resolve(server)));
}

function call(port, method, path, body) {
  return new Promise((resolve, reject) => {
    const req = request({ host: "127.0.0.1", port, method, path }, (res) => {
      const parts = [];
      res.on("data", (c) => parts.push(c));
      res.on("end", () =>
        resolve({
          status: res.statusCode,
          body: JSON.parse(Buffer.concat(parts).toString() || "{}"),
        }),
      );
    });
    req.on("error", reject);
    if (body !== undefined) req.end(body);
    else req.end();
  });
}

async function startScanner(clamdPort, overrides = {}) {
  const server = createScanServer({
    clamdHost: "127.0.0.1",
    clamdPort,
    maxBytes: 1024 * 1024,
    readyTimeoutMs: 1_500,
    scanTimeoutMs: 5_000,
    log: () => {},
    ...overrides,
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return server;
}

describe("scanner HTTP server", () => {
  let clamd;
  let scanner;
  before(async () => {
    clamd = await fakeClamd();
    scanner = await startScanner(clamd.address().port);
  });
  after(() => {
    scanner.close();
    clamd.close();
  });

  it("reports a clean file", async () => {
    const res = await call(scanner.address().port, "POST", "/scan", Buffer.alloc(200_000, 7));
    assert.deepEqual(res, { status: 200, body: { clean: true } });
  });

  it("reports malware with its signature", async () => {
    const res = await call(scanner.address().port, "POST", "/scan", EICAR);
    assert.deepEqual(res, { status: 200, body: { clean: false, signature: "Eicar-Signature" } });
  });

  it("refuses files over the limit", async () => {
    const res = await call(scanner.address().port, "POST", "/scan", Buffer.alloc(1024 * 1024 + 1));
    assert.equal(res.status, 413);
  });

  it("answers health checks from clamd's PING and 404s anything else", async () => {
    assert.deepEqual(await call(scanner.address().port, "GET", "/healthz"), {
      status: 200,
      body: { ok: true },
    });
    assert.equal((await call(scanner.address().port, "GET", "/scan")).status, 404);
    assert.equal(await ping("127.0.0.1", clamd.address().port), true);
  });
});

describe("scanner failures (callers must fail closed)", () => {
  it("returns 502 on an unexpected clamd reply", async () => {
    const clamd = await fakeClamd({ reply: "stream: Can't allocate memory ERROR" });
    const scanner = await startScanner(clamd.address().port);
    try {
      const res = await call(scanner.address().port, "POST", "/scan", "hello");
      assert.deepEqual(res, { status: 502, body: { error: "scan failed" } });
    } finally {
      scanner.close();
      clamd.close();
    }
  });

  it("returns 503 when clamd never becomes ready", async () => {
    const placeholder = await fakeClamd();
    const port = placeholder.address().port;
    await new Promise((resolve) => placeholder.close(resolve)); // nothing listens on this port now
    const scanner = await startScanner(port, { readyTimeoutMs: 300 });
    try {
      const res = await call(scanner.address().port, "POST", "/scan", "hello");
      assert.deepEqual(res, { status: 503, body: { error: "scanner not ready" } });
      assert.equal((await call(scanner.address().port, "GET", "/healthz")).status, 503);
    } finally {
      scanner.close();
    }
  });
});

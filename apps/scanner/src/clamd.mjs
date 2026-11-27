// Minimal clamd client (TCP, local only): PING, RELOAD and INSTREAM.
// Protocol: https://docs.clamav.net/manual/Usage/Scanning.html#clamd (z-prefixed, NUL-terminated).
import { connect } from "node:net";

const CHUNK = 64 * 1024;

/** Sends one z-command and returns clamd's reply without the trailing NUL. */
function command(host, port, name, { timeoutMs = 5_000, write } = {}) {
  return new Promise((resolve, reject) => {
    const socket = connect({ host, port });
    const parts = [];
    let settled = false;
    const done = (error, value) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(new Error(`clamd ${name} timed out`)));
    socket.on("error", (error) => done(error));
    socket.on("data", (chunk) => parts.push(chunk));
    socket.on("end", () =>
      done(null, Buffer.concat(parts).toString("utf8").replace(/\0+$/, "").trim()),
    );
    socket.on("connect", () => {
      socket.write(`z${name}\0`);
      if (write) write(socket).catch((error) => done(error));
    });
  });
}

/** True when clamd answers PONG. */
export async function ping(host, port) {
  try {
    return (await command(host, port, "PING", { timeoutMs: 2_000 })) === "PONG";
  } catch {
    return false;
  }
}

/** Asks clamd to reload its signature database (after freshclam). */
export function reload(host, port) {
  return command(host, port, "RELOAD", { timeoutMs: 10_000 });
}

/**
 * Streams a readable (an HTTP request body) to clamd with INSTREAM: 4-byte big-endian length
 * prefixes, then a zero-length chunk. Resolves to { clean: true } or { clean: false, signature }.
 * Anything else rejects, so callers fail closed.
 */
export async function instream(host, port, body, timeoutMs) {
  const reply = await command(host, port, "INSTREAM", {
    timeoutMs,
    write: async (socket) => {
      const send = (buffer) =>
        new Promise((resolve, reject) => {
          const length = Buffer.alloc(4);
          length.writeUInt32BE(buffer.length);
          socket.write(Buffer.concat([length, buffer]), (error) =>
            error ? reject(error) : resolve(),
          );
        });
      for await (const chunk of body) {
        for (let offset = 0; offset < chunk.length; offset += CHUNK) {
          await send(chunk.subarray(offset, offset + CHUNK));
        }
      }
      socket.write(Buffer.alloc(4)); // zero-length chunk: end of stream
    },
  });
  if (reply === "stream: OK") return { clean: true };
  const found = /^stream: (.+) FOUND$/.exec(reply);
  if (found) return { clean: false, signature: found[1] };
  throw new Error(`unexpected clamd reply: ${reply.slice(0, 200)}`);
}

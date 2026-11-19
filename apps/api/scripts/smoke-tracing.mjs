// Smoke test for OpenTelemetry on the *built* API (ESM auto-instrumentation can only be proven
// end-to-end). Starts dist/main.js with the console exporter, sends a request carrying a known
// W3C traceparent, stops the server with SIGTERM (as Cloud Run does) and checks that spans for
// HTTP, Express and pg were flushed and continue the caller's trace.
// Usage: pnpm --filter @fleettrust/api smoke:tracing   (after building)
// Linux/macOS only: on Windows, SIGTERM is a hard kill, so spans are never flushed. CI runs it.
import { spawn } from "node:child_process";
import path from "node:path";

const apiDir = path.resolve(import.meta.dirname, "..");
const port = 18_090;
const traceId = "4bf92f3577b34da6a3ce929d0e0e4736";

const child = spawn(process.execPath, ["--import", "./dist/instrumentation.js", "dist/main.js"], {
  cwd: apiDir,
  env: {
    ...process.env,
    PORT: String(port),
    OTEL_TRACES_EXPORTER: "console",
    APP_VERSION: "smoke",
    // Nothing listens on port 1, so the readiness check fails fast and still emits pg spans.
    DATABASE_URL: "postgresql://smoke:smoke@127.0.0.1:1/none",
  },
  stdio: ["ignore", "pipe", "pipe"],
});

let output = "";
child.stdout.on("data", (chunk) => (output += chunk));
child.stderr.on("data", (chunk) => (output += chunk));
const exited = new Promise((resolve) =>
  child.on("exit", (code, signal) => resolve({ code, signal })),
);

function fail(message) {
  console.error(`tracing smoke test FAILED: ${message}\n--- server output ---\n${output}`);
  child.kill("SIGKILL");
  process.exit(1);
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${port}/health`);
      if (response.ok) return;
    } catch {
      // not listening yet
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  fail("server did not start within 20 s");
}

await waitForServer();
const ready = await fetch(`http://127.0.0.1:${port}/health/ready`, {
  headers: { traceparent: `00-${traceId}-00f067aa0ba902b7-01` },
});
if (ready.status !== 503)
  fail(`expected /health/ready to be 503 without a database, got ${ready.status}`);

child.kill("SIGTERM");
const timeout = new Promise((resolve) => setTimeout(() => resolve("timeout"), 15_000));
if ((await Promise.race([exited, timeout])) === "timeout")
  fail("server did not shut down within 15 s");

const checks = [
  [output.includes(`traceId: '${traceId}'`), "spans continue the incoming traceparent"],
  [output.includes("name: 'GET /health/ready'"), "HTTP server span"],
  [output.includes("'http.route': '/health/ready'"), "Express route attribute"],
  [output.includes("'db.system.name': 'postgresql'"), "pg client span"],
  [
    /"severity":"INFO".*"message":"FleetTrust API listening"/.test(output),
    "structured JSON startup log",
  ],
];
for (const [ok, label] of checks) {
  if (!ok) fail(`missing: ${label}`);
  console.log(`ok  ${label}`);
}
console.log("tracing smoke test passed");

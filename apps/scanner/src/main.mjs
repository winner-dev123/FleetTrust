// Container entrypoint: starts clamd, serves HTTP on $PORT, and refreshes signatures once.
// Signatures baked into the image are used right away; freshclam then fetches the day's updates
// (small differential files) and clamd reloads. If freshclam fails, scanning continues with the
// baked signatures and the failure is logged.
import { spawn } from "node:child_process";

import { ping, reload } from "./clamd.mjs";
import { createScanServer } from "./server.mjs";

const env = (name, fallback) => Number(process.env[name] ?? fallback);
const config = {
  port: env("PORT", 8080),
  clamdHost: "127.0.0.1",
  clamdPort: env("CLAMD_PORT", 3310),
  maxBytes: env("MAX_SCAN_BYTES", 50 * 1024 * 1024),
  readyTimeoutMs: env("CLAMD_READY_TIMEOUT_MS", 180_000),
  scanTimeoutMs: env("SCAN_TIMEOUT_MS", 120_000),
};

/** One JSON line per event: Cloud Logging reads severity and message. */
const log = (severity, message, extra = {}) =>
  process.stdout.write(
    `${JSON.stringify({ severity, message, service: "fleettrust-scanner", ...extra })}\n`,
  );

const children = [];
function run(command, args, { critical }) {
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  children.push(child);
  child.on("exit", (code, signal) => {
    if (critical) {
      log(
        "ERROR",
        `${command} exited (${signal ?? code}); stopping so Cloud Run restarts the instance`,
      );
      process.exit(1);
    }
  });
  return child;
}

if (process.env.SPAWN_CLAMD !== "false") {
  run(
    "clamd",
    ["--foreground", `--config-file=${process.env.CLAMD_CONFIG ?? "/etc/fleettrust/clamd.conf"}`],
    {
      critical: true,
    },
  );
  if (process.env.FRESHCLAM !== "false") {
    void (async () => {
      const deadline = Date.now() + config.readyTimeoutMs;
      while (Date.now() < deadline && !(await ping(config.clamdHost, config.clamdPort))) {
        await new Promise((resolve) => setTimeout(resolve, 2_000));
      }
      const freshclam = run(
        "freshclam",
        [
          "--stdout",
          `--config-file=${process.env.FRESHCLAM_CONFIG ?? "/etc/fleettrust/freshclam.conf"}`,
        ],
        { critical: false },
      );
      // freshclam: 0 = updated, 1 = already up to date, anything else = failed.
      freshclam.on("exit", (code) => {
        if (code === 1) return log("INFO", "signatures already up to date");
        if (code !== 0)
          return log("WARNING", `freshclam exited with ${code}; using the baked signatures`);
        reload(config.clamdHost, config.clamdPort).then(
          () => log("INFO", "signatures updated and reloaded"),
          (error) => log("WARNING", `clamd reload failed: ${error.message}`),
        );
      });
    })();
  }
}

const server = createScanServer({ ...config, log });
server.requestTimeout = config.scanTimeoutMs + config.readyTimeoutMs;
server.listen(config.port, () => log("INFO", `scanner listening on ${config.port}`));

process.on("SIGTERM", () => {
  server.close();
  for (const child of children) child.kill("SIGTERM");
  setTimeout(() => process.exit(0), 2_000).unref();
});

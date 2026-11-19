import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";

import { assertDockerCompose, compose, composePsJson, DockerUnavailableError } from "./docker.ts";
import { ensureLocalEnvFile } from "./env-file.ts";
import {
  allRequiredHealthy,
  EMULATOR_PROBES,
  evaluateContainers,
  formatReport,
  parseComposePs,
  probeHttp,
} from "./health.ts";
import { paths, repoRoot } from "./paths.ts";

const usage = `Usage: pnpm infra:<command>

  env         Create infra/local/.env with random local passwords (never overwrites values)
  up          Start Postgres/PostGIS and Redis, wait until healthy   (infra:up)
  up --all    Also start Mailpit for local email                    (infra:up:all)
  status      Show container and emulator health                    (infra:status)
  down        Stop containers, keep data                            (infra:down)
  destroy     Stop containers and DELETE local data (needs --yes)   (infra:destroy)
  emulators   Start the Firebase Local Emulator Suite               (emulators)`;

function runEnv(): void {
  const { created, added } = ensureLocalEnvFile(paths.envFile);
  const where = path.relative(repoRoot, paths.envFile);
  if (created) console.log(`Created ${where} with generated local passwords.`);
  else if (added.length > 0) console.log(`Updated ${where}; added: ${added.join(", ")}.`);
  else console.log(`${where} is up to date.`);
}

function runUp(withEmail: boolean): number {
  assertDockerCompose();
  runEnv();
  return compose(["up", "--detach", "--wait", "--wait-timeout", "180"], { withEmail });
}

async function runStatus(): Promise<number> {
  let containerResults;
  try {
    assertDockerCompose();
    containerResults = evaluateContainers(parseComposePs(composePsJson()));
  } catch (error) {
    if (!(error instanceof DockerUnavailableError)) throw error;
    console.error(error.message);
    containerResults = evaluateContainers([]);
  }
  const emulatorResults = await Promise.all(EMULATOR_PROBES.map((probe) => probeHttp(probe)));
  const results = [...containerResults, ...emulatorResults];
  console.log(formatReport(results));
  return allRequiredHealthy(results) ? 0 : 1;
}

function runDestroy(confirmed: boolean): number {
  if (!confirmed) {
    console.error(
      "This deletes the local Postgres and Redis volumes (all local data).\n" +
        "Re-run with: pnpm infra:destroy --yes",
    );
    return 1;
  }
  assertDockerCompose();
  return compose(["down", "--volumes", "--remove-orphans"], { withEmail: true });
}

function runEmulators(): number {
  // Import saved emulator data only when a previous export exists; export again on exit.
  const hasExport = existsSync(path.join(paths.emulatorData, "firebase-export-metadata.json"));
  // Run the pinned firebase-tools entry point with this Node binary: no shell, so arguments
  // are passed verbatim on every OS (spawning pnpm.cmd on Windows would require shell: true).
  const firebaseBin = path.join(
    repoRoot,
    "node_modules",
    "firebase-tools",
    "lib",
    "bin",
    "firebase.js",
  );
  if (!existsSync(firebaseBin)) {
    console.error("firebase-tools is not installed. Run `pnpm install` at the repository root.");
    return 1;
  }
  const args = [
    firebaseBin,
    "emulators:start",
    "--project",
    "demo-fleettrust",
    ...(hasExport ? ["--import", paths.emulatorData] : []),
    "--export-on-exit",
    paths.emulatorData,
  ];
  const result = spawnSync(process.execPath, args, { stdio: "inherit", cwd: repoRoot });
  return result.status ?? 1;
}

async function main(argv: readonly string[]): Promise<number> {
  const [command, ...flags] = argv;
  switch (command) {
    case "env":
      runEnv();
      return 0;
    case "up":
      return runUp(flags.includes("--all"));
    case "status":
      return runStatus();
    case "down":
      assertDockerCompose();
      return compose(["down"], { withEmail: true });
    case "destroy":
      return runDestroy(flags.includes("--yes"));
    case "emulators":
      return runEmulators();
    default:
      console.log(usage);
      return command === undefined || command === "help" ? 0 : 1;
  }
}

try {
  process.exitCode = await main(process.argv.slice(2));
} catch (error) {
  if (error instanceof DockerUnavailableError) {
    console.error(error.message);
    process.exitCode = 2;
  } else {
    throw error;
  }
}

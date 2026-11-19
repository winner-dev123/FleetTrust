import { spawnSync, type SpawnSyncOptions } from "node:child_process";

import { paths } from "./paths.ts";

export class DockerUnavailableError extends Error {
  constructor(detail: string) {
    super(
      `Docker with the Compose plugin is required for local services, but it isn't available (${detail}).\n` +
        "Install Docker Desktop (or another engine with `docker compose`), start it, and retry.\n" +
        "See docs/development/local-infrastructure.md.",
    );
    this.name = "DockerUnavailableError";
  }
}

type Runner = (
  command: string,
  args: readonly string[],
  options: SpawnSyncOptions,
) => {
  status: number | null;
  error?: Error;
  stdout?: string | Buffer | null;
};

const defaultRunner: Runner = (command, args, options) => spawnSync(command, args, options);

/** Throws DockerUnavailableError unless `docker compose version` succeeds. */
export function assertDockerCompose(run: Runner = defaultRunner): void {
  const result = run("docker", ["compose", "version"], { stdio: "ignore" });
  if (result.error) throw new DockerUnavailableError("`docker` command not found");
  if (result.status !== 0) {
    throw new DockerUnavailableError(
      "`docker compose version` failed; is the Docker engine running?",
    );
  }
}

/** Base arguments shared by every compose call. */
export function composeArgs(
  extra: readonly string[],
  options: { withEmail?: boolean } = {},
): string[] {
  return [
    "compose",
    "--env-file",
    paths.envFile,
    "--file",
    paths.composeFile,
    ...(options.withEmail ? ["--profile", "email"] : []),
    ...extra,
  ];
}

/** Runs `docker compose …` with inherited stdio and returns its exit code. */
export function compose(
  extra: readonly string[],
  options: { withEmail?: boolean } = {},
  run: Runner = defaultRunner,
): number {
  const result = run("docker", composeArgs(extra, options), { stdio: "inherit" });
  return result.status ?? 1;
}

/** Runs `docker compose ps` and returns its JSON output. */
export function composePsJson(run: Runner = defaultRunner): string {
  const result = run(
    "docker",
    composeArgs(["ps", "--all", "--format", "json"], { withEmail: true }),
    {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "inherit"],
    },
  );
  if (result.status !== 0) throw new Error("`docker compose ps` failed");
  return typeof result.stdout === "string"
    ? result.stdout
    : (result.stdout?.toString("utf8") ?? "");
}

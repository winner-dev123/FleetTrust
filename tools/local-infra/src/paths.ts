import path from "node:path";

/** Repository root, resolved from this file's location (tools/local-infra/src). */
export const repoRoot = path.resolve(import.meta.dirname, "..", "..", "..");

export const paths = {
  composeFile: path.join(repoRoot, "infra", "local", "compose.yaml"),
  envFile: path.join(repoRoot, "infra", "local", ".env"),
  emulatorData: path.join(repoRoot, ".firebase-data"),
} as const;

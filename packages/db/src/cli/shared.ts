/** Resolves the target database URL. `--test` targets DATABASE_URL_TEST instead of DATABASE_URL. */
export function targetUrl(argv: readonly string[]): { url: string; variable: string } {
  const variable = argv.includes("--test") ? "DATABASE_URL_TEST" : "DATABASE_URL";
  const url = process.env[variable];
  if (!url) {
    throw new Error(
      `${variable} is not set. Locally, run \`pnpm infra:up\` (writes infra/local/.env); elsewhere, export it.`,
    );
  }
  return { url, variable };
}

/** host:port/database without credentials, safe to print. */
export function describeUrl(url: string): string {
  const parsed = new URL(url);
  return `${parsed.hostname}:${parsed.port || "5432"}${parsed.pathname}`;
}

const LOCAL_HOSTS = new Set(["127.0.0.1", "localhost", "::1", "[::1]"]);

/** True only for databases on this machine. Destructive commands refuse anything else. */
export function isLocalDatabase(url: string): boolean {
  return LOCAL_HOSTS.has(new URL(url).hostname);
}

export async function runCli(main: () => Promise<void>): Promise<void> {
  try {
    await main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    if ((error as { code?: unknown }).code === "ECONNREFUSED") {
      console.error("Is the database running? Locally: `pnpm infra:up` (needs Docker).");
    }
    process.exitCode = 1;
  }
}

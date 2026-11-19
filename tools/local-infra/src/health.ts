/** One row of `docker compose ps --format json`. */
export interface ComposeService {
  Service: string;
  State: string;
  Health: string;
}

/**
 * Parses `docker compose ps --format json`. Compose v2 prints either a JSON array
 * (older releases) or one JSON object per line (newer releases); both are accepted.
 */
export function parseComposePs(output: string): ComposeService[] {
  const text = output.trim();
  if (text === "") return [];
  const rows: unknown[] = text.startsWith("[")
    ? (JSON.parse(text) as unknown[])
    : text
        .split(/\r?\n/)
        .filter((line) => line.trim() !== "")
        .map((line) => JSON.parse(line) as unknown);
  return rows.map((row) => {
    const record = row as Partial<Record<keyof ComposeService, unknown>>;
    return {
      Service: typeof record.Service === "string" ? record.Service : "unknown",
      State: typeof record.State === "string" ? record.State : "unknown",
      Health: typeof record.Health === "string" ? record.Health : "",
    };
  });
}

export type CheckStatus = "healthy" | "starting" | "unhealthy" | "not running";

export interface CheckResult {
  name: string;
  status: CheckStatus;
  detail: string;
  /** Required services make `infra:status` exit non-zero when not healthy. */
  required: boolean;
}

export const REQUIRED_SERVICES = ["postgres", "redis"] as const;
export const OPTIONAL_SERVICES = ["mailpit"] as const;

export function evaluateContainers(services: readonly ComposeService[]): CheckResult[] {
  const byName = new Map(services.map((service) => [service.Service, service]));
  const evaluate = (name: string, required: boolean): CheckResult => {
    const service = byName.get(name);
    if (service?.State !== "running") {
      return { name, status: "not running", detail: service?.State ?? "not created", required };
    }
    if (service.Health === "healthy")
      return { name, status: "healthy", detail: "container healthy", required };
    if (service.Health === "starting")
      return { name, status: "starting", detail: "health check pending", required };
    if (service.Health === "")
      return { name, status: "unhealthy", detail: "no health check reported", required };
    return { name, status: "unhealthy", detail: `health: ${service.Health}`, required };
  };
  return [
    ...REQUIRED_SERVICES.map((name) => evaluate(name, true)),
    ...OPTIONAL_SERVICES.map((name) => evaluate(name, false)),
  ];
}

export interface HttpProbe {
  name: string;
  url: string;
}

/** Firebase Local Emulator Suite endpoints (see firebase.json). Optional: started separately. */
export const EMULATOR_PROBES: readonly HttpProbe[] = [
  { name: "firebase auth emulator", url: "http://127.0.0.1:9099/" },
  { name: "firebase storage emulator", url: "http://127.0.0.1:9199/" },
];

export async function probeHttp(
  probe: HttpProbe,
  fetchImpl: typeof fetch = fetch,
  timeoutMs = 1500,
): Promise<CheckResult> {
  try {
    const response = await fetchImpl(probe.url, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      name: probe.name,
      status: "healthy",
      detail: `HTTP ${response.status}`,
      required: false,
    };
  } catch {
    return { name: probe.name, status: "not running", detail: "no response", required: false };
  }
}

export function formatReport(results: readonly CheckResult[]): string {
  const width = Math.max(...results.map((result) => result.name.length));
  return results
    .map((result) => {
      const marker = result.status === "healthy" ? "ok  " : result.required ? "FAIL" : "--  ";
      return `${marker} ${result.name.padEnd(width)}  ${result.status} (${result.detail})`;
    })
    .join("\n");
}

export function allRequiredHealthy(results: readonly CheckResult[]): boolean {
  return results.every((result) => !result.required || result.status === "healthy");
}

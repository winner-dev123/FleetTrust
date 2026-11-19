import { type HealthResponse, healthResponseSchema } from "@fleettrust/types";
import type { z } from "zod";

export interface ApiClientOptions {
  /** Absolute API origin, e.g. `https://api.example.com`. A trailing slash is ignored. */
  baseUrl: string;
  /** Injected for tests and non-standard runtimes. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Abort requests that take longer than this. Defaults to 15 seconds. */
  timeoutMs?: number;
}

/** Raised for non-2xx responses, network failures and responses that don't match the contract. */
export class ApiError extends Error {
  readonly status: number | undefined;
  readonly code: "http_error" | "network_error" | "invalid_response";

  constructor(
    message: string,
    code: ApiError["code"],
    status?: number,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "ApiError";
    this.code = code;
    this.status = status;
  }
}

export interface ApiClient {
  /** Liveness check. */
  health(): Promise<HealthResponse>;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function getJson<TSchema extends z.ZodType>(
    path: string,
    schema: TSchema,
  ): Promise<z.output<TSchema>> {
    // AbortController + setTimeout instead of AbortSignal.timeout(), which not every
    // React Native JS engine provides.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(`${baseUrl}${path}`, {
        method: "GET",
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new ApiError(
          `Request to ${path} failed with status ${response.status}`,
          "http_error",
          response.status,
        );
      }
      const { status } = response;
      body = await response.json().catch((cause: unknown) => {
        throw new ApiError(`Response from ${path} was not valid JSON`, "invalid_response", status, {
          cause,
        });
      });
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(`Request to ${path} failed`, "network_error", undefined, { cause });
    } finally {
      clearTimeout(timer);
    }

    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `Response from ${path} did not match the expected shape`,
        "invalid_response",
        response.status,
        { cause: parsed.error },
      );
    }
    return parsed.data;
  }

  return {
    health: () => getJson("/health", healthResponseSchema),
  };
}

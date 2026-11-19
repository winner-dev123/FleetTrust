import {
  type AuthErrorReason,
  authErrorReasonSchema,
  type HealthResponse,
  healthResponseSchema,
  type MeResponse,
  meResponseSchema,
  type UpdateMeRequest,
  updateMeRequestSchema,
} from "@fleettrust/types";
import { z } from "zod";

export interface ApiClientOptions {
  /** Absolute API origin, e.g. `https://api.example.com`. A trailing slash is ignored. */
  baseUrl: string;
  /** Injected for tests and non-standard runtimes. Defaults to the global `fetch`. */
  fetch?: typeof globalThis.fetch;
  /** Abort requests that take longer than this. Defaults to 15 seconds. */
  timeoutMs?: number;
  /**
   * Current Firebase ID token, or null when signed out. Called before every authenticated
   * request; pass `() => auth.currentUser?.getIdToken() ?? null` (Firebase refreshes it).
   */
  getIdToken?: () => Promise<string | null> | string | null;
  /** Firebase App Check token for the X-Firebase-AppCheck header (required in production). */
  getAppCheckToken?: () => Promise<string | null> | string | null;
}

/** Raised for non-2xx responses, network failures and responses that don't match the contract. */
export class ApiError extends Error {
  readonly status: number | undefined;
  readonly code: "http_error" | "network_error" | "invalid_response";
  /** Machine-readable reason on auth/profile errors (e.g. `expired_token`, `profile_incomplete`). */
  readonly reason: AuthErrorReason | undefined;
  /** Seconds to wait before retrying (429 responses). */
  readonly retryAfterSeconds: number | undefined;

  constructor(
    message: string,
    code: ApiError["code"],
    status?: number,
    options?: { cause?: unknown; reason?: AuthErrorReason; retryAfterSeconds?: number },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = "ApiError";
    this.code = code;
    this.status = status;
    this.reason = options?.reason;
    this.retryAfterSeconds = options?.retryAfterSeconds;
  }

  /** True when signing in again (or refreshing the token) may fix the error. */
  get requiresSignIn(): boolean {
    return this.status === 401;
  }
}

export interface ApiClient {
  /** Liveness check (no sign-in needed). */
  health(): Promise<HealthResponse>;
  /** The signed-in user's profile; the first call after sign-in creates the account. */
  me(): Promise<MeResponse>;
  /** Update the profile. `displayName: null` clears it. Validated client-side first. */
  updateMe(update: UpdateMeRequest): Promise<MeResponse>;
  /** "Sign out everywhere": revokes every session of the signed-in user. */
  revokeAllSessions(): Promise<void>;
}

const errorBodySchema = z
  .object({ reason: authErrorReasonSchema.optional(), message: z.unknown().optional() })
  .loose();

interface RequestSpec<TSchema extends z.ZodType | undefined> {
  method: "GET" | "POST" | "PATCH";
  path: string;
  schema: TSchema;
  body?: unknown;
  authenticated: boolean;
}

export function createApiClient(options: ApiClientOptions): ApiClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, "");
  const fetchImpl = options.fetch ?? globalThis.fetch.bind(globalThis);
  const timeoutMs = options.timeoutMs ?? 15_000;

  async function headersFor(
    authenticated: boolean,
    hasBody: boolean,
  ): Promise<Record<string, string>> {
    const headers: Record<string, string> = { Accept: "application/json" };
    if (hasBody) headers["Content-Type"] = "application/json";
    if (authenticated) {
      const token = await options.getIdToken?.();
      if (token) headers["Authorization"] = `Bearer ${token}`;
      const appCheck = await options.getAppCheckToken?.();
      if (appCheck) headers["X-Firebase-AppCheck"] = appCheck;
    }
    return headers;
  }

  async function send<TSchema extends z.ZodType | undefined>(
    spec: RequestSpec<TSchema>,
  ): Promise<TSchema extends z.ZodType ? z.output<TSchema> : undefined> {
    // AbortController + setTimeout instead of AbortSignal.timeout(), which not every
    // React Native JS engine provides.
    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    let body: unknown;
    try {
      response = await fetchImpl(`${baseUrl}${spec.path}`, {
        method: spec.method,
        headers: await headersFor(spec.authenticated, spec.body !== undefined),
        ...(spec.body === undefined ? {} : { body: JSON.stringify(spec.body) }),
        signal: controller.signal,
      });
      if (!response.ok) {
        const errorBody = errorBodySchema.safeParse(await response.json().catch(() => ({})));
        const retryAfter = Number(response.headers.get("Retry-After"));
        throw new ApiError(
          `Request to ${spec.path} failed with status ${String(response.status)}`,
          "http_error",
          response.status,
          {
            ...(errorBody.success && errorBody.data.reason
              ? { reason: errorBody.data.reason }
              : {}),
            ...(Number.isFinite(retryAfter) && retryAfter > 0
              ? { retryAfterSeconds: retryAfter }
              : {}),
          },
        );
      }
      if (response.status === 204 || spec.schema === undefined) {
        return undefined as TSchema extends z.ZodType ? z.output<TSchema> : undefined;
      }
      const { status } = response;
      body = await response.json().catch((cause: unknown) => {
        throw new ApiError(
          `Response from ${spec.path} was not valid JSON`,
          "invalid_response",
          status,
          {
            cause,
          },
        );
      });
    } catch (cause) {
      if (cause instanceof ApiError) throw cause;
      throw new ApiError(`Request to ${spec.path} failed`, "network_error", undefined, { cause });
    } finally {
      clearTimeout(timer);
    }

    const parsed = spec.schema.safeParse(body);
    if (!parsed.success) {
      throw new ApiError(
        `Response from ${spec.path} did not match the expected shape`,
        "invalid_response",
        response.status,
        { cause: parsed.error },
      );
    }
    return parsed.data as TSchema extends z.ZodType ? z.output<TSchema> : undefined;
  }

  return {
    health: () =>
      send({ method: "GET", path: "/health", schema: healthResponseSchema, authenticated: false }),
    me: () =>
      send({ method: "GET", path: "/v1/me", schema: meResponseSchema, authenticated: true }),
    // async so invalid input rejects (like every other method) instead of throwing synchronously.
    updateMe: async (update) =>
      send({
        method: "PATCH",
        path: "/v1/me",
        schema: meResponseSchema,
        body: updateMeRequestSchema.parse(update),
        authenticated: true,
      }),
    revokeAllSessions: () =>
      send({
        method: "POST",
        path: "/v1/me/sessions/revoke",
        schema: undefined,
        authenticated: true,
      }),
  };
}

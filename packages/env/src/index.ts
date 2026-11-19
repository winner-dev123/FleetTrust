import { z } from "zod";

/** Raw environment input, e.g. `process.env` or an explicit object of `NEXT_PUBLIC_*` values. */
export type EnvSource = Readonly<Record<string, string | undefined>>;

/**
 * Thrown when environment validation fails.
 *
 * The message lists variable names and the reason only. It never includes the
 * offending values, because they may be secrets and errors end up in logs.
 */
export class EnvValidationError extends Error {
  readonly issues: readonly string[];

  constructor(issues: readonly string[], label: string) {
    super(`Invalid ${label} environment:\n${issues.map((issue) => `  - ${issue}`).join("\n")}`);
    this.name = "EnvValidationError";
    this.issues = issues;
  }
}

/**
 * Validates and parses environment variables against a zod schema.
 * Empty strings are treated as unset so `FOO=` in a .env file falls back to the default.
 */
export function parseEnv<TSchema extends z.ZodType>(
  schema: TSchema,
  source: EnvSource,
  label = "application",
): z.output<TSchema> {
  const normalised: Record<string, string> = {};
  for (const [key, value] of Object.entries(source)) {
    if (value !== undefined && value !== "") normalised[key] = value;
  }

  const result = schema.safeParse(normalised);
  if (result.success) return result.data;

  const issues = result.error.issues.map((issue) => {
    const path = issue.path.length > 0 ? issue.path.join(".") : "(root)";
    return `${path}: ${redactMessage(issue)}`;
  });
  throw new EnvValidationError(issues, label);
}

/** zod messages describe types, not values, but custom messages could echo input; keep only safe text. */
function redactMessage(issue: z.core.$ZodIssue): string {
  if (issue.code === "invalid_value") return "value is not one of the allowed options";
  return issue.message;
}

/** Reusable field schemas for env files. */
export const envFields = {
  /** TCP port, defaulting to `fallback`. */
  port: (fallback: number) => z.coerce.number().int().min(1).max(65_535).default(fallback),
  /** "true"/"false"/"1"/"0"/"yes"/"no" → boolean. */
  flag: (fallback: boolean) => z.stringbool().default(fallback),
  /** Comma-separated list → string[] (trimmed, empties removed). */
  list: () =>
    z
      .string()
      .default("")
      .transform((value) =>
        value
          .split(",")
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
  /**
   * Absolute http(s) URL. Plain z.url() also accepts strings like "localhost:8080"
   * (parsed as scheme "localhost:"), which is never what a config value means.
   */
  httpUrl: () => z.url({ protocol: /^https?$/, error: "must be an absolute http(s) URL" }),
  /** Deployment environment name shared by all apps. */
  appEnv: () => z.enum(["local", "test", "staging", "production"]).default("local"),
  logLevel: () => z.enum(["fatal", "error", "warn", "info", "debug", "trace"]).default("info"),
} as const;

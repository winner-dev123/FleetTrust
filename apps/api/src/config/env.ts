import { type EnvSource, envFields, parseEnv } from "@fleettrust/env";
import { appRoleSchema } from "@fleettrust/types";
import { z } from "zod";

const DEV_VERSION = "0.0.0-dev";

export const apiEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    /** Deployment environment. Distinct from NODE_ENV: staging also runs with NODE_ENV=production. */
    APP_ENV: envFields.appEnv(),
    /** Same image, two roles (docs/adr/0002). */
    APP_ROLE: appRoleSchema.default("api"),
    /** Set by CI to the release tag or git SHA. */
    APP_VERSION: z.string().min(1).default(DEV_VERSION),
    /** Cloud Run injects PORT; 8080 is its default. */
    PORT: envFields.port(8080),
    LOG_LEVEL: envFields.logLevel(),
    /** Comma-separated browser origins allowed to call the API. Empty disables CORS. */
    CORS_ORIGINS: envFields.list().pipe(z.array(envFields.httpUrl())),
    /**
     * PostgreSQL connection string (a secret: Secret Manager in deployed environments).
     * Optional locally so the API still boots without Docker; /health/ready then reports
     * the database as not_configured.
     */
    DATABASE_URL: z
      .string()
      .regex(/^postgres(ql)?:\/\//, "must be a postgres:// or postgresql:// URL")
      .optional(),
    /** Connections per instance. Keep (Cloud Run max instances × this) under the Cloud SQL limit. */
    DB_POOL_MAX: z.coerce.number().int().min(1).max(50).default(5),
    /** Google Cloud project ID; enables log ↔ trace correlation in Cloud Logging. */
    GOOGLE_CLOUD_PROJECT: z
      .string()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "must be a Google Cloud project ID")
      .optional(),
    /** Firebase project whose ID tokens are accepted. `demo-*` IDs only work with the emulators. */
    FIREBASE_PROJECT_ID: z
      .string()
      .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "must be a Firebase project ID")
      .default("demo-fleettrust"),
    /**
     * Set only to use the local Auth emulator. The Admin SDK then accepts UNSIGNED tokens,
     * so this must never be set in a deployed environment (enforced below).
     */
    FIREBASE_AUTH_EMULATOR_HOST: z
      .string()
      .regex(/^[\w.-]+:\d{2,5}$/, "must be host:port")
      .optional(),
    /** Firebase App Check: off (local), monitor (log only), enforce (reject missing/invalid tokens). */
    APP_CHECK_MODE: z.enum(["off", "monitor", "enforce"]).default("off"),
    /** Redis for rate limiting (Memorystore when deployed). Without it, an in-memory limiter is used locally. */
    REDIS_URL: z
      .string()
      .regex(/^rediss?:\/\//, "must be a redis:// or rediss:// URL")
      .optional(),
    /**
     * Proxies in front of the API that append to X-Forwarded-For (Cloud Run: 1). The client IP
     * used for rate limiting is read that many hops from the right; 0 uses the socket address.
     */
    TRUST_PROXY_HOPS: z.coerce.number().int().min(0).max(3).default(0),
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === "staging" || env.APP_ENV === "production";
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    if (deployed && env.FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
      issue(
        "FIREBASE_AUTH_EMULATOR_HOST",
        "must not be set in staging or production (the emulator accepts forged tokens)",
      );
    }
    if (deployed && env.FIREBASE_PROJECT_ID.startsWith("demo-")) {
      issue("FIREBASE_PROJECT_ID", "must be a real Firebase project in staging and production");
    }
    if (env.APP_ENV === "production" && env.APP_CHECK_MODE !== "enforce") {
      issue("APP_CHECK_MODE", "must be 'enforce' in production");
    }
    if (deployed && env.REDIS_URL === undefined) {
      issue("REDIS_URL", "is required in staging and production (shared rate limits)");
    }
    if (deployed && env.DATABASE_URL === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["DATABASE_URL"],
        message: "is required in staging and production",
      });
    }
    if (deployed && env.APP_VERSION === DEV_VERSION) {
      ctx.addIssue({
        code: "custom",
        path: ["APP_VERSION"],
        message: "must be set to the release version in staging and production",
      });
    }
    if (deployed && env.NODE_ENV !== "production") {
      ctx.addIssue({
        code: "custom",
        path: ["NODE_ENV"],
        message: "must be 'production' in staging and production",
      });
    }
  });

export type ApiEnv = z.output<typeof apiEnvSchema>;

export function loadApiEnv(source: EnvSource): ApiEnv {
  return parseEnv(apiEnvSchema, source, "API");
}

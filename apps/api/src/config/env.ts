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
    /** Public base URL of this API (local storage upload links point here). */
    PUBLIC_API_URL: envFields.httpUrl().default("http://localhost:8080"),
    /**
     * Object storage for documents (ADR-0006): `gcs` (Cloud Storage, V4 signed URLs) or
     * `memory` (in-process, local/test only).
     */
    STORAGE_DRIVER: z.enum(["memory", "gcs"]).default("memory"),
    STORAGE_QUARANTINE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/)
      .optional(),
    STORAGE_PUBLIC_MEDIA_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/)
      .optional(),
    /** CDN origin serving the public media bucket (optional; defaults to storage.googleapis.com). */
    PUBLIC_MEDIA_BASE_URL: envFields.httpUrl().optional(),
    STORAGE_SENSITIVE_BUCKET: z
      .string()
      .regex(/^[a-z0-9][a-z0-9._-]{1,220}[a-z0-9]$/)
      .optional(),
    /** Envelope encryption for verification documents: Cloud KMS, or a static local key. */
    DOCUMENT_KEY_PROVIDER: z.enum(["local", "kms"]).default("local"),
    DOCUMENT_KMS_KEY: z
      .string()
      .regex(
        /^projects\/[^/]+\/locations\/[^/]+\/keyRings\/[^/]+\/cryptoKeys\/[^/]+$/,
        "must be projects/<p>/locations/<l>/keyRings/<r>/cryptoKeys/<k>",
      )
      .optional(),
    /** 32 random bytes, base64. Local only; without it a random key is used per process. */
    DOCUMENT_LOCAL_KEK: z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/, "must be 32 bytes, base64")
      .optional(),
    /** `clamav` (clamd over TCP) or `eicar-only` (detects only the EICAR test file; local only). */
    MALWARE_SCANNER: z.enum(["eicar-only", "clamav"]).default("eicar-only"),
    CLAMAV_HOST: z.string().min(1).optional(),
    CLAMAV_PORT: envFields.port(3310),
    /** Verification documents are deleted this many days after the case is decided (OQ-14). */
    VERIFICATION_DOCUMENT_RETENTION_DAYS: z.coerce.number().int().min(1).max(3650).default(90),
    /**
     * Map and geocoding adapter (OQ-13: vendor not chosen yet). `stub` geocodes a small built-in
     * list of cities; it is refused in production.
     */
    MAP_PROVIDER: z.enum(["stub"]).default("stub"),
    /** XYZ tile template handed to clients, e.g. https://tiles.example.com/{z}/{x}/{y}.png. */
    MAP_TILE_URL: z.url({ protocol: /^https$/ }).optional(),
    MAP_ATTRIBUTION: z.string().min(1).max(300).optional(),
    /**
     * Routing adapter for route-corridor search (OQ-13). `none` (default): route searches fall back
     * to point searches around the waypoints. `straight-line`: development only, refused in production.
     */
    ROUTING_PROVIDER: z.enum(["none", "straight-line"]).default("none"),
    /** Abandon a routing call after this long and fall back to point search. */
    ROUTING_TIMEOUT_MS: z.coerce.number().int().min(200).max(20_000).default(4_000),
    /** How long computed routes are cached (0 disables). Check the vendor's caching terms (OQ-13). */
    /** Push notifications: `fcm` (Firebase Cloud Messaging) or `log` (recorded, never sent; local only). */
    PUSH_PROVIDER: z.enum(["log", "fcm"]).default("log"),
    /** Worker role: how often the outbox relay looks for new events (notifications and push). */
    OUTBOX_RELAY_INTERVAL_MS: z.coerce.number().int().min(200).max(60_000).default(2_000),
    /** Transactional email (emergency fallback). Vendor pending (OQ-06): `log` records only. */
    EMAIL_PROVIDER: z.enum(["log"]).default("log"),
    EMAIL_FROM: z.string().min(3).max(200).default("FleetTrust <no-reply@fleettrust.invalid>"),
    /** Emergency: re-alert (next contacts) when nobody acknowledged within this many seconds. */
    EMERGENCY_ESCALATION_SECONDS: z.coerce.number().int().min(15).max(3_600).default(120),
    /** Emergency: email a contact who hasn't acknowledged a push within this many seconds. */
    EMERGENCY_EMAIL_FALLBACK_SECONDS: z.coerce.number().int().min(10).max(3_600).default(60),
    /** Emergency: incidents close automatically after this many hours. */
    EMERGENCY_INCIDENT_HOURS: z.coerce.number().int().min(1).max(72).default(12),
    /** Emergency: more incidents than this per hour flag the account (never block, ADR-0010). */
    EMERGENCY_SOFT_LIMIT_PER_HOUR: z.coerce.number().int().min(1).max(100).default(3),
    /** Worker role: how often emergency deliveries, escalations and expiry are processed. */
    EMERGENCY_TICK_MS: z.coerce.number().int().min(200).max(30_000).default(1_000),
    /** Worker role: how often maintenance and document-expiry reminders are queued. */
    VEHICLE_REMINDER_INTERVAL_MS: z.coerce
      .number()
      .int()
      .min(10_000)
      .max(86_400_000)
      .default(3_600_000),
    ROUTING_CACHE_TTL_SECONDS: z.coerce.number().int().min(0).max(86_400).default(3_600),
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
    if (deployed && env.STORAGE_DRIVER !== "gcs") {
      issue("STORAGE_DRIVER", "must be 'gcs' in staging and production");
    }
    if (
      env.STORAGE_DRIVER === "gcs" &&
      (env.STORAGE_QUARANTINE_BUCKET === undefined ||
        env.STORAGE_SENSITIVE_BUCKET === undefined ||
        env.STORAGE_PUBLIC_MEDIA_BUCKET === undefined)
    ) {
      issue(
        "STORAGE_SENSITIVE_BUCKET",
        "all three bucket names are required with STORAGE_DRIVER=gcs",
      );
    }
    if (deployed && env.DOCUMENT_KEY_PROVIDER !== "kms") {
      issue("DOCUMENT_KEY_PROVIDER", "must be 'kms' in staging and production");
    }
    if (env.DOCUMENT_KEY_PROVIDER === "kms" && env.DOCUMENT_KMS_KEY === undefined) {
      issue("DOCUMENT_KMS_KEY", "is required with DOCUMENT_KEY_PROVIDER=kms");
    }
    if (deployed && env.DOCUMENT_LOCAL_KEK !== undefined) {
      issue("DOCUMENT_LOCAL_KEK", "must not be set in staging or production");
    }
    if (deployed && env.MALWARE_SCANNER !== "clamav") {
      issue("MALWARE_SCANNER", "must be 'clamav' in staging and production");
    }
    if (env.MALWARE_SCANNER === "clamav" && env.CLAMAV_HOST === undefined) {
      issue("CLAMAV_HOST", "is required with MALWARE_SCANNER=clamav");
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
    // Clients need a tile source in production. Choosing the vendor (and replacing the stub
    // geocoder) is a launch blocker tracked as OQ-13.
    if (env.APP_ENV === "production" && env.MAP_TILE_URL === undefined) {
      issue("MAP_TILE_URL", "is required in production (map tiles for clients)");
    }
    if (env.APP_ENV === "production" && env.ROUTING_PROVIDER === "straight-line") {
      issue("ROUTING_PROVIDER", "straight-line is for development only");
    }
    if (deployed && env.PUSH_PROVIDER !== "fcm") {
      issue("PUSH_PROVIDER", "must be 'fcm' in staging and production");
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

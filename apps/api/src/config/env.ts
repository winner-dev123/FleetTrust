import { type EnvSource, envFields, parseEnv } from "@fleettrust/config/env";
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
  })
  .superRefine((env, ctx) => {
    const deployed = env.APP_ENV === "staging" || env.APP_ENV === "production";
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

import { type EnvSource, envFields, parseEnv } from "@fleettrust/config/env";
import { z } from "zod";

/**
 * Public (browser-visible) configuration. Only NEXT_PUBLIC_* values belong here, and
 * they are inlined into the client bundle at build time, so they must never be secrets.
 */
const webEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: envFields.appEnv(),
    NEXT_PUBLIC_API_URL: envFields.httpUrl().optional(),
  })
  .transform((env, ctx) => {
    const isLocal = env.NEXT_PUBLIC_APP_ENV === "local" || env.NEXT_PUBLIC_APP_ENV === "test";
    const apiUrl = env.NEXT_PUBLIC_API_URL ?? (isLocal ? "http://localhost:8080" : undefined);
    if (apiUrl === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["NEXT_PUBLIC_API_URL"],
        message: "is required outside local development",
      });
      return z.NEVER;
    }
    return { appEnv: env.NEXT_PUBLIC_APP_ENV, apiUrl };
  });

export type WebEnv = z.output<typeof webEnvSchema>;

export function loadWebEnv(source: EnvSource): WebEnv {
  return parseEnv(webEnvSchema, source, "web");
}

// Each variable is referenced explicitly so Next.js can inline it into the client bundle.
export const webEnv: WebEnv = loadWebEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
});

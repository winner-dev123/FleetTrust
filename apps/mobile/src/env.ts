import { type EnvSource, envFields, parseEnv } from "@fleettrust/config/env";
import { z } from "zod";

/**
 * Public app configuration. EXPO_PUBLIC_* values are inlined into the JS bundle at
 * build time and can be read by anyone with the app, so they must never be secrets.
 */
const mobileEnvSchema = z
  .object({
    EXPO_PUBLIC_APP_ENV: envFields.appEnv(),
    EXPO_PUBLIC_API_URL: envFields.httpUrl().optional(),
  })
  .transform((env, ctx) => {
    const isLocal = env.EXPO_PUBLIC_APP_ENV === "local" || env.EXPO_PUBLIC_APP_ENV === "test";
    // Note: the Android emulator reaches the host machine at http://10.0.2.2, not localhost.
    const apiUrl = env.EXPO_PUBLIC_API_URL ?? (isLocal ? "http://localhost:8080" : undefined);
    if (apiUrl === undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["EXPO_PUBLIC_API_URL"],
        message: "is required outside local development",
      });
      return z.NEVER;
    }
    return { appEnv: env.EXPO_PUBLIC_APP_ENV, apiUrl };
  });

export type MobileEnv = z.output<typeof mobileEnvSchema>;

export function loadMobileEnv(source: EnvSource): MobileEnv {
  return parseEnv(mobileEnvSchema, source, "mobile");
}

// Each variable is referenced explicitly so Expo can inline it into the bundle.
export const mobileEnv: MobileEnv = loadMobileEnv({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
});

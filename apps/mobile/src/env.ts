import { type EnvSource, envFields, parseEnv } from "@fleettrust/env";
import { z } from "zod";

/**
 * Public app configuration. EXPO_PUBLIC_* values are inlined into the JS bundle at
 * build time and can be read by anyone with the app, so they must never be secrets.
 * Firebase project settings come from the native config files (google-services.json and
 * GoogleService-Info.plist), not from here.
 */
const mobileEnvSchema = z
  .object({
    EXPO_PUBLIC_APP_ENV: envFields.appEnv(),
    EXPO_PUBLIC_API_URL: envFields.httpUrl().optional(),
    /** Web origin: email sign-in links land here and open the app (universal / app links). */
    EXPO_PUBLIC_WEB_URL: envFields.httpUrl().optional(),
    /** Firebase Hosting domain for email links (after the Dynamic Links shutdown). */
    EXPO_PUBLIC_LINK_DOMAIN: z
      .string()
      .regex(/^[a-z0-9.-]+$/i, "must be a bare host name")
      .optional(),
    /** host:port of the Firebase Auth emulator (local development only). */
    EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: z
      .string()
      .regex(/^[a-z0-9.-]+:\d+$/i, "must be host:port")
      .optional(),
  })
  .transform((env, ctx) => {
    const isLocal = env.EXPO_PUBLIC_APP_ENV === "local" || env.EXPO_PUBLIC_APP_ENV === "test";
    // Note: the Android emulator reaches the host machine at http://10.0.2.2, not localhost.
    const apiUrl = env.EXPO_PUBLIC_API_URL ?? (isLocal ? "http://localhost:8080" : undefined);
    const webUrl = env.EXPO_PUBLIC_WEB_URL ?? (isLocal ? "http://localhost:3000" : undefined);
    for (const [key, value] of [
      ["EXPO_PUBLIC_API_URL", apiUrl],
      ["EXPO_PUBLIC_WEB_URL", webUrl],
    ] as const) {
      if (value === undefined) {
        ctx.addIssue({
          code: "custom",
          path: [key],
          message: "is required outside local development",
        });
      }
    }
    if (!isLocal && env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
      ctx.addIssue({
        code: "custom",
        path: ["EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST"],
        message: "is only allowed in local development and tests",
      });
    }
    if (apiUrl === undefined || webUrl === undefined) return z.NEVER;
    return {
      appEnv: env.EXPO_PUBLIC_APP_ENV,
      apiUrl,
      webUrl: webUrl.replace(/\/+$/, ""),
      linkDomain: env.EXPO_PUBLIC_LINK_DOMAIN ?? null,
      authEmulatorHost: isLocal ? (env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST ?? null) : null,
    };
  });

export type MobileEnv = z.output<typeof mobileEnvSchema>;

export function loadMobileEnv(source: EnvSource): MobileEnv {
  return parseEnv(mobileEnvSchema, source, "mobile");
}

// Each variable is referenced explicitly so Expo can inline it into the bundle.
export const mobileEnv: MobileEnv = loadMobileEnv({
  EXPO_PUBLIC_APP_ENV: process.env.EXPO_PUBLIC_APP_ENV,
  EXPO_PUBLIC_API_URL: process.env.EXPO_PUBLIC_API_URL,
  EXPO_PUBLIC_WEB_URL: process.env.EXPO_PUBLIC_WEB_URL,
  EXPO_PUBLIC_LINK_DOMAIN: process.env.EXPO_PUBLIC_LINK_DOMAIN,
  EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.EXPO_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
});

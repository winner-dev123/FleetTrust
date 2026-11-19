import { type EnvSource, envFields, parseEnv } from "@fleettrust/env";
import { z } from "zod";

const projectId = z
  .string()
  .regex(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/, "must be a Firebase project ID");

/**
 * Public (browser-visible) configuration. Only NEXT_PUBLIC_* values belong here, and
 * they are inlined into the client bundle at build time, so they must never be secrets.
 * (The Firebase web API key is a public identifier, not a secret; access is controlled by
 * Firebase Auth settings, App Check and the API's own authorization.)
 */
const webEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ENV: envFields.appEnv(),
    NEXT_PUBLIC_API_URL: envFields.httpUrl().optional(),
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: projectId.default("demo-fleettrust"),
    NEXT_PUBLIC_FIREBASE_API_KEY: z.string().min(1).optional(),
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: z.string().min(1).optional(),
    NEXT_PUBLIC_FIREBASE_APP_ID: z.string().min(1).optional(),
    /** Local only: talk to the Auth emulator (`pnpm emulators`). Refused when deployed. */
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: z
      .string()
      .regex(/^[\w.-]+:\d{2,5}$/, "must be host:port")
      .optional(),
  })
  .transform((env, ctx) => {
    const isLocal = env.NEXT_PUBLIC_APP_ENV === "local" || env.NEXT_PUBLIC_APP_ENV === "test";
    const issue = (path: string, message: string) => {
      ctx.addIssue({ code: "custom", path: [path], message });
    };
    const apiUrl = env.NEXT_PUBLIC_API_URL ?? (isLocal ? "http://localhost:8080" : undefined);
    if (apiUrl === undefined) issue("NEXT_PUBLIC_API_URL", "is required outside local development");
    if (!isLocal) {
      if (env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST !== undefined) {
        issue(
          "NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST",
          "must not be set outside local development",
        );
      }
      if (env.NEXT_PUBLIC_FIREBASE_PROJECT_ID.startsWith("demo-")) {
        issue(
          "NEXT_PUBLIC_FIREBASE_PROJECT_ID",
          "must be a real Firebase project outside local development",
        );
      }
      if (env.NEXT_PUBLIC_FIREBASE_API_KEY === undefined) {
        issue("NEXT_PUBLIC_FIREBASE_API_KEY", "is required outside local development");
      }
    }
    if (apiUrl === undefined) return z.NEVER;
    const firebaseProjectId = env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    return {
      appEnv: env.NEXT_PUBLIC_APP_ENV,
      apiUrl,
      firebase: {
        projectId: firebaseProjectId,
        // The emulator accepts any API key; real projects must provide theirs.
        apiKey: env.NEXT_PUBLIC_FIREBASE_API_KEY ?? "demo-api-key",
        authDomain: env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN ?? `${firebaseProjectId}.firebaseapp.com`,
        appId: env.NEXT_PUBLIC_FIREBASE_APP_ID,
        authEmulatorHost: env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
      },
    };
  });

export type WebEnv = z.output<typeof webEnvSchema>;

export function loadWebEnv(source: EnvSource): WebEnv {
  return parseEnv(webEnvSchema, source, "web");
}

// Each variable is referenced explicitly so Next.js can inline it into the client bundle.
export const webEnv: WebEnv = loadWebEnv({
  NEXT_PUBLIC_APP_ENV: process.env.NEXT_PUBLIC_APP_ENV,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  NEXT_PUBLIC_FIREBASE_API_KEY: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  NEXT_PUBLIC_FIREBASE_APP_ID: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: process.env.NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST,
});

import { z } from "zod";

import { timeZoneSchema } from "./entitlements.js";

/**
 * Public display name: optional until the first contribution. Trimmed, 1–50 characters,
 * no control characters (prevents invisible or spoofed names and log/terminal injection).
 */
export const displayNameSchema = z
  .string()
  .trim()
  .min(1, "Display name cannot be empty")
  .max(50, "Display name must be 50 characters or fewer")
  .refine((value) => !/\p{Cc}|\p{Cf}/u.test(value), "Display name contains invalid characters");

/** `GET /v1/me`: the signed-in user's own profile. Never includes the Firebase UID. */
export const meResponseSchema = z.object({
  id: z.uuid(),
  email: z.string().nullable(),
  emailVerified: z.boolean(),
  displayName: z.string().nullable(),
  /** False until a display name is set; contributing actions require it. */
  profileComplete: z.boolean(),
  /** IANA timezone: personal daily quotas reset at local midnight. */
  timeZone: z.string(),
  createdAt: z.iso.datetime(),
});
export type MeResponse = z.infer<typeof meResponseSchema>;

/** `PATCH /v1/me`. `displayName: null` clears it. */
export const updateMeRequestSchema = z
  .object({ displayName: displayNameSchema.nullable(), timeZone: timeZoneSchema })
  .partial()
  .strict();
export type UpdateMeRequest = z.infer<typeof updateMeRequestSchema>;

/** Machine-readable reasons on 401/403/409 responses, so clients know whether to refresh, re-auth or prompt. */
export const authErrorReasonSchema = z.enum([
  "missing_token",
  "malformed_token",
  "invalid_token",
  "expired_token",
  "revoked_token",
  "user_disabled",
  "reauthentication_required",
  "app_check_failed",
  "account_suspended",
  "profile_incomplete",
  /** New accounts are paused by an admin; existing accounts are unaffected. */
  "signups_paused",
  /** Limited pilot: this email isn't on the pilot allowlist (setting signups.pilot_allowlist). */
  "pilot_invite_only",
]);
export type AuthErrorReason = z.infer<typeof authErrorReasonSchema>;

import { z } from "zod";

/**
 * Privacy (Prompt 27, ADR-0034): consent records, data export and account deletion.
 */

/** Must match CONSENT_PURPOSES in @fleettrust/db. */
export const CONSENT_PURPOSES = ["terms", "privacy", "analytics", "marketing_email"] as const;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number];

/** Terms and privacy notice are required to use FleetTrust; the others are optional, off by default. */
export const REQUIRED_CONSENTS: readonly ConsentPurpose[] = ["terms", "privacy"];

/**
 * The version of each document or purpose text people currently agree to. Bump it when the
 * text changes; people are asked again when their recorded version is older.
 */
export const CURRENT_CONSENT_VERSIONS: Readonly<Record<ConsentPurpose, string>> = {
  terms: "2026-11-24",
  privacy: "2026-11-24",
  analytics: "2026-11-24",
  marketing_email: "2026-11-24",
};

export const CONSENT_LABELS: Readonly<Record<ConsentPurpose, string>> = {
  terms: "Terms of service",
  privacy: "Privacy notice",
  analytics: "Anonymous usage statistics",
  marketing_email: "Product news by email",
};

export const consentStateSchema = z.object({
  purpose: z.enum(CONSENT_PURPOSES),
  required: z.boolean(),
  currentVersion: z.string(),
  /** Latest recorded choice, or null if the person never answered. */
  granted: z.boolean().nullable(),
  version: z.string().nullable(),
  recordedAt: z.iso.datetime().nullable(),
  /** Required and not granted for the current version: ask again. */
  needsAnswer: z.boolean(),
});
export type ConsentStateDto = z.infer<typeof consentStateSchema>;

export const recordConsentSchema = z
  .object({
    purpose: z.enum(CONSENT_PURPOSES),
    version: z.string().min(1).max(40),
    granted: z.boolean(),
  })
  .strict();
export type RecordConsent = z.infer<typeof recordConsentSchema>;

export const privacyErrorReasonSchema = z.enum([
  /** The person is the only owner of an organization: transfer or close it first. */
  "sole_owner",
  /** The consent version isn't the current one (reload and read the latest text). */
  "stale_consent_version",
  /** Required consents can be withdrawn only by deleting the account. */
  "required_consent",
]);
export type PrivacyErrorReason = z.infer<typeof privacyErrorReasonSchema>;

/** The personal data export: one JSON document, sections keyed by name. */
export const dataExportSchema = z.object({
  format: z.literal("fleettrust-export-v1"),
  generatedAt: z.iso.datetime(),
  userId: z.uuid(),
  sections: z.record(z.string(), z.unknown()),
});
export type DataExport = z.infer<typeof dataExportSchema>;

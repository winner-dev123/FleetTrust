import { z } from "zod";

/**
 * Verification badges (SRS §8, F-020..F-023). Evidence-based labels with an expiry date.
 * Plans never affect them (ADR-0009).
 */
export const BADGE_TYPES = ["driver", "business", "location"] as const;
export const badgeTypeSchema = z.enum(BADGE_TYPES);
export type BadgeType = z.infer<typeof badgeTypeSchema>;

/** Which subject each badge applies to. */
export const BADGE_SUBJECT: Readonly<Record<BadgeType, "user" | "organization">> = {
  driver: "user",
  business: "organization",
  location: "organization",
};

export const DOCUMENT_KINDS = [
  "identity_document",
  "driving_licence",
  "business_registration",
  "proof_of_address",
  "other",
] as const;
export const documentKindSchema = z.enum(DOCUMENT_KINDS);

/** Accepted evidence formats. The API checks the actual bytes, not just this declaration. */
export const DOCUMENT_CONTENT_TYPES = [
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
] as const;
export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024;
export const MAX_DOCUMENTS_PER_CASE = 10;

/** Badges can be renewed this many days before they expire. */
export const REVERIFICATION_WINDOW_DAYS = 30;
/** Appeals must be filed within this many days of the decision. */
export const APPEAL_WINDOW_DAYS = 30;

export const caseStatusSchema = z.enum([
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
]);
export type CaseStatus = z.infer<typeof caseStatusSchema>;

export const openCaseRequestSchema = z
  .object({
    badgeType: badgeTypeSchema,
    /** Required for business/location badges; the caller needs verification.manage there. */
    organizationId: z.uuid().optional(),
  })
  .strict();
export type OpenCaseRequest = z.infer<typeof openCaseRequestSchema>;

export const addDocumentRequestSchema = z
  .object({
    kind: documentKindSchema,
    contentType: z.enum(DOCUMENT_CONTENT_TYPES),
    size: z.number().int().min(1).max(MAX_DOCUMENT_BYTES),
  })
  .strict();
export type AddDocumentRequest = z.infer<typeof addDocumentRequestSchema>;

export const verificationDocumentSchema = z.object({
  id: z.uuid(),
  kind: documentKindSchema,
  status: z.enum(["pending_upload", "available", "rejected", "purged"]),
  contentType: z.string().nullable(),
  size: z.number().int().nullable(),
  createdAt: z.iso.datetime(),
});
export type VerificationDocumentDto = z.infer<typeof verificationDocumentSchema>;

/** Returned once per document: where to PUT the bytes, and which headers to send. */
export const documentUploadSchema = z.object({
  document: verificationDocumentSchema,
  upload: z.object({
    url: z.string(),
    method: z.literal("PUT"),
    headers: z.record(z.string(), z.string()),
    expiresAt: z.iso.datetime(),
  }),
});
export type DocumentUpload = z.infer<typeof documentUploadSchema>;

export const verificationCaseSchema = z.object({
  id: z.uuid(),
  subject: z.object({ type: z.enum(["user", "organization"]), id: z.uuid() }),
  badgeType: badgeTypeSchema,
  status: caseStatusSchema,
  renewsBadgeId: z.uuid().nullable(),
  submittedAt: z.iso.datetime().nullable(),
  decidedAt: z.iso.datetime().nullable(),
  /** Shown to the applicant for rejections and change requests. */
  decisionReason: z.string().nullable(),
  documents: z.array(verificationDocumentSchema),
  appeal: z.object({ id: z.uuid(), status: z.enum(["open", "upheld", "overturned"]) }).nullable(),
  createdAt: z.iso.datetime(),
});
export type VerificationCaseDto = z.infer<typeof verificationCaseSchema>;

export const badgeSchema = z.object({
  id: z.uuid(),
  badgeType: badgeTypeSchema,
  grantedAt: z.iso.datetime(),
  expiresAt: z.iso.datetime(),
  status: z.enum(["active", "expired", "revoked", "superseded"]),
  /** Within REVERIFICATION_WINDOW_DAYS of expiry: open a renewal case. */
  reverificationDue: z.boolean(),
  revocationReason: z.string().nullable(),
  appeal: z.object({ id: z.uuid(), status: z.enum(["open", "upheld", "overturned"]) }).nullable(),
});
export type BadgeDto = z.infer<typeof badgeSchema>;

/**
 * Public trust labels (SRS §8.1). Only an active badge yields "verified"; everything else —
 * no case, pending, rejected, expired, revoked — is "unverified". No reasons are exposed.
 */
export const verificationLabelsSchema = z.object({
  subject: z.object({ type: z.enum(["user", "organization"]), id: z.uuid() }),
  labels: z.array(
    z.object({
      badgeType: badgeTypeSchema,
      status: z.enum(["verified", "unverified"]),
      expiresAt: z.iso.datetime().nullable(),
    }),
  ),
});
export type VerificationLabels = z.infer<typeof verificationLabelsSchema>;

export const appealRequestSchema = z
  .object({ statement: z.string().trim().min(10).max(2000) })
  .strict();

// --- Reviewer API ---------------------------------------------------------------------------

export const reviewDecisionRequestSchema = z.discriminatedUnion("decision", [
  z
    .object({
      decision: z.literal("approve"),
      /** Defaults to one year from now; at most three years. */
      expiresAt: z.iso.datetime().optional(),
      note: z.string().trim().max(1000).optional(),
    })
    .strict(),
  z.object({ decision: z.literal("reject"), reason: z.string().trim().min(3).max(1000) }).strict(),
  z
    .object({
      decision: z.literal("request_changes"),
      reason: z.string().trim().min(3).max(1000),
    })
    .strict(),
]);
export type ReviewDecisionRequest = z.infer<typeof reviewDecisionRequestSchema>;

export const revokeBadgeRequestSchema = z
  .object({ reason: z.string().trim().min(3).max(1000) })
  .strict();

export const appealDecisionRequestSchema = z
  .object({
    decision: z.enum(["uphold", "overturn"]),
    reason: z.string().trim().min(3).max(1000),
  })
  .strict();

export const documentAccessSchema = z.object({
  /** One-time link, valid for a few minutes. Never log or share it. */
  url: z.string(),
  expiresAt: z.iso.datetime(),
});

export const reviewCaseSchema = verificationCaseSchema.extend({
  openedBy: z.uuid(),
  decidedBy: z.uuid().nullable(),
  documents: z.array(
    verificationDocumentSchema.extend({
      sha256: z.string().nullable(),
      scanResult: z.string().nullable(),
    }),
  ),
});
export type ReviewCaseDto = z.infer<typeof reviewCaseSchema>;

export const reviewAppealSchema = z.object({
  id: z.uuid(),
  caseId: z.uuid().nullable(),
  badgeId: z.uuid().nullable(),
  statement: z.string(),
  status: z.enum(["open", "upheld", "overturned"]),
  filedBy: z.uuid(),
  originalDecidedBy: z.uuid().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewAppealDto = z.infer<typeof reviewAppealSchema>;

export const verificationErrorReasonSchema = z.enum([
  "badge_not_applicable",
  "case_already_open",
  "case_not_editable",
  "too_many_documents",
  "upload_missing",
  "upload_size_mismatch",
  "content_type_mismatch",
  "malware_detected",
  "no_documents",
  "conflict_of_interest",
  "appeal_window_closed",
  "appeal_exists",
  "not_appealable",
  "renewal_not_due",
  "access_expired",
]);
export type VerificationErrorReason = z.infer<typeof verificationErrorReasonSchema>;

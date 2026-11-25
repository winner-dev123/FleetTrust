import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { organizations } from "./organizations.js";
import { SUBJECT_TYPES } from "./plans.js";
import { users } from "./users.js";

/**
 * Document verification (SRS F-020..F-023, FR-08, ADR-0006). Evidence-based badges with an
 * expiry date. Nothing here reads or is read by plans or entitlements (ADR-0009).
 */

/** driver: a person; business and location: an organization. */
export const BADGE_TYPES = ["driver", "business", "location"] as const;
export type BadgeType = (typeof BADGE_TYPES)[number];

export const CASE_STATUSES = [
  "draft",
  "submitted",
  "changes_requested",
  "approved",
  "rejected",
  "withdrawn",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const DOCUMENT_KINDS = [
  "identity_document",
  "driving_licence",
  "business_registration",
  "proof_of_address",
  "other",
] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_STATUSES = ["pending_upload", "available", "rejected", "purged"] as const;
export type DocumentStatus = (typeof DOCUMENT_STATUSES)[number];

const subjectCheck = (subjectType: unknown, userId: unknown, organizationId: unknown) =>
  sql`(${subjectType} = 'user' AND ${userId} IS NOT NULL AND ${organizationId} IS NULL) OR
      (${subjectType} = 'organization' AND ${organizationId} IS NOT NULL AND ${userId} IS NULL)`;

/** Driver badges belong to people; business and location badges to organizations. */
const badgeSubjectCheck = (badgeType: unknown, subjectType: unknown) =>
  sql`(${badgeType} = 'driver' AND ${subjectType} = 'user') OR
      (${badgeType} IN ('business', 'location') AND ${subjectType} = 'organization')`;

const OPEN_CASE = sql.raw(`status IN ('draft', 'submitted', 'changes_requested')`);

export const verificationCases = pgTable(
  "verification_cases",
  {
    id: id(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    badgeType: text("badge_type", { enum: BADGE_TYPES }).notNull(),
    status: text("status", { enum: CASE_STATUSES }).notNull().default("draft"),
    openedBy: uuid("opened_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Set when this case renews an existing badge (reverification). */
    renewsBadgeId: uuid("renews_badge_id").references((): AnyPgColumn => verificationBadges.id, {
      onDelete: "restrict",
    }),
    submittedAt: timestamp("submitted_at", { withTimezone: true, mode: "date" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    /** Shown to the applicant. Required for rejections and change requests. */
    decisionReason: text("decision_reason"),
    ...timestamps(),
  },
  (t) => [
    index("verification_cases_org_idx").on(t.organizationId, t.createdAt.desc()),
    index("verification_cases_user_idx").on(t.userId, t.createdAt.desc()),
    index("verification_cases_queue_idx").on(t.status, t.submittedAt),
    // One open case per subject and badge type.
    uniqueIndex("verification_cases_one_open")
      .on(sql`COALESCE(${t.organizationId}, ${t.userId})`, t.badgeType)
      .where(OPEN_CASE),
    check("verification_cases_subject", subjectCheck(t.subjectType, t.userId, t.organizationId)),
    check("verification_cases_badge_subject", badgeSubjectCheck(t.badgeType, t.subjectType)),
    check(
      "verification_cases_status_valid",
      sql`${t.status} IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn')`,
    ),
    check(
      "verification_cases_decision_consistent",
      sql`(${t.status} IN ('approved', 'rejected')) = (${t.decidedAt} IS NOT NULL AND ${t.decidedBy} IS NOT NULL)`,
    ),
    check(
      "verification_cases_reason_required",
      // COALESCE: a length check on NULL is NULL, which a CHECK treats as passing (fixed in Prompt 27).
      sql`${t.status} NOT IN ('rejected', 'changes_requested') OR COALESCE(char_length(${t.decisionReason}), 0) >= 3`,
    ),
  ],
);

/**
 * Evidence files. Bytes live encrypted in the sensitive bucket (AES-256-GCM, per-file data
 * key wrapped by Cloud KMS); this row holds metadata and the wrapped key, never content.
 */
export const verificationDocuments = pgTable(
  "verification_documents",
  {
    id: id(),
    caseId: uuid("case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "restrict" }),
    kind: text("kind", { enum: DOCUMENT_KINDS }).notNull(),
    status: text("status", { enum: DOCUMENT_STATUSES }).notNull().default("pending_upload"),
    declaredContentType: text("declared_content_type").notNull(),
    declaredSize: integer("declared_size").notNull(),
    uploadedBy: uuid("uploaded_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** Object key in the quarantine bucket until the scan passes. */
    quarantineKey: text("quarantine_key").notNull(),
    /** Object key in the sensitive bucket once available. */
    storageKey: text("storage_key"),
    /** Detected from the bytes (magic numbers), not trusted from the client. */
    contentType: text("content_type"),
    size: integer("size"),
    sha256: text("sha256"),
    encryptionKeyId: text("encryption_key_id"),
    wrappedKey: text("wrapped_key"),
    iv: text("iv"),
    authTag: text("auth_tag"),
    /** e.g. `clean`, `infected:Eicar-Test-Signature`, `type_mismatch`. */
    scanResult: text("scan_result"),
    availableAt: timestamp("available_at", { withTimezone: true, mode: "date" }),
    purgedAt: timestamp("purged_at", { withTimezone: true, mode: "date" }),
    ...timestamps(),
  },
  (t) => [
    index("verification_documents_case_idx").on(t.caseId),
    check(
      "verification_documents_kind_valid",
      sql`${t.kind} IN ('identity_document', 'driving_licence', 'business_registration', 'proof_of_address', 'other')`,
    ),
    check(
      "verification_documents_status_valid",
      sql`${t.status} IN ('pending_upload', 'available', 'rejected', 'purged')`,
    ),
    check(
      "verification_documents_size_range",
      sql`${t.declaredSize} BETWEEN 1 AND 10485760 AND (${t.size} IS NULL OR ${t.size} BETWEEN 1 AND 10485760)`,
    ),
    check(
      "verification_documents_available_complete",
      sql`${t.status} <> 'available' OR (${t.storageKey} IS NOT NULL AND ${t.wrappedKey} IS NOT NULL AND ${t.iv} IS NOT NULL AND ${t.authTag} IS NOT NULL AND ${t.sha256} IS NOT NULL AND ${t.availableAt} IS NOT NULL)`,
    ),
  ],
);

/**
 * Granted badges. Active = not ended and not expired; expired badges disappear from labels
 * automatically. Ended badges are kept for history (revoked, or superseded by a renewal).
 */
export const verificationBadges = pgTable(
  "verification_badges",
  {
    id: id(),
    subjectType: text("subject_type", { enum: SUBJECT_TYPES }).notNull(),
    userId: uuid("user_id").references(() => users.id, { onDelete: "restrict" }),
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    badgeType: text("badge_type", { enum: BADGE_TYPES }).notNull(),
    /** Every badge comes from a reviewed case (SRS trust rule 2). */
    caseId: uuid("case_id")
      .notNull()
      .references(() => verificationCases.id, { onDelete: "restrict" }),
    grantedBy: uuid("granted_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    grantedAt: timestamp("granted_at", { withTimezone: true, mode: "date" }).notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true, mode: "date" }),
    endedBy: uuid("ended_by").references(() => users.id, { onDelete: "restrict" }),
    endReason: text("end_reason", { enum: ["revoked", "superseded"] }),
    endNote: text("end_note"),
    ...timestamps(),
  },
  (t) => [
    index("verification_badges_org_idx").on(t.organizationId),
    index("verification_badges_user_idx").on(t.userId),
    uniqueIndex("verification_badges_one_current")
      .on(sql`COALESCE(${t.organizationId}, ${t.userId})`, t.badgeType)
      .where(sql`${t.endedAt} IS NULL`),
    check("verification_badges_subject", subjectCheck(t.subjectType, t.userId, t.organizationId)),
    check("verification_badges_badge_subject", badgeSubjectCheck(t.badgeType, t.subjectType)),
    check("verification_badges_expiry_after_grant", sql`${t.expiresAt} > ${t.grantedAt}`),
    check(
      "verification_badges_ended_consistent",
      sql`(${t.endedAt} IS NULL) = (${t.endReason} IS NULL)`,
    ),
    check(
      "verification_badges_revocation_reason",
      sql`${t.endReason} IS DISTINCT FROM 'revoked' OR (${t.endedBy} IS NOT NULL AND COALESCE(char_length(${t.endNote}), 0) >= 3)`,
    ),
  ],
);

/** One appeal per decision: a rejected case or a revoked badge. */
export const verificationAppeals = pgTable(
  "verification_appeals",
  {
    id: id(),
    caseId: uuid("case_id").references(() => verificationCases.id, { onDelete: "restrict" }),
    badgeId: uuid("badge_id").references(() => verificationBadges.id, { onDelete: "restrict" }),
    /** Denormalised for tenant-scoped listing. */
    organizationId: uuid("organization_id").references(() => organizations.id, {
      onDelete: "restrict",
    }),
    statement: text("statement").notNull(),
    status: text("status", { enum: ["open", "upheld", "overturned"] })
      .notNull()
      .default("open"),
    filedBy: uuid("filed_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    decidedBy: uuid("decided_by").references(() => users.id, { onDelete: "restrict" }),
    decidedAt: timestamp("decided_at", { withTimezone: true, mode: "date" }),
    decisionReason: text("decision_reason"),
    ...timestamps(),
  },
  (t) => [
    uniqueIndex("verification_appeals_case_key").on(t.caseId),
    uniqueIndex("verification_appeals_badge_key").on(t.badgeId),
    index("verification_appeals_org_idx").on(t.organizationId),
    index("verification_appeals_queue_idx").on(t.status, t.createdAt),
    check("verification_appeals_target", sql`(${t.caseId} IS NULL) <> (${t.badgeId} IS NULL)`),
    check(
      "verification_appeals_statement_length",
      sql`char_length(${t.statement}) BETWEEN 10 AND 2000`,
    ),
    check(
      "verification_appeals_status_valid",
      sql`${t.status} IN ('open', 'upheld', 'overturned')`,
    ),
    check(
      "verification_appeals_decision_consistent",
      sql`(${t.status} = 'open') = (${t.decidedAt} IS NULL) AND (${t.status} = 'open' OR (${t.decidedBy} IS NOT NULL AND char_length(${t.decisionReason}) >= 3))`,
    ),
  ],
);

/**
 * One-time, short-lived reviewer access to a decrypted document (FR-08). Only the token's
 * hash is stored; every grant and every use is audited.
 */
export const documentAccessGrants = pgTable(
  "document_access_grants",
  {
    id: id(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => verificationDocuments.id, { onDelete: "restrict" }),
    reviewerId: uuid("reviewer_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true, mode: "date" }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true, mode: "date" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("document_access_grants_token_key").on(t.tokenHash),
    index("document_access_grants_document_idx").on(t.documentId),
  ],
);

export type VerificationCase = typeof verificationCases.$inferSelect;
export type VerificationDocument = typeof verificationDocuments.$inferSelect;
export type VerificationBadge = typeof verificationBadges.$inferSelect;
export type VerificationAppeal = typeof verificationAppeals.$inferSelect;

import { createHash, randomBytes } from "node:crypto";

import {
  and,
  asc,
  type Database,
  eq,
  type Executor,
  gt,
  inArray,
  isNull,
  lte,
  memberships,
  ne,
  or,
  recordAuditEvent,
  type User,
  documentAccessGrants,
  type VerificationAppeal,
  verificationAppeals,
  verificationBadges,
  type VerificationCase,
  verificationCases,
  verificationDocuments,
} from "@fleettrust/db";
import type {
  CaseStatus,
  ReviewAppealDto,
  ReviewCaseDto,
  ReviewDecisionRequest,
} from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import type { ApiEnv } from "../../config/env.js";
import { API_ENV } from "../../config/config.module.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { decryptBlob, KEY_WRAPPER, type KeyWrapper } from "../../platform/crypto/envelope.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { DAY_MS, notFound, subjectIdOf, toDocumentDto, verificationError } from "./shared.js";
import { VerificationService } from "./verification.service.js";

const ACCESS_TTL_MS = 5 * 60 * 1000;
const DEFAULT_BADGE_DAYS = 365;
const MAX_BADGE_DAYS = 3 * 365;
const requestId = () => currentRequestContext()?.requestId;
const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/**
 * Reviewer side (platform role `verification_reviewer`): queue, decisions, one-time document
 * access, badge revocation, appeals and retention. Every action is audited as `admin`.
 */
@Injectable()
export class ReviewService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly verification: VerificationService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  async queue(status: CaseStatus): Promise<ReviewCaseDto[]> {
    const rows = await this.db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.status, status))
      .orderBy(asc(verificationCases.submittedAt), asc(verificationCases.createdAt))
      .limit(100);
    return this.reviewDtos(rows);
  }

  async getCase(caseId: string): Promise<ReviewCaseDto> {
    const [row] = await this.db
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, caseId))
      .limit(1);
    if (!row) throw notFound();
    const [dto] = await this.reviewDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  async decide(
    reviewer: User,
    caseId: string,
    input: ReviewDecisionRequest,
  ): Promise<ReviewCaseDto> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(verificationCases)
        .where(eq(verificationCases.id, caseId))
        .for("update");
      if (!row) throw notFound();
      await this.assertNoConflict(tx, reviewer, row);
      if (row.status !== "submitted") throw verificationError(409, "case_not_editable");
      const now = new Date();

      if (input.decision === "request_changes") {
        await tx
          .update(verificationCases)
          .set({ status: "changes_requested", decisionReason: input.reason })
          .where(eq(verificationCases.id, row.id));
        await this.audit(tx, reviewer, row, "verification.changes_requested", {
          reason: input.reason,
        });
        return;
      }
      if (input.decision === "reject") {
        await tx
          .update(verificationCases)
          .set({
            status: "rejected",
            decidedAt: now,
            decidedBy: reviewer.id,
            decisionReason: input.reason,
          })
          .where(eq(verificationCases.id, row.id));
        await this.audit(tx, reviewer, row, "verification.case_rejected", { reason: input.reason });
        return;
      }

      const expiresAt = input.expiresAt
        ? new Date(input.expiresAt)
        : new Date(now.getTime() + DEFAULT_BADGE_DAYS * DAY_MS);
      if (
        expiresAt.getTime() <= now.getTime() + DAY_MS ||
        expiresAt.getTime() > now.getTime() + MAX_BADGE_DAYS * DAY_MS
      ) {
        throw verificationError(400, "badge_not_applicable");
      }
      // A renewal (or any new grant) supersedes the current badge of the same type.
      const superseded = await tx
        .update(verificationBadges)
        .set({ endedAt: now, endedBy: reviewer.id, endReason: "superseded" })
        .where(
          and(
            row.organizationId
              ? eq(verificationBadges.organizationId, row.organizationId)
              : eq(verificationBadges.userId, row.userId ?? ""),
            eq(verificationBadges.badgeType, row.badgeType),
            isNull(verificationBadges.endedAt),
          ),
        )
        .returning({ id: verificationBadges.id });
      const [badge] = await tx
        .insert(verificationBadges)
        .values({
          subjectType: row.subjectType,
          userId: row.userId,
          organizationId: row.organizationId,
          badgeType: row.badgeType,
          caseId: row.id,
          grantedBy: reviewer.id,
          grantedAt: now,
          expiresAt,
        })
        .returning();
      if (!badge) throw new Error("badge insert returned no row");
      await tx
        .update(verificationCases)
        .set({ status: "approved", decidedAt: now, decidedBy: reviewer.id, decisionReason: null })
        .where(eq(verificationCases.id, row.id));
      await this.audit(tx, reviewer, row, "verification.badge_granted", {
        badgeId: badge.id,
        expiresAt: expiresAt.toISOString(),
        superseded: superseded.map((s) => s.id),
        note: input.note ?? null,
      });
    });
    return this.getCase(caseId);
  }

  async revokeBadge(reviewer: User, badgeId: string, reason: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [badge] = await tx
        .select()
        .from(verificationBadges)
        .where(and(eq(verificationBadges.id, badgeId), isNull(verificationBadges.endedAt)))
        .for("update");
      if (!badge) throw notFound();
      const [origin] = await tx
        .select()
        .from(verificationCases)
        .where(eq(verificationCases.id, badge.caseId));
      if (!origin) throw notFound();
      await this.assertNoConflict(tx, reviewer, origin);
      await tx
        .update(verificationBadges)
        .set({ endedAt: new Date(), endedBy: reviewer.id, endReason: "revoked", endNote: reason })
        .where(eq(verificationBadges.id, badge.id));
      await this.audit(tx, reviewer, origin, "verification.badge_revoked", { badgeId, reason });
    });
  }

  // --- Document access ----------------------------------------------------------------------

  /** Issues a one-time, five-minute link to view a decrypted document. Audited. */
  async grantDocumentAccess(
    reviewer: User,
    documentId: string,
  ): Promise<{ url: string; expiresAt: string }> {
    return this.db.transaction(async (tx) => {
      const [found] = await tx
        .select({ document: verificationDocuments, verificationCase: verificationCases })
        .from(verificationDocuments)
        .innerJoin(verificationCases, eq(verificationCases.id, verificationDocuments.caseId))
        .where(
          and(
            eq(verificationDocuments.id, documentId),
            eq(verificationDocuments.status, "available"),
          ),
        )
        .limit(1);
      if (!found) throw notFound();
      await this.assertNoConflict(tx, reviewer, found.verificationCase);
      const token = randomBytes(32).toString("base64url");
      const expiresAt = new Date(Date.now() + ACCESS_TTL_MS);
      await tx.insert(documentAccessGrants).values({
        documentId,
        reviewerId: reviewer.id,
        tokenHash: hashToken(token),
        expiresAt,
      });
      await this.audit(
        tx,
        reviewer,
        found.verificationCase,
        "verification.document_access_granted",
        {
          documentId,
        },
      );
      return {
        url: `${this.env.PUBLIC_API_URL.replace(/\/+$/, "")}/v1/admin/verification/document-access/${token}`,
        expiresAt: expiresAt.toISOString(),
      };
    });
  }

  /** Redeems a one-time link: decrypts and returns the document. Used links can't be reused. */
  async redeemDocumentAccess(token: string): Promise<{ data: Buffer; contentType: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw notFound();
    const found = await this.db.transaction(async (tx) => {
      const [grant] = await tx
        .update(documentAccessGrants)
        .set({ usedAt: new Date() })
        .where(
          and(
            eq(documentAccessGrants.tokenHash, hashToken(token)),
            isNull(documentAccessGrants.usedAt),
            gt(documentAccessGrants.expiresAt, new Date()),
          ),
        )
        .returning();
      if (!grant) throw verificationError(410, "access_expired");
      const [row] = await tx
        .select({ document: verificationDocuments, verificationCase: verificationCases })
        .from(verificationDocuments)
        .innerJoin(verificationCases, eq(verificationCases.id, verificationDocuments.caseId))
        .where(
          and(
            eq(verificationDocuments.id, grant.documentId),
            eq(verificationDocuments.status, "available"),
          ),
        )
        .limit(1);
      if (!row) throw verificationError(410, "access_expired");
      await recordAuditEvent(tx, {
        actorType: "admin",
        actorId: grant.reviewerId,
        organizationId: row.verificationCase.organizationId,
        action: "verification.document_accessed",
        targetType: "verification_case",
        targetId: row.verificationCase.id,
        requestId: requestId(),
        metadata: { documentId: row.document.id },
      });
      return row.document;
    });
    if (
      !found.storageKey ||
      !found.wrappedKey ||
      !found.iv ||
      !found.authTag ||
      !found.contentType
    ) {
      throw verificationError(410, "access_expired");
    }
    const ciphertext = await this.storage.read("sensitive", found.storageKey);
    const data = await decryptBlob(
      this.keys,
      {
        ciphertext,
        wrappedKey: Buffer.from(found.wrappedKey, "base64"),
        iv: Buffer.from(found.iv, "base64"),
        authTag: Buffer.from(found.authTag, "base64"),
      },
      found.id,
    );
    return { data, contentType: found.contentType };
  }

  // --- Appeals ------------------------------------------------------------------------------

  async appeals(status: "open" | "upheld" | "overturned"): Promise<ReviewAppealDto[]> {
    const rows = await this.db
      .select()
      .from(verificationAppeals)
      .where(eq(verificationAppeals.status, status))
      .orderBy(asc(verificationAppeals.createdAt))
      .limit(100);
    const result: ReviewAppealDto[] = [];
    for (const appeal of rows) {
      result.push({
        id: appeal.id,
        caseId: appeal.caseId,
        badgeId: appeal.badgeId,
        statement: appeal.statement,
        status: appeal.status,
        filedBy: appeal.filedBy,
        originalDecidedBy: await this.originalDecider(this.db, appeal),
        createdAt: appeal.createdAt.toISOString(),
      });
    }
    return result;
  }

  /**
   * Decides an appeal. The reviewer must not be the one who made the original decision
   * (four-eyes). Overturning a rejection sends the case back to the queue; overturning a
   * revocation reinstates the badge until its original expiry.
   */
  async decideAppeal(
    reviewer: User,
    appealId: string,
    decision: "uphold" | "overturn",
    reason: string,
  ): Promise<ReviewAppealDto> {
    await this.db.transaction(async (tx) => {
      const [appeal] = await tx
        .select()
        .from(verificationAppeals)
        .where(and(eq(verificationAppeals.id, appealId), eq(verificationAppeals.status, "open")))
        .for("update");
      if (!appeal) throw notFound();
      const originalDecider = await this.originalDecider(tx, appeal);
      const origin = await this.appealCase(tx, appeal);
      await this.assertNoConflict(tx, reviewer, origin);
      if (originalDecider === reviewer.id) throw verificationError(403, "conflict_of_interest");
      const now = new Date();
      await tx
        .update(verificationAppeals)
        .set({
          status: decision === "uphold" ? "upheld" : "overturned",
          decidedBy: reviewer.id,
          decidedAt: now,
          decisionReason: reason,
        })
        .where(eq(verificationAppeals.id, appeal.id));

      if (decision === "overturn" && appeal.caseId) {
        await tx
          .update(verificationCases)
          .set({
            status: "submitted",
            submittedAt: now,
            decidedAt: null,
            decidedBy: null,
            decisionReason: null,
          })
          .where(eq(verificationCases.id, appeal.caseId));
      }
      if (decision === "overturn" && appeal.badgeId) {
        const [revoked] = await tx
          .select()
          .from(verificationBadges)
          .where(eq(verificationBadges.id, appeal.badgeId));
        const [current] = revoked
          ? await tx
              .select({ id: verificationBadges.id })
              .from(verificationBadges)
              .where(
                and(
                  revoked.organizationId
                    ? eq(verificationBadges.organizationId, revoked.organizationId)
                    : eq(verificationBadges.userId, revoked.userId ?? ""),
                  eq(verificationBadges.badgeType, revoked.badgeType),
                  isNull(verificationBadges.endedAt),
                ),
              )
          : [];
        // Reinstate only if it hasn't expired meanwhile and nothing newer replaced it.
        if (revoked && revoked.expiresAt > now && !current) {
          await tx.insert(verificationBadges).values({
            subjectType: revoked.subjectType,
            userId: revoked.userId,
            organizationId: revoked.organizationId,
            badgeType: revoked.badgeType,
            caseId: revoked.caseId,
            grantedBy: reviewer.id,
            grantedAt: now,
            expiresAt: revoked.expiresAt,
          });
        }
      }
      await this.audit(
        tx,
        reviewer,
        origin,
        decision === "uphold" ? "verification.appeal_upheld" : "verification.appeal_overturned",
        { appealId, reason },
      );
    });
    const [dto] = (await this.appeals("upheld"))
      .concat(await this.appeals("overturned"))
      .filter((a) => a.id === appealId);
    if (!dto) throw notFound();
    return dto;
  }

  // --- Retention ----------------------------------------------------------------------------

  /**
   * Deletes evidence after the retention period (OQ-14 default: 90 days after the decision),
   * plus abandoned uploads older than a day. Metadata stays for the audit trail.
   */
  async purgeExpiredDocuments(actor: User | null): Promise<number> {
    const cutoff = new Date(Date.now() - this.env.VERIFICATION_DOCUMENT_RETENTION_DAYS * DAY_MS);
    const abandoned = new Date(Date.now() - DAY_MS);
    const closed = await this.db
      .select({ id: verificationCases.id })
      .from(verificationCases)
      .where(
        or(
          and(
            inArray(verificationCases.status, ["approved", "rejected"]),
            lte(verificationCases.decidedAt, cutoff),
          ),
          and(eq(verificationCases.status, "withdrawn"), lte(verificationCases.updatedAt, cutoff)),
        ),
      );
    const candidates = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        and(
          ne(verificationDocuments.status, "purged"),
          or(
            closed.length > 0
              ? inArray(
                  verificationDocuments.caseId,
                  closed.map((c) => c.id),
                )
              : undefined,
            and(
              eq(verificationDocuments.status, "pending_upload"),
              lte(verificationDocuments.createdAt, abandoned),
            ),
          ),
        ),
      );
    for (const document of candidates) {
      if (document.storageKey) await this.storage.delete("sensitive", document.storageKey);
      await this.storage.delete("quarantine", document.quarantineKey);
      await this.db
        .update(verificationDocuments)
        .set({
          status: "purged",
          purgedAt: new Date(),
          storageKey: null,
          wrappedKey: null,
          iv: null,
          authTag: null,
        })
        .where(eq(verificationDocuments.id, document.id));
    }
    if (candidates.length > 0) {
      await recordAuditEvent(this.db, {
        actorType: actor ? "admin" : "system",
        actorId: actor?.id ?? null,
        action: "verification.documents_purged",
        targetType: "verification_document",
        requestId: requestId(),
        metadata: {
          count: candidates.length,
          retentionDays: this.env.VERIFICATION_DOCUMENT_RETENTION_DAYS,
        },
      });
    }
    return candidates.length;
  }

  // --- Helpers ------------------------------------------------------------------------------

  /** Reviewers can't act on their own cases or on organizations they belong to (AB-11). */
  private async assertNoConflict(
    tx: Executor,
    reviewer: User,
    row: VerificationCase,
  ): Promise<void> {
    if (row.userId === reviewer.id || row.openedBy === reviewer.id) {
      throw verificationError(403, "conflict_of_interest");
    }
    if (row.organizationId) {
      const [member] = await tx
        .select({ id: memberships.id })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, row.organizationId),
            eq(memberships.userId, reviewer.id),
          ),
        )
        .limit(1);
      if (member) throw verificationError(403, "conflict_of_interest");
    }
  }

  private async appealCase(tx: Executor, appeal: VerificationAppeal): Promise<VerificationCase> {
    let caseId = appeal.caseId;
    if (!caseId && appeal.badgeId) {
      const [badge] = await tx
        .select({ caseId: verificationBadges.caseId })
        .from(verificationBadges)
        .where(eq(verificationBadges.id, appeal.badgeId));
      caseId = badge?.caseId ?? null;
    }
    const [row] = caseId
      ? await tx.select().from(verificationCases).where(eq(verificationCases.id, caseId))
      : [];
    if (!row) throw notFound();
    return row;
  }

  private async originalDecider(tx: Executor, appeal: VerificationAppeal): Promise<string | null> {
    if (appeal.badgeId) {
      const [badge] = await tx
        .select({ endedBy: verificationBadges.endedBy })
        .from(verificationBadges)
        .where(eq(verificationBadges.id, appeal.badgeId));
      return badge?.endedBy ?? null;
    }
    const [row] = await tx
      .select({ decidedBy: verificationCases.decidedBy })
      .from(verificationCases)
      .where(eq(verificationCases.id, appeal.caseId ?? ""));
    // After an overturn the case's decision is cleared; the audit log keeps the original.
    return row?.decidedBy ?? null;
  }

  private async reviewDtos(rows: readonly VerificationCase[]): Promise<ReviewCaseDto[]> {
    const base = await this.verification.withDetails(rows);
    if (rows.length === 0) return [];
    const documents = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        inArray(
          verificationDocuments.caseId,
          rows.map((r) => r.id),
        ),
      );
    return base.map((dto) => {
      const row = rows.find((r) => r.id === dto.id);
      return {
        ...dto,
        openedBy: row?.openedBy ?? "",
        decidedBy: row?.decidedBy ?? null,
        documents: documents
          .filter((d) => d.caseId === dto.id)
          .map((d) => ({ ...toDocumentDto(d), sha256: d.sha256, scanResult: d.scanResult })),
      };
    });
  }

  private async audit(
    tx: Executor,
    reviewer: User,
    row: VerificationCase,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(tx, {
      actorType: "admin",
      actorId: reviewer.id,
      organizationId: row.organizationId,
      action,
      targetType: "verification_case",
      targetId: row.id,
      requestId: requestId(),
      metadata: { badgeType: row.badgeType, subject: subjectIdOf(row), ...metadata },
    });
  }
}

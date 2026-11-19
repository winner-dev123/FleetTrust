import { createHash, randomUUID } from "node:crypto";

import {
  and,
  asc,
  count,
  type Database,
  desc,
  eq,
  type Executor,
  inArray,
  isNull,
  memberships,
  organizations,
  recordAuditEvent,
  type User,
  type VerificationAppeal,
  verificationAppeals,
  type VerificationBadge,
  verificationBadges,
  type VerificationCase,
  verificationCases,
  type VerificationDocument,
  verificationDocuments,
} from "@fleettrust/db";
import {
  type AddDocumentRequest,
  APPEAL_WINDOW_DAYS,
  BADGE_SUBJECT,
  BADGE_TYPES,
  type BadgeDto,
  type BadgeType,
  type DocumentUpload,
  hasPermission,
  MAX_DOCUMENTS_PER_CASE,
  REVERIFICATION_WINDOW_DAYS,
  type Role,
  type VerificationCaseDto,
  type VerificationLabels,
} from "@fleettrust/types";
import { Inject, Injectable, Logger } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { encryptBlob, KEY_WRAPPER, type KeyWrapper } from "../../platform/crypto/envelope.js";
import { sniffContentType } from "../../platform/scanning/file-type.js";
import { MALWARE_SCANNER, type MalwareScanner } from "../../platform/scanning/malware-scanner.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import {
  DAY_MS,
  notFound,
  toBadgeDto,
  toCaseDto,
  toDocumentDto,
  verificationError,
} from "./shared.js";

const UPLOAD_URL_TTL_SECONDS = 15 * 60;
const requestId = () => currentRequestContext()?.requestId;

export type VerificationSubject =
  { type: "user"; id: string } | { type: "organization"; id: string };

const subjectColumns = (subject: VerificationSubject) =>
  subject.type === "organization"
    ? { organizationId: subject.id, userId: null }
    : { userId: subject.id, organizationId: null };

/**
 * Applicant side of verification (SRS J4, F-020..F-023): cases, the evidence upload pipeline
 * (quarantine → type check → malware scan → envelope encryption → sensitive bucket),
 * badges, appeals and public labels. Never reads plans or entitlements (ADR-0009).
 */
@Injectable()
export class VerificationService {
  private readonly logger = new Logger(VerificationService.name);

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(KEY_WRAPPER) private readonly keys: KeyWrapper,
    @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // --- Cases --------------------------------------------------------------------------------

  async openCase(
    actor: User,
    subject: VerificationSubject,
    badgeType: BadgeType,
  ): Promise<VerificationCaseDto> {
    if (BADGE_SUBJECT[badgeType] !== subject.type)
      throw verificationError(400, "badge_not_applicable");
    if (subject.type === "organization" && badgeType === "location") {
      // Location badges are for providers (a workshop's premises), not fleets.
      const [org] = await this.db
        .select({ kind: organizations.kind })
        .from(organizations)
        .where(eq(organizations.id, subject.id));
      if (org?.kind !== "provider") throw verificationError(400, "badge_not_applicable");
    }
    const now = new Date();
    const current = await this.currentBadge(this.db, subject, badgeType);
    let renewsBadgeId: string | null = null;
    if (current && current.expiresAt > now) {
      if (current.expiresAt.getTime() - now.getTime() > REVERIFICATION_WINDOW_DAYS * DAY_MS) {
        throw verificationError(409, "renewal_not_due");
      }
      renewsBadgeId = current.id;
    }
    try {
      return await this.db.transaction(async (tx) => {
        const [row] = await tx
          .insert(verificationCases)
          .values({
            subjectType: subject.type,
            ...subjectColumns(subject),
            badgeType,
            openedBy: actor.id,
            renewsBadgeId,
          })
          .returning();
        if (!row) throw new Error("case insert returned no row");
        await this.audit(tx, actor, row, "verification.case_opened", {
          renewal: renewsBadgeId !== null,
        });
        return toCaseDto(row, [], undefined);
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes(
          "verification_cases_one_open",
        )
      ) {
        throw verificationError(409, "case_already_open");
      }
      throw error;
    }
  }

  async listCases(subject: VerificationSubject): Promise<VerificationCaseDto[]> {
    const rows = await this.db
      .select()
      .from(verificationCases)
      .where(
        subject.type === "organization"
          ? eq(verificationCases.organizationId, subject.id)
          : eq(verificationCases.userId, subject.id),
      )
      .orderBy(desc(verificationCases.createdAt), desc(verificationCases.id));
    return this.withDetails(rows);
  }

  /** Loads a case the caller may manage: the person themselves, or verification.manage in the org. */
  async manageableCase(
    actor: User,
    caseId: string,
    executor: Executor = this.db,
  ): Promise<VerificationCase> {
    const [row] = await executor
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, caseId))
      .limit(1);
    if (!row || !(await this.canManage(actor, row, executor))) throw notFound();
    return row;
  }

  async getCase(actor: User, caseId: string): Promise<VerificationCaseDto> {
    const row = await this.manageableCase(actor, caseId);
    const [dto] = await this.withDetails([row]);
    if (!dto) throw notFound();
    return dto;
  }

  async submit(actor: User, caseId: string): Promise<VerificationCaseDto> {
    return this.db.transaction(async (tx) => {
      const row = await this.lockEditable(tx, actor, caseId);
      const [available] = await tx
        .select({ n: count() })
        .from(verificationDocuments)
        .where(
          and(
            eq(verificationDocuments.caseId, row.id),
            eq(verificationDocuments.status, "available"),
          ),
        );
      if ((available?.n ?? 0) === 0) throw verificationError(409, "no_documents");
      const [updated] = await tx
        .update(verificationCases)
        .set({ status: "submitted", submittedAt: new Date(), decisionReason: null })
        .where(eq(verificationCases.id, row.id))
        .returning();
      if (!updated) throw notFound();
      await this.audit(tx, actor, updated, "verification.case_submitted");
      const [dto] = await this.withDetails([updated], tx);
      if (!dto) throw notFound();
      return dto;
    });
  }

  async withdraw(actor: User, caseId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const row = await this.manageableCase(actor, caseId, tx);
      if (!["draft", "submitted", "changes_requested"].includes(row.status)) {
        throw verificationError(409, "case_not_editable");
      }
      await tx
        .update(verificationCases)
        .set({ status: "withdrawn" })
        .where(eq(verificationCases.id, row.id));
      await this.audit(tx, actor, row, "verification.case_withdrawn");
    });
  }

  // --- Documents ----------------------------------------------------------------------------

  /** Registers a document and returns a short-lived upload URL into quarantine. */
  async addDocument(
    actor: User,
    caseId: string,
    input: AddDocumentRequest,
  ): Promise<DocumentUpload> {
    const document = await this.db.transaction(async (tx) => {
      const row = await this.lockEditable(tx, actor, caseId);
      const [existing] = await tx
        .select({ n: count() })
        .from(verificationDocuments)
        .where(
          and(
            eq(verificationDocuments.caseId, row.id),
            inArray(verificationDocuments.status, ["pending_upload", "available"]),
          ),
        );
      if ((existing?.n ?? 0) >= MAX_DOCUMENTS_PER_CASE)
        throw verificationError(409, "too_many_documents");
      const [doc] = await tx
        .insert(verificationDocuments)
        .values({
          caseId: row.id,
          kind: input.kind,
          declaredContentType: input.contentType,
          declaredSize: input.size,
          uploadedBy: actor.id,
          // Random, meaningless object name: no user data in storage paths.
          quarantineKey: `uploads/${randomUUID()}`,
        })
        .returning();
      if (!doc) throw new Error("document insert returned no row");
      await this.audit(tx, actor, row, "verification.document_added", {
        documentId: doc.id,
        kind: doc.kind,
      });
      return doc;
    });
    const upload = await this.storage.createUploadUrl("quarantine", document.quarantineKey, {
      contentType: input.contentType,
      maxBytes: input.size,
      expiresInSeconds: UPLOAD_URL_TTL_SECONDS,
    });
    return {
      document: toDocumentDto(document),
      upload: { ...upload, expiresAt: upload.expiresAt.toISOString() },
    };
  }

  /**
   * Processes an uploaded file: checks it arrived with the declared size, detects its real
   * type, scans it, encrypts it and moves it to the sensitive bucket. Rejected files are
   * deleted. The quarantine copy is always removed. (Synchronous for now; moves to a job
   * triggered by the storage finalize event with the jobs runtime, ADR-0007.)
   */
  async completeUpload(
    actor: User,
    caseId: string,
    documentId: string,
  ): Promise<VerificationCaseDto> {
    const row = await this.manageableCase(actor, caseId);
    if (!["draft", "changes_requested"].includes(row.status))
      throw verificationError(409, "case_not_editable");
    const [document] = await this.db
      .select()
      .from(verificationDocuments)
      .where(
        and(eq(verificationDocuments.id, documentId), eq(verificationDocuments.caseId, row.id)),
      )
      .limit(1);
    if (!document) throw notFound();
    if (document.status !== "pending_upload") return this.getCase(actor, caseId);

    const info = await this.storage.head("quarantine", document.quarantineKey);
    if (!info) throw verificationError(409, "upload_missing");
    if (info.size !== document.declaredSize) {
      await this.reject(actor, row, document, "size_mismatch");
      throw verificationError(400, "upload_size_mismatch");
    }
    const data = await this.storage.read("quarantine", document.quarantineKey);
    const detected = sniffContentType(data);
    if (detected !== document.declaredContentType) {
      await this.reject(actor, row, document, "type_mismatch");
      throw verificationError(400, "content_type_mismatch");
    }
    const scan = await this.scanner.scan(data);
    if (!scan.clean) {
      this.logger.warn(`Malware detected in an uploaded document (${scan.signature})`);
      await this.reject(actor, row, document, `infected:${scan.signature}`);
      throw verificationError(400, "malware_detected");
    }

    const encrypted = await encryptBlob(this.keys, data, document.id);
    const storageKey = `documents/${document.id}`;
    await this.storage.write(
      "sensitive",
      storageKey,
      encrypted.ciphertext,
      "application/octet-stream",
    );
    await this.storage.delete("quarantine", document.quarantineKey);
    await this.db.transaction(async (tx) => {
      await tx
        .update(verificationDocuments)
        .set({
          status: "available",
          storageKey,
          contentType: detected,
          size: data.length,
          sha256: createHash("sha256").update(data).digest("hex"),
          encryptionKeyId: encrypted.keyId,
          wrappedKey: encrypted.wrappedKey.toString("base64"),
          iv: encrypted.iv.toString("base64"),
          authTag: encrypted.authTag.toString("base64"),
          scanResult: `clean:${this.scanner.name}`,
          availableAt: new Date(),
        })
        .where(eq(verificationDocuments.id, document.id));
      await this.audit(tx, actor, row, "verification.document_available", {
        documentId: document.id,
      });
    });
    return this.getCase(actor, caseId);
  }

  private async reject(
    actor: User,
    row: VerificationCase,
    document: VerificationDocument,
    result: string,
  ): Promise<void> {
    await this.storage.delete("quarantine", document.quarantineKey);
    await this.db.transaction(async (tx) => {
      await tx
        .update(verificationDocuments)
        .set({ status: "rejected", scanResult: result })
        .where(eq(verificationDocuments.id, document.id));
      await this.audit(tx, actor, row, "verification.document_rejected", {
        documentId: document.id,
        result,
      });
    });
  }

  // --- Badges, appeals, labels --------------------------------------------------------------

  async listBadges(subject: VerificationSubject): Promise<BadgeDto[]> {
    const badges = await this.db
      .select()
      .from(verificationBadges)
      .where(
        subject.type === "organization"
          ? eq(verificationBadges.organizationId, subject.id)
          : eq(verificationBadges.userId, subject.id),
      )
      .orderBy(desc(verificationBadges.grantedAt));
    const appeals = badges.length
      ? await this.db
          .select()
          .from(verificationAppeals)
          .where(
            inArray(
              verificationAppeals.badgeId,
              badges.map((b) => b.id),
            ),
          )
      : [];
    const now = new Date();
    return badges.map((badge) =>
      toBadgeDto(
        badge,
        appeals.find((a) => a.badgeId === badge.id),
        now,
      ),
    );
  }

  /**
   * Public trust labels (SRS §8.1): "verified" only with a current, unrevoked, unexpired badge.
   * No case details, reasons or document information are ever part of a label.
   */
  async labels(subject: VerificationSubject): Promise<VerificationLabels> {
    const now = new Date();
    const types = BADGE_TYPES.filter((type) => BADGE_SUBJECT[type] === subject.type);
    const labels = [];
    for (const badgeType of types) {
      const badge = await this.currentBadge(this.db, subject, badgeType);
      const active = badge !== undefined && badge.expiresAt > now;
      labels.push({
        badgeType,
        status: active ? ("verified" as const) : ("unverified" as const),
        expiresAt: active ? badge.expiresAt.toISOString() : null,
      });
    }
    return { subject, labels };
  }

  /** Appeal a rejected case (within APPEAL_WINDOW_DAYS of the decision). */
  async appealCase(actor: User, caseId: string, statement: string): Promise<VerificationCaseDto> {
    await this.db.transaction(async (tx) => {
      const row = await this.manageableCase(actor, caseId, tx);
      if (row.status !== "rejected" || row.decidedAt === null)
        throw verificationError(409, "not_appealable");
      if (Date.now() - row.decidedAt.getTime() > APPEAL_WINDOW_DAYS * DAY_MS) {
        throw verificationError(409, "appeal_window_closed");
      }
      await this.fileAppeal(
        tx,
        actor,
        { caseId: row.id, organizationId: row.organizationId },
        statement,
      );
      await this.audit(tx, actor, row, "verification.appeal_filed", { target: "case" });
    });
    return this.getCase(actor, caseId);
  }

  /** Appeal a revoked badge (within APPEAL_WINDOW_DAYS of the revocation). */
  async appealBadge(actor: User, badgeId: string, statement: string): Promise<BadgeDto> {
    const subject = await this.db.transaction(async (tx) => {
      const [badge] = await tx
        .select()
        .from(verificationBadges)
        .where(eq(verificationBadges.id, badgeId))
        .limit(1);
      if (!badge) throw notFound();
      const [origin] = await tx
        .select()
        .from(verificationCases)
        .where(eq(verificationCases.id, badge.caseId));
      if (!origin || !(await this.canManage(actor, origin, tx))) throw notFound();
      if (badge.endReason !== "revoked" || badge.endedAt === null)
        throw verificationError(409, "not_appealable");
      if (Date.now() - badge.endedAt.getTime() > APPEAL_WINDOW_DAYS * DAY_MS) {
        throw verificationError(409, "appeal_window_closed");
      }
      await this.fileAppeal(
        tx,
        actor,
        { badgeId: badge.id, organizationId: badge.organizationId },
        statement,
      );
      await this.audit(tx, actor, origin, "verification.appeal_filed", {
        target: "badge",
        badgeId,
      });
      return origin;
    });
    const badges = await this.listBadges(
      subject.subjectType === "organization"
        ? { type: "organization", id: subject.organizationId ?? "" }
        : { type: "user", id: subject.userId ?? "" },
    );
    const dto = badges.find((b) => b.id === badgeId);
    if (!dto) throw notFound();
    return dto;
  }

  private async fileAppeal(
    tx: Executor,
    actor: User,
    target: { caseId?: string; badgeId?: string; organizationId: string | null },
    statement: string,
  ): Promise<VerificationAppeal> {
    try {
      const [appeal] = await tx
        .insert(verificationAppeals)
        .values({
          caseId: target.caseId ?? null,
          badgeId: target.badgeId ?? null,
          organizationId: target.organizationId,
          statement,
          filedBy: actor.id,
        })
        .returning();
      if (!appeal) throw new Error("appeal insert returned no row");
      return appeal;
    } catch (error) {
      if (
        /verification_appeals_(case|badge)_key/.test(
          String((error as { cause?: unknown }).cause ?? error),
        )
      ) {
        throw verificationError(409, "appeal_exists");
      }
      throw error;
    }
  }

  // --- Helpers ------------------------------------------------------------------------------

  async currentBadge(
    executor: Executor,
    subject: VerificationSubject,
    badgeType: BadgeType,
  ): Promise<VerificationBadge | undefined> {
    const [badge] = await executor
      .select()
      .from(verificationBadges)
      .where(
        and(
          subject.type === "organization"
            ? eq(verificationBadges.organizationId, subject.id)
            : eq(verificationBadges.userId, subject.id),
          eq(verificationBadges.badgeType, badgeType),
          isNull(verificationBadges.endedAt),
        ),
      )
      .limit(1);
    return badge;
  }

  private async canManage(
    actor: User,
    row: VerificationCase,
    executor: Executor,
  ): Promise<boolean> {
    if (row.subjectType === "user") return row.userId === actor.id;
    const [membership] = await executor
      .select({ role: memberships.role, status: organizations.status })
      .from(memberships)
      .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
      .where(
        and(
          eq(memberships.organizationId, row.organizationId ?? ""),
          eq(memberships.userId, actor.id),
        ),
      )
      .limit(1);
    return (
      membership?.status === "active" &&
      hasPermission(membership.role as Role, "verification.manage")
    );
  }

  private async lockEditable(tx: Executor, actor: User, caseId: string): Promise<VerificationCase> {
    const row = await this.manageableCase(actor, caseId, tx);
    const [locked] = await tx
      .select()
      .from(verificationCases)
      .where(eq(verificationCases.id, row.id))
      .for("update");
    if (!locked || !["draft", "changes_requested"].includes(locked.status)) {
      throw verificationError(409, "case_not_editable");
    }
    return locked;
  }

  async withDetails(
    rows: readonly VerificationCase[],
    executor: Executor = this.db,
  ): Promise<VerificationCaseDto[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const documents = await executor
      .select()
      .from(verificationDocuments)
      .where(inArray(verificationDocuments.caseId, ids))
      .orderBy(asc(verificationDocuments.createdAt));
    const appeals = await executor
      .select()
      .from(verificationAppeals)
      .where(inArray(verificationAppeals.caseId, ids));
    return rows.map((row) =>
      toCaseDto(
        row,
        documents.filter((d) => d.caseId === row.id),
        appeals.find((a) => a.caseId === row.id),
      ),
    );
  }

  private async audit(
    tx: Executor,
    actor: User,
    row: VerificationCase,
    action: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(tx, {
      actorType: "user",
      actorId: actor.id,
      organizationId: row.organizationId,
      action,
      targetType: "verification_case",
      targetId: row.id,
      requestId: requestId(),
      metadata: { badgeType: row.badgeType, ...metadata },
    });
  }
}

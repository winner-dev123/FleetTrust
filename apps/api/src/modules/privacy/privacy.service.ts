import {
  and,
  articleBookmarks,
  articleComments,
  articleImages,
  articles,
  auditEvents,
  communityGroupMembers,
  consents,
  conversationStates,
  type Database,
  desc,
  emergencyIncidents,
  eq,
  friendRequests,
  friendships,
  incidentRecipients,
  inArray,
  isNull,
  jobApplications,
  memberSanctions,
  memberships,
  messages,
  messagingPreferences,
  moderationAppeals,
  ne,
  notifications,
  or,
  organizations,
  platformStaff,
  powerUserStatus,
  pushDevices,
  recordAuditEvent,
  savedListMembers,
  savedLists,
  serviceRequests,
  socialSettings,
  staffAvailability,
  staffTimeOff,
  trustedContacts,
  type User,
  userBlocks,
  users,
  vehicleDocuments,
  vehicles,
  verificationCases,
  verificationDocuments,
} from "@fleettrust/db";
import {
  CONSENT_PURPOSES,
  type ConsentStateDto,
  CURRENT_CONSENT_VERSIONS,
  type DataExport,
  type RecordConsent,
  REQUIRED_CONSENTS,
} from "@fleettrust/types";
import { ConflictException, Inject, Injectable, Logger } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { OBJECT_STORAGE, type ObjectStorage } from "../../platform/storage/index.js";
import { AUTH_VERIFIER, type AuthVerifier } from "../identity/index.js";

const privacyError = (status: 409, reason: string) =>
  new ConflictException({ statusCode: status, error: "conflict", reason });

/** Internal fields that never leave the system, even in a person's own export. */
const INTERNAL =
  /^(firebaseUid|storageKey|quarantineKey|wrappedKey|iv|authTag|keyId|encryptionKeyId|sha256)$/;

function clean(rows: readonly Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) =>
    Object.fromEntries(
      Object.entries(row)
        .filter(([key]) => !INTERNAL.test(key))
        .map(([key, value]) => [key, value instanceof Date ? value.toISOString() : value]),
    ),
  );
}

/**
 * Privacy rights (Prompt 27, ADR-0034): consent records, export of a person's own data, and
 * account deletion. Deletion erases and anonymises rather than dropping the user row: the
 * row stays as a tombstone so the audit trail and content shared with others keep their
 * references, but nothing in it identifies the person any more.
 */
@Injectable()
export class PrivacyService {
  private readonly logger = new Logger("PrivacyService");

  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  // -------------------------------------------------------------------------------------------
  // Consent
  // -------------------------------------------------------------------------------------------

  async consents(userId: string): Promise<ConsentStateDto[]> {
    const rows = await this.db
      .select()
      .from(consents)
      .where(eq(consents.userId, userId))
      .orderBy(desc(consents.recordedAt), desc(consents.id));
    return CONSENT_PURPOSES.map((purpose) => {
      const latest = rows.find((row) => row.purpose === purpose);
      const required = REQUIRED_CONSENTS.includes(purpose);
      const currentVersion = CURRENT_CONSENT_VERSIONS[purpose];
      return {
        purpose,
        required,
        currentVersion,
        granted: latest?.granted ?? null,
        version: latest?.version ?? null,
        recordedAt: latest?.recordedAt.toISOString() ?? null,
        needsAnswer: required && !(latest?.granted === true && latest.version === currentVersion),
      };
    });
  }

  /** Append-only: every choice is a new row, so the history shows what was agreed and when. */
  async recordConsent(user: User, choice: RecordConsent): Promise<ConsentStateDto[]> {
    if (choice.version !== CURRENT_CONSENT_VERSIONS[choice.purpose]) {
      throw privacyError(409, "stale_consent_version");
    }
    if (!choice.granted && REQUIRED_CONSENTS.includes(choice.purpose)) {
      throw privacyError(409, "required_consent");
    }
    await this.db.transaction(async (tx) => {
      await tx.insert(consents).values({ userId: user.id, ...choice });
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: user.id,
        action: choice.granted ? "privacy.consent_granted" : "privacy.consent_withdrawn",
        targetType: "user",
        targetId: user.id,
        requestId: currentRequestContext()?.requestId,
        metadata: { purpose: choice.purpose, version: choice.version },
      });
    });
    return this.consents(user.id);
  }

  // -------------------------------------------------------------------------------------------
  // Export (right of access and portability)
  // -------------------------------------------------------------------------------------------

  async export(user: User): Promise<DataExport> {
    const id = user.id;
    const db = this.db;
    const [profile] = await db.select().from(users).where(eq(users.id, id));
    const sections: Record<string, unknown> = {
      profile: clean(profile ? [profile] : [])[0] ?? null,
      consents: clean(await db.select().from(consents).where(eq(consents.userId, id))),
      organizations: clean(
        await db
          .select({
            organization: organizations.name,
            kind: organizations.kind,
            role: memberships.role,
            since: memberships.createdAt,
          })
          .from(memberships)
          .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
          .where(eq(memberships.userId, id)),
      ),
      friends: clean(
        await db
          .select()
          .from(friendships)
          .where(or(eq(friendships.userAId, id), eq(friendships.userBId, id))),
      ),
      friendRequests: clean(
        await db
          .select()
          .from(friendRequests)
          .where(or(eq(friendRequests.senderId, id), eq(friendRequests.recipientId, id))),
      ),
      blocks: clean(await db.select().from(userBlocks).where(eq(userBlocks.blockerId, id))),
      groupMemberships: clean(
        await db.select().from(communityGroupMembers).where(eq(communityGroupMembers.userId, id)),
      ),
      trustedContacts: clean(
        await db
          .select()
          .from(trustedContacts)
          .where(or(eq(trustedContacts.ownerUserId, id), eq(trustedContacts.contactUserId, id))),
      ),
      emergencyIncidents: clean(
        await db.select().from(emergencyIncidents).where(eq(emergencyIncidents.ownerUserId, id)),
      ),
      savedLists: clean(await db.select().from(savedLists).where(eq(savedLists.ownerUserId, id))),
      vehicles: clean(await db.select().from(vehicles).where(eq(vehicles.ownerUserId, id))),
      serviceRequests: clean(
        await db.select().from(serviceRequests).where(eq(serviceRequests.requesterUserId, id)),
      ),
      articles: clean(await db.select().from(articles).where(eq(articles.authorUserId, id))),
      comments: clean(
        await db.select().from(articleComments).where(eq(articleComments.authorUserId, id)),
      ),
      messagesSent: clean(await db.select().from(messages).where(eq(messages.senderUserId, id))),
      notifications: clean(
        await db.select().from(notifications).where(eq(notifications.userId, id)),
      ),
      jobApplications: clean(
        await db.select().from(jobApplications).where(eq(jobApplications.applicantUserId, id)),
      ),
      messagingPreferences: clean(
        await db.select().from(messagingPreferences).where(eq(messagingPreferences.userId, id)),
      ),
      verificationCases: clean(
        await db.select().from(verificationCases).where(eq(verificationCases.userId, id)),
      ),
      sanctions: clean(
        await db.select().from(memberSanctions).where(eq(memberSanctions.userId, id)),
      ),
      appeals: clean(
        await db.select().from(moderationAppeals).where(eq(moderationAppeals.userId, id)),
      ),
      powerUser: clean(
        await db.select().from(powerUserStatus).where(eq(powerUserStatus.userId, id)),
      ),
      activity: clean(
        await db
          .select({
            at: auditEvents.occurredAt,
            action: auditEvents.action,
            targetType: auditEvents.targetType,
          })
          .from(auditEvents)
          .where(eq(auditEvents.actorId, id))
          .orderBy(desc(auditEvents.occurredAt))
          .limit(5000),
      ),
    };
    await recordAuditEvent(db, {
      actorType: "user",
      actorId: id,
      action: "privacy.data_exported",
      targetType: "user",
      targetId: id,
      requestId: currentRequestContext()?.requestId,
      metadata: {},
    });
    return {
      format: "fleettrust-export-v1",
      generatedAt: new Date().toISOString(),
      userId: id,
      sections,
    };
  }

  // -------------------------------------------------------------------------------------------
  // Deletion (right to erasure)
  // -------------------------------------------------------------------------------------------

  /**
   * Erases the account. Refused while the person is the only owner of an organization, so a
   * business is never left without an owner. Files are deleted after the database commit, then
   * the Firebase account; a failure there is logged and the tombstone already blocks sign-in.
   */
  async deleteAccount(user: User): Promise<void> {
    const id = user.id;
    const owned = await this.db
      .select({ organizationId: memberships.organizationId })
      .from(memberships)
      .where(and(eq(memberships.userId, id), eq(memberships.role, "owner")));
    for (const { organizationId } of owned) {
      const others = await this.db
        .select({ userId: memberships.userId })
        .from(memberships)
        .where(
          and(
            eq(memberships.organizationId, organizationId),
            eq(memberships.role, "owner"),
            ne(memberships.userId, id),
          ),
        );
      if (others.length === 0) throw privacyError(409, "sole_owner");
    }

    const files = await this.db.transaction(async (tx) => {
      const toDelete: { bucket: "sensitive" | "quarantine" | "public_media"; key: string }[] = [];

      // Images they uploaded for articles: public files, so they must go with the articles.
      const images = await tx
        .select({
          storageKey: articleImages.storageKey,
          quarantineKey: articleImages.quarantineKey,
        })
        .from(articleImages)
        .where(eq(articleImages.uploadedBy, id));
      for (const image of images) {
        if (image.storageKey) toDelete.push({ bucket: "public_media", key: image.storageKey });
        toDelete.push({ bucket: "quarantine", key: image.quarantineKey });
      }
      await tx.delete(articleImages).where(eq(articleImages.uploadedBy, id));

      // Personal vehicles and their documents (fleet vehicles belong to the organization).
      const personal = await tx
        .select({ id: vehicles.id })
        .from(vehicles)
        .where(and(eq(vehicles.ownerUserId, id), isNull(vehicles.organizationId)));
      if (personal.length > 0) {
        const docs = await tx
          .select({
            storageKey: vehicleDocuments.storageKey,
            quarantineKey: vehicleDocuments.quarantineKey,
          })
          .from(vehicleDocuments)
          .where(
            inArray(
              vehicleDocuments.vehicleId,
              personal.map((v) => v.id),
            ),
          );
        for (const doc of docs) {
          if (doc.storageKey) toDelete.push({ bucket: "sensitive", key: doc.storageKey });
          toDelete.push({ bucket: "quarantine", key: doc.quarantineKey });
        }
        await tx.delete(vehicles).where(
          inArray(
            vehicles.id,
            personal.map((v) => v.id),
          ),
        );
      }

      // Identity documents: files deleted, rows kept as "purged" (the decision history stays).
      const cases = await tx
        .select({ id: verificationCases.id })
        .from(verificationCases)
        .where(eq(verificationCases.userId, id));
      if (cases.length > 0) {
        const docs = await tx
          .select()
          .from(verificationDocuments)
          .where(
            and(
              inArray(
                verificationDocuments.caseId,
                cases.map((c) => c.id),
              ),
              ne(verificationDocuments.status, "purged"),
            ),
          );
        for (const doc of docs) {
          if (doc.storageKey) toDelete.push({ bucket: "sensitive", key: doc.storageKey });
          toDelete.push({ bucket: "quarantine", key: doc.quarantineKey });
        }
        if (docs.length > 0) {
          await tx
            .update(verificationDocuments)
            .set({
              status: "purged",
              purgedAt: new Date(),
              storageKey: null,
              wrappedKey: null,
              iv: null,
              authTag: null,
            })
            .where(
              inArray(
                verificationDocuments.id,
                docs.map((d) => d.id),
              ),
            );
        }
      }

      // Records only this person uses.
      await tx.delete(consents).where(eq(consents.userId, id));
      await tx.delete(articleBookmarks).where(eq(articleBookmarks.userId, id));
      await tx.delete(socialSettings).where(eq(socialSettings.userId, id));
      await tx
        .delete(friendRequests)
        .where(or(eq(friendRequests.senderId, id), eq(friendRequests.recipientId, id)));
      await tx
        .delete(friendships)
        .where(or(eq(friendships.userAId, id), eq(friendships.userBId, id)));
      await tx
        .delete(userBlocks)
        .where(or(eq(userBlocks.blockerId, id), eq(userBlocks.blockedId, id)));
      await tx.delete(communityGroupMembers).where(eq(communityGroupMembers.userId, id));
      await tx
        .delete(trustedContacts)
        .where(or(eq(trustedContacts.ownerUserId, id), eq(trustedContacts.contactUserId, id)));
      await tx.delete(incidentRecipients).where(eq(incidentRecipients.userId, id));
      await tx.delete(emergencyIncidents).where(eq(emergencyIncidents.ownerUserId, id));
      await tx.delete(jobApplications).where(eq(jobApplications.applicantUserId, id));
      await tx.delete(savedListMembers).where(eq(savedListMembers.userId, id));
      await tx.delete(savedLists).where(eq(savedLists.ownerUserId, id));
      await tx.delete(conversationStates).where(eq(conversationStates.userId, id));
      await tx.delete(messagingPreferences).where(eq(messagingPreferences.userId, id));
      await tx.delete(notifications).where(eq(notifications.userId, id));
      await tx.delete(pushDevices).where(eq(pushDevices.userId, id));
      await tx.delete(powerUserStatus).where(eq(powerUserStatus.userId, id));
      await tx.delete(moderationAppeals).where(eq(moderationAppeals.userId, id));
      await tx.delete(staffAvailability).where(eq(staffAvailability.userId, id));
      await tx.delete(staffTimeOff).where(eq(staffTimeOff.userId, id));
      await tx.delete(memberships).where(eq(memberships.userId, id));
      const staffRoles = await tx
        .delete(platformStaff)
        .where(eq(platformStaff.userId, id))
        .returning({ role: platformStaff.role });

      // Their own writing is withdrawn; what others replied to stays in place.
      await tx
        .update(articleComments)
        .set({ status: "deleted" })
        .where(eq(articleComments.authorUserId, id));
      await tx
        .update(articles)
        .set({
          status: "draft",
          title: "Deleted article",
          summary: null,
          body: { type: "doc", content: [] },
          bodyText: "",
          tags: [],
          publishedAt: null,
        })
        .where(eq(articles.authorUserId, id));
      // Service requests stay for the providers' records, without the free-text location note.
      await tx
        .update(serviceRequests)
        .set({ locationNote: null })
        .where(eq(serviceRequests.requesterUserId, id));

      // The tombstone: no email, name or activity; the Firebase UID can't sign in again.
      await tx
        .update(users)
        .set({
          status: "deleted",
          deletedAt: new Date(),
          email: null,
          emailVerified: false,
          displayName: null,
          lastSeenAt: null,
          lastSignInProvider: null,
          firebaseUid: `deleted:${id}`,
        })
        .where(eq(users.id, id));
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: id,
        action: "user.account_deleted",
        targetType: "user",
        targetId: id,
        requestId: currentRequestContext()?.requestId,
        metadata: {
          vehicles: personal.length,
          files: toDelete.length,
          articleImages: images.length,
          staffRolesRemoved: staffRoles.map((r) => r.role),
        },
      });
      return toDelete;
    });

    for (const file of files) {
      await this.storage.delete(file.bucket, file.key).catch((error: unknown) => {
        this.logger.error(
          `file deletion failed after account deletion: ${(error as Error).message}`,
        );
      });
    }
    await this.verifier.deleteAccount(user.firebaseUid).catch((error: unknown) => {
      this.logger.error(`Firebase account deletion failed: ${(error as Error).message}`);
    });
  }
}

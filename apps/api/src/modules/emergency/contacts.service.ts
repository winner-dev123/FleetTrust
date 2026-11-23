import {
  and,
  type Database,
  desc,
  eq,
  or,
  recordAuditEvent,
  type TrustedContact,
  trustedContacts,
  type User,
  users,
} from "@fleettrust/db";
import { MAX_TRUSTED_CONTACTS, type TrustedContactDto } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import { blockedEitherWay, emergencyError, notFound } from "./shared.js";

const FALLBACK_NAME = "FleetTrust member";

/**
 * Trusted contacts with mutual consent (F-061, AB-03). You can only alert people who accepted.
 * Contacts can pause alerts or leave at any time; blocks end the link.
 */
@Injectable()
export class TrustedContactsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async audit(actor: User, row: TrustedContact, action: string): Promise<void> {
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: actor.id,
      action: `emergency.contact_${action}`,
      targetType: "trusted_contact",
      targetId: row.id,
      requestId: currentRequestContext()?.requestId,
      metadata: { ownerUserId: row.ownerUserId, contactUserId: row.contactUserId },
    });
  }

  /** Invites someone. They must accept before they can be alerted. */
  async invite(
    owner: User,
    contactId: string,
    priority: "primary" | "backup",
  ): Promise<TrustedContactDto> {
    if (contactId === owner.id) throw emergencyError(400, "not_allowed");
    const [contact] = await this.db.select().from(users).where(eq(users.id, contactId));
    if (contact?.status !== "active") throw notFound();
    if (await blockedEitherWay(this.db, owner.id, contactId)) throw notFound();
    const existing = await this.db
      .select()
      .from(trustedContacts)
      .where(eq(trustedContacts.ownerUserId, owner.id));
    const current = existing.find((c) => c.contactUserId === contactId);
    if (current && current.status !== "declined") throw emergencyError(409, "already_contact");
    if (existing.filter((c) => c.status !== "declined").length >= MAX_TRUSTED_CONTACTS) {
      throw emergencyError(409, "too_many_contacts");
    }
    let row: TrustedContact | undefined;
    if (current) {
      [row] = await this.db
        .update(trustedContacts)
        .set({ status: "pending", priority, muted: false, respondedAt: null })
        .where(eq(trustedContacts.id, current.id))
        .returning();
    } else {
      [row] = await this.db
        .insert(trustedContacts)
        .values({ ownerUserId: owner.id, contactUserId: contactId, priority })
        .returning();
    }
    if (!row) throw new Error("trusted contact write returned no row");
    await this.audit(owner, row, "invited");
    return this.dto(owner.id, row, contact.displayName);
  }

  /** Contacts you chose, and people who chose you (pending invitations included). */
  async list(user: User): Promise<TrustedContactDto[]> {
    const rows = await this.db
      .select({ contact: trustedContacts, owner: users.displayName })
      .from(trustedContacts)
      .innerJoin(users, eq(users.id, trustedContacts.ownerUserId))
      .where(
        or(eq(trustedContacts.ownerUserId, user.id), eq(trustedContacts.contactUserId, user.id)),
      )
      .orderBy(desc(trustedContacts.createdAt));
    const result: TrustedContactDto[] = [];
    for (const r of rows) {
      const mine = r.contact.ownerUserId === user.id;
      // A declined invitation is only visible to the person who declined it as nothing.
      if (!mine && r.contact.status === "declined") continue;
      let name = r.owner;
      if (mine) {
        const [c] = await this.db
          .select({ name: users.displayName })
          .from(users)
          .where(eq(users.id, r.contact.contactUserId));
        name = c?.name ?? null;
      }
      result.push(this.dto(user.id, r.contact, name));
    }
    return result;
  }

  private async byId(user: User, id: string): Promise<TrustedContact> {
    const [row] = await this.db
      .select()
      .from(trustedContacts)
      .where(
        and(
          eq(trustedContacts.id, id),
          or(eq(trustedContacts.ownerUserId, user.id), eq(trustedContacts.contactUserId, user.id)),
        ),
      );
    if (!row) throw notFound();
    return row;
  }

  async respond(user: User, id: string, accept: boolean): Promise<TrustedContactDto> {
    const row = await this.byId(user, id);
    if (row.contactUserId !== user.id) throw notFound();
    if (row.status !== "pending") throw emergencyError(409, "not_allowed");
    if (accept && (await blockedEitherWay(this.db, row.ownerUserId, user.id))) throw notFound();
    const [updated] = await this.db
      .update(trustedContacts)
      .set({ status: accept ? "active" : "declined", respondedAt: this.clock.now() })
      .where(eq(trustedContacts.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await this.audit(user, updated, accept ? "accepted" : "declined");
    const [owner] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.ownerUserId));
    return this.dto(user.id, updated, owner?.name ?? null);
  }

  /** The contact pauses (or resumes) alerts from this person. */
  async setMuted(user: User, id: string, muted: boolean): Promise<TrustedContactDto> {
    const row = await this.byId(user, id);
    if (row.contactUserId !== user.id || row.status !== "active") throw notFound();
    const [updated] = await this.db
      .update(trustedContacts)
      .set({ muted })
      .where(eq(trustedContacts.id, row.id))
      .returning();
    if (!updated) throw notFound();
    await this.audit(user, updated, muted ? "paused" : "resumed");
    const [owner] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.ownerUserId));
    return this.dto(user.id, updated, owner?.name ?? null);
  }

  async setPriority(
    user: User,
    id: string,
    priority: "primary" | "backup",
  ): Promise<TrustedContactDto> {
    const row = await this.byId(user, id);
    if (row.ownerUserId !== user.id) throw notFound();
    const [updated] = await this.db
      .update(trustedContacts)
      .set({ priority })
      .where(eq(trustedContacts.id, row.id))
      .returning();
    if (!updated) throw notFound();
    const [c] = await this.db
      .select({ name: users.displayName })
      .from(users)
      .where(eq(users.id, row.contactUserId));
    return this.dto(user.id, updated, c?.name ?? null);
  }

  /** The owner removes a contact, or the contact leaves. */
  async remove(user: User, id: string): Promise<void> {
    const row = await this.byId(user, id);
    await this.db.delete(trustedContacts).where(eq(trustedContacts.id, row.id));
    await this.audit(user, row, row.ownerUserId === user.id ? "removed" : "left");
  }

  private dto(viewerId: string, row: TrustedContact, otherName: string | null): TrustedContactDto {
    const mine = row.ownerUserId === viewerId;
    return {
      id: row.id,
      person: {
        userId: mine ? row.contactUserId : row.ownerUserId,
        displayName: otherName ?? FALLBACK_NAME,
      },
      role: mine ? "my_contact" : "contact_for",
      status: row.status,
      priority: row.priority,
      muted: row.muted,
      createdAt: row.createdAt.toISOString(),
    };
  }
}

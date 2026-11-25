import {
  and,
  type Database,
  eq,
  memberSanctions,
  recordAuditEvent,
  type User,
  users,
} from "@fleettrust/db";
import { isOnPilotAllowlist, parsePilotAllowlist } from "@fleettrust/types";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { SettingsService } from "../../platform/settings/index.js";
import type { VerifiedIdentity } from "./auth-verifier.js";

/** last_seen_at is a hint, not an audit trail: write it at most this often per user. */
const LAST_SEEN_RESOLUTION_MS = 5 * 60 * 1000;

export class DatabaseUnavailableError extends Error {
  constructor() {
    super("DATABASE_URL is not configured");
    this.name = "DatabaseUnavailableError";
  }
}

/** New accounts are paused by an admin (feature setting `signups.paused`). */
export class SignupsPausedError extends Error {
  constructor() {
    super("new sign-ups are paused");
    this.name = "SignupsPausedError";
  }
}

/** Limited pilot: the email isn't on the pilot allowlist (setting `signups.pilot_allowlist`). */
export class PilotInviteOnlyError extends Error {
  constructor() {
    super("this email address is not on the pilot allowlist");
    this.name = "PilotInviteOnlyError";
  }
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    private readonly settings: SettingsService,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new DatabaseUnavailableError();
    return this.database.db;
  }

  /**
   * A suspended account whose moderation suspensions have all ended (lapsed or lifted) becomes
   * active again (ADR-0030). An account suspended any other way (no suspension record) stays
   * suspended. Returns the user as it is now.
   */
  async reactivateIfSuspensionEnded(user: User): Promise<User> {
    const now = new Date();
    const suspensions = await this.db
      .select({ endsAt: memberSanctions.endsAt, liftedAt: memberSanctions.liftedAt })
      .from(memberSanctions)
      .where(and(eq(memberSanctions.userId, user.id), eq(memberSanctions.kind, "suspension")));
    const stillActive = suspensions.some(
      (s) => s.liftedAt === null && (s.endsAt === null || s.endsAt > now),
    );
    if (suspensions.length === 0 || stillActive) return user;
    const [row] = await this.db
      .update(users)
      .set({ status: "active" })
      .where(and(eq(users.id, user.id), eq(users.status, "suspended")))
      .returning();
    if (!row) return user;
    await recordAuditEvent(this.db, {
      actorType: "system",
      action: "user.suspension_ended",
      targetType: "user",
      targetId: user.id,
    });
    return row;
  }

  /**
   * Returns the account for a verified identity, creating it on first sign-in (minimal
   * signup: no form, no documents). Safe under concurrency: simultaneous first requests
   * converge on one row and one `user.signed_up` audit event.
   */
  async findOrCreate(identity: VerifiedIdentity, requestId?: string): Promise<User> {
    const existing = await this.findByFirebaseUid(identity.uid);
    if (existing) return this.refresh(existing, identity);
    // Admin lever for abuse waves: existing accounts keep working (Prompt 26).
    if (await this.settings.get("signups.paused")) throw new SignupsPausedError();
    // Limited pilot (Prompt 29): only verified addresses on the allowlist get a new account.
    const pilot = parsePilotAllowlist(await this.settings.get("signups.pilot_allowlist"));
    if (
      pilot.length > 0 &&
      !(identity.emailVerified && isOnPilotAllowlist(identity.email, pilot))
    ) {
      throw new PilotInviteOnlyError();
    }

    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(users)
        .values({
          firebaseUid: identity.uid,
          email: identity.email?.toLowerCase() ?? null,
          emailVerified: identity.emailVerified,
          lastSignInProvider: identity.signInProvider ?? null,
          lastSeenAt: new Date(),
        })
        .onConflictDoNothing({ target: users.firebaseUid })
        .returning();
      if (!row) return undefined; // another request created it first
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: row.id,
        action: "user.signed_up",
        targetType: "user",
        targetId: row.id,
        requestId,
        metadata: { provider: identity.signInProvider ?? "unknown" },
      });
      return row;
    });

    if (created) return created;
    const winner = await this.findByFirebaseUid(identity.uid);
    if (!winner) throw new Error("user row vanished after a concurrent insert");
    return winner;
  }

  async findByFirebaseUid(uid: string): Promise<User | undefined> {
    const [row] = await this.db.select().from(users).where(eq(users.firebaseUid, uid)).limit(1);
    return row;
  }

  async updateProfile(
    user: User,
    change: { displayName?: string | null | undefined; timeZone?: string | undefined },
    requestId?: string,
  ): Promise<User> {
    return this.db.transaction(async (tx) => {
      const [row] = await tx
        .update(users)
        .set({
          ...(change.displayName === undefined ? {} : { displayName: change.displayName }),
          ...(change.timeZone === undefined ? {} : { timezone: change.timeZone }),
        })
        .where(eq(users.id, user.id))
        .returning();
      if (!row) throw new Error("user not found");
      if (change.displayName !== undefined) {
        await recordAuditEvent(tx, {
          actorType: "user",
          actorId: user.id,
          action: "user.display_name_changed",
          targetType: "user",
          targetId: user.id,
          requestId,
          metadata: { cleared: change.displayName === null },
        });
      }
      if (change.timeZone !== undefined) {
        await recordAuditEvent(tx, {
          actorType: "user",
          actorId: user.id,
          action: "user.time_zone_changed",
          targetType: "user",
          targetId: user.id,
          requestId,
          metadata: { timeZone: change.timeZone },
        });
      }
      return row;
    });
  }

  async recordSessionsRevoked(user: User, requestId?: string): Promise<void> {
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: user.id,
      action: "user.sessions_revoked",
      targetType: "user",
      targetId: user.id,
      requestId,
    });
  }

  /** Keep provider-owned fields in sync and bump last_seen_at (throttled). */
  private async refresh(user: User, identity: VerifiedIdentity): Promise<User> {
    const email = identity.email?.toLowerCase() ?? null;
    const stale =
      !user.lastSeenAt || Date.now() - user.lastSeenAt.getTime() > LAST_SEEN_RESOLUTION_MS;
    const changed =
      email !== user.email ||
      identity.emailVerified !== user.emailVerified ||
      (identity.signInProvider ?? null) !== user.lastSignInProvider;
    if (!stale && !changed) return user;

    const [row] = await this.db
      .update(users)
      .set({
        email,
        emailVerified: identity.emailVerified,
        lastSignInProvider: identity.signInProvider ?? null,
        lastSeenAt: new Date(),
      })
      .where(eq(users.id, user.id))
      .returning();
    return row ?? user;
  }
}

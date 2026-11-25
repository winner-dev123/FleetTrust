import {
  and,
  auditEvents,
  count,
  type Database,
  desc,
  eq,
  gt,
  gte,
  isNull,
  like,
  lt,
  lte,
  memberSanctions,
  memberships,
  or,
  organizations,
  type PlatformRole,
  platformStaff,
  recordAuditEvent,
  supportCases,
  type User,
  users,
} from "@fleettrust/db";
import {
  AUDIT_SCOPES,
  type AuditEntryDto,
  type AuditPage,
  type auditQuerySchema,
  type PlatformStaffMemberDto,
  type StaffRole,
  type SupportAccountDto,
  type SupportCaseDto,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";

import { API_ENV } from "../../config/config.module.js";
import type { ApiEnv } from "../../config/env.js";
import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { EMAIL_SENDER, type EmailSender } from "../../platform/email/index.js";
import { AUTH_VERIFIER, type AuthVerifier } from "../identity/index.js";

const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });
const requestId = () => currentRequestContext()?.requestId;

abstract class DbService {
  constructor(protected readonly database: DatabaseProvider) {}

  protected get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }
}

// ---------------------------------------------------------------------------------------------
// Staff roles (super admins)
// ---------------------------------------------------------------------------------------------

@Injectable()
export class StaffService extends DbService {
  constructor(@Inject(DATABASE) database: DatabaseProvider) {
    super(database);
  }

  async list(): Promise<PlatformStaffMemberDto[]> {
    const rows = await this.db
      .select({
        userId: platformStaff.userId,
        role: platformStaff.role,
        since: platformStaff.createdAt,
        email: users.email,
        displayName: users.displayName,
      })
      .from(platformStaff)
      .innerJoin(users, eq(users.id, platformStaff.userId))
      .orderBy(users.email, platformStaff.role);
    const byUser = new Map<string, PlatformStaffMemberDto>();
    for (const row of rows) {
      const entry = byUser.get(row.userId) ?? {
        userId: row.userId,
        email: row.email,
        displayName: row.displayName,
        roles: [],
      };
      entry.roles.push({ role: row.role, since: row.since.toISOString() });
      byUser.set(row.userId, entry);
    }
    return [...byUser.values()];
  }

  /**
   * Nobody changes their own roles: a second super admin must do it, so one compromised
   * account can't grant itself more access. The first super admin comes from `pnpm db:staff`.
   */
  async grant(actor: User, email: string, role: StaffRole): Promise<PlatformStaffMemberDto[]> {
    const [target] = await this.db
      .select()
      .from(users)
      .where(eq(users.email, email.trim().toLowerCase()))
      .limit(1);
    if (!target) throw notFound();
    if (target.id === actor.id) {
      throw new ForbiddenException({ statusCode: 403, error: "forbidden", reason: "own_roles" });
    }
    await this.db.transaction(async (tx) => {
      const inserted = await tx
        .insert(platformStaff)
        .values({ userId: target.id, role })
        .onConflictDoNothing()
        .returning();
      if (inserted.length === 0) return;
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        action: "staff.role_granted",
        targetType: "user",
        targetId: target.id,
        requestId: requestId(),
        metadata: { role, via: "console" },
      });
    });
    return this.list();
  }

  async revoke(actor: User, userId: string, role: StaffRole): Promise<PlatformStaffMemberDto[]> {
    if (userId === actor.id) {
      throw new ForbiddenException({ statusCode: 403, error: "forbidden", reason: "own_roles" });
    }
    await this.db.transaction(async (tx) => {
      const removed = await tx
        .delete(platformStaff)
        .where(and(eq(platformStaff.userId, userId), eq(platformStaff.role, role)))
        .returning();
      if (removed.length === 0) throw notFound();
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        action: "staff.role_revoked",
        targetType: "user",
        targetId: userId,
        requestId: requestId(),
        metadata: { role, via: "console" },
      });
    });
    return this.list();
  }
}

// ---------------------------------------------------------------------------------------------
// Audit search
// ---------------------------------------------------------------------------------------------

/** The action families the caller's roles may search, or "all" for super admins. */
export function auditScope(roles: readonly PlatformRole[]): "all" | string[] {
  const prefixes = new Set<string>();
  for (const role of roles) {
    const scope = AUDIT_SCOPES[role];
    if (scope === "all") return "all";
    for (const prefix of scope) prefixes.add(prefix);
  }
  return [...prefixes].sort();
}

type Filter = NonNullable<Parameters<typeof and>[number]>;

const escapeLike = (value: string) => value.replace(/[\\%_]/g, (c) => `\\${c}`);

function encodeCursor(at: Date, id: string): string {
  return Buffer.from(`${at.toISOString()}|${id}`).toString("base64url");
}

function decodeCursor(cursor: string): { at: Date; id: string } {
  const [at, id] = Buffer.from(cursor, "base64url").toString("utf8").split("|");
  const date = at ? new Date(at) : new Date(Number.NaN);
  if (!id || Number.isNaN(date.getTime()) || !/^[0-9a-f-]{36}$/i.test(id)) {
    throw new BadRequestException({
      statusCode: 400,
      error: "bad_request",
      reason: "invalid_cursor",
    });
  }
  return { at: date, id };
}

@Injectable()
export class AuditService extends DbService {
  constructor(@Inject(DATABASE) database: DatabaseProvider) {
    super(database);
  }

  async search(
    actor: User,
    roles: readonly PlatformRole[],
    query: z.output<typeof auditQuerySchema>,
  ): Promise<AuditPage> {
    const scope = auditScope(roles);
    const filters: Filter[] = [];
    if (scope !== "all") {
      const allowed = scope.map((prefix) => like(auditEvents.action, `${escapeLike(prefix)}%`));
      const any = or(...allowed);
      if (any) filters.push(any);
    }
    if (query.action) {
      filters.push(
        query.action.endsWith(".")
          ? like(auditEvents.action, `${escapeLike(query.action)}%`)
          : eq(auditEvents.action, query.action),
      );
    }
    if (query.actorId) filters.push(eq(auditEvents.actorId, query.actorId));
    if (query.actorEmail) {
      const [person] = await this.db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, query.actorEmail.toLowerCase()))
        .limit(1);
      if (!person) return { items: [], nextCursor: null, scope };
      filters.push(eq(auditEvents.actorId, person.id));
    }
    if (query.targetType) filters.push(eq(auditEvents.targetType, query.targetType));
    if (query.targetId) filters.push(eq(auditEvents.targetId, query.targetId));
    if (query.organizationId) filters.push(eq(auditEvents.organizationId, query.organizationId));
    if (query.from) filters.push(gte(auditEvents.occurredAt, new Date(query.from)));
    if (query.to) filters.push(lte(auditEvents.occurredAt, new Date(query.to)));
    if (query.cursor) {
      const { at, id } = decodeCursor(query.cursor);
      const page = or(
        lt(auditEvents.occurredAt, at),
        and(eq(auditEvents.occurredAt, at), lt(auditEvents.id, id)),
      );
      if (page) filters.push(page);
    }

    const rows = await this.db
      .select({
        event: auditEvents,
        actorEmail: users.email,
        actorName: users.displayName,
      })
      .from(auditEvents)
      .leftJoin(users, eq(users.id, auditEvents.actorId))
      .where(filters.length > 0 ? and(...filters) : undefined)
      .orderBy(desc(auditEvents.occurredAt), desc(auditEvents.id))
      .limit(query.limit + 1);

    // Searching the audit log is itself audited (who looked for what).
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: actor.id,
      action: "admin.audit_searched",
      targetType: "audit_log",
      requestId: requestId(),
      metadata: {
        filters: Object.fromEntries(
          Object.entries(query).filter(([key]) => key !== "cursor" && key !== "limit"),
        ),
        scope,
      },
    });

    const page = rows.slice(0, query.limit);
    const last = page.at(-1);
    const items: AuditEntryDto[] = page.map(({ event, actorEmail, actorName }) => ({
      id: event.id,
      occurredAt: event.occurredAt.toISOString(),
      actorType: event.actorType,
      actor: event.actorId
        ? { id: event.actorId, email: actorEmail, displayName: actorName }
        : null,
      action: event.action,
      targetType: event.targetType,
      targetId: event.targetId,
      organizationId: event.organizationId,
      requestId: event.requestId,
      metadata: event.metadata,
    }));
    return {
      items,
      nextCursor:
        rows.length > query.limit && last
          ? encodeCursor(last.event.occurredAt, last.event.id)
          : null,
      scope,
    };
  }
}

// ---------------------------------------------------------------------------------------------
// Support: account metadata and recovery help, always through an audited case
// ---------------------------------------------------------------------------------------------

@Injectable()
export class SupportService extends DbService {
  constructor(
    @Inject(DATABASE) database: DatabaseProvider,
    @Inject(AUTH_VERIFIER) private readonly verifier: AuthVerifier,
    @Inject(EMAIL_SENDER) private readonly email: EmailSender,
    @Inject(API_ENV) private readonly env: ApiEnv,
  ) {
    super(database);
  }

  /** Metadata only: no documents, messages or request contents (SRS §2.3). Audited. */
  async lookup(
    actor: User,
    by: { email?: string | undefined; userId?: string | undefined },
  ): Promise<SupportAccountDto> {
    const [user] = await this.db
      .select()
      .from(users)
      .where(by.userId ? eq(users.id, by.userId) : eq(users.email, (by.email ?? "").toLowerCase()))
      .limit(1);
    if (!user) throw notFound();
    const now = new Date();
    const [orgs, [sanctions], [cases]] = await Promise.all([
      this.db
        .select({ name: organizations.name, kind: organizations.kind, role: memberships.role })
        .from(memberships)
        .innerJoin(organizations, eq(organizations.id, memberships.organizationId))
        .where(eq(memberships.userId, user.id)),
      this.db
        .select({ n: count() })
        .from(memberSanctions)
        .where(
          and(
            eq(memberSanctions.userId, user.id),
            eq(memberSanctions.kind, "suspension"),
            isNull(memberSanctions.liftedAt),
            or(isNull(memberSanctions.endsAt), gt(memberSanctions.endsAt, now)),
          ),
        ),
      this.db
        .select({ n: count() })
        .from(supportCases)
        .where(and(eq(supportCases.userId, user.id), eq(supportCases.status, "open"))),
    ]);
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: actor.id,
      action: "support.account_viewed",
      targetType: "user",
      targetId: user.id,
      requestId: requestId(),
      metadata: {},
    });
    return {
      userId: user.id,
      email: user.email,
      emailVerified: user.emailVerified,
      displayName: user.displayName,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      lastSeenAt: user.lastSeenAt?.toISOString() ?? null,
      lastSignInProvider: user.lastSignInProvider,
      organizations: orgs,
      activeSanctions: sanctions?.n ?? 0,
      openCases: cases?.n ?? 0,
    };
  }

  async open(actor: User, userId: string, reason: string): Promise<SupportCaseDto> {
    const [user] = await this.db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (!user) throw notFound();
    const created = await this.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(supportCases)
        .values({ userId, reason, openedBy: actor.id })
        .returning();
      if (!row) throw new Error("support case insert returned no row");
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        action: "support.case_opened",
        targetType: "support_case",
        targetId: row.id,
        requestId: requestId(),
        metadata: { userId },
      });
      return row;
    });
    return this.get(created.id);
  }

  async list(status: "open" | "closed"): Promise<SupportCaseDto[]> {
    const rows = await this.db
      .select({ id: supportCases.id })
      .from(supportCases)
      .where(eq(supportCases.status, status))
      .orderBy(desc(supportCases.openedAt))
      .limit(100);
    return Promise.all(rows.map((row) => this.get(row.id)));
  }

  async get(caseId: string): Promise<SupportCaseDto> {
    const [row] = await this.db
      .select({ c: supportCases, subjectEmail: users.email })
      .from(supportCases)
      .innerJoin(users, eq(users.id, supportCases.userId))
      .where(eq(supportCases.id, caseId))
      .limit(1);
    if (!row) throw notFound();
    const [opener] = await this.db
      .select({ email: users.email })
      .from(users)
      .where(eq(users.id, row.c.openedBy))
      .limit(1);
    const actions = await this.db
      .select({ action: auditEvents.action, at: auditEvents.occurredAt })
      .from(auditEvents)
      .where(and(eq(auditEvents.targetType, "support_case"), eq(auditEvents.targetId, caseId)))
      .orderBy(auditEvents.occurredAt);
    return {
      id: row.c.id,
      userId: row.c.userId,
      subjectEmail: row.subjectEmail,
      reason: row.c.reason,
      status: row.c.status,
      resolution: row.c.resolution,
      openedBy: opener?.email ?? null,
      openedAt: row.c.openedAt.toISOString(),
      closedAt: row.c.closedAt?.toISOString() ?? null,
      actions: actions.map((a) => ({ action: a.action, at: a.at.toISOString() })),
    };
  }

  async close(actor: User, caseId: string, resolution: string): Promise<SupportCaseDto> {
    await this.db.transaction(async (tx) => {
      const updated = await tx
        .update(supportCases)
        .set({ status: "closed", resolution, closedBy: actor.id, closedAt: new Date() })
        .where(and(eq(supportCases.id, caseId), eq(supportCases.status, "open")))
        .returning({ id: supportCases.id });
      if (updated.length === 0) await this.assertOpen(tx, caseId);
      await recordAuditEvent(tx, {
        actorType: "user",
        actorId: actor.id,
        action: "support.case_closed",
        targetType: "support_case",
        targetId: caseId,
        requestId: requestId(),
        metadata: {},
      });
    });
    return this.get(caseId);
  }

  /** "Sign out everywhere" for the case's account (for example a lost phone). */
  async revokeSessions(actor: User, caseId: string): Promise<SupportCaseDto> {
    const subject = await this.openCaseSubject(caseId);
    await this.verifier.revokeSessions(subject.firebaseUid);
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: actor.id,
      action: "support.sessions_revoked",
      targetType: "support_case",
      targetId: caseId,
      requestId: requestId(),
      metadata: { userId: subject.id },
    });
    return this.get(caseId);
  }

  /**
   * Emails a sign-in link to the account's own address. Staff never see the link and can't
   * send it anywhere else, so support can't take over an account.
   */
  async sendSignInLink(actor: User, caseId: string): Promise<SupportCaseDto> {
    const subject = await this.openCaseSubject(caseId);
    if (!subject.email) {
      throw new ConflictException({ statusCode: 409, error: "conflict", reason: "no_email" });
    }
    const link = await this.verifier.signInLink(
      subject.email,
      `${this.env.PUBLIC_WEB_URL}/auth/finish`,
    );
    await this.email.send({
      to: subject.email,
      subject: "Your FleetTrust sign-in link",
      text: `FleetTrust support sent you this sign-in link at your request:\n\n${link}\n\nIt works once and expires soon. If you didn't ask for help, ignore this email.`,
    });
    await recordAuditEvent(this.db, {
      actorType: "user",
      actorId: actor.id,
      action: "support.sign_in_link_sent",
      targetType: "support_case",
      targetId: caseId,
      requestId: requestId(),
      metadata: { userId: subject.id },
    });
    return this.get(caseId);
  }

  private async openCaseSubject(caseId: string): Promise<User> {
    const [row] = await this.db
      .select({ c: supportCases, user: users })
      .from(supportCases)
      .innerJoin(users, eq(users.id, supportCases.userId))
      .where(eq(supportCases.id, caseId))
      .limit(1);
    if (!row) throw notFound();
    if (row.c.status !== "open") {
      throw new ConflictException({ statusCode: 409, error: "conflict", reason: "case_closed" });
    }
    return row.user;
  }

  private async assertOpen(
    executor: Database | Parameters<Parameters<Database["transaction"]>[0]>[0],
    caseId: string,
  ): Promise<void> {
    const [row] = await executor
      .select({ status: supportCases.status })
      .from(supportCases)
      .where(eq(supportCases.id, caseId))
      .limit(1);
    if (!row) throw notFound();
    throw new ConflictException({ statusCode: 409, error: "conflict", reason: "case_closed" });
  }
}

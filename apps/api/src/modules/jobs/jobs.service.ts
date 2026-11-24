import {
  and,
  branches,
  count,
  currencies,
  type Database,
  desc,
  enqueueOutboxEvent,
  eq,
  type Executor,
  gt,
  gte,
  inArray,
  isNull,
  type Job,
  type JobApplication,
  jobApplications,
  jobs,
  memberships,
  organizations,
  queryRows,
  recordAuditEvent,
  sql,
  type User,
  users,
  verificationBadges,
} from "@fleettrust/db";
import {
  type ApplicationDto,
  type applicationStatusRequestSchema,
  type applyRequestSchema,
  JOB_SCAM_WARNING,
  type JobDto,
  type JobErrorReason,
  type jobListQuerySchema,
  type jobRequestSchema,
  jobWarnings,
  MAX_JOB_OPEN_DAYS,
  type PublicJob,
  type publicJobQuerySchema,
  salaryLabel,
  UNVERIFIED_EMPLOYER_NOTICE,
} from "@fleettrust/types";
import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { z } from "zod";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";

type JobInput = z.output<typeof jobRequestSchema>;
type JobQuery = z.output<typeof jobListQuerySchema>;
type PublicQuery = z.output<typeof publicJobQuerySchema>;
type ApplyInput = z.output<typeof applyRequestSchema>;
type StatusInput = z.output<typeof applicationStatusRequestSchema>;

export function jobError(status: 400 | 409, reason: JobErrorReason): Error {
  const body = { statusCode: status, error: status === 409 ? "conflict" : "bad_request", reason };
  return status === 409 ? new ConflictException(body) : new BadRequestException(body);
}

const notFound = () => new NotFoundException({ statusCode: 404, error: "not_found" });
const DAY_MS = 86_400_000;
const FALLBACK_NAME = "FleetTrust member";
const trim = (v: string) => (v.includes(".") ? v.replace(/\.?0+$/, "") : v);

/** Applications move between these; `withdrawn` is the applicant's own, and final. */
const RECRUITER_MOVES = new Set(["submitted", "shortlisted"]);

/**
 * Job board (SRS F-153, F-154, AB-14, ADR-0029).
 *
 * - Fleets with `jobs.manage` (owners, admins, recruiters) write listings and handle applications.
 * - Publishing: an employer with an active business verification badge whose listing shows no
 *   scam signs goes live at once; anything else waits in the moderation queue.
 * - Edits to a live listing are checked again. Listings can be reported (moderation module).
 */
@Injectable()
export class JobsService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private today(): string {
    return this.clock.now().toISOString().slice(0, 10);
  }

  /** Organizations with an active (not ended, not expired) business badge. */
  private async verifiedEmployers(executor: Executor, orgIds: readonly string[]) {
    if (orgIds.length === 0) return new Set<string>();
    const rows = await executor
      .select({ organizationId: verificationBadges.organizationId })
      .from(verificationBadges)
      .where(
        and(
          inArray(verificationBadges.organizationId, [...orgIds]),
          eq(verificationBadges.badgeType, "business"),
          isNull(verificationBadges.endedAt),
          gt(verificationBadges.expiresAt, this.clock.now()),
        ),
      );
    return new Set(rows.flatMap((r) => (r.organizationId ? [r.organizationId] : [])));
  }

  private assertFleet(access: TenantAccess) {
    if (access.organization.kind !== "fleet") throw jobError(400, "not_a_fleet");
  }

  private async validate(executor: Executor, access: TenantAccess, input: JobInput) {
    const today = this.today();
    const latest = new Date(Date.parse(`${today}T00:00:00Z`) + MAX_JOB_OPEN_DAYS * DAY_MS)
      .toISOString()
      .slice(0, 10);
    if (input.closesOn <= today || input.closesOn > latest) {
      throw jobError(400, "invalid_close_date");
    }
    if (input.branchId !== null) {
      const [branch] = await executor
        .select({ id: branches.id })
        .from(branches)
        .where(
          and(
            eq(branches.id, input.branchId),
            eq(branches.organizationId, access.tenant.organizationId),
          ),
        );
      if (!branch || (access.branchScope !== null && access.branchScope !== input.branchId)) {
        throw jobError(400, "invalid_branch");
      }
    }
    if (input.salary !== null) {
      const [currency] = await executor
        .select()
        .from(currencies)
        .where(eq(currencies.code, input.salary.currency));
      if (!currency?.isActive) throw jobError(400, "unknown_currency");
    }
  }

  private columns(input: JobInput) {
    return {
      title: input.title,
      description: input.description,
      role: input.role,
      employmentType: input.employmentType,
      licenceClasses: input.licenceClasses,
      locality: input.locality,
      countryCode: input.countryCode,
      branchId: input.branchId,
      salaryCurrency: input.salary?.currency ?? null,
      salaryMin: input.salary?.min ?? null,
      salaryMax: input.salary?.max ?? null,
      salaryPeriod: input.salary?.period ?? null,
      closesOn: input.closesOn,
    };
  }

  private async audit(
    executor: Executor,
    actor: User,
    job: Job,
    action: string,
    metadata: Record<string, unknown> = {},
  ) {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: job.organizationId,
      action,
      targetType: "job",
      targetId: job.id,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  /** Where a listing goes when it's (re)submitted: live, or the moderation queue. */
  private async destination(
    executor: Executor,
    job: Pick<Job, "organizationId" | "title" | "description">,
  ) {
    const verified = (await this.verifiedEmployers(executor, [job.organizationId])).has(
      job.organizationId,
    );
    const warnings = jobWarnings(`${job.title}\n${job.description}`);
    const live = verified && warnings.length === 0;
    return {
      status: live ? ("published" as const) : ("pending_moderation" as const),
      note: live
        ? null
        : warnings.length > 0
          ? "Mentions fees or payments: a moderator will review it."
          : "Employer not verified yet: a moderator will review it.",
    };
  }

  // --- Employer --------------------------------------------------------------------------------

  private async own(executor: Executor, access: TenantAccess, jobId: string, lock = false) {
    this.assertFleet(access);
    const query = executor
      .select()
      .from(jobs)
      .where(and(eq(jobs.id, jobId), eq(jobs.organizationId, access.tenant.organizationId)));
    const [row] = lock ? await query.for("update") : await query;
    if (!row) throw notFound();
    return row;
  }

  async create(access: TenantAccess, actor: User, input: JobInput): Promise<JobDto> {
    this.assertFleet(access);
    const row = await this.db.transaction(async (tx) => {
      await this.validate(tx, access, input);
      const [created] = await tx
        .insert(jobs)
        .values({
          organizationId: access.tenant.organizationId,
          createdBy: actor.id,
          ...this.columns(input),
        })
        .returning();
      if (!created) throw new Error("job insert returned no row");
      await this.audit(tx, actor, created, "job.created");
      return created;
    });
    return this.get(access, row.id);
  }

  async update(access: TenantAccess, actor: User, jobId: string, input: JobInput): Promise<JobDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, jobId, true);
      if (current.status === "hidden" || current.status === "closed") {
        throw jobError(409, "invalid_transition");
      }
      await this.validate(tx, access, input);
      let status = current.status;
      let note = current.moderationNote;
      if (status === "rejected") status = "draft";
      // A live listing is checked again, so approved text can't be swapped for a scam.
      if (status === "published") {
        const next = await this.destination(tx, { ...current, ...this.columns(input) });
        status = next.status;
        note = next.note;
      }
      await tx
        .update(jobs)
        .set({ ...this.columns(input), status, moderationNote: note })
        .where(eq(jobs.id, current.id));
      await this.audit(tx, actor, current, "job.updated", { from: current.status, to: status });
    });
    return this.get(access, jobId);
  }

  async publish(access: TenantAccess, actor: User, jobId: string): Promise<JobDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, jobId, true);
      if (current.status !== "draft" && current.status !== "rejected") {
        throw jobError(409, "invalid_transition");
      }
      if (current.closesOn <= this.today()) throw jobError(400, "invalid_close_date");
      const next = await this.destination(tx, current);
      await tx
        .update(jobs)
        .set({
          status: next.status,
          moderationNote: next.note,
          publishedAt: next.status === "published" ? this.clock.now() : null,
        })
        .where(eq(jobs.id, current.id));
      await this.audit(
        tx,
        actor,
        current,
        next.status === "published" ? "job.published" : "job.submitted_for_moderation",
        { reason: next.note },
      );
    });
    return this.get(access, jobId);
  }

  async close(access: TenantAccess, actor: User, jobId: string): Promise<JobDto> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, jobId, true);
      if (current.status !== "published") throw jobError(409, "invalid_transition");
      await tx.update(jobs).set({ status: "closed" }).where(eq(jobs.id, current.id));
      await this.audit(tx, actor, current, "job.closed");
    });
    return this.get(access, jobId);
  }

  /** Listings that were never live can be deleted. */
  async remove(access: TenantAccess, actor: User, jobId: string): Promise<void> {
    await this.db.transaction(async (tx) => {
      const current = await this.own(tx, access, jobId, true);
      if (!["draft", "pending_moderation", "rejected"].includes(current.status)) {
        throw jobError(409, "invalid_transition");
      }
      await tx.delete(jobs).where(eq(jobs.id, current.id));
      await this.audit(tx, actor, current, "job.deleted");
    });
  }

  async list(access: TenantAccess, query: JobQuery): Promise<JobDto[]> {
    this.assertFleet(access);
    const rows = await this.db
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.organizationId, access.tenant.organizationId),
          query.status ? eq(jobs.status, query.status) : undefined,
        ),
      )
      .orderBy(desc(jobs.createdAt))
      .limit(500);
    return this.employerDtos(rows);
  }

  async get(access: TenantAccess, jobId: string): Promise<JobDto> {
    const row = await this.own(this.db, access, jobId);
    const [dto] = await this.employerDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  async applications(access: TenantAccess, jobId: string): Promise<ApplicationDto[]> {
    const job = await this.own(this.db, access, jobId);
    const rows = await this.db
      .select()
      .from(jobApplications)
      .where(
        and(
          eq(jobApplications.jobId, job.id),
          eq(jobApplications.organizationId, job.organizationId),
        ),
      )
      .orderBy(desc(jobApplications.createdAt));
    return this.applicationDtos(rows);
  }

  async setApplicationStatus(
    access: TenantAccess,
    actor: User,
    applicationId: string,
    input: StatusInput,
  ): Promise<ApplicationDto> {
    this.assertFleet(access);
    const row = await this.db.transaction(async (tx) => {
      const [current] = await tx
        .select()
        .from(jobApplications)
        .where(
          and(
            eq(jobApplications.id, applicationId),
            eq(jobApplications.organizationId, access.tenant.organizationId),
          ),
        )
        .for("update");
      if (!current) throw notFound();
      if (!RECRUITER_MOVES.has(current.status)) throw jobError(409, "invalid_transition");
      const [updated] = await tx
        .update(jobApplications)
        .set({ status: input.status })
        .where(eq(jobApplications.id, current.id))
        .returning();
      if (!updated) throw notFound();
      if (updated.status !== current.status) {
        await enqueueOutboxEvent(tx, {
          aggregateType: "job_application",
          aggregateId: updated.id,
          eventType: "JobApplicationUpdated",
          payload: { status: updated.status, actorId: actor.id },
        });
      }
      return updated;
    });
    const [dto] = await this.applicationDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  // --- Public and applicants -------------------------------------------------------------------

  async publicList(query: PublicQuery): Promise<{ items: PublicJob[]; nextOffset: number | null }> {
    const today = this.today();
    const pattern = query.q ? `%${query.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` : null;
    const nowIso = this.clock.now().toISOString();
    const rows = await queryRows<{ id: string }>(
      this.db,
      sql`SELECT j.id FROM jobs j
          JOIN organizations o ON o.id = j.organization_id AND o.status = 'active'
          WHERE j.status = 'published' AND j.closes_on >= ${today}::date
          ${query.role ? sql`AND j.role = ${query.role}` : sql``}
          ${query.employmentType ? sql`AND j.employment_type = ${query.employmentType}` : sql``}
          ${query.countryCode ? sql`AND j.country_code = ${query.countryCode}` : sql``}
          ${pattern ? sql`AND (j.title ILIKE ${pattern} OR j.description ILIKE ${pattern} OR j.locality ILIKE ${pattern})` : sql``}
          ${
            query.verifiedOnly
              ? sql`AND EXISTS (SELECT 1 FROM verification_badges b
                     WHERE b.organization_id = j.organization_id AND b.badge_type = 'business'
                       AND b.ended_at IS NULL AND b.expires_at > ${nowIso}::timestamptz)`
              : sql``
          }
          ORDER BY j.published_at DESC, j.id
          LIMIT ${query.limit + 1} OFFSET ${query.offset}`,
    );
    const page = rows.slice(0, query.limit).map((r) => r.id);
    const loaded = page.length
      ? await this.db.select().from(jobs).where(inArray(jobs.id, page))
      : [];
    const dtos = await this.publicDtos(loaded);
    const byId = new Map(dtos.map((d) => [d.id, d]));
    return {
      items: page.flatMap((id) => {
        const dto = byId.get(id);
        return dto ? [dto] : [];
      }),
      nextOffset: rows.length > query.limit ? query.offset + query.limit : null,
    };
  }

  /** A live listing (published, not past its closing date, employer active). */
  private async openJob(executor: Executor, jobId: string, lock = false): Promise<Job | null> {
    const query = executor
      .select({ job: jobs, orgStatus: organizations.status })
      .from(jobs)
      .innerJoin(organizations, eq(organizations.id, jobs.organizationId))
      .where(
        and(eq(jobs.id, jobId), eq(jobs.status, "published"), gte(jobs.closesOn, this.today())),
      );
    const [row] = lock ? await query.for("update", { of: jobs }) : await query;
    return row?.orgStatus === "active" ? row.job : null;
  }

  async publicJob(jobId: string): Promise<PublicJob> {
    const job = await this.openJob(this.db, jobId);
    if (!job) throw notFound();
    const [dto] = await this.publicDtos([job]);
    if (!dto) throw notFound();
    return dto;
  }

  async apply(actor: User, jobId: string, input: ApplyInput): Promise<ApplicationDto> {
    let id: string;
    try {
      id = await this.db.transaction(async (tx) => {
        const job = await this.openJob(tx, jobId, true);
        if (!job) {
          const [exists] = await tx.select({ id: jobs.id }).from(jobs).where(eq(jobs.id, jobId));
          if (!exists) throw notFound();
          throw jobError(409, "job_not_open");
        }
        const [member] = await tx
          .select({ id: memberships.userId })
          .from(memberships)
          .where(
            and(
              eq(memberships.organizationId, job.organizationId),
              eq(memberships.userId, actor.id),
            ),
          );
        if (member) throw jobError(400, "own_job");
        const [row] = await tx
          .insert(jobApplications)
          .values({
            jobId: job.id,
            organizationId: job.organizationId,
            applicantUserId: actor.id,
            message: input.message,
            phone: input.phone,
            email: input.email,
          })
          .returning();
        if (!row) throw new Error("application insert returned no row");
        await enqueueOutboxEvent(tx, {
          aggregateType: "job_application",
          aggregateId: row.id,
          eventType: "JobApplicationReceived",
          payload: { jobId: job.id, organizationId: job.organizationId },
        });
        return row.id;
      });
    } catch (error) {
      if (
        String((error as { cause?: unknown }).cause ?? error).includes(
          "job_applications_one_per_person",
        )
      ) {
        throw jobError(409, "already_applied");
      }
      throw error;
    }
    return this.myApplication(actor, id);
  }

  async myApplications(actor: User): Promise<ApplicationDto[]> {
    const rows = await this.db
      .select()
      .from(jobApplications)
      .where(eq(jobApplications.applicantUserId, actor.id))
      .orderBy(desc(jobApplications.createdAt))
      .limit(200);
    return this.applicationDtos(rows);
  }

  private async myApplication(actor: User, applicationId: string): Promise<ApplicationDto> {
    const [row] = await this.db
      .select()
      .from(jobApplications)
      .where(
        and(eq(jobApplications.id, applicationId), eq(jobApplications.applicantUserId, actor.id)),
      );
    if (!row) throw notFound();
    const [dto] = await this.applicationDtos([row]);
    if (!dto) throw notFound();
    return dto;
  }

  async withdraw(actor: User, applicationId: string): Promise<ApplicationDto> {
    await this.db.transaction(async (tx) => {
      const [row] = await tx
        .select()
        .from(jobApplications)
        .where(
          and(eq(jobApplications.id, applicationId), eq(jobApplications.applicantUserId, actor.id)),
        )
        .for("update");
      if (!row) throw notFound();
      if (!RECRUITER_MOVES.has(row.status)) throw jobError(409, "invalid_transition");
      await tx
        .update(jobApplications)
        .set({ status: "withdrawn" })
        .where(eq(jobApplications.id, row.id));
    });
    return this.myApplication(actor, applicationId);
  }

  // --- DTOs ------------------------------------------------------------------------------------

  private async employers(rows: readonly Pick<Job, "organizationId">[]) {
    const ids = [...new Set(rows.map((r) => r.organizationId))];
    if (ids.length === 0) return new Map<string, { name: string; verified: boolean }>();
    const [orgs, verified] = await Promise.all([
      this.db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(inArray(organizations.id, ids)),
      this.verifiedEmployers(this.db, ids),
    ]);
    return new Map(orgs.map((o) => [o.id, { name: o.name, verified: verified.has(o.id) }]));
  }

  private core(job: Job, employer: { name: string; verified: boolean } | undefined): PublicJob {
    const verified = employer?.verified ?? false;
    const salary =
      job.salaryCurrency === null || job.salaryMin === null || job.salaryPeriod === null
        ? null
        : {
            currency: job.salaryCurrency,
            min: trim(job.salaryMin),
            max: job.salaryMax === null ? null : trim(job.salaryMax),
            period: job.salaryPeriod,
          };
    return {
      id: job.id,
      title: job.title,
      description: job.description,
      role: job.role,
      employmentType: job.employmentType,
      licenceClasses: job.licenceClasses,
      locality: job.locality,
      countryCode: job.countryCode,
      salary: salary === null ? null : { ...salary, label: salaryLabel(salary) },
      closesOn: job.closesOn,
      publishedAt: job.publishedAt?.toISOString() ?? null,
      employer: {
        organizationId: job.organizationId,
        name: employer?.name ?? "Employer",
        verified,
      },
      scamWarning: JOB_SCAM_WARNING,
      employerNotice: verified ? null : UNVERIFIED_EMPLOYER_NOTICE,
    };
  }

  private async publicDtos(rows: readonly Job[]): Promise<PublicJob[]> {
    const employers = await this.employers(rows);
    return rows.map((job) => this.core(job, employers.get(job.organizationId)));
  }

  private async employerDtos(rows: readonly Job[]): Promise<JobDto[]> {
    const ids = rows.map((r) => r.id);
    const [employers, counts] = await Promise.all([
      this.employers(rows),
      ids.length
        ? this.db
            .select({ jobId: jobApplications.jobId, status: jobApplications.status, n: count() })
            .from(jobApplications)
            .where(inArray(jobApplications.jobId, ids))
            .groupBy(jobApplications.jobId, jobApplications.status)
        : Promise.resolve([]),
    ]);
    return rows.map((job) => {
      const mine = counts.filter((c) => c.jobId === job.id);
      return {
        ...this.core(job, employers.get(job.organizationId)),
        status: job.status,
        branchId: job.branchId,
        moderationNote: job.moderationNote,
        warnings: jobWarnings(`${job.title}\n${job.description}`),
        applications: {
          total: mine.reduce((n, c) => n + c.n, 0),
          submitted: mine.filter((c) => c.status === "submitted").reduce((n, c) => n + c.n, 0),
        },
        createdAt: job.createdAt.toISOString(),
        updatedAt: job.updatedAt.toISOString(),
      };
    });
  }

  private async applicationDtos(rows: readonly JobApplication[]): Promise<ApplicationDto[]> {
    if (rows.length === 0) return [];
    const jobIds = [...new Set(rows.map((r) => r.jobId))];
    const [jobRows, people] = await Promise.all([
      this.db.select().from(jobs).where(inArray(jobs.id, jobIds)),
      this.db
        .select({ id: users.id, name: users.displayName })
        .from(users)
        .where(inArray(users.id, [...new Set(rows.map((r) => r.applicantUserId))])),
    ]);
    const employers = await this.employers(jobRows);
    const jobOf = new Map(jobRows.map((j) => [j.id, j]));
    const nameOf = new Map(people.map((p) => [p.id, p.name ?? FALLBACK_NAME]));
    return rows.flatMap((r) => {
      const job = jobOf.get(r.jobId);
      if (!job) return [];
      const employer = employers.get(job.organizationId);
      return [
        {
          id: r.id,
          jobId: r.jobId,
          job: {
            title: job.title,
            status: job.status,
            employer: {
              organizationId: job.organizationId,
              name: employer?.name ?? "Employer",
              verified: employer?.verified ?? false,
            },
          },
          applicant: {
            userId: r.applicantUserId,
            name: nameOf.get(r.applicantUserId) ?? FALLBACK_NAME,
          },
          message: r.message,
          phone: r.phone,
          email: r.email,
          status: r.status,
          createdAt: r.createdAt.toISOString(),
          updatedAt: r.updatedAt.toISOString(),
        },
      ];
    });
  }
}

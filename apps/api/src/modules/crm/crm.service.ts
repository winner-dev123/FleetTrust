import {
  and,
  appointments,
  asc,
  type CrmTask,
  crmInquiryNotes,
  crmInquiryStates,
  crmTasks,
  type Database,
  desc,
  eq,
  type Executor,
  gt,
  inArray,
  isNull,
  or,
  recordAuditEvent,
  type ServiceRequest,
  type ServiceRequestRecipient,
  serviceQuotes,
  serviceRequestEvents,
  serviceRequestRecipients,
  serviceRequests,
  sql,
  type User,
  users,
} from "@fleettrust/db";
import {
  type CrmInquiryDto,
  type CrmQuoteDto,
  type CrmTaskDto,
  type createTaskSchema,
  formatIndicativePrice,
  type InquiryNoteDto,
  PIPELINE_STAGES,
  type PipelineDto,
  type PipelineItemDto,
  type PipelineStage,
  type pipelineQuerySchema,
  type quoteListQuerySchema,
  type taskQuerySchema,
  type updateInquiryCrmSchema,
  type updateTaskSchema,
} from "@fleettrust/types";
import type { z } from "zod";
import { Inject, Injectable } from "@nestjs/common";

import { DATABASE, type DatabaseProvider } from "../../database/database.module.js";
import { currentRequestContext } from "../../observability/request-context.js";
import { CLOCK, type Clock } from "../../platform/clock/index.js";
import type { TenantAccess } from "../organizations/index.js";
import { priceOf } from "../providers/index.js";
import {
  assertProvider,
  canManage,
  crmError,
  eligibleMember,
  inScope,
  notFound,
  recipientInScope,
  responseDueAt,
  stageOf,
  summaryOf,
} from "./shared.js";

type PipelineQuery = z.output<typeof pipelineQuerySchema>;
type UpdateInquiry = z.output<typeof updateInquiryCrmSchema>;
type QuoteQuery = z.output<typeof quoteListQuerySchema>;
type TaskInput = z.output<typeof createTaskSchema>;
type TaskUpdate = z.output<typeof updateTaskSchema>;
type TaskQuery = z.output<typeof taskQuerySchema>;

const PIPELINE_LIMIT = 200;
const DAY_MS = 86_400_000;
/** Replies that end the "awaiting response" state. */
const RESPONSE_EVENTS = ["quote_submitted", "declined"];

/**
 * The provider CRM (F-130, ADR-0027): pipeline over the inquiry inbox, assignment and priority,
 * internal notes, quote overview and tasks. Branch scope narrows everything; staff work on
 * their own items, managers (`crm.manage`) on everyone's.
 */
@Injectable()
export class CrmService {
  constructor(
    @Inject(DATABASE) private readonly database: DatabaseProvider,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  private get db(): Database {
    if (this.database === null) throw new Error("DATABASE_URL is not configured");
    return this.database.db;
  }

  private async audit(
    executor: Executor,
    access: TenantAccess,
    actor: User,
    action: string,
    targetType: string,
    targetId: string,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await recordAuditEvent(executor, {
      actorType: "user",
      actorId: actor.id,
      organizationId: access.tenant.organizationId,
      action: `crm.${action}`,
      targetType,
      targetId,
      requestId: currentRequestContext()?.requestId,
      metadata,
    });
  }

  private async names(ids: readonly (string | null)[]): Promise<Map<string, string | null>> {
    const unique = [...new Set(ids.filter((id): id is string => id !== null))];
    if (unique.length === 0) return new Map();
    const rows = await this.db
      .select({ id: users.id, displayName: users.displayName })
      .from(users)
      .where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.displayName]));
  }

  // --- Pipeline --------------------------------------------------------------------------------

  private async items(
    access: TenantAccess,
    rows: { recipient: ServiceRequestRecipient; request: ServiceRequest }[],
  ): Promise<PipelineItemDto[]> {
    if (rows.length === 0) return [];
    const now = this.clock.now();
    const recipientIds = rows.map((r) => r.recipient.id);
    const requestIds = rows.map((r) => r.request.id);
    const orgId = access.tenant.organizationId;
    const [states, responses, tasks, upcoming, quotes] = await Promise.all([
      this.db
        .select()
        .from(crmInquiryStates)
        .where(inArray(crmInquiryStates.recipientId, recipientIds)),
      this.db
        .select({
          requestId: serviceRequestEvents.requestId,
          first: sql<Date | string>`min(${serviceRequestEvents.createdAt})`,
        })
        .from(serviceRequestEvents)
        .where(
          and(
            eq(serviceRequestEvents.organizationId, orgId),
            inArray(serviceRequestEvents.requestId, requestIds),
            inArray(serviceRequestEvents.type, RESPONSE_EVENTS),
          ),
        )
        .groupBy(serviceRequestEvents.requestId),
      this.db
        .select({ recipientId: crmTasks.recipientId, count: sql<number>`count(*)::int` })
        .from(crmTasks)
        .where(and(inArray(crmTasks.recipientId, recipientIds), eq(crmTasks.status, "open")))
        .groupBy(crmTasks.recipientId),
      this.db
        .select({
          recipientId: appointments.recipientId,
          next: sql<Date | string>`min(${appointments.startsAt})`,
        })
        .from(appointments)
        .where(
          and(
            inArray(appointments.recipientId, recipientIds),
            eq(appointments.status, "booked"),
            gt(appointments.startsAt, now),
          ),
        )
        .groupBy(appointments.recipientId),
      this.db
        .select()
        .from(serviceQuotes)
        .where(inArray(serviceQuotes.recipientId, recipientIds))
        .orderBy(desc(serviceQuotes.createdAt)),
    ]);
    const stateBy = new Map(states.map((s) => [s.recipientId, s]));
    const firstBy = new Map(responses.map((r) => [r.requestId, new Date(r.first)]));
    const tasksBy = new Map(tasks.map((t) => [t.recipientId, t.count]));
    const nextBy = new Map(upcoming.map((u) => [u.recipientId, new Date(u.next)]));
    const latestBy = new Map<string, (typeof quotes)[number]>();
    for (const q of quotes) if (!latestBy.has(q.recipientId)) latestBy.set(q.recipientId, q);
    const names = await this.names(states.map((s) => s.assigneeUserId));

    return rows.map(({ recipient, request }) => {
      const stage = stageOf(recipient, request, now);
      const state = stateBy.get(recipient.id);
      const first = firstBy.get(request.id) ?? null;
      const dueAt = responseDueAt(recipient.createdAt, request.urgency);
      const responseState = first
        ? ("responded" as const)
        : stage === "new" || stage === "open"
          ? ("awaiting" as const)
          : ("closed" as const);
      const quote = latestBy.get(recipient.id);
      const assignee = state?.assigneeUserId ?? null;
      return {
        recipientId: recipient.id,
        requestId: request.id,
        branchId: recipient.branchId,
        stage,
        category: request.category as PipelineItemDto["category"],
        vehicleType: request.vehicleType as PipelineItemDto["vehicleType"],
        urgency: request.urgency,
        summary: summaryOf(request.description),
        createdAt: recipient.createdAt.toISOString(),
        assignee:
          assignee === null ? null : { userId: assignee, displayName: names.get(assignee) ?? null },
        priority: state?.priority ?? "normal",
        response: {
          state: responseState,
          dueAt: dueAt.toISOString(),
          overdue: responseState === "awaiting" && now > dueAt,
          firstResponseAt: first?.toISOString() ?? null,
        },
        openTasks: tasksBy.get(recipient.id) ?? 0,
        nextAppointmentAt: nextBy.get(recipient.id)?.toISOString() ?? null,
        latestQuote: quote
          ? {
              id: quote.id,
              status:
                quote.status === "active" && quote.validUntil <= now ? "expired" : quote.status,
              priceLabel: formatIndicativePrice(priceOf(quote)),
              validUntil: quote.validUntil.toISOString(),
            }
          : null,
      };
    });
  }

  private async scopedRows(access: TenantAccess, recipientIds?: string[]) {
    return this.db
      .select({ recipient: serviceRequestRecipients, request: serviceRequests })
      .from(serviceRequestRecipients)
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceRequestRecipients.requestId))
      .where(
        and(
          eq(serviceRequestRecipients.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : eq(serviceRequestRecipients.branchId, access.branchScope),
          recipientIds ? inArray(serviceRequestRecipients.id, recipientIds) : undefined,
        ),
      )
      .orderBy(desc(serviceRequestRecipients.createdAt))
      .limit(PIPELINE_LIMIT);
  }

  async pipeline(access: TenantAccess, actor: User, query: PipelineQuery): Promise<PipelineDto> {
    assertProvider(access);
    const all = await this.items(access, await this.scopedRows(access));
    const stages = Object.fromEntries(PIPELINE_STAGES.map((s) => [s, 0])) as Record<
      PipelineStage,
      number
    >;
    for (const item of all) stages[item.stage] += 1;
    const assignee = query.assignee === "me" ? actor.id : query.assignee;
    const items = all.filter(
      (item) =>
        (query.stage === undefined || item.stage === query.stage) &&
        (query.priority === undefined || item.priority === query.priority) &&
        (assignee === undefined ||
          (assignee === "unassigned"
            ? item.assignee === null
            : item.assignee?.userId === assignee)),
    );
    return { stages, items };
  }

  private async item(access: TenantAccess, recipientId: string): Promise<PipelineItemDto> {
    const [item] = await this.items(access, await this.scopedRows(access, [recipientId]));
    if (!item) throw notFound();
    return item;
  }

  async inquiry(access: TenantAccess, recipientId: string): Promise<CrmInquiryDto> {
    assertProvider(access);
    await recipientInScope(this.db, access, recipientId);
    const notes = await this.db
      .select()
      .from(crmInquiryNotes)
      .where(eq(crmInquiryNotes.recipientId, recipientId))
      .orderBy(asc(crmInquiryNotes.createdAt));
    const names = await this.names(notes.map((n) => n.authorUserId));
    return {
      item: await this.item(access, recipientId),
      notes: notes.map((n): InquiryNoteDto => ({
        id: n.id,
        author: { userId: n.authorUserId, displayName: names.get(n.authorUserId) ?? null },
        body: n.body,
        createdAt: n.createdAt.toISOString(),
      })),
    };
  }

  /**
   * Assign or prioritise an inquiry. Managers assign anyone who can work at the inquiry's
   * branch. Staff can claim an unassigned inquiry, release their own, and set the priority of
   * inquiries assigned to them.
   */
  async updateInquiry(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    input: UpdateInquiry,
  ): Promise<CrmInquiryDto> {
    assertProvider(access);
    await this.db.transaction(async (tx) => {
      const recipient = await recipientInScope(tx, access, recipientId);
      const [current] = await tx
        .select()
        .from(crmInquiryStates)
        .where(eq(crmInquiryStates.recipientId, recipient.id))
        .for("update");
      const assignedNow = current?.assigneeUserId ?? null;
      const manager = canManage(access);
      if (input.assigneeUserId !== undefined && input.assigneeUserId !== assignedNow) {
        const target = input.assigneeUserId;
        if (!manager) {
          const claim = target === actor.id && assignedNow === null;
          const release = target === null && assignedNow === actor.id;
          if (!claim && !release) throw crmError(403, "not_allowed");
        }
        if (
          target !== null &&
          !(await eligibleMember(tx, recipient.organizationId, target, recipient.branchId))
        ) {
          throw crmError(400, "invalid_assignee");
        }
      }
      if (input.priority !== undefined && !manager) {
        const owner = (input.assigneeUserId ?? assignedNow) === actor.id;
        if (!owner) throw crmError(403, "not_allowed");
      }
      const values = {
        assigneeUserId: input.assigneeUserId === undefined ? assignedNow : input.assigneeUserId,
        priority: input.priority ?? current?.priority ?? "normal",
      };
      if (current) {
        await tx.update(crmInquiryStates).set(values).where(eq(crmInquiryStates.id, current.id));
      } else {
        await tx.insert(crmInquiryStates).values({
          organizationId: recipient.organizationId,
          recipientId: recipient.id,
          ...values,
        });
      }
      await this.audit(
        tx,
        access,
        actor,
        "inquiry_updated",
        "service_request_recipient",
        recipientId,
        {
          assigneeUserId: values.assigneeUserId,
          priority: values.priority,
        },
      );
    });
    return this.inquiry(access, recipientId);
  }

  async addNote(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    body: string,
  ): Promise<CrmInquiryDto> {
    assertProvider(access);
    const recipient = await recipientInScope(this.db, access, recipientId);
    await this.db.insert(crmInquiryNotes).values({
      organizationId: recipient.organizationId,
      recipientId: recipient.id,
      authorUserId: actor.id,
      body,
    });
    return this.inquiry(access, recipientId);
  }

  async removeNote(
    access: TenantAccess,
    actor: User,
    recipientId: string,
    noteId: string,
  ): Promise<void> {
    assertProvider(access);
    await recipientInScope(this.db, access, recipientId);
    const [note] = await this.db
      .select()
      .from(crmInquiryNotes)
      .where(and(eq(crmInquiryNotes.id, noteId), eq(crmInquiryNotes.recipientId, recipientId)));
    if (!note) throw notFound();
    if (note.authorUserId !== actor.id) throw crmError(403, "not_author");
    await this.db.delete(crmInquiryNotes).where(eq(crmInquiryNotes.id, note.id));
  }

  // --- Quotes ----------------------------------------------------------------------------------

  async quotes(access: TenantAccess, query: QuoteQuery): Promise<CrmQuoteDto[]> {
    assertProvider(access);
    const now = this.clock.now();
    const rows = await this.db
      .select({
        quote: serviceQuotes,
        branchId: serviceRequestRecipients.branchId,
        request: serviceRequests,
      })
      .from(serviceQuotes)
      .innerJoin(
        serviceRequestRecipients,
        eq(serviceRequestRecipients.id, serviceQuotes.recipientId),
      )
      .innerJoin(serviceRequests, eq(serviceRequests.id, serviceQuotes.requestId))
      .where(
        and(
          eq(serviceQuotes.organizationId, access.tenant.organizationId),
          access.branchScope === null
            ? undefined
            : eq(serviceRequestRecipients.branchId, access.branchScope),
        ),
      )
      .orderBy(desc(serviceQuotes.createdAt))
      .limit(PIPELINE_LIMIT);
    const names = await this.names(rows.map((r) => r.quote.createdBy));
    const soonMs = (query.expiringWithinDays ?? 3) * DAY_MS;
    return rows
      .map(({ quote, branchId, request }): CrmQuoteDto => {
        const status =
          quote.status === "active" && quote.validUntil <= now ? "expired" : quote.status;
        return {
          id: quote.id,
          recipientId: quote.recipientId,
          requestId: request.id,
          branchId,
          category: request.category as CrmQuoteDto["category"],
          summary: summaryOf(request.description),
          priceLabel: formatIndicativePrice(priceOf(quote)),
          status,
          validUntil: quote.validUntil.toISOString(),
          expiringSoon: status === "active" && quote.validUntil.getTime() - now.getTime() <= soonMs,
          createdBy: { userId: quote.createdBy, displayName: names.get(quote.createdBy) ?? null },
          createdAt: quote.createdAt.toISOString(),
        };
      })
      .filter(
        (q) =>
          (query.status === undefined || q.status === query.status) &&
          (query.expiringWithinDays === undefined || q.expiringSoon),
      );
  }

  // --- Tasks -----------------------------------------------------------------------------------

  private async taskDto(rows: CrmTask[]): Promise<CrmTaskDto[]> {
    const now = this.clock.now();
    const names = await this.names(rows.map((r) => r.assigneeUserId));
    return rows.map((t) => ({
      id: t.id,
      title: t.title,
      status: t.status,
      dueAt: t.dueAt?.toISOString() ?? null,
      overdue: t.status === "open" && t.dueAt !== null && t.dueAt <= now,
      branchId: t.branchId,
      recipientId: t.recipientId,
      appointmentId: t.appointmentId,
      assignee:
        t.assigneeUserId === null
          ? null
          : { userId: t.assigneeUserId, displayName: names.get(t.assigneeUserId) ?? null },
      createdBy: t.createdBy,
      completedAt: t.completedAt?.toISOString() ?? null,
      createdAt: t.createdAt.toISOString(),
    }));
  }

  /** Managers see tasks in their scope; staff see tasks assigned to or created by them. */
  private taskVisibility(access: TenantAccess, actor: User) {
    const mine = or(eq(crmTasks.assigneeUserId, actor.id), eq(crmTasks.createdBy, actor.id));
    if (!canManage(access)) return mine;
    if (access.branchScope === null) return undefined;
    return or(eq(crmTasks.branchId, access.branchScope), mine);
  }

  private async taskFor(executor: Executor, access: TenantAccess, actor: User, taskId: string) {
    const [task] = await executor
      .select()
      .from(crmTasks)
      .where(
        and(
          eq(crmTasks.id, taskId),
          eq(crmTasks.organizationId, access.tenant.organizationId),
          this.taskVisibility(access, actor),
        ),
      );
    if (!task) throw notFound();
    return task;
  }

  async tasks(access: TenantAccess, actor: User, query: TaskQuery): Promise<CrmTaskDto[]> {
    assertProvider(access);
    const assignee = query.assignee === "me" ? actor.id : query.assignee;
    const rows = await this.db
      .select()
      .from(crmTasks)
      .where(
        and(
          eq(crmTasks.organizationId, access.tenant.organizationId),
          this.taskVisibility(access, actor),
          query.status ? eq(crmTasks.status, query.status) : undefined,
          query.recipientId ? eq(crmTasks.recipientId, query.recipientId) : undefined,
          assignee === undefined
            ? undefined
            : assignee === "unassigned"
              ? isNull(crmTasks.assigneeUserId)
              : eq(crmTasks.assigneeUserId, assignee),
        ),
      )
      .orderBy(sql`${crmTasks.dueAt} ASC NULLS LAST`, desc(crmTasks.createdAt))
      .limit(PIPELINE_LIMIT);
    return this.taskDto(rows);
  }

  /** Staff may only give tasks to themselves; managers to anyone working at the branch. */
  private async assertAssignable(
    executor: Executor,
    access: TenantAccess,
    actor: User,
    assignee: string | null,
    branchId: string | null,
  ): Promise<void> {
    if (assignee === null || assignee === actor.id) return;
    if (!canManage(access)) throw crmError(403, "not_allowed");
    if (!(await eligibleMember(executor, access.tenant.organizationId, assignee, branchId))) {
      throw crmError(400, "invalid_assignee");
    }
  }

  async createTask(access: TenantAccess, actor: User, input: TaskInput): Promise<CrmTaskDto> {
    assertProvider(access);
    const id = await this.db.transaction(async (tx) => {
      let branchId: string | null = access.branchScope;
      if (input.recipientId !== null) {
        const recipient = await recipientInScope(tx, access, input.recipientId).catch(() => {
          throw crmError(400, "invalid_link");
        });
        branchId = recipient.branchId;
      }
      if (input.appointmentId !== null) {
        const [appointment] = await tx
          .select()
          .from(appointments)
          .where(
            and(
              eq(appointments.id, input.appointmentId),
              eq(appointments.organizationId, access.tenant.organizationId),
            ),
          );
        if (!appointment || !inScope(access, appointment.branchId)) {
          throw crmError(400, "invalid_link");
        }
        branchId = appointment.branchId;
      }
      const assignee = input.assigneeUserId === undefined ? actor.id : input.assigneeUserId;
      await this.assertAssignable(tx, access, actor, assignee, branchId);
      const [task] = await tx
        .insert(crmTasks)
        .values({
          organizationId: access.tenant.organizationId,
          branchId,
          recipientId: input.recipientId,
          appointmentId: input.appointmentId,
          title: input.title,
          dueAt: input.dueAt === null ? null : new Date(input.dueAt),
          assigneeUserId: assignee,
          createdBy: actor.id,
        })
        .returning();
      if (!task) throw new Error("task insert returned no row");
      return task.id;
    });
    const [dto] = await this.taskDto([await this.taskFor(this.db, access, actor, id)]);
    if (!dto) throw notFound();
    return dto;
  }

  async updateTask(
    access: TenantAccess,
    actor: User,
    taskId: string,
    input: TaskUpdate,
  ): Promise<CrmTaskDto> {
    assertProvider(access);
    const now = this.clock.now();
    await this.db.transaction(async (tx) => {
      const task = await this.taskFor(tx, access, actor, taskId);
      if (input.assigneeUserId !== undefined && input.assigneeUserId !== task.assigneeUserId) {
        await this.assertAssignable(tx, access, actor, input.assigneeUserId, task.branchId);
      }
      const done = input.done;
      await tx
        .update(crmTasks)
        .set({
          ...(input.title === undefined ? {} : { title: input.title }),
          ...(input.dueAt === undefined
            ? {}
            : { dueAt: input.dueAt === null ? null : new Date(input.dueAt) }),
          ...(input.assigneeUserId === undefined ? {} : { assigneeUserId: input.assigneeUserId }),
          ...(done === undefined
            ? {}
            : done
              ? { status: "done" as const, completedAt: now, completedBy: actor.id }
              : { status: "open" as const, completedAt: null, completedBy: null }),
        })
        .where(eq(crmTasks.id, task.id));
    });
    const [dto] = await this.taskDto([await this.taskFor(this.db, access, actor, taskId)]);
    if (!dto) throw notFound();
    return dto;
  }

  async removeTask(access: TenantAccess, actor: User, taskId: string): Promise<void> {
    assertProvider(access);
    const task = await this.taskFor(this.db, access, actor, taskId);
    if (!canManage(access) && task.createdBy !== actor.id) throw crmError(403, "not_allowed");
    await this.db.delete(crmTasks).where(eq(crmTasks.id, task.id));
  }
}

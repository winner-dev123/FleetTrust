import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  smallint,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { id, timestamps } from "./columns.js";
import { branches, organizations } from "./organizations.js";
import { serviceRequestRecipients } from "./requests.js";
import { users } from "./users.js";

export const INQUIRY_PRIORITY_VALUES = ["low", "normal", "high"] as const;
export const APPOINTMENT_STATUS_VALUES = ["booked", "completed", "cancelled", "no_show"] as const;

const list = (values: readonly string[]) => sql.raw(values.map((v) => `'${v}'`).join(", "));

/**
 * Provider-side CRM state of an inquiry (F-130, ADR-0027): who works on it and how urgent it is.
 * The pipeline stage is derived from the inquiry and request status, never stored. Created on
 * first change.
 */
export const crmInquiryStates = pgTable(
  "crm_inquiry_states",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    priority: text("priority", { enum: INQUIRY_PRIORITY_VALUES }).notNull().default("normal"),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "crm_inquiry_states_recipient_fk",
      columns: [t.recipientId, t.organizationId],
      foreignColumns: [serviceRequestRecipients.id, serviceRequestRecipients.organizationId],
    }).onDelete("cascade"),
    uniqueIndex("crm_inquiry_states_recipient_key").on(t.recipientId),
    index("crm_inquiry_states_org_idx").on(t.organizationId, t.assigneeUserId),
    check(
      "crm_inquiry_states_priority_valid",
      sql`${t.priority} IN (${list(INQUIRY_PRIORITY_VALUES)})`,
    ),
  ],
);

/** Internal notes on an inquiry. Never shown to the customer. Only the author may delete one. */
export const crmInquiryNotes = pgTable(
  "crm_inquiry_notes",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    recipientId: uuid("recipient_id").notNull(),
    authorUserId: uuid("author_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    foreignKey({
      name: "crm_inquiry_notes_recipient_fk",
      columns: [t.recipientId, t.organizationId],
      foreignColumns: [serviceRequestRecipients.id, serviceRequestRecipients.organizationId],
    }).onDelete("cascade"),
    index("crm_inquiry_notes_org_idx").on(t.organizationId, t.recipientId, t.createdAt),
    check("crm_inquiry_notes_body_length", sql`char_length(${t.body}) BETWEEN 1 AND 2000`),
  ],
);

/**
 * Appointments (F-131). Times are UTC instants; the API converts from and to the branch's local
 * time. Migration 0032 adds an exclusion constraint so one staff member can never hold two
 * overlapping booked appointments, even under concurrent bookings.
 */
export const appointments = pgTable(
  "appointments",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    staffUserId: uuid("staff_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    /** The inquiry it belongs to (accepted quote). The customer sees the appointment. */
    recipientId: uuid("recipient_id").references(() => serviceRequestRecipients.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    customerName: text("customer_name"),
    notes: text("notes"),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    status: text("status", { enum: APPOINTMENT_STATUS_VALUES }).notNull().default("booked"),
    cancelReason: text("cancel_reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "appointments_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("restrict"),
    index("appointments_org_idx").on(t.organizationId, t.startsAt),
    index("appointments_staff_idx").on(t.staffUserId, t.startsAt),
    index("appointments_branch_idx").on(t.branchId, t.startsAt),
    index("appointments_recipient_idx").on(t.recipientId),
    check("appointments_status_valid", sql`${t.status} IN (${list(APPOINTMENT_STATUS_VALUES)})`),
    check("appointments_time_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "appointments_cancel_reason",
      sql`(${t.status} = 'cancelled') = (${t.cancelReason} IS NOT NULL)`,
    ),
    check("appointments_title_length", sql`char_length(${t.title}) BETWEEN 2 AND 120`),
    check("appointments_notes_length", sql`${t.notes} IS NULL OR char_length(${t.notes}) <= 2000`),
  ],
);

/** Internal follow-ups, optionally linked to an inquiry or an appointment. */
export const crmTasks = pgTable(
  "crm_tasks",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    /** Branch it belongs to (from the linked inquiry or appointment, or the creator's scope). */
    branchId: uuid("branch_id").references(() => branches.id, { onDelete: "set null" }),
    recipientId: uuid("recipient_id"),
    appointmentId: uuid("appointment_id").references(() => appointments.id, {
      onDelete: "set null",
    }),
    title: text("title").notNull(),
    dueAt: timestamp("due_at", { withTimezone: true, mode: "date" }),
    assigneeUserId: uuid("assignee_user_id").references(() => users.id, { onDelete: "set null" }),
    status: text("status", { enum: ["open", "done"] })
      .notNull()
      .default("open"),
    completedAt: timestamp("completed_at", { withTimezone: true, mode: "date" }),
    completedBy: uuid("completed_by").references(() => users.id, { onDelete: "set null" }),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "crm_tasks_recipient_fk",
      columns: [t.recipientId, t.organizationId],
      foreignColumns: [serviceRequestRecipients.id, serviceRequestRecipients.organizationId],
    }).onDelete("cascade"),
    index("crm_tasks_org_idx").on(t.organizationId, t.status, t.dueAt),
    index("crm_tasks_assignee_idx").on(t.assigneeUserId, t.status),
    index("crm_tasks_recipient_idx").on(t.recipientId),
    index("crm_tasks_appointment_idx").on(t.appointmentId),
    check("crm_tasks_status_valid", sql`${t.status} IN ('open', 'done')`),
    check(
      "crm_tasks_done_consistent",
      sql`(${t.status} = 'done') = (${t.completedAt} IS NOT NULL)`,
    ),
    check("crm_tasks_title_length", sql`char_length(${t.title}) BETWEEN 2 AND 200`),
  ],
);

/**
 * Weekly working hours of a staff member at a branch (local minutes like opening hours;
 * `closes_minute` above 1440 runs past midnight). No rows = the branch's opening hours apply.
 */
export const staffAvailability = pgTable(
  "staff_availability",
  {
    id: id(),
    organizationId: uuid("organization_id").notNull(),
    branchId: uuid("branch_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    /** ISO weekday: 1 = Monday … 7 = Sunday. */
    weekday: smallint("weekday").notNull(),
    opensMinute: smallint("opens_minute").notNull(),
    closesMinute: smallint("closes_minute").notNull(),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      name: "staff_availability_branch_fk",
      columns: [t.branchId, t.organizationId],
      foreignColumns: [branches.id, branches.organizationId],
    }).onDelete("cascade"),
    index("staff_availability_org_idx").on(t.organizationId, t.userId, t.branchId),
    check("staff_availability_weekday_range", sql`${t.weekday} BETWEEN 1 AND 7`),
    check("staff_availability_opens_range", sql`${t.opensMinute} BETWEEN 0 AND 1439`),
    check(
      "staff_availability_closes_range",
      sql`${t.closesMinute} > ${t.opensMinute} AND ${t.closesMinute} - ${t.opensMinute} <= 1440`,
    ),
  ],
);

/** Absences (UTC instants). No appointments can be booked inside them. */
export const staffTimeOff = pgTable(
  "staff_time_off",
  {
    id: id(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    startsAt: timestamp("starts_at", { withTimezone: true, mode: "date" }).notNull(),
    endsAt: timestamp("ends_at", { withTimezone: true, mode: "date" }).notNull(),
    reason: text("reason"),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => users.id, { onDelete: "restrict" }),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" }).notNull().defaultNow(),
  },
  (t) => [
    index("staff_time_off_org_idx").on(t.organizationId, t.userId, t.startsAt),
    check("staff_time_off_order", sql`${t.endsAt} > ${t.startsAt}`),
    check(
      "staff_time_off_reason_length",
      sql`${t.reason} IS NULL OR char_length(${t.reason}) <= 200`,
    ),
  ],
);

export type CrmInquiryState = typeof crmInquiryStates.$inferSelect;
export type CrmInquiryNote = typeof crmInquiryNotes.$inferSelect;
export type Appointment = typeof appointments.$inferSelect;
export type CrmTask = typeof crmTasks.$inferSelect;
export type StaffAvailability = typeof staffAvailability.$inferSelect;
export type StaffTimeOff = typeof staffTimeOff.$inferSelect;

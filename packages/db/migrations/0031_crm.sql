CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"staff_user_id" uuid NOT NULL,
	"recipient_id" uuid,
	"title" text NOT NULL,
	"customer_name" text,
	"notes" text,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'booked' NOT NULL,
	"cancel_reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "appointments_status_valid" CHECK ("appointments"."status" IN ('booked', 'completed', 'cancelled', 'no_show')),
	CONSTRAINT "appointments_time_order" CHECK ("appointments"."ends_at" > "appointments"."starts_at"),
	CONSTRAINT "appointments_cancel_reason" CHECK (("appointments"."status" = 'cancelled') = ("appointments"."cancel_reason" IS NOT NULL)),
	CONSTRAINT "appointments_title_length" CHECK (char_length("appointments"."title") BETWEEN 2 AND 120),
	CONSTRAINT "appointments_notes_length" CHECK ("appointments"."notes" IS NULL OR char_length("appointments"."notes") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "crm_inquiry_notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_inquiry_notes_body_length" CHECK (char_length("crm_inquiry_notes"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "crm_inquiry_states" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"assignee_user_id" uuid,
	"priority" text DEFAULT 'normal' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_inquiry_states_priority_valid" CHECK ("crm_inquiry_states"."priority" IN ('low', 'normal', 'high'))
);
--> statement-breakpoint
CREATE TABLE "crm_tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"recipient_id" uuid,
	"appointment_id" uuid,
	"title" text NOT NULL,
	"due_at" timestamp with time zone,
	"assignee_user_id" uuid,
	"status" text DEFAULT 'open' NOT NULL,
	"completed_at" timestamp with time zone,
	"completed_by" uuid,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "crm_tasks_status_valid" CHECK ("crm_tasks"."status" IN ('open', 'done')),
	CONSTRAINT "crm_tasks_done_consistent" CHECK (("crm_tasks"."status" = 'done') = ("crm_tasks"."completed_at" IS NOT NULL)),
	CONSTRAINT "crm_tasks_title_length" CHECK (char_length("crm_tasks"."title") BETWEEN 2 AND 200)
);
--> statement-breakpoint
CREATE TABLE "staff_availability" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_minute" smallint NOT NULL,
	"closes_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_availability_weekday_range" CHECK ("staff_availability"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "staff_availability_opens_range" CHECK ("staff_availability"."opens_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "staff_availability_closes_range" CHECK ("staff_availability"."closes_minute" > "staff_availability"."opens_minute" AND "staff_availability"."closes_minute" - "staff_availability"."opens_minute" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "staff_time_off" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone NOT NULL,
	"reason" text,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "staff_time_off_order" CHECK ("staff_time_off"."ends_at" > "staff_time_off"."starts_at"),
	CONSTRAINT "staff_time_off_reason_length" CHECK ("staff_time_off"."reason" IS NULL OR char_length("staff_time_off"."reason") <= 200)
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_staff_user_id_users_id_fk" FOREIGN KEY ("staff_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_recipient_id_service_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."service_request_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_inquiry_notes" ADD CONSTRAINT "crm_inquiry_notes_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_inquiry_notes" ADD CONSTRAINT "crm_inquiry_notes_recipient_fk" FOREIGN KEY ("recipient_id","organization_id") REFERENCES "public"."service_request_recipients"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_inquiry_states" ADD CONSTRAINT "crm_inquiry_states_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_inquiry_states" ADD CONSTRAINT "crm_inquiry_states_recipient_fk" FOREIGN KEY ("recipient_id","organization_id") REFERENCES "public"."service_request_recipients"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_assignee_user_id_users_id_fk" FOREIGN KEY ("assignee_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_completed_by_users_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "crm_tasks" ADD CONSTRAINT "crm_tasks_recipient_fk" FOREIGN KEY ("recipient_id","organization_id") REFERENCES "public"."service_request_recipients"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_availability" ADD CONSTRAINT "staff_availability_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "staff_time_off" ADD CONSTRAINT "staff_time_off_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_org_idx" ON "appointments" USING btree ("organization_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_staff_idx" ON "appointments" USING btree ("staff_user_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_branch_idx" ON "appointments" USING btree ("branch_id","starts_at");--> statement-breakpoint
CREATE INDEX "appointments_recipient_idx" ON "appointments" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "crm_inquiry_notes_org_idx" ON "crm_inquiry_notes" USING btree ("organization_id","recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "crm_inquiry_states_recipient_key" ON "crm_inquiry_states" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "crm_inquiry_states_org_idx" ON "crm_inquiry_states" USING btree ("organization_id","assignee_user_id");--> statement-breakpoint
CREATE INDEX "crm_tasks_org_idx" ON "crm_tasks" USING btree ("organization_id","status","due_at");--> statement-breakpoint
CREATE INDEX "crm_tasks_assignee_idx" ON "crm_tasks" USING btree ("assignee_user_id","status");--> statement-breakpoint
CREATE INDEX "crm_tasks_recipient_idx" ON "crm_tasks" USING btree ("recipient_id");--> statement-breakpoint
CREATE INDEX "crm_tasks_appointment_idx" ON "crm_tasks" USING btree ("appointment_id");--> statement-breakpoint
CREATE INDEX "staff_availability_org_idx" ON "staff_availability" USING btree ("organization_id","user_id","branch_id");--> statement-breakpoint
CREATE INDEX "staff_time_off_org_idx" ON "staff_time_off" USING btree ("organization_id","user_id","starts_at");
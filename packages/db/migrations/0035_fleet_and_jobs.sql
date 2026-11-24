-- vehicles(id, organization_id) must be unique before the composite FKs below reference it.
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_id_organization_key" UNIQUE("id","organization_id");--> statement-breakpoint
CREATE TABLE "fleet_expenses" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_kind" text DEFAULT 'fleet' NOT NULL,
	"vehicle_id" uuid,
	"branch_id" uuid,
	"category" text NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" char(3) NOT NULL,
	"spent_on" date NOT NULL,
	"vendor" text,
	"description" text,
	"odometer_km" integer,
	"litres" numeric(7, 2),
	"entered_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_expenses_category_valid" CHECK ("fleet_expenses"."category" IN ('fuel', 'maintenance', 'tyres', 'parts', 'tolls', 'parking', 'insurance', 'licensing', 'fines', 'cleaning', 'other')),
	CONSTRAINT "fleet_expenses_amount_positive" CHECK ("fleet_expenses"."amount" > 0),
	CONSTRAINT "fleet_expenses_litres_fuel" CHECK ("fleet_expenses"."litres" IS NULL OR ("fleet_expenses"."category" = 'fuel' AND "fleet_expenses"."litres" > 0)),
	CONSTRAINT "fleet_expenses_text_length" CHECK (("fleet_expenses"."vendor" IS NULL OR char_length("fleet_expenses"."vendor") <= 120)
       AND ("fleet_expenses"."description" IS NULL OR char_length("fleet_expenses"."description") <= 500)),
	CONSTRAINT "fleet_expenses_odometer" CHECK ("fleet_expenses"."odometer_km" IS NULL OR "fleet_expenses"."odometer_km" >= 0)
);
--> statement-breakpoint
CREATE TABLE "fleet_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_kind" text DEFAULT 'fleet' NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"branch_id" uuid,
	"kind" text NOT NULL,
	"severity" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"location" text,
	"description" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution_note" text,
	"resolved_at" timestamp with time zone,
	"resolved_by" uuid,
	"reported_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_incidents_kind_valid" CHECK ("fleet_incidents"."kind" IN ('breakdown', 'accident', 'damage', 'theft', 'traffic_fine', 'other')),
	CONSTRAINT "fleet_incidents_severity_valid" CHECK ("fleet_incidents"."severity" IN ('low', 'medium', 'high')),
	CONSTRAINT "fleet_incidents_status_valid" CHECK ("fleet_incidents"."status" IN ('open', 'resolved')),
	CONSTRAINT "fleet_incidents_resolved_consistent" CHECK (("fleet_incidents"."status" = 'resolved') = ("fleet_incidents"."resolved_at" IS NOT NULL)),
	CONSTRAINT "fleet_incidents_text_length" CHECK (char_length("fleet_incidents"."description") BETWEEN 5 AND 2000
       AND ("fleet_incidents"."location" IS NULL OR char_length("fleet_incidents"."location") <= 200)
       AND ("fleet_incidents"."resolution_note" IS NULL OR char_length("fleet_incidents"."resolution_note") <= 1000))
);
--> statement-breakpoint
CREATE TABLE "fleet_preferred_providers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_kind" text DEFAULT 'fleet' NOT NULL,
	"provider_organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"note" text,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fleet_preferred_providers_key" UNIQUE NULLS NOT DISTINCT("organization_id","provider_organization_id","branch_id"),
	CONSTRAINT "fleet_preferred_providers_note_length" CHECK ("fleet_preferred_providers"."note" IS NULL OR char_length("fleet_preferred_providers"."note") <= 500),
	CONSTRAINT "fleet_preferred_providers_categories" CHECK (cardinality("fleet_preferred_providers"."categories") <= 7)
);
--> statement-breakpoint
CREATE TABLE "job_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"message" text NOT NULL,
	"phone" text,
	"email" text,
	"status" text DEFAULT 'submitted' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "job_applications_status_valid" CHECK ("job_applications"."status" IN ('submitted', 'shortlisted', 'rejected', 'hired', 'withdrawn')),
	CONSTRAINT "job_applications_contact" CHECK (("job_applications"."phone" IS NOT NULL OR "job_applications"."email" IS NOT NULL)
       AND char_length("job_applications"."message") BETWEEN 20 AND 3000)
);
--> statement-breakpoint
CREATE TABLE "jobs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"organization_kind" text DEFAULT 'fleet' NOT NULL,
	"branch_id" uuid,
	"created_by" uuid NOT NULL,
	"title" text NOT NULL,
	"description" text NOT NULL,
	"role" text NOT NULL,
	"employment_type" text NOT NULL,
	"licence_classes" text[] DEFAULT '{}'::text[] NOT NULL,
	"locality" text NOT NULL,
	"country_code" char(2) NOT NULL,
	"salary_currency" char(3),
	"salary_min" numeric(12, 2),
	"salary_max" numeric(12, 2),
	"salary_period" text,
	"closes_on" date NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"moderation_note" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jobs_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "jobs_status_valid" CHECK ("jobs"."status" IN ('draft', 'pending_moderation', 'published', 'rejected', 'hidden', 'closed')),
	CONSTRAINT "jobs_role_valid" CHECK ("jobs"."role" IN ('driver', 'mechanic', 'dispatcher', 'fleet_manager', 'other')),
	CONSTRAINT "jobs_employment_type_valid" CHECK ("jobs"."employment_type" IN ('full_time', 'part_time', 'contract', 'temporary')),
	CONSTRAINT "jobs_text_length" CHECK (char_length("jobs"."title") BETWEEN 5 AND 120 AND char_length("jobs"."description") BETWEEN 50 AND 5000
       AND char_length("jobs"."locality") BETWEEN 2 AND 80),
	CONSTRAINT "jobs_licence_classes" CHECK (cardinality("jobs"."licence_classes") <= 10),
	CONSTRAINT "jobs_salary_shape" CHECK (("jobs"."salary_currency" IS NULL AND "jobs"."salary_min" IS NULL AND "jobs"."salary_max" IS NULL AND "jobs"."salary_period" IS NULL)
       OR ("jobs"."salary_currency" IS NOT NULL AND "jobs"."salary_min" > 0 AND "jobs"."salary_period" IN ('hour', 'day', 'week', 'month', 'year')
           AND ("jobs"."salary_max" IS NULL OR "jobs"."salary_max" >= "jobs"."salary_min"))),
	CONSTRAINT "jobs_published_consistent" CHECK ("jobs"."status" NOT IN ('published', 'closed') OR "jobs"."published_at" IS NOT NULL)
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_valid";--> statement-breakpoint
ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_target_valid";--> statement-breakpoint
ALTER TABLE "fleet_expenses" ADD CONSTRAINT "fleet_expenses_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_expenses" ADD CONSTRAINT "fleet_expenses_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_expenses" ADD CONSTRAINT "fleet_expenses_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_expenses" ADD CONSTRAINT "fleet_expenses_org_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_expenses" ADD CONSTRAINT "fleet_expenses_vehicle_fk" FOREIGN KEY ("vehicle_id","organization_id") REFERENCES "public"."vehicles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_reported_by_users_id_fk" FOREIGN KEY ("reported_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_org_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_incidents" ADD CONSTRAINT "fleet_incidents_vehicle_fk" FOREIGN KEY ("vehicle_id","organization_id") REFERENCES "public"."vehicles"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_preferred_providers" ADD CONSTRAINT "fleet_preferred_providers_provider_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("provider_organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_preferred_providers" ADD CONSTRAINT "fleet_preferred_providers_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_preferred_providers" ADD CONSTRAINT "fleet_preferred_providers_org_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fleet_preferred_providers" ADD CONSTRAINT "fleet_preferred_providers_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_applications" ADD CONSTRAINT "job_applications_job_fk" FOREIGN KEY ("job_id","organization_id") REFERENCES "public"."jobs"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_salary_currency_currencies_code_fk" FOREIGN KEY ("salary_currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_org_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "fleet_expenses_org_idx" ON "fleet_expenses" USING btree ("organization_id","spent_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fleet_expenses_vehicle_idx" ON "fleet_expenses" USING btree ("vehicle_id","spent_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fleet_incidents_org_idx" ON "fleet_incidents" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fleet_incidents_vehicle_idx" ON "fleet_incidents" USING btree ("vehicle_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "fleet_incidents_reporter_idx" ON "fleet_incidents" USING btree ("reported_by");--> statement-breakpoint
CREATE INDEX "fleet_preferred_providers_provider_idx" ON "fleet_preferred_providers" USING btree ("provider_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "job_applications_one_per_person" ON "job_applications" USING btree ("job_id","applicant_user_id");--> statement-breakpoint
CREATE INDEX "job_applications_org_idx" ON "job_applications" USING btree ("organization_id","job_id");--> statement-breakpoint
CREATE INDEX "job_applications_applicant_idx" ON "job_applications" USING btree ("applicant_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_org_idx" ON "jobs" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "jobs_public_idx" ON "jobs" USING btree ("published_at" DESC NULLS LAST) WHERE "jobs"."status" = 'published';--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_valid" CHECK ("content_reports"."target_type" IN ('article', 'article_comment', 'group', 'user', 'message', 'job'));--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_valid" CHECK ("moderation_actions"."target_type" IN ('article', 'article_comment', 'group', 'user', 'message', 'job'));
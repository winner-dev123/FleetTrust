CREATE TABLE "plan_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"plan_version_id" uuid NOT NULL,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"grace_days" smallint DEFAULT 14 NOT NULL,
	"external_reference" text NOT NULL,
	"invoice_number" text,
	"note" text,
	"assigned_by" uuid NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_assignments_subject" CHECK (("plan_assignments"."subject_type" = 'user' AND "plan_assignments"."user_id" IS NOT NULL AND "plan_assignments"."organization_id" IS NULL) OR
      ("plan_assignments"."subject_type" = 'organization' AND "plan_assignments"."organization_id" IS NOT NULL AND "plan_assignments"."user_id" IS NULL)),
	CONSTRAINT "plan_assignments_grace_range" CHECK ("plan_assignments"."grace_days" BETWEEN 0 AND 90),
	CONSTRAINT "plan_assignments_term" CHECK ("plan_assignments"."ends_at" IS NULL OR "plan_assignments"."ends_at" > "plan_assignments"."starts_at"),
	CONSTRAINT "plan_assignments_reference_length" CHECK (char_length("plan_assignments"."external_reference") BETWEEN 1 AND 200),
	CONSTRAINT "plan_assignments_ended_consistent" CHECK (("plan_assignments"."ended_at" IS NULL) = ("plan_assignments"."ended_by" IS NULL) AND ("plan_assignments"."ended_at" IS NULL) = ("plan_assignments"."end_reason" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "plan_version_limits" (
	"plan_version_id" uuid NOT NULL,
	"key" text NOT NULL,
	"limit_value" integer,
	CONSTRAINT "plan_version_limits_pkey" PRIMARY KEY("plan_version_id","key"),
	CONSTRAINT "plan_version_limits_key_format" CHECK ("plan_version_limits"."key" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "plan_version_limits_non_negative" CHECK ("plan_version_limits"."limit_value" IS NULL OR "plan_version_limits"."limit_value" >= 0)
);
--> statement-breakpoint
CREATE TABLE "plan_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"plan_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"price_minor" bigint,
	"currency" char(3),
	"billing_period" text,
	"published_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plan_versions_plan_version_key" UNIQUE("plan_id","version"),
	CONSTRAINT "plan_versions_version_positive" CHECK ("plan_versions"."version" > 0),
	CONSTRAINT "plan_versions_status_valid" CHECK ("plan_versions"."status" IN ('draft', 'published', 'retired')),
	CONSTRAINT "plan_versions_price_complete" CHECK (("plan_versions"."price_minor" IS NULL) = ("plan_versions"."currency" IS NULL) AND ("plan_versions"."price_minor" IS NULL) = ("plan_versions"."billing_period" IS NULL)),
	CONSTRAINT "plan_versions_price_non_negative" CHECK ("plan_versions"."price_minor" IS NULL OR "plan_versions"."price_minor" >= 0),
	CONSTRAINT "plan_versions_published_at" CHECK (("plan_versions"."status" = 'draft') = ("plan_versions"."published_at" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "plans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"audience" text NOT NULL,
	"name" text NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "plans_audience_valid" CHECK ("plans"."audience" IN ('user', 'provider', 'fleet')),
	CONSTRAINT "plans_code_format" CHECK ("plans"."code" ~ '^[a-z][a-z0-9-]{1,40}$')
);
--> statement-breakpoint
CREATE TABLE "platform_staff" (
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "platform_staff_pkey" PRIMARY KEY("user_id","role"),
	CONSTRAINT "platform_staff_role_valid" CHECK ("platform_staff"."role" IN ('billing_operator'))
);
--> statement-breakpoint
CREATE TABLE "quota_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"key" text NOT NULL,
	"period_start" date NOT NULL,
	"idempotency_key" text NOT NULL,
	"amount" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_consumptions_amount_positive" CHECK ("quota_consumptions"."amount" > 0),
	CONSTRAINT "quota_consumptions_idempotency_key_length" CHECK (char_length("quota_consumptions"."idempotency_key") BETWEEN 1 AND 200)
);
--> statement-breakpoint
CREATE TABLE "quota_counters" (
	"subject_type" text NOT NULL,
	"subject_id" uuid NOT NULL,
	"key" text NOT NULL,
	"period_start" date NOT NULL,
	"used" integer NOT NULL,
	CONSTRAINT "quota_counters_pkey" PRIMARY KEY("subject_type","subject_id","key","period_start"),
	CONSTRAINT "quota_counters_used_non_negative" CHECK ("quota_counters"."used" >= 0)
);
--> statement-breakpoint
CREATE TABLE "quota_overrides" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"key" text NOT NULL,
	"limit_value" integer,
	"reason" text NOT NULL,
	"expires_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "quota_overrides_subject" CHECK (("quota_overrides"."subject_type" = 'user' AND "quota_overrides"."user_id" IS NOT NULL AND "quota_overrides"."organization_id" IS NULL) OR
      ("quota_overrides"."subject_type" = 'organization' AND "quota_overrides"."organization_id" IS NOT NULL AND "quota_overrides"."user_id" IS NULL)),
	CONSTRAINT "quota_overrides_key_format" CHECK ("quota_overrides"."key" ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
	CONSTRAINT "quota_overrides_non_negative" CHECK ("quota_overrides"."limit_value" IS NULL OR "quota_overrides"."limit_value" >= 0),
	CONSTRAINT "quota_overrides_reason_length" CHECK (char_length("quota_overrides"."reason") BETWEEN 3 AND 500),
	CONSTRAINT "quota_overrides_revoked_consistent" CHECK (("quota_overrides"."revoked_at" IS NULL) = ("quota_overrides"."revoked_by" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "organizations" ADD COLUMN "timezone" text DEFAULT 'UTC' NOT NULL;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_assignments" ADD CONSTRAINT "plan_assignments_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_version_limits" ADD CONSTRAINT "plan_version_limits_plan_version_id_plan_versions_id_fk" FOREIGN KEY ("plan_version_id") REFERENCES "public"."plan_versions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_plan_id_plans_id_fk" FOREIGN KEY ("plan_id") REFERENCES "public"."plans"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "plan_versions" ADD CONSTRAINT "plan_versions_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_overrides" ADD CONSTRAINT "quota_overrides_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_overrides" ADD CONSTRAINT "quota_overrides_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_overrides" ADD CONSTRAINT "quota_overrides_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "quota_overrides" ADD CONSTRAINT "quota_overrides_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "plan_assignments_org_idx" ON "plan_assignments" USING btree ("organization_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "plan_assignments_user_idx" ON "plan_assignments" USING btree ("user_id","starts_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "plans_code_key" ON "plans" USING btree ("code");--> statement-breakpoint
CREATE UNIQUE INDEX "plans_one_default_per_audience" ON "plans" USING btree ("audience") WHERE "plans"."is_default";--> statement-breakpoint
CREATE UNIQUE INDEX "quota_consumptions_idempotency_key" ON "quota_consumptions" USING btree ("subject_type","subject_id","key","idempotency_key");--> statement-breakpoint
CREATE INDEX "quota_overrides_org_idx" ON "quota_overrides" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "quota_overrides_user_idx" ON "quota_overrides" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "quota_overrides_open_key" ON "quota_overrides" USING btree (COALESCE("organization_id", "user_id"),"key") WHERE "quota_overrides"."revoked_at" IS NULL;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_timezone_length" CHECK (char_length("users"."timezone") BETWEEN 1 AND 64);--> statement-breakpoint
ALTER TABLE "organizations" ADD CONSTRAINT "organizations_timezone_length" CHECK (char_length("organizations"."timezone") BETWEEN 1 AND 64);
CREATE TABLE "feature_settings" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "feature_settings_key_format" CHECK ("feature_settings"."key" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$')
);
--> statement-breakpoint
CREATE TABLE "service_category_settings" (
	"category" text PRIMARY KEY NOT NULL,
	"description" text,
	"sort_order" integer NOT NULL,
	"accepting_new_offerings" boolean DEFAULT true NOT NULL,
	"updated_by" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_category_settings_category_valid" CHECK ("service_category_settings"."category" IN ('workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic')),
	CONSTRAINT "service_category_settings_description_length" CHECK (char_length("service_category_settings"."description") <= 500),
	CONSTRAINT "service_category_settings_sort_order_range" CHECK ("service_category_settings"."sort_order" BETWEEN 0 AND 1000)
);
--> statement-breakpoint
CREATE TABLE "support_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"resolution" text,
	"opened_by" uuid NOT NULL,
	"opened_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_by" uuid,
	"closed_at" timestamp with time zone,
	CONSTRAINT "support_cases_status_valid" CHECK ("support_cases"."status" IN ('open', 'closed')),
	CONSTRAINT "support_cases_reason_length" CHECK (char_length("support_cases"."reason") BETWEEN 5 AND 1000),
	CONSTRAINT "support_cases_closed_consistent" CHECK (("support_cases"."status" = 'open' AND "support_cases"."closed_at" IS NULL AND "support_cases"."closed_by" IS NULL AND "support_cases"."resolution" IS NULL)
        OR ("support_cases"."status" = 'closed' AND "support_cases"."closed_at" IS NOT NULL AND "support_cases"."closed_by" IS NOT NULL AND "support_cases"."resolution" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_staff" DROP CONSTRAINT "platform_staff_role_valid";--> statement-breakpoint
ALTER TABLE "feature_settings" ADD CONSTRAINT "feature_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_category_settings" ADD CONSTRAINT "service_category_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "support_cases" ADD CONSTRAINT "support_cases_closed_by_users_id_fk" FOREIGN KEY ("closed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "support_cases_user_idx" ON "support_cases" USING btree ("user_id","opened_at");--> statement-breakpoint
CREATE INDEX "support_cases_open_idx" ON "support_cases" USING btree ("status","opened_at");--> statement-breakpoint
CREATE INDEX "audit_events_time_idx" ON "audit_events" USING btree ("occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_action_time_idx" ON "audit_events" USING btree ("action" text_pattern_ops,"occurred_at" DESC NULLS LAST);--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_role_valid" CHECK ("platform_staff"."role" IN ('super_admin', 'verification_reviewer', 'billing_operator', 'trust_safety_moderator', 'support_agent'));
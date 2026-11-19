CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_type" text NOT NULL,
	"actor_id" uuid,
	"organization_id" uuid,
	"action" text NOT NULL,
	"target_type" text NOT NULL,
	"target_id" text,
	"request_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "audit_events_actor_type_valid" CHECK ("audit_events"."actor_type" IN ('user', 'admin', 'system')),
	CONSTRAINT "audit_events_action_format" CHECK ("audit_events"."action" ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
	CONSTRAINT "audit_events_actor_present" CHECK ("audit_events"."actor_type" = 'system' OR "audit_events"."actor_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "currencies" (
	"code" char(3) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"display_decimals" smallint NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "currencies_code_format" CHECK ("currencies"."code" ~ '^[A-Z]{3}$'),
	CONSTRAINT "currencies_display_decimals_range" CHECK ("currencies"."display_decimals" BETWEEN 0 AND 4)
);
--> statement-breakpoint
CREATE TABLE "outbox_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"aggregate_type" text NOT NULL,
	"aggregate_id" text NOT NULL,
	"event_type" text NOT NULL,
	"payload" jsonb NOT NULL,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	"available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	CONSTRAINT "outbox_events_event_type_format" CHECK ("outbox_events"."event_type" ~ '^[A-Z][A-Za-z0-9]+$'),
	CONSTRAINT "outbox_events_attempts_non_negative" CHECK ("outbox_events"."attempts" >= 0)
);
--> statement-breakpoint
CREATE INDEX "audit_events_org_time_idx" ON "audit_events" USING btree ("organization_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_actor_time_idx" ON "audit_events" USING btree ("actor_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_events_target_idx" ON "audit_events" USING btree ("target_type","target_id");--> statement-breakpoint
CREATE INDEX "outbox_events_unpublished_idx" ON "outbox_events" USING btree ("available_at") WHERE "outbox_events"."published_at" IS NULL;--> statement-breakpoint
CREATE INDEX "outbox_events_aggregate_idx" ON "outbox_events" USING btree ("aggregate_type","aggregate_id","occurred_at");
CREATE TABLE "emergency_guidance" (
	"country_code" char(2) PRIMARY KEY NOT NULL,
	"emergency_number" text NOT NULL,
	"label" text NOT NULL,
	"guidance" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_guidance_country_format" CHECK ("emergency_guidance"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "emergency_guidance_number_format" CHECK ("emergency_guidance"."emergency_number" ~ '^[0-9+ ]{2,20}$')
);
--> statement-breakpoint
CREATE TABLE "emergency_incidents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"client_incident_id" uuid NOT NULL,
	"category" text NOT NULL,
	"note" text,
	"status" text DEFAULT 'active' NOT NULL,
	"location_shared" boolean DEFAULT false NOT NULL,
	"location" geography(Point, 4326),
	"location_accuracy_m" integer,
	"location_updated_at" timestamp with time zone,
	"country_code" char(2),
	"notify_providers" boolean DEFAULT false NOT NULL,
	"flagged" boolean DEFAULT false NOT NULL,
	"wave" smallint DEFAULT 1 NOT NULL,
	"next_escalation_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "emergency_incidents_status_valid" CHECK ("emergency_incidents"."status" IN ('active', 'resolved', 'cancelled', 'expired')),
	CONSTRAINT "emergency_incidents_category_valid" CHECK ("emergency_incidents"."category" IN ('breakdown', 'accident', 'medical', 'security', 'stranded', 'other')),
	CONSTRAINT "emergency_incidents_location_consent" CHECK ("emergency_incidents"."location" IS NULL OR "emergency_incidents"."location_shared"),
	CONSTRAINT "emergency_incidents_note_length" CHECK ("emergency_incidents"."note" IS NULL OR char_length("emergency_incidents"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "incident_deliveries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"channel" text NOT NULL,
	"purpose" text DEFAULT 'alert' NOT NULL,
	"wave" smallint DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"attempts" smallint DEFAULT 0 NOT NULL,
	"next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"sent_at" timestamp with time zone,
	"last_error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_deliveries_channel_valid" CHECK ("incident_deliveries"."channel" IN ('push', 'email')),
	CONSTRAINT "incident_deliveries_status_valid" CHECK ("incident_deliveries"."status" IN ('pending', 'sent', 'failed', 'skipped'))
);
--> statement-breakpoint
CREATE TABLE "incident_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"incident_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"priority" text,
	"wave" smallint DEFAULT 1 NOT NULL,
	"notified_at" timestamp with time zone,
	"acknowledged_at" timestamp with time zone,
	"distance_m" integer,
	"offered_at" timestamp with time zone,
	"offer_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "incident_recipients_kind_fields" CHECK (("incident_recipients"."kind" = 'contact' AND "incident_recipients"."user_id" IS NOT NULL AND "incident_recipients"."organization_id" IS NULL)
       OR ("incident_recipients"."kind" = 'provider' AND "incident_recipients"."organization_id" IS NOT NULL AND "incident_recipients"."user_id" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "provider_emergency_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"opted_in" boolean DEFAULT false NOT NULL,
	"radius_km" smallint DEFAULT 25 NOT NULL,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_emergency_settings_radius" CHECK ("provider_emergency_settings"."radius_km" BETWEEN 1 AND 100)
);
--> statement-breakpoint
CREATE TABLE "trusted_contacts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"contact_user_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"priority" text DEFAULT 'primary' NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trusted_contacts_status_valid" CHECK ("trusted_contacts"."status" IN ('pending', 'active', 'declined')),
	CONSTRAINT "trusted_contacts_priority_valid" CHECK ("trusted_contacts"."priority" IN ('primary', 'backup')),
	CONSTRAINT "trusted_contacts_not_self" CHECK ("trusted_contacts"."owner_user_id" <> "trusted_contacts"."contact_user_id")
);
--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_valid";--> statement-breakpoint
ALTER TABLE "conversations" DROP CONSTRAINT "conversations_kind_fields";--> statement-breakpoint
ALTER TABLE "conversations" ADD COLUMN "incident_id" uuid;--> statement-breakpoint
ALTER TABLE "emergency_incidents" ADD CONSTRAINT "emergency_incidents_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deliveries" ADD CONSTRAINT "incident_deliveries_incident_id_emergency_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."emergency_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deliveries" ADD CONSTRAINT "incident_deliveries_recipient_id_incident_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."incident_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_deliveries" ADD CONSTRAINT "incident_deliveries_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_recipients" ADD CONSTRAINT "incident_recipients_incident_id_emergency_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."emergency_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_recipients" ADD CONSTRAINT "incident_recipients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "incident_recipients" ADD CONSTRAINT "incident_recipients_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_emergency_settings" ADD CONSTRAINT "provider_emergency_settings_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_emergency_settings" ADD CONSTRAINT "provider_emergency_settings_updated_by_users_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trusted_contacts" ADD CONSTRAINT "trusted_contacts_contact_user_id_users_id_fk" FOREIGN KEY ("contact_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_incidents_client_key" ON "emergency_incidents" USING btree ("owner_user_id","client_incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "emergency_incidents_one_active_key" ON "emergency_incidents" USING btree ("owner_user_id") WHERE "emergency_incidents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "emergency_incidents_owner_idx" ON "emergency_incidents" USING btree ("owner_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "emergency_incidents_escalation_idx" ON "emergency_incidents" USING btree ("next_escalation_at") WHERE "emergency_incidents"."status" = 'active';--> statement-breakpoint
CREATE INDEX "emergency_incidents_expiry_idx" ON "emergency_incidents" USING btree ("expires_at") WHERE "emergency_incidents"."status" = 'active';--> statement-breakpoint
CREATE UNIQUE INDEX "incident_deliveries_key" ON "incident_deliveries" USING btree ("recipient_id","user_id","channel","purpose","wave");--> statement-breakpoint
CREATE INDEX "incident_deliveries_due_idx" ON "incident_deliveries" USING btree ("next_attempt_at") WHERE "incident_deliveries"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "incident_deliveries_incident_idx" ON "incident_deliveries" USING btree ("incident_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_recipients_user_key" ON "incident_recipients" USING btree ("incident_id","user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "incident_recipients_org_key" ON "incident_recipients" USING btree ("incident_id","organization_id");--> statement-breakpoint
CREATE INDEX "incident_recipients_org_idx" ON "incident_recipients" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "incident_recipients_user_idx" ON "incident_recipients" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "trusted_contacts_pair_key" ON "trusted_contacts" USING btree ("owner_user_id","contact_user_id");--> statement-breakpoint
CREATE INDEX "trusted_contacts_contact_idx" ON "trusted_contacts" USING btree ("contact_user_id","status");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_incident_id_emergency_incidents_id_fk" FOREIGN KEY ("incident_id") REFERENCES "public"."emergency_incidents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_incident_key" ON "conversations" USING btree ("incident_id");--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_valid" CHECK ("conversations"."kind" IN ('direct', 'request', 'group', 'incident'));--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_kind_fields" CHECK (("conversations"."kind" = 'direct' AND "conversations"."direct_user_a" IS NOT NULL AND "conversations"."direct_user_b" IS NOT NULL AND "conversations"."direct_user_a" < "conversations"."direct_user_b" AND "conversations"."request_recipient_id" IS NULL AND "conversations"."group_id" IS NULL AND "conversations"."incident_id" IS NULL)
       OR ("conversations"."kind" = 'request' AND "conversations"."request_recipient_id" IS NOT NULL AND "conversations"."direct_user_a" IS NULL AND "conversations"."group_id" IS NULL AND "conversations"."incident_id" IS NULL)
       OR ("conversations"."kind" = 'group' AND "conversations"."group_id" IS NOT NULL AND "conversations"."direct_user_a" IS NULL AND "conversations"."request_recipient_id" IS NULL AND "conversations"."incident_id" IS NULL)
       OR ("conversations"."kind" = 'incident' AND "conversations"."incident_id" IS NOT NULL AND "conversations"."direct_user_a" IS NULL AND "conversations"."request_recipient_id" IS NULL AND "conversations"."group_id" IS NULL));
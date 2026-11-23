CREATE TABLE "service_quotes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"recipient_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"request_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"price_type" text NOT NULL,
	"currency" char(3),
	"price_amount" numeric(14, 4),
	"price_max" numeric(14, 4),
	"price_unit" text,
	"message" text,
	"available_from" timestamp with time zone,
	"valid_until" timestamp with time zone NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_quotes_status_valid" CHECK ("service_quotes"."status" IN ('active', 'superseded', 'withdrawn', 'accepted', 'not_selected')),
	CONSTRAINT "service_quotes_price_shape" CHECK (("service_quotes"."price_type" IN ('fixed', 'from') AND "service_quotes"."currency" IS NOT NULL AND "service_quotes"."price_amount" > 0 AND "service_quotes"."price_max" IS NULL AND "service_quotes"."price_unit" IS NOT NULL)
       OR ("service_quotes"."price_type" = 'range' AND "service_quotes"."currency" IS NOT NULL AND "service_quotes"."price_amount" > 0 AND "service_quotes"."price_max" > "service_quotes"."price_amount" AND "service_quotes"."price_unit" IS NOT NULL)
       OR ("service_quotes"."price_type" = 'quote_required' AND "service_quotes"."currency" IS NULL AND "service_quotes"."price_amount" IS NULL AND "service_quotes"."price_max" IS NULL AND "service_quotes"."price_unit" IS NULL)),
	CONSTRAINT "service_quotes_message_length" CHECK ("service_quotes"."message" IS NULL OR char_length("service_quotes"."message") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "service_request_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid,
	"uploaded_by" uuid NOT NULL,
	"organization_id" uuid,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_attachments_status_valid" CHECK ("service_request_attachments"."status" IN ('pending_upload', 'available', 'rejected')),
	CONSTRAINT "service_request_attachments_size" CHECK ("service_request_attachments"."declared_size" BETWEEN 1 AND 8388608)
);
--> statement-breakpoint
CREATE TABLE "service_request_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"type" text NOT NULL,
	"actor_side" text NOT NULL,
	"actor_user_id" uuid,
	"organization_id" uuid,
	"note" text,
	"attachment_ids" uuid[] DEFAULT '{}'::uuid[] NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_events_actor_valid" CHECK ("service_request_events"."actor_side" IN ('requester', 'provider', 'system')),
	CONSTRAINT "service_request_events_note_length" CHECK ("service_request_events"."note" IS NULL OR char_length("service_request_events"."note") <= 2000)
);
--> statement-breakpoint
CREATE TABLE "service_request_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"status" text DEFAULT 'pending' NOT NULL,
	"distance_meters" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_request_recipients_request_org_key" UNIQUE("request_id","organization_id"),
	CONSTRAINT "service_request_recipients_id_org_key" UNIQUE("id","organization_id"),
	CONSTRAINT "service_request_recipients_status_valid" CHECK ("service_request_recipients"."status" IN ('pending', 'viewed', 'quoted', 'declined', 'accepted', 'not_selected', 'cancelled'))
);
--> statement-breakpoint
CREATE TABLE "service_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"requester_user_id" uuid,
	"requester_organization_id" uuid,
	"requester_organization_kind" text,
	"fleet_branch_id" uuid,
	"created_by" uuid NOT NULL,
	"client_request_id" uuid NOT NULL,
	"category" text NOT NULL,
	"vehicle_type" text NOT NULL,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_year" smallint,
	"vehicle_registration" text,
	"location" geography(Point, 4326) NOT NULL,
	"location_note" text,
	"description" text NOT NULL,
	"urgency" text NOT NULL,
	"needed_by" timestamp with time zone,
	"status" text DEFAULT 'open' NOT NULL,
	"accepted_quote_id" uuid,
	"expires_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_requests_requester" CHECK (("service_requests"."requester_user_id" IS NOT NULL AND "service_requests"."requester_organization_id" IS NULL AND "service_requests"."requester_organization_kind" IS NULL AND "service_requests"."fleet_branch_id" IS NULL)
       OR ("service_requests"."requester_user_id" IS NULL AND "service_requests"."requester_organization_id" IS NOT NULL AND "service_requests"."requester_organization_kind" = 'fleet')),
	CONSTRAINT "service_requests_category_valid" CHECK ("service_requests"."category" IN ('workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic')),
	CONSTRAINT "service_requests_status_valid" CHECK ("service_requests"."status" IN ('open', 'accepted', 'completed', 'cancelled')),
	CONSTRAINT "service_requests_urgency_valid" CHECK ("service_requests"."urgency" IN ('routine', 'soon', 'urgent')),
	CONSTRAINT "service_requests_description_length" CHECK (char_length("service_requests"."description") BETWEEN 10 AND 2000),
	CONSTRAINT "service_requests_accepted_consistent" CHECK (("service_requests"."status" IN ('accepted', 'completed')) = ("service_requests"."accepted_quote_id" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_quotes" ADD CONSTRAINT "service_quotes_recipient_fk" FOREIGN KEY ("recipient_id","organization_id") REFERENCES "public"."service_request_recipients"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD CONSTRAINT "service_request_attachments_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD CONSTRAINT "service_request_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD CONSTRAINT "service_request_attachments_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_actor_user_id_users_id_fk" FOREIGN KEY ("actor_user_id") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_events" ADD CONSTRAINT "service_request_events_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_recipients" ADD CONSTRAINT "service_request_recipients_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_recipients" ADD CONSTRAINT "service_request_recipients_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_request_recipients" ADD CONSTRAINT "service_request_recipients_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_requester_org_fk" FOREIGN KEY ("requester_organization_id","requester_organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_fleet_branch_fk" FOREIGN KEY ("fleet_branch_id","requester_organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "service_quotes_org_idx" ON "service_quotes" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_quotes_request_idx" ON "service_quotes" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "service_quotes_recipient_idx" ON "service_quotes" USING btree ("recipient_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_quotes_one_active" ON "service_quotes" USING btree ("recipient_id") WHERE "service_quotes"."status" IN ('active', 'accepted');--> statement-breakpoint
CREATE INDEX "service_request_attachments_request_idx" ON "service_request_attachments" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "service_request_attachments_org_idx" ON "service_request_attachments" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_request_attachments_uploader_idx" ON "service_request_attachments" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "service_request_events_request_idx" ON "service_request_events" USING btree ("request_id","created_at");--> statement-breakpoint
CREATE INDEX "service_request_events_org_idx" ON "service_request_events" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "service_request_recipients_org_idx" ON "service_request_recipients" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_requests_user_idx" ON "service_requests" USING btree ("requester_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_requests_organization_idx" ON "service_requests" USING btree ("requester_organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_user_client_key" ON "service_requests" USING btree ("requester_user_id","client_request_id") WHERE "service_requests"."requester_organization_id" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "service_requests_org_client_key" ON "service_requests" USING btree ("requester_organization_id","client_request_id") WHERE "service_requests"."requester_organization_id" IS NOT NULL;
CREATE TABLE "maintenance_schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"title" text NOT NULL,
	"kind" text NOT NULL,
	"interval_km" integer,
	"interval_days" integer,
	"last_done_km" integer,
	"last_done_on" date,
	"remind_before_km" integer DEFAULT 1000 NOT NULL,
	"remind_before_days" integer DEFAULT 14 NOT NULL,
	"reminded_status" text,
	"reminded_at" timestamp with time zone,
	"active" boolean DEFAULT true NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "maintenance_schedules_kind_valid" CHECK ("maintenance_schedules"."kind" IN ('service', 'inspection', 'tyres', 'licence_renewal', 'other')),
	CONSTRAINT "maintenance_schedules_interval" CHECK ("maintenance_schedules"."interval_km" IS NOT NULL OR "maintenance_schedules"."interval_days" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "service_records" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"performed_on" date NOT NULL,
	"odometer_km" integer,
	"category" text NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"cost_amount" numeric(14, 2),
	"cost_currency" char(3),
	"source" text NOT NULL,
	"provider_organization_id" uuid,
	"provider_name" text,
	"entered_by" uuid NOT NULL,
	"schedule_id" uuid,
	"document_id" uuid,
	"service_request_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "service_records_source_valid" CHECK ("service_records"."source" IN ('owner', 'fleet', 'driver', 'provider', 'document')),
	CONSTRAINT "service_records_category_valid" CHECK ("service_records"."category" IN ('service', 'repair', 'tyres', 'inspection', 'towing', 'parts', 'fuel', 'other')),
	CONSTRAINT "service_records_cost_pair" CHECK (("service_records"."cost_amount" IS NULL) = ("service_records"."cost_currency" IS NULL)),
	CONSTRAINT "service_records_provider_source" CHECK ("service_records"."source" <> 'provider' OR "service_records"."provider_organization_id" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "vehicle_assignments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"assigned_by" uuid,
	"starts_at" timestamp with time zone DEFAULT now() NOT NULL,
	"ends_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vehicle_document_shares" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"label" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"max_views" smallint NOT NULL,
	"views" smallint DEFAULT 0 NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_document_shares_views" CHECK ("vehicle_document_shares"."views" >= 0 AND "vehicle_document_shares"."views" <= "vehicle_document_shares"."max_views")
);
--> statement-breakpoint
CREATE TABLE "vehicle_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"vehicle_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"expires_on" date,
	"driver_visible" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"size" integer,
	"sha256" text,
	"wrapped_key" text,
	"iv" text,
	"auth_tag" text,
	"key_id" text,
	"rejection_reason" text,
	"expiry_reminded_for" date,
	"uploaded_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicle_documents_kind_valid" CHECK ("vehicle_documents"."kind" IN ('registration', 'insurance', 'roadworthy', 'permit', 'invoice', 'manual', 'other')),
	CONSTRAINT "vehicle_documents_status_valid" CHECK ("vehicle_documents"."status" IN ('pending_upload', 'available', 'rejected')),
	CONSTRAINT "vehicle_documents_encrypted_when_available" CHECK ("vehicle_documents"."status" <> 'available' OR ("vehicle_documents"."storage_key" IS NOT NULL AND "vehicle_documents"."wrapped_key" IS NOT NULL AND "vehicle_documents"."iv" IS NOT NULL AND "vehicle_documents"."auth_tag" IS NOT NULL))
);
--> statement-breakpoint
CREATE TABLE "vehicles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid,
	"organization_id" uuid,
	"branch_id" uuid,
	"nickname" text,
	"vehicle_type" text NOT NULL,
	"make" text,
	"model" text,
	"year" smallint,
	"registration" text,
	"vin" char(17),
	"odometer_km" integer,
	"odometer_updated_at" timestamp with time zone,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "vehicles_one_owner" CHECK (("vehicles"."owner_user_id" IS NULL) <> ("vehicles"."organization_id" IS NULL)),
	CONSTRAINT "vehicles_branch_needs_org" CHECK ("vehicles"."branch_id" IS NULL OR "vehicles"."organization_id" IS NOT NULL),
	CONSTRAINT "vehicles_status_valid" CHECK ("vehicles"."status" IN ('active', 'archived')),
	CONSTRAINT "vehicles_odometer_non_negative" CHECK ("vehicles"."odometer_km" IS NULL OR "vehicles"."odometer_km" >= 0)
);
--> statement-breakpoint
ALTER TABLE "service_requests" ADD COLUMN "vehicle_id" uuid;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "maintenance_schedules" ADD CONSTRAINT "maintenance_schedules_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_provider_organization_id_organizations_id_fk" FOREIGN KEY ("provider_organization_id") REFERENCES "public"."organizations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_records" ADD CONSTRAINT "service_records_entered_by_users_id_fk" FOREIGN KEY ("entered_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_assignments" ADD CONSTRAINT "vehicle_assignments_assigned_by_users_id_fk" FOREIGN KEY ("assigned_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_document_shares" ADD CONSTRAINT "vehicle_document_shares_document_id_vehicle_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."vehicle_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_document_shares" ADD CONSTRAINT "vehicle_document_shares_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicle_documents" ADD CONSTRAINT "vehicle_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vehicles" ADD CONSTRAINT "vehicles_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "maintenance_schedules_vehicle_idx" ON "maintenance_schedules" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "service_records_vehicle_idx" ON "service_records" USING btree ("vehicle_id","performed_on" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "service_records_provider_idx" ON "service_records" USING btree ("provider_organization_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_assignments_current_key" ON "vehicle_assignments" USING btree ("vehicle_id") WHERE "vehicle_assignments"."ends_at" IS NULL;--> statement-breakpoint
CREATE INDEX "vehicle_assignments_user_idx" ON "vehicle_assignments" USING btree ("user_id") WHERE "vehicle_assignments"."ends_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicle_document_shares_token_key" ON "vehicle_document_shares" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "vehicle_document_shares_document_idx" ON "vehicle_document_shares" USING btree ("document_id");--> statement-breakpoint
CREATE INDEX "vehicle_documents_vehicle_idx" ON "vehicle_documents" USING btree ("vehicle_id");--> statement-breakpoint
CREATE INDEX "vehicle_documents_expiry_idx" ON "vehicle_documents" USING btree ("expires_on") WHERE "vehicle_documents"."status" = 'available';--> statement-breakpoint
CREATE INDEX "vehicles_org_idx" ON "vehicles" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "vehicles_owner_idx" ON "vehicles" USING btree ("owner_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_org_registration_key" ON "vehicles" USING btree ("organization_id","registration") WHERE "vehicles"."status" = 'active' AND "vehicles"."registration" IS NOT NULL AND "vehicles"."organization_id" IS NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "vehicles_user_registration_key" ON "vehicles" USING btree ("owner_user_id","registration") WHERE "vehicles"."status" = 'active' AND "vehicles"."registration" IS NOT NULL AND "vehicles"."owner_user_id" IS NOT NULL;--> statement-breakpoint
ALTER TABLE "service_requests" ADD CONSTRAINT "service_requests_vehicle_id_vehicles_id_fk" FOREIGN KEY ("vehicle_id") REFERENCES "public"."vehicles"("id") ON DELETE set null ON UPDATE no action;
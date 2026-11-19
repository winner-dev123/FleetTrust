CREATE TABLE "document_access_grants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "verification_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid,
	"badge_id" uuid,
	"organization_id" uuid,
	"statement" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"filed_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_appeals_target" CHECK (("verification_appeals"."case_id" IS NULL) <> ("verification_appeals"."badge_id" IS NULL)),
	CONSTRAINT "verification_appeals_statement_length" CHECK (char_length("verification_appeals"."statement") BETWEEN 10 AND 2000),
	CONSTRAINT "verification_appeals_status_valid" CHECK ("verification_appeals"."status" IN ('open', 'upheld', 'overturned')),
	CONSTRAINT "verification_appeals_decision_consistent" CHECK (("verification_appeals"."status" = 'open') = ("verification_appeals"."decided_at" IS NULL) AND ("verification_appeals"."status" = 'open' OR ("verification_appeals"."decided_by" IS NOT NULL AND char_length("verification_appeals"."decision_reason") >= 3)))
);
--> statement-breakpoint
CREATE TABLE "verification_badges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"badge_type" text NOT NULL,
	"case_id" uuid NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"ended_by" uuid,
	"end_reason" text,
	"end_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_badges_subject" CHECK (("verification_badges"."subject_type" = 'user' AND "verification_badges"."user_id" IS NOT NULL AND "verification_badges"."organization_id" IS NULL) OR
      ("verification_badges"."subject_type" = 'organization' AND "verification_badges"."organization_id" IS NOT NULL AND "verification_badges"."user_id" IS NULL)),
	CONSTRAINT "verification_badges_badge_subject" CHECK (("verification_badges"."badge_type" = 'driver' AND "verification_badges"."subject_type" = 'user') OR
      ("verification_badges"."badge_type" IN ('business', 'location') AND "verification_badges"."subject_type" = 'organization')),
	CONSTRAINT "verification_badges_expiry_after_grant" CHECK ("verification_badges"."expires_at" > "verification_badges"."granted_at"),
	CONSTRAINT "verification_badges_ended_consistent" CHECK (("verification_badges"."ended_at" IS NULL) = ("verification_badges"."end_reason" IS NULL)),
	CONSTRAINT "verification_badges_revocation_reason" CHECK ("verification_badges"."end_reason" IS DISTINCT FROM 'revoked' OR ("verification_badges"."ended_by" IS NOT NULL AND char_length("verification_badges"."end_note") >= 3))
);
--> statement-breakpoint
CREATE TABLE "verification_cases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"subject_type" text NOT NULL,
	"user_id" uuid,
	"organization_id" uuid,
	"badge_type" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"opened_by" uuid NOT NULL,
	"renews_badge_id" uuid,
	"submitted_at" timestamp with time zone,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_cases_subject" CHECK (("verification_cases"."subject_type" = 'user' AND "verification_cases"."user_id" IS NOT NULL AND "verification_cases"."organization_id" IS NULL) OR
      ("verification_cases"."subject_type" = 'organization' AND "verification_cases"."organization_id" IS NOT NULL AND "verification_cases"."user_id" IS NULL)),
	CONSTRAINT "verification_cases_badge_subject" CHECK (("verification_cases"."badge_type" = 'driver' AND "verification_cases"."subject_type" = 'user') OR
      ("verification_cases"."badge_type" IN ('business', 'location') AND "verification_cases"."subject_type" = 'organization')),
	CONSTRAINT "verification_cases_status_valid" CHECK ("verification_cases"."status" IN ('draft', 'submitted', 'changes_requested', 'approved', 'rejected', 'withdrawn')),
	CONSTRAINT "verification_cases_decision_consistent" CHECK (("verification_cases"."status" IN ('approved', 'rejected')) = ("verification_cases"."decided_at" IS NOT NULL AND "verification_cases"."decided_by" IS NOT NULL)),
	CONSTRAINT "verification_cases_reason_required" CHECK ("verification_cases"."status" NOT IN ('rejected', 'changes_requested') OR char_length("verification_cases"."decision_reason") >= 3)
);
--> statement-breakpoint
CREATE TABLE "verification_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"case_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"size" integer,
	"sha256" text,
	"encryption_key_id" text,
	"wrapped_key" text,
	"iv" text,
	"auth_tag" text,
	"scan_result" text,
	"available_at" timestamp with time zone,
	"purged_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "verification_documents_kind_valid" CHECK ("verification_documents"."kind" IN ('identity_document', 'driving_licence', 'business_registration', 'proof_of_address', 'other')),
	CONSTRAINT "verification_documents_status_valid" CHECK ("verification_documents"."status" IN ('pending_upload', 'available', 'rejected', 'purged')),
	CONSTRAINT "verification_documents_size_range" CHECK ("verification_documents"."declared_size" BETWEEN 1 AND 10485760 AND ("verification_documents"."size" IS NULL OR "verification_documents"."size" BETWEEN 1 AND 10485760)),
	CONSTRAINT "verification_documents_available_complete" CHECK ("verification_documents"."status" <> 'available' OR ("verification_documents"."storage_key" IS NOT NULL AND "verification_documents"."wrapped_key" IS NOT NULL AND "verification_documents"."iv" IS NOT NULL AND "verification_documents"."auth_tag" IS NOT NULL AND "verification_documents"."sha256" IS NOT NULL AND "verification_documents"."available_at" IS NOT NULL))
);
--> statement-breakpoint
ALTER TABLE "platform_staff" DROP CONSTRAINT "platform_staff_role_valid";--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_document_id_verification_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."verification_documents"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "document_access_grants" ADD CONSTRAINT "document_access_grants_reviewer_id_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_case_id_verification_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."verification_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_badge_id_verification_badges_id_fk" FOREIGN KEY ("badge_id") REFERENCES "public"."verification_badges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_filed_by_users_id_fk" FOREIGN KEY ("filed_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_appeals" ADD CONSTRAINT "verification_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_case_id_verification_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."verification_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_granted_by_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_ended_by_users_id_fk" FOREIGN KEY ("ended_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_opened_by_users_id_fk" FOREIGN KEY ("opened_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_renews_badge_id_verification_badges_id_fk" FOREIGN KEY ("renews_badge_id") REFERENCES "public"."verification_badges"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_case_id_verification_cases_id_fk" FOREIGN KEY ("case_id") REFERENCES "public"."verification_cases"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_documents" ADD CONSTRAINT "verification_documents_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "document_access_grants_token_key" ON "document_access_grants" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "document_access_grants_document_idx" ON "document_access_grants" USING btree ("document_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_appeals_case_key" ON "verification_appeals" USING btree ("case_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_appeals_badge_key" ON "verification_appeals" USING btree ("badge_id");--> statement-breakpoint
CREATE INDEX "verification_appeals_org_idx" ON "verification_appeals" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "verification_appeals_queue_idx" ON "verification_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "verification_badges_org_idx" ON "verification_badges" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "verification_badges_user_idx" ON "verification_badges" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_badges_one_current" ON "verification_badges" USING btree (COALESCE("organization_id", "user_id"),"badge_type") WHERE "verification_badges"."ended_at" IS NULL;--> statement-breakpoint
CREATE INDEX "verification_cases_org_idx" ON "verification_cases" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "verification_cases_user_idx" ON "verification_cases" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "verification_cases_queue_idx" ON "verification_cases" USING btree ("status","submitted_at");--> statement-breakpoint
CREATE UNIQUE INDEX "verification_cases_one_open" ON "verification_cases" USING btree (COALESCE("organization_id", "user_id"),"badge_type") WHERE status IN ('draft', 'submitted', 'changes_requested');--> statement-breakpoint
CREATE INDEX "verification_documents_case_idx" ON "verification_documents" USING btree ("case_id");--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_role_valid" CHECK ("platform_staff"."role" IN ('billing_operator', 'verification_reviewer'));
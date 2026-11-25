CREATE TABLE "consents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"purpose" text NOT NULL,
	"version" text NOT NULL,
	"granted" boolean NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "consents_purpose_valid" CHECK ("consents"."purpose" IN ('terms', 'privacy', 'analytics', 'marketing_email')),
	CONSTRAINT "consents_version_length" CHECK (char_length("consents"."version") BETWEEN 1 AND 40)
);
--> statement-breakpoint
ALTER TABLE "users" DROP CONSTRAINT "users_status_valid";--> statement-breakpoint
ALTER TABLE "verification_badges" DROP CONSTRAINT "verification_badges_revocation_reason";--> statement-breakpoint
ALTER TABLE "verification_cases" DROP CONSTRAINT "verification_cases_reason_required";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD COLUMN "wrapped_key" text;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD COLUMN "iv" text;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD COLUMN "auth_tag" text;--> statement-breakpoint
ALTER TABLE "service_request_attachments" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "wrapped_key" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "iv" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "auth_tag" text;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD COLUMN "key_id" text;--> statement-breakpoint
ALTER TABLE "consents" ADD CONSTRAINT "consents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consents_user_purpose_idx" ON "consents" USING btree ("user_id","purpose","recorded_at");--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_deleted_anonymous" CHECK (("users"."status" = 'deleted') = ("users"."deleted_at" IS NOT NULL)
        AND ("users"."status" <> 'deleted' OR ("users"."email" IS NULL AND "users"."display_name" IS NULL AND "users"."last_seen_at" IS NULL)));--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_status_valid" CHECK ("users"."status" IN ('active', 'suspended', 'deleted'));--> statement-breakpoint
ALTER TABLE "verification_badges" ADD CONSTRAINT "verification_badges_revocation_reason" CHECK ("verification_badges"."end_reason" IS DISTINCT FROM 'revoked' OR ("verification_badges"."ended_by" IS NOT NULL AND COALESCE(char_length("verification_badges"."end_note"), 0) >= 3));--> statement-breakpoint
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_reason_required" CHECK ("verification_cases"."status" NOT IN ('rejected', 'changes_requested') OR COALESCE(char_length("verification_cases"."decision_reason"), 0) >= 3);
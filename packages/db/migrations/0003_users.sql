CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"firebase_uid" text NOT NULL,
	"email" text,
	"email_verified" boolean DEFAULT false NOT NULL,
	"display_name" text,
	"status" text DEFAULT 'active' NOT NULL,
	"last_sign_in_provider" text,
	"last_seen_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_status_valid" CHECK ("users"."status" IN ('active', 'suspended')),
	CONSTRAINT "users_firebase_uid_length" CHECK (char_length("users"."firebase_uid") BETWEEN 1 AND 128),
	CONSTRAINT "users_email_lowercase" CHECK ("users"."email" IS NULL OR "users"."email" = lower("users"."email")),
	CONSTRAINT "users_display_name_length" CHECK ("users"."display_name" IS NULL OR char_length("users"."display_name") BETWEEN 1 AND 50)
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_firebase_uid_key" ON "users" USING btree ("firebase_uid");--> statement-breakpoint
CREATE INDEX "users_email_idx" ON "users" USING btree ("email");--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actor_id_users_id_fk" FOREIGN KEY ("actor_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;
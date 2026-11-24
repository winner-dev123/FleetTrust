CREATE TABLE "member_sanctions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"reason" text NOT NULL,
	"starts_at" timestamp with time zone NOT NULL,
	"ends_at" timestamp with time zone,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lift_reason" text,
	"overturned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_sanctions_kind_valid" CHECK ("member_sanctions"."kind" IN ('warning', 'suspension')),
	CONSTRAINT "member_sanctions_reason_length" CHECK (char_length("member_sanctions"."reason") BETWEEN 3 AND 1000),
	CONSTRAINT "member_sanctions_shape" CHECK (("member_sanctions"."kind" = 'warning' AND "member_sanctions"."ends_at" IS NULL AND "member_sanctions"."lifted_at" IS NULL)
       OR ("member_sanctions"."kind" = 'suspension' AND ("member_sanctions"."ends_at" IS NULL OR "member_sanctions"."ends_at" > "member_sanctions"."starts_at")))
);
--> statement-breakpoint
CREATE TABLE "moderation_appeals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"sanction_id" uuid,
	"moderation_action_id" uuid,
	"power_user_revoked_at" timestamp with time zone,
	"statement" text NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_appeals_kind_valid" CHECK ("moderation_appeals"."kind" IN ('sanction', 'power_user', 'content')),
	CONSTRAINT "moderation_appeals_status_valid" CHECK ("moderation_appeals"."status" IN ('open', 'upheld', 'overturned')),
	CONSTRAINT "moderation_appeals_target" CHECK (("moderation_appeals"."kind" = 'sanction' AND "moderation_appeals"."sanction_id" IS NOT NULL AND "moderation_appeals"."moderation_action_id" IS NULL AND "moderation_appeals"."power_user_revoked_at" IS NULL)
       OR ("moderation_appeals"."kind" = 'content' AND "moderation_appeals"."moderation_action_id" IS NOT NULL AND "moderation_appeals"."sanction_id" IS NULL AND "moderation_appeals"."power_user_revoked_at" IS NULL)
       OR ("moderation_appeals"."kind" = 'power_user' AND "moderation_appeals"."power_user_revoked_at" IS NOT NULL AND "moderation_appeals"."sanction_id" IS NULL AND "moderation_appeals"."moderation_action_id" IS NULL)),
	CONSTRAINT "moderation_appeals_decision" CHECK (("moderation_appeals"."status" = 'open') = ("moderation_appeals"."decided_at" IS NULL)
       AND ("moderation_appeals"."status" = 'open' OR ("moderation_appeals"."decision_reason" IS NOT NULL AND char_length("moderation_appeals"."decision_reason") >= 3))),
	CONSTRAINT "moderation_appeals_statement_length" CHECK (char_length("moderation_appeals"."statement") BETWEEN 20 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "power_user_status" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"granted_at" timestamp with time zone NOT NULL,
	"criteria" jsonb NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoke_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "power_user_status_valid" CHECK ("power_user_status"."status" IN ('active', 'revoked')),
	CONSTRAINT "power_user_status_revoked_consistent" CHECK (("power_user_status"."status" = 'revoked') = ("power_user_status"."revoked_at" IS NOT NULL AND "power_user_status"."revoke_reason" IS NOT NULL AND char_length("power_user_status"."revoke_reason") >= 3))
);
--> statement-breakpoint
ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_action_valid";--> statement-breakpoint
ALTER TABLE "member_sanctions" ADD CONSTRAINT "member_sanctions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sanctions" ADD CONSTRAINT "member_sanctions_lifted_by_users_id_fk" FOREIGN KEY ("lifted_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_sanctions" ADD CONSTRAINT "member_sanctions_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_sanction_id_member_sanctions_id_fk" FOREIGN KEY ("sanction_id") REFERENCES "public"."member_sanctions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_moderation_action_id_moderation_actions_id_fk" FOREIGN KEY ("moderation_action_id") REFERENCES "public"."moderation_actions"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_appeals" ADD CONSTRAINT "moderation_appeals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_user_status" ADD CONSTRAINT "power_user_status_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "power_user_status" ADD CONSTRAINT "power_user_status_revoked_by_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_sanctions_user_idx" ON "member_sanctions" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "member_sanctions_active_idx" ON "member_sanctions" USING btree ("user_id") WHERE "member_sanctions"."kind" = 'suspension' AND "member_sanctions"."lifted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "moderation_appeals_user_idx" ON "moderation_appeals" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "moderation_appeals_queue_idx" ON "moderation_appeals" USING btree ("status","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_appeals_sanction_key" ON "moderation_appeals" USING btree ("sanction_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_appeals_action_key" ON "moderation_appeals" USING btree ("moderation_action_id");--> statement-breakpoint
CREATE UNIQUE INDEX "moderation_appeals_power_user_key" ON "moderation_appeals" USING btree ("user_id","power_user_revoked_at");--> statement-breakpoint
CREATE INDEX "power_user_status_active_idx" ON "power_user_status" USING btree ("granted_at") WHERE "power_user_status"."status" = 'active';--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_action_valid" CHECK ("moderation_actions"."action" IN ('approve', 'reject', 'hide', 'restore', 'dismiss_reports', 'auto_flag', 'warn', 'suspend', 'lift_suspension', 'revoke_power_user', 'appeal_upheld', 'appeal_overturned'));
CREATE TABLE "community_group_members" (
	"group_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_group_members_pkey" PRIMARY KEY("group_id","user_id"),
	CONSTRAINT "community_group_members_role_valid" CHECK ("community_group_members"."role" IN ('owner', 'moderator', 'member')),
	CONSTRAINT "community_group_members_status_valid" CHECK ("community_group_members"."status" IN ('active', 'pending', 'banned')),
	CONSTRAINT "community_group_members_owner_active" CHECK ("community_group_members"."role" <> 'owner' OR "community_group_members"."status" = 'active')
);
--> statement-breakpoint
CREATE TABLE "community_groups" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"kind" text NOT NULL,
	"specialty" text,
	"location_label" text,
	"location" geography(Point, 4326),
	"join_policy" text DEFAULT 'open' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid NOT NULL,
	"organization_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "community_groups_kind_valid" CHECK ("community_groups"."kind" IN ('region', 'route', 'specialty')),
	CONSTRAINT "community_groups_specialty_valid" CHECK ("community_groups"."specialty" IS NULL OR "community_groups"."specialty" IN ('heavy_haulage', 'refrigerated', 'hazardous_goods', 'tankers', 'livestock', 'car_carriers', 'abnormal_loads', 'owner_operators', 'mechanics', 'towing_recovery', 'fleet_management', 'driver_training')),
	CONSTRAINT "community_groups_kind_fields" CHECK (("community_groups"."kind" = 'specialty' AND "community_groups"."specialty" IS NOT NULL) OR ("community_groups"."kind" <> 'specialty' AND "community_groups"."location_label" IS NOT NULL)),
	CONSTRAINT "community_groups_join_policy_valid" CHECK ("community_groups"."join_policy" IN ('open', 'approval')),
	CONSTRAINT "community_groups_status_valid" CHECK ("community_groups"."status" IN ('active', 'hidden', 'archived')),
	CONSTRAINT "community_groups_name_length" CHECK (char_length("community_groups"."name") BETWEEN 3 AND 80),
	CONSTRAINT "community_groups_description_length" CHECK ("community_groups"."description" IS NULL OR char_length("community_groups"."description") <= 2000),
	CONSTRAINT "community_groups_slug_format" CHECK ("community_groups"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$')
);
--> statement-breakpoint
CREATE TABLE "friend_requests" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"sender_id" uuid NOT NULL,
	"recipient_id" uuid NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"responded_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friend_requests_status_valid" CHECK ("friend_requests"."status" IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
	CONSTRAINT "friend_requests_not_self" CHECK ("friend_requests"."sender_id" <> "friend_requests"."recipient_id")
);
--> statement-breakpoint
CREATE TABLE "friendships" (
	"user_a_id" uuid NOT NULL,
	"user_b_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "friendships_pkey" PRIMARY KEY("user_a_id","user_b_id"),
	CONSTRAINT "friendships_ordered" CHECK ("friendships"."user_a_id" < "friendships"."user_b_id")
);
--> statement-breakpoint
CREATE TABLE "social_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"friend_requests_from" text DEFAULT 'everyone' NOT NULL,
	"friend_list_visibility" text DEFAULT 'friends' NOT NULL,
	"discoverable" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "social_settings_requests_from_valid" CHECK ("social_settings"."friend_requests_from" IN ('everyone', 'friends_of_friends', 'nobody')),
	CONSTRAINT "social_settings_friend_list_valid" CHECK ("social_settings"."friend_list_visibility" IN ('friends', 'only_me'))
);
--> statement-breakpoint
CREATE TABLE "user_blocks" (
	"blocker_id" uuid NOT NULL,
	"blocked_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_blocks_pkey" PRIMARY KEY("blocker_id","blocked_id"),
	CONSTRAINT "user_blocks_not_self" CHECK ("user_blocks"."blocker_id" <> "user_blocks"."blocked_id")
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_valid";--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_reason_valid";--> statement-breakpoint
ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_target_valid";--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_group_members" ADD CONSTRAINT "community_group_members_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_groups" ADD CONSTRAINT "community_groups_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_sender_id_users_id_fk" FOREIGN KEY ("sender_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friend_requests" ADD CONSTRAINT "friend_requests_recipient_id_users_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_a_id_users_id_fk" FOREIGN KEY ("user_a_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "friendships" ADD CONSTRAINT "friendships_user_b_id_users_id_fk" FOREIGN KEY ("user_b_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "social_settings" ADD CONSTRAINT "social_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocker_id_users_id_fk" FOREIGN KEY ("blocker_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_blocks" ADD CONSTRAINT "user_blocks_blocked_id_users_id_fk" FOREIGN KEY ("blocked_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_group_members_owner_key" ON "community_group_members" USING btree ("group_id") WHERE "community_group_members"."role" = 'owner';--> statement-breakpoint
CREATE INDEX "community_group_members_user_idx" ON "community_group_members" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "community_group_members_group_idx" ON "community_group_members" USING btree ("group_id","status","role");--> statement-breakpoint
CREATE UNIQUE INDEX "community_groups_slug_key" ON "community_groups" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "community_groups_org_idx" ON "community_groups" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "community_groups_creator_idx" ON "community_groups" USING btree ("created_by","created_at");--> statement-breakpoint
CREATE INDEX "community_groups_status_idx" ON "community_groups" USING btree ("status","kind","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "community_groups_location_gist" ON "community_groups" USING gist ("location");--> statement-breakpoint
CREATE UNIQUE INDEX "friend_requests_pending_pair_key" ON "friend_requests" USING btree (least("sender_id", "recipient_id"),greatest("sender_id", "recipient_id")) WHERE "friend_requests"."status" = 'pending';--> statement-breakpoint
CREATE INDEX "friend_requests_recipient_idx" ON "friend_requests" USING btree ("recipient_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "friend_requests_sender_idx" ON "friend_requests" USING btree ("sender_id","status","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "friend_requests_pair_idx" ON "friend_requests" USING btree ("sender_id","recipient_id","responded_at");--> statement-breakpoint
CREATE INDEX "friendships_user_b_idx" ON "friendships" USING btree ("user_b_id");--> statement-breakpoint
CREATE INDEX "user_blocks_blocked_idx" ON "user_blocks" USING btree ("blocked_id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_valid" CHECK ("content_reports"."target_type" IN ('article', 'article_comment', 'group', 'user'));--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reason_valid" CHECK ("content_reports"."reason" IN ('spam', 'scam', 'harassment', 'hate', 'defamation', 'misinformation', 'sexual_content', 'violence', 'impersonation', 'other'));--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_valid" CHECK ("moderation_actions"."target_type" IN ('article', 'article_comment', 'group', 'user'));
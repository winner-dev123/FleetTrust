CREATE TABLE "conversation_states" (
	"conversation_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"last_read_seq" bigint DEFAULT 0 NOT NULL,
	"muted" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversation_states_pkey" PRIMARY KEY("conversation_id","user_id")
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"kind" text NOT NULL,
	"direct_user_a" uuid,
	"direct_user_b" uuid,
	"request_recipient_id" uuid,
	"group_id" uuid,
	"last_seq" bigint DEFAULT 0 NOT NULL,
	"last_message_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "conversations_kind_valid" CHECK ("conversations"."kind" IN ('direct', 'request', 'group')),
	CONSTRAINT "conversations_kind_fields" CHECK (("conversations"."kind" = 'direct' AND "conversations"."direct_user_a" IS NOT NULL AND "conversations"."direct_user_b" IS NOT NULL AND "conversations"."direct_user_a" < "conversations"."direct_user_b" AND "conversations"."request_recipient_id" IS NULL AND "conversations"."group_id" IS NULL)
       OR ("conversations"."kind" = 'request' AND "conversations"."request_recipient_id" IS NOT NULL AND "conversations"."direct_user_a" IS NULL AND "conversations"."group_id" IS NULL)
       OR ("conversations"."kind" = 'group' AND "conversations"."group_id" IS NOT NULL AND "conversations"."direct_user_a" IS NULL AND "conversations"."request_recipient_id" IS NULL)),
	CONSTRAINT "conversations_last_seq_non_negative" CHECK ("conversations"."last_seq" >= 0)
);
--> statement-breakpoint
CREATE TABLE "message_attachments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"message_id" uuid,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"size" integer,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_attachments_status_valid" CHECK ("message_attachments"."status" IN ('pending_upload', 'available', 'rejected')),
	CONSTRAINT "message_attachments_size_valid" CHECK ("message_attachments"."declared_size" BETWEEN 1 AND 8388608)
);
--> statement-breakpoint
CREATE TABLE "messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"seq" bigint NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_side" text,
	"client_message_id" uuid,
	"body" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"warnings" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_status_valid" CHECK ("messages"."status" IN ('visible', 'deleted', 'removed', 'hidden')),
	CONSTRAINT "messages_body_length" CHECK (char_length("messages"."body") <= 4000),
	CONSTRAINT "messages_sender_side_valid" CHECK ("messages"."sender_side" IS NULL OR "messages"."sender_side" IN ('requester', 'provider'))
);
--> statement-breakpoint
CREATE TABLE "messaging_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"direct_messages_from" text DEFAULT 'friends' NOT NULL,
	"read_receipts" boolean DEFAULT true NOT NULL,
	"push_previews" boolean DEFAULT false NOT NULL,
	"push_messages" boolean DEFAULT true NOT NULL,
	"push_requests" boolean DEFAULT true NOT NULL,
	"push_community" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messaging_preferences_dm_valid" CHECK ("messaging_preferences"."direct_messages_from" IN ('everyone', 'friends', 'nobody'))
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"title" text NOT NULL,
	"body" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"source_event_id" uuid NOT NULL,
	"read_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "push_devices" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fid" text NOT NULL,
	"platform" text NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_devices_platform_valid" CHECK ("push_devices"."platform" IN ('ios', 'android', 'web'))
);
--> statement-breakpoint
ALTER TABLE "content_reports" DROP CONSTRAINT "content_reports_target_valid";--> statement-breakpoint
ALTER TABLE "moderation_actions" DROP CONSTRAINT "moderation_actions_target_valid";--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversation_states" ADD CONSTRAINT "conversation_states_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_user_a_users_id_fk" FOREIGN KEY ("direct_user_a") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_direct_user_b_users_id_fk" FOREIGN KEY ("direct_user_b") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_request_recipient_id_service_request_recipients_id_fk" FOREIGN KEY ("request_recipient_id") REFERENCES "public"."service_request_recipients"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_group_id_community_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."community_groups"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_attachments" ADD CONSTRAINT "message_attachments_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "public"."messages"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messages" ADD CONSTRAINT "messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "messaging_preferences" ADD CONSTRAINT "messaging_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_devices" ADD CONSTRAINT "push_devices_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conversation_states_user_idx" ON "conversation_states" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_direct_key" ON "conversations" USING btree ("direct_user_a","direct_user_b") WHERE "conversations"."kind" = 'direct';--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_request_key" ON "conversations" USING btree ("request_recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conversations_group_key" ON "conversations" USING btree ("group_id");--> statement-breakpoint
CREATE INDEX "conversations_direct_b_idx" ON "conversations" USING btree ("direct_user_b");--> statement-breakpoint
CREATE INDEX "message_attachments_conversation_idx" ON "message_attachments" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "message_attachments_message_idx" ON "message_attachments" USING btree ("message_id");--> statement-breakpoint
CREATE INDEX "message_attachments_uploader_idx" ON "message_attachments" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_conversation_seq_key" ON "messages" USING btree ("conversation_id","seq");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_client_key" ON "messages" USING btree ("conversation_id","sender_user_id","client_message_id");--> statement-breakpoint
CREATE INDEX "messages_sender_idx" ON "messages" USING btree ("sender_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_source_key" ON "notifications" USING btree ("user_id","source_event_id");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "notifications_unread_idx" ON "notifications" USING btree ("user_id") WHERE "notifications"."read_at" IS NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "push_devices_fid_key" ON "push_devices" USING btree ("fid");--> statement-breakpoint
CREATE INDEX "push_devices_user_idx" ON "push_devices" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_target_valid" CHECK ("content_reports"."target_type" IN ('article', 'article_comment', 'group', 'user', 'message'));--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_target_valid" CHECK ("moderation_actions"."target_type" IN ('article', 'article_comment', 'group', 'user', 'message'));
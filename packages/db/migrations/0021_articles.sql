CREATE TABLE "article_bookmarks" (
	"user_id" uuid NOT NULL,
	"article_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_bookmarks_pkey" PRIMARY KEY("user_id","article_id")
);
--> statement-breakpoint
CREATE TABLE "article_comments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"article_id" uuid NOT NULL,
	"parent_id" uuid,
	"author_user_id" uuid NOT NULL,
	"body" text NOT NULL,
	"status" text DEFAULT 'visible' NOT NULL,
	"edited_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_comments_status_valid" CHECK ("article_comments"."status" IN ('visible', 'hidden', 'deleted')),
	CONSTRAINT "article_comments_body_length" CHECK (char_length("article_comments"."body") BETWEEN 1 AND 2000)
);
--> statement-breakpoint
CREATE TABLE "article_images" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"uploaded_by" uuid NOT NULL,
	"article_id" uuid,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"rejection_reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "article_images_status_valid" CHECK ("article_images"."status" IN ('pending_upload', 'available', 'rejected')),
	CONSTRAINT "article_images_size_valid" CHECK ("article_images"."declared_size" BETWEEN 1 AND 5242880)
);
--> statement-breakpoint
CREATE TABLE "articles" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"author_user_id" uuid NOT NULL,
	"organization_id" uuid,
	"slug" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"title" text NOT NULL,
	"summary" text,
	"body" jsonb NOT NULL,
	"body_text" text DEFAULT '' NOT NULL,
	"category" text NOT NULL,
	"tags" text[] DEFAULT '{}'::text[] NOT NULL,
	"cover_image_id" uuid,
	"comments_enabled" boolean DEFAULT true NOT NULL,
	"search_vector" tsvector,
	"moderation_note" text,
	"quota_consumed_at" timestamp with time zone,
	"published_at" timestamp with time zone,
	"edited_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "articles_status_valid" CHECK ("articles"."status" IN ('draft', 'pending_moderation', 'published', 'rejected', 'hidden')),
	CONSTRAINT "articles_category_valid" CHECK ("articles"."category" IN ('maintenance', 'safety', 'regulations', 'routes', 'fuel_efficiency', 'business', 'technology', 'driver_wellbeing', 'other')),
	CONSTRAINT "articles_title_length" CHECK (char_length("articles"."title") BETWEEN 1 AND 150),
	CONSTRAINT "articles_summary_length" CHECK ("articles"."summary" IS NULL OR char_length("articles"."summary") <= 300),
	CONSTRAINT "articles_slug_format" CHECK ("articles"."slug" ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
	CONSTRAINT "articles_tags_count" CHECK (coalesce(array_length("articles"."tags", 1), 0) <= 5),
	CONSTRAINT "articles_published_has_date" CHECK ("articles"."status" <> 'published' OR "articles"."published_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "content_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"reporter_user_id" uuid NOT NULL,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"reason" text NOT NULL,
	"details" text,
	"status" text DEFAULT 'open' NOT NULL,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "content_reports_target_valid" CHECK ("content_reports"."target_type" IN ('article', 'article_comment')),
	CONSTRAINT "content_reports_reason_valid" CHECK ("content_reports"."reason" IN ('spam', 'scam', 'harassment', 'hate', 'defamation', 'misinformation', 'sexual_content', 'violence', 'other')),
	CONSTRAINT "content_reports_status_valid" CHECK ("content_reports"."status" IN ('open', 'actioned', 'dismissed')),
	CONSTRAINT "content_reports_details_length" CHECK ("content_reports"."details" IS NULL OR char_length("content_reports"."details") <= 1000)
);
--> statement-breakpoint
CREATE TABLE "moderation_actions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"moderator_user_id" uuid,
	"target_type" text NOT NULL,
	"target_id" uuid NOT NULL,
	"action" text NOT NULL,
	"reason" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "moderation_actions_target_valid" CHECK ("moderation_actions"."target_type" IN ('article', 'article_comment')),
	CONSTRAINT "moderation_actions_action_valid" CHECK ("moderation_actions"."action" IN ('approve', 'reject', 'hide', 'restore', 'dismiss_reports', 'auto_flag'))
);
--> statement-breakpoint
ALTER TABLE "platform_staff" DROP CONSTRAINT "platform_staff_role_valid";--> statement-breakpoint
ALTER TABLE "article_bookmarks" ADD CONSTRAINT "article_bookmarks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_bookmarks" ADD CONSTRAINT "article_bookmarks_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_comments" ADD CONSTRAINT "article_comments_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "article_images" ADD CONSTRAINT "article_images_article_id_articles_id_fk" FOREIGN KEY ("article_id") REFERENCES "public"."articles"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_author_user_id_users_id_fk" FOREIGN KEY ("author_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "articles" ADD CONSTRAINT "articles_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_reporter_user_id_users_id_fk" FOREIGN KEY ("reporter_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "content_reports" ADD CONSTRAINT "content_reports_resolved_by_users_id_fk" FOREIGN KEY ("resolved_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "moderation_actions" ADD CONSTRAINT "moderation_actions_moderator_user_id_users_id_fk" FOREIGN KEY ("moderator_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "article_bookmarks_user_idx" ON "article_bookmarks" USING btree ("user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "article_bookmarks_article_idx" ON "article_bookmarks" USING btree ("article_id");--> statement-breakpoint
CREATE INDEX "article_comments_article_idx" ON "article_comments" USING btree ("article_id","created_at");--> statement-breakpoint
CREATE INDEX "article_comments_author_idx" ON "article_comments" USING btree ("author_user_id","created_at");--> statement-breakpoint
CREATE INDEX "article_comments_parent_idx" ON "article_comments" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "article_images_uploader_idx" ON "article_images" USING btree ("uploaded_by","created_at");--> statement-breakpoint
CREATE INDEX "article_images_article_idx" ON "article_images" USING btree ("article_id");--> statement-breakpoint
CREATE UNIQUE INDEX "articles_slug_key" ON "articles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "articles_org_idx" ON "articles" USING btree ("organization_id","published_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "articles_author_idx" ON "articles" USING btree ("author_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "articles_published_idx" ON "articles" USING btree ("published_at" DESC NULLS LAST,"id" DESC NULLS LAST) WHERE "articles"."status" = 'published' AND "articles"."deleted_at" IS NULL;--> statement-breakpoint
CREATE INDEX "articles_tags_idx" ON "articles" USING gin ("tags");--> statement-breakpoint
CREATE INDEX "articles_search_idx" ON "articles" USING gin ("search_vector");--> statement-breakpoint
CREATE UNIQUE INDEX "content_reports_open_key" ON "content_reports" USING btree ("reporter_user_id","target_type","target_id") WHERE "content_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "content_reports_target_idx" ON "content_reports" USING btree ("target_type","target_id","status");--> statement-breakpoint
CREATE INDEX "content_reports_open_idx" ON "content_reports" USING btree ("created_at") WHERE "content_reports"."status" = 'open';--> statement-breakpoint
CREATE INDEX "content_reports_reporter_idx" ON "content_reports" USING btree ("reporter_user_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_target_idx" ON "moderation_actions" USING btree ("target_type","target_id","created_at");--> statement-breakpoint
CREATE INDEX "moderation_actions_moderator_idx" ON "moderation_actions" USING btree ("moderator_user_id","created_at");--> statement-breakpoint
ALTER TABLE "platform_staff" ADD CONSTRAINT "platform_staff_role_valid" CHECK ("platform_staff"."role" IN ('billing_operator', 'verification_reviewer', 'trust_safety_moderator'));
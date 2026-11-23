CREATE TABLE "saved_list_items" (
	"list_id" uuid NOT NULL,
	"provider_organization_id" uuid NOT NULL,
	"note" text,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_list_items_list_id_provider_organization_id_pk" PRIMARY KEY("list_id","provider_organization_id"),
	CONSTRAINT "saved_list_items_note_length" CHECK ("saved_list_items"."note" IS NULL OR char_length("saved_list_items"."note") <= 500)
);
--> statement-breakpoint
CREATE TABLE "saved_list_members" (
	"list_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_list_members_list_id_user_id_pk" PRIMARY KEY("list_id","user_id"),
	CONSTRAINT "saved_list_members_role_valid" CHECK ("saved_list_members"."role" IN ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "saved_list_share_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"list_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"role" text NOT NULL,
	"created_by" uuid NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"revoked_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_list_share_links_role_valid" CHECK ("saved_list_share_links"."role" IN ('viewer', 'editor'))
);
--> statement-breakpoint
CREATE TABLE "saved_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_user_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "saved_lists_kind_valid" CHECK ("saved_lists"."kind" IN ('favorites', 'custom')),
	CONSTRAINT "saved_lists_name_length" CHECK (char_length("saved_lists"."name") BETWEEN 1 AND 80),
	CONSTRAINT "saved_lists_description_length" CHECK ("saved_lists"."description" IS NULL OR char_length("saved_lists"."description") <= 500)
);
--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_list_id_saved_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."saved_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_provider_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("provider_organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_items" ADD CONSTRAINT "saved_list_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_members" ADD CONSTRAINT "saved_list_members_list_id_saved_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."saved_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_members" ADD CONSTRAINT "saved_list_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_share_links" ADD CONSTRAINT "saved_list_share_links_list_id_saved_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."saved_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_list_share_links" ADD CONSTRAINT "saved_list_share_links_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "saved_lists" ADD CONSTRAINT "saved_lists_owner_user_id_users_id_fk" FOREIGN KEY ("owner_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "saved_list_items_provider_idx" ON "saved_list_items" USING btree ("provider_organization_id");--> statement-breakpoint
CREATE INDEX "saved_list_items_list_added_idx" ON "saved_list_items" USING btree ("list_id","added_at");--> statement-breakpoint
CREATE INDEX "saved_list_members_user_idx" ON "saved_list_members" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_list_share_links_token_key" ON "saved_list_share_links" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "saved_list_share_links_list_idx" ON "saved_list_share_links" USING btree ("list_id");--> statement-breakpoint
CREATE INDEX "saved_lists_owner_idx" ON "saved_lists" USING btree ("owner_user_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "saved_lists_one_favorites" ON "saved_lists" USING btree ("owner_user_id") WHERE "saved_lists"."kind" = 'favorites';
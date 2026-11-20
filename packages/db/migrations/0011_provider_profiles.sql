CREATE TABLE "provider_media" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"status" text DEFAULT 'pending_upload' NOT NULL,
	"declared_content_type" text NOT NULL,
	"declared_size" integer NOT NULL,
	"quarantine_key" text NOT NULL,
	"storage_key" text,
	"content_type" text,
	"size" integer,
	"alt_text" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"rejection_reason" text,
	"uploaded_by" uuid NOT NULL,
	"available_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_media_kind_valid" CHECK ("provider_media"."kind" IN ('logo', 'cover', 'gallery')),
	CONSTRAINT "provider_media_status_valid" CHECK ("provider_media"."status" IN ('pending_upload', 'available', 'rejected', 'removed')),
	CONSTRAINT "provider_media_size_range" CHECK ("provider_media"."declared_size" BETWEEN 1 AND 5242880 AND ("provider_media"."size" IS NULL OR "provider_media"."size" BETWEEN 1 AND 5242880)),
	CONSTRAINT "provider_media_available_complete" CHECK ("provider_media"."status" <> 'available' OR ("provider_media"."storage_key" IS NOT NULL AND "provider_media"."available_at" IS NOT NULL)),
	CONSTRAINT "provider_media_alt_length" CHECK ("provider_media"."alt_text" IS NULL OR char_length("provider_media"."alt_text") <= 200)
);
--> statement-breakpoint
CREATE TABLE "provider_profiles" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"organization_kind" text DEFAULT 'provider' NOT NULL,
	"slug" text,
	"legal_name" text,
	"trading_name" text,
	"description" text,
	"categories" text[] DEFAULT '{}'::text[] NOT NULL,
	"vehicle_types" text[] DEFAULT '{}'::text[] NOT NULL,
	"category_details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"contact_phone" text,
	"contact_email" text,
	"website" text,
	"status" text DEFAULT 'draft' NOT NULL,
	"published_snapshot" jsonb,
	"published_at" timestamp with time zone,
	"published_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_profiles_kind" CHECK ("provider_profiles"."organization_kind" = 'provider'),
	CONSTRAINT "provider_profiles_slug_format" CHECK ("provider_profiles"."slug" IS NULL OR "provider_profiles"."slug" ~ '^[a-z0-9][a-z0-9-]{1,58}[a-z0-9]$'),
	CONSTRAINT "provider_profiles_status_valid" CHECK ("provider_profiles"."status" IN ('draft', 'published', 'hidden')),
	CONSTRAINT "provider_profiles_published_consistent" CHECK ("provider_profiles"."status" <> 'published' OR ("provider_profiles"."published_snapshot" IS NOT NULL AND "provider_profiles"."published_at" IS NOT NULL AND "provider_profiles"."slug" IS NOT NULL)),
	CONSTRAINT "provider_profiles_text_lengths" CHECK (("provider_profiles"."legal_name" IS NULL OR char_length("provider_profiles"."legal_name") <= 200) AND
          ("provider_profiles"."trading_name" IS NULL OR char_length("provider_profiles"."trading_name") <= 120) AND
          ("provider_profiles"."description" IS NULL OR char_length("provider_profiles"."description") <= 2000))
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "address_line1" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "address_line2" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "locality" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "region" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "postal_code" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "country_code" char(2);--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "location" geography(Point, 4326);--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "service_radius_km" smallint;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "phone" text;--> statement-breakpoint
ALTER TABLE "provider_media" ADD CONSTRAINT "provider_media_organization_id_organizations_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organizations"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_media" ADD CONSTRAINT "provider_media_uploaded_by_users_id_fk" FOREIGN KEY ("uploaded_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_published_by_users_id_fk" FOREIGN KEY ("published_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_profiles" ADD CONSTRAINT "provider_profiles_organization_fk" FOREIGN KEY ("organization_id","organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_media_org_idx" ON "provider_media" USING btree ("organization_id","kind","sort_order");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_profiles_slug_key" ON "provider_profiles" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "branches_location_gist" ON "branches" USING gist ("location");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_country_code_format" CHECK ("branches"."country_code" IS NULL OR "branches"."country_code" ~ '^[A-Z]{2}$');--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_service_radius_range" CHECK ("branches"."service_radius_km" IS NULL OR "branches"."service_radius_km" BETWEEN 1 AND 500);
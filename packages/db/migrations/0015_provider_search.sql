CREATE TABLE "provider_search_entries" (
	"branch_id" uuid PRIMARY KEY NOT NULL,
	"organization_id" uuid NOT NULL,
	"slug" text NOT NULL,
	"trading_name" text NOT NULL,
	"branch_name" text NOT NULL,
	"locality" text,
	"country_code" text,
	"categories" text[] NOT NULL,
	"vehicle_types" text[] NOT NULL,
	"location" geography(Point, 4326) NOT NULL,
	"approx_location" geography(Point, 4326) NOT NULL,
	"service_radius_km" smallint,
	"search_document" tsvector NOT NULL,
	"published_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "provider_search_entries" ADD CONSTRAINT "provider_search_entries_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "provider_search_entries_org_idx" ON "provider_search_entries" USING btree ("organization_id");--> statement-breakpoint
CREATE INDEX "provider_search_entries_location_gist" ON "provider_search_entries" USING gist ("location");--> statement-breakpoint
CREATE INDEX "provider_search_entries_approx_gist" ON "provider_search_entries" USING gist ("approx_location");--> statement-breakpoint
CREATE INDEX "provider_search_entries_location_geom_gist" ON "provider_search_entries" USING gist (("location"::geometry));--> statement-breakpoint
CREATE INDEX "provider_search_entries_approx_geom_gist" ON "provider_search_entries" USING gist (("approx_location"::geometry));--> statement-breakpoint
CREATE INDEX "provider_search_entries_categories_gin" ON "provider_search_entries" USING gin ("categories");--> statement-breakpoint
CREATE INDEX "provider_search_entries_vehicle_types_gin" ON "provider_search_entries" USING gin ("vehicle_types");--> statement-breakpoint
CREATE INDEX "provider_search_entries_document_gin" ON "provider_search_entries" USING gin ("search_document");
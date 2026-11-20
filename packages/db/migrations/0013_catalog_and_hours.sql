CREATE TABLE "branch_hours_exceptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"date" date NOT NULL,
	"closed" boolean NOT NULL,
	"intervals" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"label" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_hours_exceptions_shape" CHECK (("branch_hours_exceptions"."closed" AND jsonb_array_length("branch_hours_exceptions"."intervals") = 0) OR (NOT "branch_hours_exceptions"."closed" AND jsonb_array_length("branch_hours_exceptions"."intervals") BETWEEN 1 AND 4)),
	CONSTRAINT "branch_hours_exceptions_label_length" CHECK ("branch_hours_exceptions"."label" IS NULL OR char_length("branch_hours_exceptions"."label") <= 80)
);
--> statement-breakpoint
CREATE TABLE "branch_opening_hours" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	"weekday" smallint NOT NULL,
	"opens_minute" smallint NOT NULL,
	"closes_minute" smallint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "branch_opening_hours_weekday_range" CHECK ("branch_opening_hours"."weekday" BETWEEN 1 AND 7),
	CONSTRAINT "branch_opening_hours_opens_range" CHECK ("branch_opening_hours"."opens_minute" BETWEEN 0 AND 1439),
	CONSTRAINT "branch_opening_hours_closes_range" CHECK ("branch_opening_hours"."closes_minute" > "branch_opening_hours"."opens_minute" AND "branch_opening_hours"."closes_minute" - "branch_opening_hours"."opens_minute" <= 1440)
);
--> statement-breakpoint
CREATE TABLE "provider_offering_branches" (
	"offering_id" uuid NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid NOT NULL,
	CONSTRAINT "provider_offering_branches_offering_id_branch_id_pk" PRIMARY KEY("offering_id","branch_id")
);
--> statement-breakpoint
CREATE TABLE "provider_offerings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"category" text NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"vehicle_types" text[] NOT NULL,
	"service_location" text DEFAULT 'at_premises' NOT NULL,
	"price_type" text NOT NULL,
	"currency" char(3),
	"price_amount" numeric(14, 4),
	"price_max" numeric(14, 4),
	"price_unit" text,
	"sort_order" smallint DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_offerings_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "provider_offerings_category_valid" CHECK ("provider_offerings"."category" IN ('workshop', 'fuel_station', 'towing', 'tyres', 'parts', 'parking', 'mobile_mechanic')),
	CONSTRAINT "provider_offerings_name_length" CHECK (char_length("provider_offerings"."name") BETWEEN 2 AND 120),
	CONSTRAINT "provider_offerings_description_length" CHECK ("provider_offerings"."description" IS NULL OR char_length("provider_offerings"."description") <= 1000),
	CONSTRAINT "provider_offerings_vehicle_types" CHECK (cardinality("provider_offerings"."vehicle_types") >= 1),
	CONSTRAINT "provider_offerings_service_location_valid" CHECK ("provider_offerings"."service_location" IN ('at_premises', 'at_customer')),
	CONSTRAINT "provider_offerings_price_unit_valid" CHECK ("provider_offerings"."price_unit" IS NULL OR "provider_offerings"."price_unit" IN ('job', 'hour', 'day', 'night', 'km', 'litre', 'kwh', 'item', 'tyre', 'vehicle')),
	CONSTRAINT "provider_offerings_price_shape" CHECK (("provider_offerings"."price_type" IN ('fixed', 'from') AND "provider_offerings"."currency" IS NOT NULL AND "provider_offerings"."price_amount" > 0 AND "provider_offerings"."price_max" IS NULL AND "provider_offerings"."price_unit" IS NOT NULL)
       OR ("provider_offerings"."price_type" = 'range' AND "provider_offerings"."currency" IS NOT NULL AND "provider_offerings"."price_amount" > 0 AND "provider_offerings"."price_max" > "provider_offerings"."price_amount" AND "provider_offerings"."price_unit" IS NOT NULL)
       OR ("provider_offerings"."price_type" = 'quote_required' AND "provider_offerings"."currency" IS NULL AND "provider_offerings"."price_amount" IS NULL AND "provider_offerings"."price_max" IS NULL AND "provider_offerings"."price_unit" IS NULL)),
	CONSTRAINT "provider_offerings_sort_order_range" CHECK ("provider_offerings"."sort_order" BETWEEN 0 AND 999)
);
--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "time_zone" text;--> statement-breakpoint
ALTER TABLE "branches" ADD COLUMN "hours_updated_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "branch_hours_exceptions" ADD CONSTRAINT "branch_hours_exceptions_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "branch_opening_hours" ADD CONSTRAINT "branch_opening_hours_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offering_branches" ADD CONSTRAINT "provider_offering_branches_offering_fk" FOREIGN KEY ("offering_id","organization_id") REFERENCES "public"."provider_offerings"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offering_branches" ADD CONSTRAINT "provider_offering_branches_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offerings" ADD CONSTRAINT "provider_offerings_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_offerings" ADD CONSTRAINT "provider_offerings_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "branch_hours_exceptions_org_idx" ON "branch_hours_exceptions" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "branch_hours_exceptions_branch_date_key" ON "branch_hours_exceptions" USING btree ("branch_id","date");--> statement-breakpoint
CREATE INDEX "branch_opening_hours_org_idx" ON "branch_opening_hours" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "branch_opening_hours_branch_idx" ON "branch_opening_hours" USING btree ("branch_id","weekday");--> statement-breakpoint
CREATE INDEX "provider_offering_branches_org_idx" ON "provider_offering_branches" USING btree ("organization_id","branch_id");--> statement-breakpoint
CREATE INDEX "provider_offering_branches_branch_idx" ON "provider_offering_branches" USING btree ("branch_id");--> statement-breakpoint
CREATE INDEX "provider_offerings_org_idx" ON "provider_offerings" USING btree ("organization_id","sort_order");--> statement-breakpoint
ALTER TABLE "branches" ADD CONSTRAINT "branches_time_zone_length" CHECK ("branches"."time_zone" IS NULL OR char_length("branches"."time_zone") BETWEEN 1 AND 64);
CREATE TABLE "part_compatibility" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_id" uuid NOT NULL,
	"vehicle_type" text NOT NULL,
	"make" text,
	"model" text,
	"year_from" smallint,
	"year_to" smallint,
	CONSTRAINT "part_compatibility_model_needs_make" CHECK ("part_compatibility"."model" IS NULL OR "part_compatibility"."make" IS NOT NULL),
	CONSTRAINT "part_compatibility_years" CHECK (("part_compatibility"."year_from" IS NULL OR "part_compatibility"."year_from" BETWEEN 1900 AND 2100)
       AND ("part_compatibility"."year_to" IS NULL OR "part_compatibility"."year_to" BETWEEN 1900 AND 2100)
       AND ("part_compatibility"."year_from" IS NULL OR "part_compatibility"."year_to" IS NULL OR "part_compatibility"."year_from" <= "part_compatibility"."year_to"))
);
--> statement-breakpoint
CREATE TABLE "part_inquiries" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"part_id" uuid,
	"branch_id" uuid,
	"requester_user_id" uuid,
	"requester_organization_id" uuid,
	"requester_organization_kind" text,
	"created_by" uuid NOT NULL,
	"part_name" text NOT NULL,
	"part_number" text,
	"quantity" smallint DEFAULT 1 NOT NULL,
	"message" text,
	"vehicle_type" text,
	"vehicle_make" text,
	"vehicle_model" text,
	"vehicle_year" smallint,
	"status" text DEFAULT 'open' NOT NULL,
	"availability" text,
	"quantity_available" integer,
	"eta_days" smallint,
	"answer_message" text,
	"answered_at" timestamp with time zone,
	"answered_by" uuid,
	"closed_at" timestamp with time zone,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "part_inquiries_requester" CHECK (("part_inquiries"."requester_user_id" IS NOT NULL AND "part_inquiries"."requester_organization_id" IS NULL AND "part_inquiries"."requester_organization_kind" IS NULL)
       OR ("part_inquiries"."requester_user_id" IS NULL AND "part_inquiries"."requester_organization_id" IS NOT NULL AND "part_inquiries"."requester_organization_kind" = 'fleet')),
	CONSTRAINT "part_inquiries_status_valid" CHECK ("part_inquiries"."status" IN ('open', 'answered', 'closed')),
	CONSTRAINT "part_inquiries_quantity" CHECK ("part_inquiries"."quantity" BETWEEN 1 AND 999),
	CONSTRAINT "part_inquiries_message_length" CHECK ("part_inquiries"."message" IS NULL OR char_length("part_inquiries"."message") <= 1000),
	CONSTRAINT "part_inquiries_answer_shape" CHECK (("part_inquiries"."availability" IS NULL AND "part_inquiries"."answered_at" IS NULL AND "part_inquiries"."answer_message" IS NULL AND "part_inquiries"."quantity_available" IS NULL AND "part_inquiries"."eta_days" IS NULL)
       OR ("part_inquiries"."availability" IN ('available', 'not_available', 'can_order') AND "part_inquiries"."answered_at" IS NOT NULL
           AND ("part_inquiries"."eta_days" IS NULL OR ("part_inquiries"."availability" = 'can_order' AND "part_inquiries"."eta_days" BETWEEN 1 AND 90))
           AND ("part_inquiries"."quantity_available" IS NULL OR ("part_inquiries"."availability" = 'available' AND "part_inquiries"."quantity_available" > 0))
           AND ("part_inquiries"."answer_message" IS NULL OR char_length("part_inquiries"."answer_message") <= 1000))),
	CONSTRAINT "part_inquiries_answered_consistent" CHECK ("part_inquiries"."status" <> 'answered' OR "part_inquiries"."answered_at" IS NOT NULL)
);
--> statement-breakpoint
CREATE TABLE "parts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"branch_id" uuid,
	"name" text NOT NULL,
	"brand" text,
	"part_number" text,
	"part_number_normalized" text,
	"category" text NOT NULL,
	"condition" text NOT NULL,
	"description" text,
	"price_type" text NOT NULL,
	"currency" char(3),
	"price_amount" numeric(14, 4),
	"price_max" numeric(14, 4),
	"price_unit" text,
	"stock_status" text NOT NULL,
	"stock_quantity" integer,
	"stock_confirmed_at" timestamp with time zone DEFAULT now() NOT NULL,
	"stock_confirmed_by" uuid,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "parts_id_organization_key" UNIQUE("id","organization_id"),
	CONSTRAINT "parts_category_valid" CHECK ("parts"."category" IN ('engine', 'brakes', 'suspension_steering', 'electrical', 'filters', 'tyres_wheels', 'body', 'transmission', 'cooling', 'exhaust', 'lighting', 'fluids', 'accessories', 'other')),
	CONSTRAINT "parts_condition_valid" CHECK ("parts"."condition" IN ('new', 'used', 'refurbished')),
	CONSTRAINT "parts_stock_status_valid" CHECK ("parts"."stock_status" IN ('in_stock', 'low_stock', 'out_of_stock', 'on_order')),
	CONSTRAINT "parts_status_valid" CHECK ("parts"."status" IN ('active', 'archived')),
	CONSTRAINT "parts_name_length" CHECK (char_length("parts"."name") BETWEEN 2 AND 120),
	CONSTRAINT "parts_brand_length" CHECK ("parts"."brand" IS NULL OR char_length("parts"."brand") <= 60),
	CONSTRAINT "parts_part_number_shape" CHECK (("parts"."part_number" IS NULL AND "parts"."part_number_normalized" IS NULL)
       OR ("parts"."part_number" IS NOT NULL AND "parts"."part_number_normalized" IS NOT NULL AND char_length("parts"."part_number") BETWEEN 2 AND 40 AND "parts"."part_number_normalized" ~ '^[A-Z0-9]+$')),
	CONSTRAINT "parts_description_length" CHECK ("parts"."description" IS NULL OR char_length("parts"."description") <= 1000),
	CONSTRAINT "parts_stock_quantity" CHECK ("parts"."stock_quantity" IS NULL OR ("parts"."stock_quantity" >= 0 AND "parts"."stock_status" IN ('in_stock', 'low_stock'))),
	CONSTRAINT "parts_price_unit_valid" CHECK ("parts"."price_unit" IS NULL OR "parts"."price_unit" IN ('job', 'hour', 'day', 'night', 'km', 'litre', 'kwh', 'item', 'tyre', 'vehicle')),
	CONSTRAINT "parts_price_shape" CHECK (("parts"."price_type" IN ('fixed', 'from') AND "parts"."currency" IS NOT NULL AND "parts"."price_amount" > 0 AND "parts"."price_max" IS NULL AND "parts"."price_unit" IS NOT NULL)
       OR ("parts"."price_type" = 'range' AND "parts"."currency" IS NOT NULL AND "parts"."price_amount" > 0 AND "parts"."price_max" > "parts"."price_amount" AND "parts"."price_unit" IS NOT NULL)
       OR ("parts"."price_type" = 'quote_required' AND "parts"."currency" IS NULL AND "parts"."price_amount" IS NULL AND "parts"."price_max" IS NULL AND "parts"."price_unit" IS NULL))
);
--> statement-breakpoint
CREATE TABLE "provider_referrals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"request_id" uuid NOT NULL,
	"from_organization_id" uuid NOT NULL,
	"from_recipient_id" uuid NOT NULL,
	"to_organization_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"message" text NOT NULL,
	"relationship" text NOT NULL,
	"relationship_details" text,
	"status" text DEFAULT 'pending_consent' NOT NULL,
	"share_photos" boolean DEFAULT false NOT NULL,
	"share_outcome" boolean DEFAULT false NOT NULL,
	"consent_text" text,
	"consent_version" smallint,
	"decided_at" timestamp with time zone,
	"decided_by" uuid,
	"recipient_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_referrals_status_valid" CHECK ("provider_referrals"."status" IN ('pending_consent', 'consented', 'declined', 'withdrawn')),
	CONSTRAINT "provider_referrals_relationship_valid" CHECK ("provider_referrals"."relationship" IN ('none', 'partner', 'same_owner', 'referral_fee')),
	CONSTRAINT "provider_referrals_not_self" CHECK ("provider_referrals"."from_organization_id" <> "provider_referrals"."to_organization_id"),
	CONSTRAINT "provider_referrals_message_length" CHECK (char_length("provider_referrals"."message") BETWEEN 10 AND 1000),
	CONSTRAINT "provider_referrals_disclosure" CHECK (("provider_referrals"."relationship" = 'none' AND "provider_referrals"."relationship_details" IS NULL)
       OR ("provider_referrals"."relationship" <> 'none' AND "provider_referrals"."relationship_details" IS NOT NULL AND char_length("provider_referrals"."relationship_details") BETWEEN 3 AND 300)),
	CONSTRAINT "provider_referrals_decision_shape" CHECK (("provider_referrals"."status" = 'pending_consent' AND "provider_referrals"."decided_at" IS NULL AND "provider_referrals"."consent_text" IS NULL AND "provider_referrals"."recipient_id" IS NULL)
       OR ("provider_referrals"."status" = 'consented' AND "provider_referrals"."decided_at" IS NOT NULL AND "provider_referrals"."consent_text" IS NOT NULL AND "provider_referrals"."consent_version" IS NOT NULL)
       OR ("provider_referrals"."status" IN ('declined', 'withdrawn') AND "provider_referrals"."decided_at" IS NOT NULL AND "provider_referrals"."consent_text" IS NULL AND "provider_referrals"."recipient_id" IS NULL))
);
--> statement-breakpoint
ALTER TABLE "part_compatibility" ADD CONSTRAINT "part_compatibility_part_fk" FOREIGN KEY ("part_id","organization_id") REFERENCES "public"."parts"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_part_id_parts_id_fk" FOREIGN KEY ("part_id") REFERENCES "public"."parts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_branch_id_branches_id_fk" FOREIGN KEY ("branch_id") REFERENCES "public"."branches"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_requester_user_id_users_id_fk" FOREIGN KEY ("requester_user_id") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_answered_by_users_id_fk" FOREIGN KEY ("answered_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "part_inquiries" ADD CONSTRAINT "part_inquiries_requester_org_fk" FOREIGN KEY ("requester_organization_id","requester_organization_kind") REFERENCES "public"."organizations"("id","kind") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_stock_confirmed_by_users_id_fk" FOREIGN KEY ("stock_confirmed_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "parts" ADD CONSTRAINT "parts_branch_fk" FOREIGN KEY ("branch_id","organization_id") REFERENCES "public"."branches"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_request_id_service_requests_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."service_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_to_organization_id_provider_profiles_organization_id_fk" FOREIGN KEY ("to_organization_id") REFERENCES "public"."provider_profiles"("organization_id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_decided_by_users_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_recipient_id_service_request_recipients_id_fk" FOREIGN KEY ("recipient_id") REFERENCES "public"."service_request_recipients"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "provider_referrals" ADD CONSTRAINT "provider_referrals_from_recipient_fk" FOREIGN KEY ("from_recipient_id","from_organization_id") REFERENCES "public"."service_request_recipients"("id","organization_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "part_compatibility_org_idx" ON "part_compatibility" USING btree ("organization_id","part_id");--> statement-breakpoint
CREATE INDEX "part_compatibility_part_idx" ON "part_compatibility" USING btree ("part_id");--> statement-breakpoint
CREATE INDEX "part_compatibility_vehicle_idx" ON "part_compatibility" USING btree ("vehicle_type",lower("make"));--> statement-breakpoint
CREATE INDEX "part_inquiries_org_idx" ON "part_inquiries" USING btree ("organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "part_inquiries_requester_user_idx" ON "part_inquiries" USING btree ("requester_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "part_inquiries_requester_org_idx" ON "part_inquiries" USING btree ("requester_organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "part_inquiries_part_idx" ON "part_inquiries" USING btree ("part_id");--> statement-breakpoint
CREATE UNIQUE INDEX "part_inquiries_one_open" ON "part_inquiries" USING btree ("part_id","created_by") WHERE "part_inquiries"."status" = 'open';--> statement-breakpoint
CREATE INDEX "parts_org_idx" ON "parts" USING btree ("organization_id","status","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "parts_part_number_idx" ON "parts" USING btree ("part_number_normalized");--> statement-breakpoint
CREATE INDEX "parts_category_idx" ON "parts" USING btree ("category","stock_confirmed_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_referrals_from_idx" ON "provider_referrals" USING btree ("from_organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_referrals_to_idx" ON "provider_referrals" USING btree ("to_organization_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "provider_referrals_request_idx" ON "provider_referrals" USING btree ("request_id");--> statement-breakpoint
CREATE INDEX "provider_referrals_from_recipient_idx" ON "provider_referrals" USING btree ("from_recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_referrals_recipient_key" ON "provider_referrals" USING btree ("recipient_id");--> statement-breakpoint
CREATE UNIQUE INDEX "provider_referrals_open_key" ON "provider_referrals" USING btree ("request_id","to_organization_id") WHERE "provider_referrals"."status" IN ('pending_consent', 'consented');
CREATE TABLE "venues" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" varchar(255) NOT NULL,
	"short_name" varchar(100) NOT NULL,
	"city" varchar(50) NOT NULL,
	"district" varchar(100) NOT NULL,
	"address" text NOT NULL,
	"category" varchar(50) NOT NULL,
	"total_capacity" varchar(50) NOT NULL,
	"thumbnail_url" varchar(500),
	"description" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venue_layouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"venue_id" uuid NOT NULL,
	"name" varchar(255) NOT NULL,
	"category_name" varchar(100) NOT NULL,
	"description" text,
	"capacity_estimate" varchar(50) NOT NULL,
	"map_key" varchar(100) NOT NULL,
	"svg_content" text,
	"default_zones" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"is_default" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue_id" uuid;--> statement-breakpoint
ALTER TABLE "events" ADD COLUMN "venue_layout_id" uuid;--> statement-breakpoint
ALTER TABLE "venue_layouts" ADD CONSTRAINT "venue_layouts_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_venues_city_category" ON "venues" USING btree ("city","category");--> statement-breakpoint
CREATE INDEX "idx_venue_layouts_venue_id" ON "venue_layouts" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "idx_venue_layouts_map_key" ON "venue_layouts" USING btree ("map_key");--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "events" ADD CONSTRAINT "events_venue_layout_id_venue_layouts_id_fk" FOREIGN KEY ("venue_layout_id") REFERENCES "public"."venue_layouts"("id") ON DELETE no action ON UPDATE no action;
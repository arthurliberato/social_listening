CREATE TABLE "link_clicks" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"click_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"visitor_hash" text NOT NULL,
	"is_bot" boolean DEFAULT false NOT NULL,
	"is_unique" boolean DEFAULT false NOT NULL,
	CONSTRAINT "link_clicks_click_id_unique" UNIQUE("click_id")
);
--> statement-breakpoint
CREATE TABLE "link_conversions" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"link_id" uuid NOT NULL,
	"click_id" text NOT NULL,
	"ts" timestamp with time zone DEFAULT now() NOT NULL,
	"value_usd" integer DEFAULT 0 NOT NULL,
	"dedupe_key" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tracking_links" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"code" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tracking_links_code_unique" UNIQUE("code")
);
--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "destination_url" text;--> statement-breakpoint
ALTER TABLE "campaigns" ADD COLUMN "conversion_key" text;--> statement-breakpoint
ALTER TABLE "link_clicks" ADD CONSTRAINT "link_clicks_link_id_tracking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracking_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "link_conversions" ADD CONSTRAINT "link_conversions_link_id_tracking_links_id_fk" FOREIGN KEY ("link_id") REFERENCES "public"."tracking_links"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tracking_links" ADD CONSTRAINT "tracking_links_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "link_clicks_link_ts_idx" ON "link_clicks" USING btree ("link_id","ts");--> statement-breakpoint
CREATE UNIQUE INDEX "link_conversions_dedupe_uq" ON "link_conversions" USING btree ("link_id","dedupe_key");--> statement-breakpoint
CREATE UNIQUE INDEX "tracking_links_creator_uq" ON "tracking_links" USING btree ("campaign_id","creator_id");
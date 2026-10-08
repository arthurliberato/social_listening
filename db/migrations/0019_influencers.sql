CREATE TABLE "creators" (
	"id" integer PRIMARY KEY NOT NULL,
	"platform" text NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"bio" text NOT NULL,
	"niche" text NOT NULL,
	"tags" text[] NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"followers" integer NOT NULL,
	"engagement_rate" real NOT NULL,
	"avg_views" integer NOT NULL,
	"posts_per_week" real NOT NULL,
	"growth_30d" real NOT NULL,
	"verified" boolean NOT NULL,
	"sponsored_pct" real NOT NULL,
	"fake_follower_pct" real NOT NULL,
	"authenticity_score" smallint NOT NULL,
	"brand_safety" text NOT NULL,
	"rate_per_post_usd" integer NOT NULL,
	"avatar_seed" integer NOT NULL,
	"audience" jsonb NOT NULL,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', display_name || ' ' || handle || ' ' || bio || ' ' || niche)) STORED
);
--> statement-breakpoint
CREATE TABLE "creator_list_items" (
	"list_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_list_items_list_id_creator_id_pk" PRIMARY KEY("list_id","creator_id")
);
--> statement-breakpoint
CREATE TABLE "creator_lists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "creator_profile_views" (
	"account_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"period" text NOT NULL,
	"first_viewed_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_profile_views_account_id_creator_id_period_pk" PRIMARY KEY("account_id","creator_id","period")
);
--> statement-breakpoint
ALTER TABLE "creator_list_items" ADD CONSTRAINT "creator_list_items_list_id_creator_lists_id_fk" FOREIGN KEY ("list_id") REFERENCES "public"."creator_lists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_list_items" ADD CONSTRAINT "creator_list_items_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_lists" ADD CONSTRAINT "creator_lists_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_lists" ADD CONSTRAINT "creator_lists_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_profile_views" ADD CONSTRAINT "creator_profile_views_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creators_followers_idx" ON "creators" USING btree ("followers");--> statement-breakpoint
CREATE INDEX "creators_niche_idx" ON "creators" USING btree ("niche","followers");--> statement-breakpoint
CREATE INDEX "creators_platform_idx" ON "creators" USING btree ("platform","followers");--> statement-breakpoint
CREATE INDEX "creators_tsv_idx" ON "creators" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "creator_lists_ws_idx" ON "creator_lists" USING btree ("workspace_id");
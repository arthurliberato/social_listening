CREATE TABLE "authors" (
	"id" integer PRIMARY KEY NOT NULL,
	"source_id" smallint NOT NULL,
	"handle" text NOT NULL,
	"display_name" text NOT NULL,
	"followers" integer NOT NULL,
	"following" integer NOT NULL,
	"verified" boolean NOT NULL,
	"country" text NOT NULL,
	"language" text NOT NULL,
	"author_type" text NOT NULL,
	"bot_score" real NOT NULL,
	"bio" text NOT NULL,
	"avatar_seed" integer NOT NULL,
	"created_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "brands" (
	"id" smallint PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"short_name" text NOT NULL,
	"vertical" text NOT NULL,
	"homonym_sense" text,
	"markets" text[] NOT NULL,
	"aliases" text[] DEFAULT '{}' NOT NULL,
	"competitor_ids" smallint[] DEFAULT '{}' NOT NULL,
	CONSTRAINT "brands_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "mentions" (
	"id" bigint PRIMARY KEY NOT NULL,
	"source_id" smallint NOT NULL,
	"author_id" integer NOT NULL,
	"brand_id" smallint,
	"parent_id" bigint,
	"content_type" text NOT NULL,
	"title" text,
	"text" text NOT NULL,
	"lang" text NOT NULL,
	"country" text NOT NULL,
	"region" text NOT NULL,
	"city" text NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"url" text NOT NULL,
	"has_media" boolean NOT NULL,
	"media_alt" text,
	"detected_logos" text[] NOT NULL,
	"likes" integer NOT NULL,
	"shares" integer NOT NULL,
	"comments" integer NOT NULL,
	"views" bigint NOT NULL,
	"reach_est" bigint NOT NULL,
	"sentiment_true" text NOT NULL,
	"sentiment_pred" text NOT NULL,
	"sentiment_conf" real NOT NULL,
	"emotion_pred" text NOT NULL,
	"topics" text[] NOT NULL,
	"entities" text[] NOT NULL,
	"is_spam" boolean NOT NULL,
	"is_sarcastic" boolean NOT NULL,
	"story_id" bigint,
	"crisis_id" bigint,
	"tsv" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || text)) STORED
);
--> statement-breakpoint
CREATE TABLE "sources" (
	"id" smallint PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"display_name" text NOT NULL,
	"reach_multiplier" real NOT NULL
);
--> statement-breakpoint
CREATE TABLE "stories" (
	"id" bigint PRIMARY KEY NOT NULL,
	"type" text NOT NULL,
	"brand_id" smallint NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"peak_at" timestamp with time zone NOT NULL,
	"end_at" timestamp with time zone NOT NULL,
	"decay_half_life_hours" real NOT NULL,
	"peak_multiple" real NOT NULL,
	"keywords" text[] NOT NULL,
	"meta" jsonb
);
--> statement-breakpoint
ALTER TABLE "authors" ADD CONSTRAINT "authors_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_source_id_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "mentions" ADD CONSTRAINT "mentions_author_id_authors_id_fk" FOREIGN KEY ("author_id") REFERENCES "public"."authors"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stories" ADD CONSTRAINT "stories_brand_id_brands_id_fk" FOREIGN KEY ("brand_id") REFERENCES "public"."brands"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "mentions_published_idx" ON "mentions" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "mentions_brand_published_idx" ON "mentions" USING btree ("brand_id","published_at");--> statement-breakpoint
CREATE INDEX "mentions_tsv_idx" ON "mentions" USING gin ("tsv");--> statement-breakpoint
CREATE INDEX "mentions_story_idx" ON "mentions" USING btree ("story_id");
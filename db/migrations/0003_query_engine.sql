CREATE TABLE "query_daily_stats" (
	"query_id" uuid NOT NULL,
	"day" date NOT NULL,
	"mentions" integer NOT NULL,
	"positive" integer NOT NULL,
	"negative" integer NOT NULL,
	"neutral" integer NOT NULL,
	"mixed" integer NOT NULL,
	"reach" bigint NOT NULL,
	CONSTRAINT "query_daily_stats_query_id_day_pk" PRIMARY KEY("query_id","day")
);
--> statement-breakpoint
CREATE TABLE "query_matches" (
	"query_id" uuid NOT NULL,
	"mention_id" bigint NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"matched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "query_matches_query_id_mention_id_pk" PRIMARY KEY("query_id","mention_id")
);
--> statement-breakpoint
CREATE TABLE "usage_counters" (
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"metric" text NOT NULL,
	"value" bigint DEFAULT 0 NOT NULL,
	CONSTRAINT "usage_counters_account_id_period_metric_pk" PRIMARY KEY("account_id","period","metric")
);
--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "builder_mode" text DEFAULT 'guided' NOT NULL;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "backfill_status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "backfill_matched" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "backfilled_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "queries" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "query_daily_stats" ADD CONSTRAINT "query_daily_stats_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "query_matches" ADD CONSTRAINT "query_matches_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "usage_counters" ADD CONSTRAINT "usage_counters_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "query_matches_feed_idx" ON "query_matches" USING btree ("query_id","published_at");
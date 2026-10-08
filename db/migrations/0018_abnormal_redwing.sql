CREATE TABLE "history_packs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"query_id" uuid NOT NULL,
	"purchased_by" uuid,
	"price_cents" integer NOT NULL,
	"extra_days" integer NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"matched" integer DEFAULT 0 NOT NULL,
	"from_at" timestamp with time zone,
	"to_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "history_extra_days" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "history_packs" ADD CONSTRAINT "history_packs_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_packs" ADD CONSTRAINT "history_packs_query_id_queries_id_fk" FOREIGN KEY ("query_id") REFERENCES "public"."queries"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "history_packs" ADD CONSTRAINT "history_packs_purchased_by_users_id_fk" FOREIGN KEY ("purchased_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "history_packs_query_idx" ON "history_packs" USING btree ("query_id");
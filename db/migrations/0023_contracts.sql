CREATE TABLE "creator_contracts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"version" integer NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"terms" jsonb NOT NULL,
	"fee_usd" integer NOT NULL,
	"body_text" text NOT NULL,
	"body_hash" text NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signed_name" text,
	"signed_at" timestamp with time zone,
	"request_note" text DEFAULT '' NOT NULL,
	"responded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "creator_payout_details" (
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"holder_name" text NOT NULL,
	"last4" text NOT NULL,
	"country" text NOT NULL,
	"behavior" text DEFAULT 'ok' NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "creator_payout_details_campaign_id_creator_id_pk" PRIMARY KEY("campaign_id","creator_id")
);
--> statement-breakpoint
CREATE TABLE "creator_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"amount_usd" integer NOT NULL,
	"status" text DEFAULT 'processing' NOT NULL,
	"initiated_by" uuid,
	"initiated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settle_at" timestamp with time zone NOT NULL,
	"settled_at" timestamp with time zone,
	"failure_reason" text DEFAULT '' NOT NULL,
	"reference" text NOT NULL,
	CONSTRAINT "creator_payouts_reference_unique" UNIQUE("reference")
);
--> statement-breakpoint
ALTER TABLE "creator_contracts" ADD CONSTRAINT "creator_contracts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_contracts" ADD CONSTRAINT "creator_contracts_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payout_details" ADD CONSTRAINT "creator_payout_details_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD CONSTRAINT "creator_payouts_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "creator_payouts" ADD CONSTRAINT "creator_payouts_initiated_by_users_id_fk" FOREIGN KEY ("initiated_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "creator_contracts_creator_idx" ON "creator_contracts" USING btree ("campaign_id","creator_id","version");--> statement-breakpoint
CREATE INDEX "creator_payouts_creator_idx" ON "creator_payouts" USING btree ("campaign_id","creator_id","initiated_at");
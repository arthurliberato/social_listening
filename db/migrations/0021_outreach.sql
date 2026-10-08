CREATE TABLE "campaign_content" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"version" integer NOT NULL,
	"url" text NOT NULL,
	"caption" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'submitted' NOT NULL,
	"feedback" text DEFAULT '' NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"reviewed_at" timestamp with time zone,
	"reviewed_by" uuid
);
--> statement-breakpoint
CREATE TABLE "campaign_invites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"creator_id" integer NOT NULL,
	"token" text NOT NULL,
	"offered_usd" integer NOT NULL,
	"message" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'sent' NOT NULL,
	"counter_usd" integer,
	"creator_note" text DEFAULT '' NOT NULL,
	"sent_by" uuid,
	"sent_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"viewed_at" timestamp with time zone,
	"responded_at" timestamp with time zone,
	CONSTRAINT "campaign_invites_token_unique" UNIQUE("token")
);
--> statement-breakpoint
ALTER TABLE "campaign_content" ADD CONSTRAINT "campaign_content_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_content" ADD CONSTRAINT "campaign_content_reviewed_by_users_id_fk" FOREIGN KEY ("reviewed_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_campaign_id_campaigns_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaigns"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign_invites" ADD CONSTRAINT "campaign_invites_sent_by_users_id_fk" FOREIGN KEY ("sent_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_content_creator_idx" ON "campaign_content" USING btree ("campaign_id","creator_id","version");--> statement-breakpoint
CREATE INDEX "campaign_invites_creator_idx" ON "campaign_invites" USING btree ("campaign_id","creator_id");
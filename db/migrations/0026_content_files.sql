CREATE TABLE "campaign_content_files" (
	"content_id" uuid PRIMARY KEY NOT NULL,
	"sha256" text NOT NULL,
	"data" "bytea" NOT NULL
);
--> statement-breakpoint
ALTER TABLE "campaign_content" ADD COLUMN "file_name" text;--> statement-breakpoint
ALTER TABLE "campaign_content" ADD COLUMN "file_mime" text;--> statement-breakpoint
ALTER TABLE "campaign_content" ADD COLUMN "file_size" integer;--> statement-breakpoint
ALTER TABLE "campaign_content_files" ADD CONSTRAINT "campaign_content_files_content_id_campaign_content_id_fk" FOREIGN KEY ("content_id") REFERENCES "public"."campaign_content"("id") ON DELETE cascade ON UPDATE no action;
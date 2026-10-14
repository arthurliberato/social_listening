CREATE TABLE "survey_state" (
	"user_id" uuid NOT NULL,
	"survey_id" text NOT NULL,
	"shown_at" timestamp with time zone,
	"answered_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"open_session" text,
	"last_eval_session" text,
	CONSTRAINT "survey_state_user_id_survey_id_pk" PRIMARY KEY("user_id","survey_id")
);
--> statement-breakpoint
ALTER TABLE "survey_state" ADD CONSTRAINT "survey_state_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
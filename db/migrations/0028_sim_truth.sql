CREATE SCHEMA "sim_truth";
--> statement-breakpoint
CREATE TABLE "sim_truth"."agent_latents" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"run" text NOT NULL,
	"pu" real NOT NULL,
	"peou" real NOT NULL,
	"trust" real NOT NULL,
	"satisfaction" real NOT NULL,
	"patience" real NOT NULL,
	"response_style" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sim_truth"."latent_history" (
	"user_id" uuid NOT NULL,
	"sim_day" date NOT NULL,
	"construct" text NOT NULL,
	"value" real NOT NULL,
	CONSTRAINT "latent_history_user_id_sim_day_construct_pk" PRIMARY KEY("user_id","sim_day","construct")
);
--> statement-breakpoint
CREATE TABLE "sim_truth"."planted_effects" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "sim_truth"."planted_effects_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"flag_key" text NOT NULL,
	"variant" text NOT NULL,
	"outcome" text NOT NULL,
	"effect" real NOT NULL,
	"unit" text NOT NULL,
	"notes" text DEFAULT '' NOT NULL
);

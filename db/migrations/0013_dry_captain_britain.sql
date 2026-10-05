CREATE TABLE "author_watchlist" (
	"workspace_id" uuid NOT NULL,
	"author_id" integer NOT NULL,
	"added_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "author_watchlist_workspace_id_author_id_pk" PRIMARY KEY("workspace_id","author_id")
);
--> statement-breakpoint
ALTER TABLE "author_watchlist" ADD CONSTRAINT "author_watchlist_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "author_watchlist" ADD CONSTRAINT "author_watchlist_added_by_users_id_fk" FOREIGN KEY ("added_by") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;
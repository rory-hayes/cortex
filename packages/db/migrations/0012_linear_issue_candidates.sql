CREATE TABLE "linear_issue_candidates" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"linear_oauth_connection_id" text NOT NULL,
	"linear_workspace_id" text NOT NULL,
	"linear_issue_id" text NOT NULL,
	"identifier" text NOT NULL,
	"title" text NOT NULL,
	"body_summary" text DEFAULT '' NOT NULL,
	"comments_summary" text DEFAULT '' NOT NULL,
	"status" text NOT NULL,
	"labels" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"project_id" text,
	"project_name" text,
	"url" text,
	"linear_updated_at" timestamp with time zone NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"redaction_applied" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linear_issue_candidates_labels_array" CHECK (jsonb_typeof("linear_issue_candidates"."labels") = 'array')
);
--> statement-breakpoint
ALTER TABLE "linear_issue_candidates" ADD CONSTRAINT "linear_issue_candidates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "linear_issue_candidates" ADD CONSTRAINT "linear_issue_candidates_linear_oauth_connection_id_linear_oauth_connections_id_fk" FOREIGN KEY ("linear_oauth_connection_id") REFERENCES "public"."linear_oauth_connections"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_issue_candidates_workspace_linear_issue_unique" ON "linear_issue_candidates" USING btree ("workspace_id","linear_workspace_id","linear_issue_id");--> statement-breakpoint
CREATE INDEX "linear_issue_candidates_workspace_status_idx" ON "linear_issue_candidates" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "linear_issue_candidates_connection_sync_idx" ON "linear_issue_candidates" USING btree ("linear_oauth_connection_id","last_synced_at");

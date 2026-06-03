CREATE TYPE "public"."repo_scan_status" AS ENUM('queued', 'running', 'completed', 'failed', 'cancelled');--> statement-breakpoint
CREATE TABLE "repo_scans" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"status" "repo_scan_status" DEFAULT 'queued' NOT NULL,
	"status_summary" text DEFAULT 'Queued for repo readiness scanning.' NOT NULL,
	"inventory" jsonb DEFAULT '{"totalFileCount":0,"scannedFileCount":0,"omittedFileCount":0,"totalDirectoryCount":0,"languageSummaries":[],"packageManagerLabels":[],"ciProviderLabels":[],"documentationSummaries":[],"policySummary":{"hasPolicyFile":false,"protectedPathCount":0,"sensitivePathCount":0,"validationCommandCount":0,"dryRunCheckCount":0}}'::jsonb NOT NULL,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_recommendation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"readiness_report_id" text,
	"failure_summary" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_scans_inventory_object" CHECK (jsonb_typeof("repo_scans"."inventory") = 'object'),
	CONSTRAINT "repo_scans_finding_ids_array" CHECK (jsonb_typeof("repo_scans"."finding_ids") = 'array'),
	CONSTRAINT "repo_scans_task_recommendation_ids_array" CHECK (jsonb_typeof("repo_scans"."task_recommendation_ids") = 'array'),
	CONSTRAINT "repo_scans_running_started_at_required" CHECK ("repo_scans"."status" <> 'running' or "repo_scans"."started_at" is not null),
	CONSTRAINT "repo_scans_terminal_finished_at_required" CHECK ("repo_scans"."status" not in ('completed', 'failed', 'cancelled') or "repo_scans"."finished_at" is not null),
	CONSTRAINT "repo_scans_completed_report_required" CHECK ("repo_scans"."status" <> 'completed' or ("repo_scans"."readiness_report_id" is not null and length(btrim("repo_scans"."readiness_report_id")) > 0)),
	CONSTRAINT "repo_scans_failed_failure_summary_required" CHECK ("repo_scans"."status" <> 'failed' or ("repo_scans"."failure_summary" is not null and length(btrim("repo_scans"."failure_summary")) > 0))
);
--> statement-breakpoint
ALTER TABLE "repo_scans" ADD CONSTRAINT "repo_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_scans" ADD CONSTRAINT "repo_scans_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "repo_scans_workspace_status_idx" ON "repo_scans" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "repo_scans_repo_created_at_idx" ON "repo_scans" USING btree ("repo_id","created_at");--> statement-breakpoint
CREATE INDEX "repo_scans_workspace_created_at_idx" ON "repo_scans" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "repo_scans_readiness_report_id_idx" ON "repo_scans" USING btree ("readiness_report_id");

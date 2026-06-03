CREATE TYPE "public"."repo_execution_readiness" AS ENUM('not_ready', 'setup_required', 'planning_ready', 'setup_pr_ready', 'local_runner_ready', 'blocked');--> statement-breakpoint
CREATE TABLE "repo_readiness_reports" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"scan_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"overall_score" double precision NOT NULL,
	"category_scores" jsonb NOT NULL,
	"summary" text NOT NULL,
	"strengths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"weaknesses" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"blocked_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"recommended_next_actions" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_recommendation_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"execution_readiness" "repo_execution_readiness" NOT NULL,
	"generated_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repo_readiness_reports_overall_score_range" CHECK ("repo_readiness_reports"."overall_score" >= 0 and "repo_readiness_reports"."overall_score" <= 100),
	CONSTRAINT "repo_readiness_reports_category_scores_object" CHECK (jsonb_typeof("repo_readiness_reports"."category_scores") = 'object'),
	CONSTRAINT "repo_readiness_reports_strengths_array" CHECK (jsonb_typeof("repo_readiness_reports"."strengths") = 'array'),
	CONSTRAINT "repo_readiness_reports_weaknesses_array" CHECK (jsonb_typeof("repo_readiness_reports"."weaknesses") = 'array'),
	CONSTRAINT "repo_readiness_reports_blocked_reasons_array" CHECK (jsonb_typeof("repo_readiness_reports"."blocked_reasons") = 'array'),
	CONSTRAINT "repo_readiness_reports_recommended_next_actions_array" CHECK (jsonb_typeof("repo_readiness_reports"."recommended_next_actions") = 'array'),
	CONSTRAINT "repo_readiness_reports_finding_ids_array" CHECK (jsonb_typeof("repo_readiness_reports"."finding_ids") = 'array'),
	CONSTRAINT "repo_readiness_reports_task_recommendation_ids_array" CHECK (jsonb_typeof("repo_readiness_reports"."task_recommendation_ids") = 'array')
);
--> statement-breakpoint
ALTER TABLE "repo_readiness_reports" ADD CONSTRAINT "repo_readiness_reports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_readiness_reports" ADD CONSTRAINT "repo_readiness_reports_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_readiness_reports" ADD CONSTRAINT "repo_readiness_reports_scan_id_repo_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repo_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_readiness_reports_workspace_scan_unique" ON "repo_readiness_reports" USING btree ("workspace_id","scan_id");--> statement-breakpoint
CREATE INDEX "repo_readiness_reports_latest_idx" ON "repo_readiness_reports" USING btree ("workspace_id","repo_id","generated_at","created_at");--> statement-breakpoint
CREATE INDEX "repo_readiness_reports_workspace_repo_scan_idx" ON "repo_readiness_reports" USING btree ("workspace_id","repo_id","scan_id");
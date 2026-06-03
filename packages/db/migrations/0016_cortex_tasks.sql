CREATE TYPE "public"."cortex_task_origin_type" AS ENUM('finding', 'task_recommendation', 'manual', 'external_import');--> statement-breakpoint
CREATE TYPE "public"."cortex_task_risk_level" AS ENUM('low', 'medium', 'high', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."cortex_task_execution_mode" AS ENUM('planning_only', 'setup_pr', 'local_runner');--> statement-breakpoint
CREATE TYPE "public"."cortex_task_status" AS ENUM('draft', 'needs_review', 'approved', 'queued', 'running', 'blocked', 'pr_opened', 'completed', 'rejected', 'deferred');--> statement-breakpoint
CREATE TYPE "public"."cortex_task_approval_status" AS ENUM('not_requested', 'pending', 'approved', 'rejected', 'deferred');--> statement-breakpoint
CREATE TABLE "cortex_tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"origin_type" "cortex_task_origin_type" NOT NULL,
	"origin_external_id" text,
	"origin_external_system" text,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "cortex_task_risk_level" NOT NULL,
	"execution_mode" "cortex_task_execution_mode" NOT NULL,
	"status" "cortex_task_status" DEFAULT 'draft' NOT NULL,
	"approval_status" "cortex_task_approval_status" DEFAULT 'not_requested' NOT NULL,
	"suggested_validation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"task_recommendation_id" text,
	"task_packet_id" text,
	"run_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"latest_run_id" text,
	"pr_artifact_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"external_links" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cortex_tasks_title_non_empty" CHECK (length(btrim("cortex_tasks"."title")) > 0),
	CONSTRAINT "cortex_tasks_objective_non_empty" CHECK (length(btrim("cortex_tasks"."objective")) > 0),
	CONSTRAINT "cortex_tasks_acceptance_criteria_non_empty_array" CHECK (jsonb_typeof("cortex_tasks"."acceptance_criteria") = 'array' and jsonb_array_length("cortex_tasks"."acceptance_criteria") > 0),
	CONSTRAINT "cortex_tasks_suggested_validation_array" CHECK (jsonb_typeof("cortex_tasks"."suggested_validation") = 'array'),
	CONSTRAINT "cortex_tasks_finding_ids_array" CHECK (jsonb_typeof("cortex_tasks"."finding_ids") = 'array'),
	CONSTRAINT "cortex_tasks_run_ids_array" CHECK (jsonb_typeof("cortex_tasks"."run_ids") = 'array'),
	CONSTRAINT "cortex_tasks_latest_run_id_in_run_ids" CHECK ("cortex_tasks"."latest_run_id" is null or "cortex_tasks"."run_ids" ? "cortex_tasks"."latest_run_id"),
	CONSTRAINT "cortex_tasks_pr_artifact_ids_array" CHECK (jsonb_typeof("cortex_tasks"."pr_artifact_ids") = 'array'),
	CONSTRAINT "cortex_tasks_external_links_array" CHECK (jsonb_typeof("cortex_tasks"."external_links") = 'array'),
	CONSTRAINT "cortex_tasks_metadata_object" CHECK (jsonb_typeof("cortex_tasks"."metadata") = 'object'),
	CONSTRAINT "cortex_tasks_finding_origin_requires_finding_ids" CHECK ("cortex_tasks"."origin_type" <> 'finding' or jsonb_array_length("cortex_tasks"."finding_ids") > 0),
	CONSTRAINT "cortex_tasks_recommendation_origin_requires_task_recommendation_id" CHECK ("cortex_tasks"."origin_type" <> 'task_recommendation' or ("cortex_tasks"."task_recommendation_id" is not null and length(btrim("cortex_tasks"."task_recommendation_id")) > 0)),
	CONSTRAINT "cortex_tasks_external_origin_requires_reference" CHECK ("cortex_tasks"."origin_type" <> 'external_import' or (("cortex_tasks"."origin_external_id" is not null and length(btrim("cortex_tasks"."origin_external_id")) > 0) or jsonb_array_length("cortex_tasks"."external_links") > 0))
);
--> statement-breakpoint
ALTER TABLE "cortex_tasks" ADD CONSTRAINT "cortex_tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cortex_tasks" ADD CONSTRAINT "cortex_tasks_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cortex_tasks_workspace_status_idx" ON "cortex_tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "cortex_tasks_repo_status_idx" ON "cortex_tasks" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "cortex_tasks_approval_status_idx" ON "cortex_tasks" USING btree ("workspace_id","approval_status");--> statement-breakpoint
CREATE INDEX "cortex_tasks_execution_mode_idx" ON "cortex_tasks" USING btree ("workspace_id","execution_mode");--> statement-breakpoint
CREATE INDEX "cortex_tasks_latest_run_id_idx" ON "cortex_tasks" USING btree ("latest_run_id");--> statement-breakpoint
CREATE INDEX "cortex_tasks_task_packet_id_idx" ON "cortex_tasks" USING btree ("task_packet_id");--> statement-breakpoint
CREATE INDEX "cortex_tasks_task_recommendation_id_idx" ON "cortex_tasks" USING btree ("task_recommendation_id");

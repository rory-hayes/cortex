CREATE TYPE "public"."task_recommendation_status" AS ENUM('open', 'approved', 'ignored', 'deferred', 'converted');--> statement-breakpoint
CREATE TYPE "public"."task_recommendation_effort" AS ENUM('small', 'medium', 'large');--> statement-breakpoint
CREATE TABLE "task_recommendations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"scan_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"title" text NOT NULL,
	"objective" text NOT NULL,
	"finding_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_level" "cortex_task_risk_level" NOT NULL,
	"effort" "task_recommendation_effort" NOT NULL,
	"execution_mode" "cortex_task_execution_mode" NOT NULL,
	"suggested_validation" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"status" "task_recommendation_status" DEFAULT 'open' NOT NULL,
	"cortex_task_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_recommendations_title_non_empty" CHECK (length(btrim("task_recommendations"."title")) > 0),
	CONSTRAINT "task_recommendations_objective_non_empty" CHECK (length(btrim("task_recommendations"."objective")) > 0),
	CONSTRAINT "task_recommendations_finding_ids_non_empty_array" CHECK (jsonb_typeof("task_recommendations"."finding_ids") = 'array' and jsonb_array_length("task_recommendations"."finding_ids") > 0),
	CONSTRAINT "task_recommendations_acceptance_criteria_non_empty_array" CHECK (jsonb_typeof("task_recommendations"."acceptance_criteria") = 'array' and jsonb_array_length("task_recommendations"."acceptance_criteria") > 0),
	CONSTRAINT "task_recommendations_suggested_validation_array" CHECK (jsonb_typeof("task_recommendations"."suggested_validation") = 'array'),
	CONSTRAINT "task_recommendations_metadata_object" CHECK (jsonb_typeof("task_recommendations"."metadata") = 'object'),
	CONSTRAINT "task_recommendations_cortex_task_conversion_state" CHECK (("task_recommendations"."status" = 'converted' and "task_recommendations"."cortex_task_id" is not null and length(btrim("task_recommendations"."cortex_task_id")) > 0) or ("task_recommendations"."status" <> 'converted' and "task_recommendations"."cortex_task_id" is null))
);
--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_scan_id_repo_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repo_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_recommendations" ADD CONSTRAINT "task_recommendations_cortex_task_id_cortex_tasks_id_fk" FOREIGN KEY ("cortex_task_id") REFERENCES "public"."cortex_tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "task_recommendations_workspace_status_idx" ON "task_recommendations" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "task_recommendations_repo_status_idx" ON "task_recommendations" USING btree ("repo_id","status");--> statement-breakpoint
CREATE INDEX "task_recommendations_scan_status_idx" ON "task_recommendations" USING btree ("scan_id","status");--> statement-breakpoint
CREATE INDEX "task_recommendations_cortex_task_id_idx" ON "task_recommendations" USING btree ("cortex_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "task_recommendations_cortex_task_id_unique" ON "task_recommendations" USING btree ("cortex_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cortex_tasks_task_recommendation_id_unique" ON "cortex_tasks" USING btree ("task_recommendation_id");

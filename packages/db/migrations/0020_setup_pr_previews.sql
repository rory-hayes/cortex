CREATE TYPE "public"."setup_pr_preview_status" AS ENUM('draft', 'pr_created', 'superseded');--> statement-breakpoint
CREATE TABLE "setup_pr_previews" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"status" "setup_pr_preview_status" NOT NULL,
	"task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"excluded_template_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"files" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "setup_pr_previews_task_ids_non_empty_array" CHECK (jsonb_typeof("setup_pr_previews"."task_ids") = 'array' and jsonb_array_length("setup_pr_previews"."task_ids") > 0),
	CONSTRAINT "setup_pr_previews_excluded_task_ids_array" CHECK (jsonb_typeof("setup_pr_previews"."excluded_task_ids") = 'array'),
	CONSTRAINT "setup_pr_previews_excluded_template_ids_array" CHECK (jsonb_typeof("setup_pr_previews"."excluded_template_ids") = 'array'),
	CONSTRAINT "setup_pr_previews_files_non_empty_array" CHECK (jsonb_typeof("setup_pr_previews"."files") = 'array' and jsonb_array_length("setup_pr_previews"."files") > 0),
	CONSTRAINT "setup_pr_previews_metadata_object" CHECK (jsonb_typeof("setup_pr_previews"."metadata") = 'object')
);
--> statement-breakpoint
ALTER TABLE "setup_pr_previews" ADD CONSTRAINT "setup_pr_previews_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "setup_pr_previews" ADD CONSTRAINT "setup_pr_previews_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "setup_pr_previews_workspace_status_idx" ON "setup_pr_previews" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "setup_pr_previews_repo_status_idx" ON "setup_pr_previews" USING btree ("repo_id","status");

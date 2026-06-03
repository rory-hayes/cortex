CREATE TYPE "public"."cortex_task_external_link_provider" AS ENUM('github', 'linear', 'jira', 'docs');--> statement-breakpoint
CREATE TYPE "public"."cortex_task_external_link_resource_type" AS ENUM('github_issue', 'linear_issue', 'jira_issue', 'pull_request', 'documentation');--> statement-breakpoint
CREATE TABLE "cortex_task_external_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"cortex_task_id" text NOT NULL,
	"provider" "cortex_task_external_link_provider" NOT NULL,
	"resource_type" "cortex_task_external_link_resource_type" NOT NULL,
	"external_id" text,
	"url" text NOT NULL,
	"title" text NOT NULL,
	"external_status" text DEFAULT 'unknown' NOT NULL,
	"synced_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cortex_task_external_links_title_non_empty" CHECK (length(btrim("cortex_task_external_links"."title")) > 0),
	CONSTRAINT "cortex_task_external_links_status_non_empty" CHECK (length(btrim("cortex_task_external_links"."external_status")) > 0),
	CONSTRAINT "cortex_task_external_links_https_url" CHECK (lower("cortex_task_external_links"."url") like 'https://%'),
	CONSTRAINT "cortex_task_external_links_metadata_object" CHECK (jsonb_typeof("cortex_task_external_links"."metadata") = 'object'),
	CONSTRAINT "cortex_task_external_links_external_id_required" CHECK ("cortex_task_external_links"."resource_type" = 'documentation' or ("cortex_task_external_links"."external_id" is not null and length(btrim("cortex_task_external_links"."external_id")) > 0)),
	CONSTRAINT "cortex_task_external_links_provider_resource_match" CHECK (("cortex_task_external_links"."provider" = 'github' and "cortex_task_external_links"."resource_type" in ('github_issue', 'pull_request')) or ("cortex_task_external_links"."provider" = 'linear' and "cortex_task_external_links"."resource_type" = 'linear_issue') or ("cortex_task_external_links"."provider" = 'jira' and "cortex_task_external_links"."resource_type" = 'jira_issue') or ("cortex_task_external_links"."provider" = 'docs' and "cortex_task_external_links"."resource_type" = 'documentation'))
);
--> statement-breakpoint
ALTER TABLE "cortex_task_external_links" ADD CONSTRAINT "cortex_task_external_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cortex_task_external_links" ADD CONSTRAINT "cortex_task_external_links_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cortex_task_external_links" ADD CONSTRAINT "cortex_task_external_links_cortex_task_id_cortex_tasks_id_fk" FOREIGN KEY ("cortex_task_id") REFERENCES "public"."cortex_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cortex_task_external_links_task_lookup_idx" ON "cortex_task_external_links" USING btree ("workspace_id","cortex_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "cortex_task_external_links_provider_external_id_unique" ON "cortex_task_external_links" USING btree ("workspace_id","provider","resource_type","external_id") WHERE "external_id" IS NOT NULL;

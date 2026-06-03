CREATE TYPE "public"."dry_run_result_status" AS ENUM('passed', 'failed', 'warning');--> statement-breakpoint
CREATE TABLE "dry_run_results" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"status" "dry_run_result_status" NOT NULL,
	"checks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"capabilities" jsonb NOT NULL,
	"blockers" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"warnings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"result_created_at" timestamp with time zone NOT NULL,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dry_run_results" ADD CONSTRAINT "dry_run_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dry_run_results" ADD CONSTRAINT "dry_run_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "dry_run_results_run_id_unique" ON "dry_run_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "dry_run_results_run_id_idx" ON "dry_run_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "dry_run_results_workspace_id_status_idx" ON "dry_run_results" USING btree ("workspace_id","status");
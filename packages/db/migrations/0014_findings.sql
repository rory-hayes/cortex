CREATE TYPE "public"."finding_category" AS ENUM('product_clarity', 'agent_readiness', 'architecture', 'backlog_quality', 'validation', 'ci_cd', 'security', 'repo_hygiene', 'execution_risk', 'integration');--> statement-breakpoint
CREATE TYPE "public"."finding_severity" AS ENUM('info', 'low', 'medium', 'high', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."finding_status" AS ENUM('open', 'dismissed', 'deferred', 'resolved');--> statement-breakpoint
CREATE TYPE "public"."finding_source" AS ENUM('deterministic_rule', 'ai_summary', 'manual', 'imported');--> statement-breakpoint
CREATE TABLE "findings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"scan_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"category" "finding_category" NOT NULL,
	"severity" "finding_severity" NOT NULL,
	"status" "finding_status" DEFAULT 'open' NOT NULL,
	"title" text NOT NULL,
	"summary" text NOT NULL,
	"evidence" jsonb NOT NULL,
	"recommendation" text NOT NULL,
	"source" "finding_source" NOT NULL,
	"deterministic_rule_id" text NOT NULL,
	"confidence" double precision NOT NULL,
	"dedupe_key" text NOT NULL,
	"task_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "findings_evidence_non_empty_array" CHECK (jsonb_typeof("findings"."evidence") = 'array' and jsonb_array_length("findings"."evidence") > 0),
	CONSTRAINT "findings_task_ids_array" CHECK (jsonb_typeof("findings"."task_ids") = 'array'),
	CONSTRAINT "findings_confidence_range" CHECK ("findings"."confidence" >= 0 and "findings"."confidence" <= 1),
	CONSTRAINT "findings_dedupe_key_non_empty" CHECK (length(btrim("findings"."dedupe_key")) > 0)
);
--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "findings" ADD CONSTRAINT "findings_scan_id_repo_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."repo_scans"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "findings_workspace_repo_dedupe_unique" ON "findings" USING btree ("workspace_id","repo_id","dedupe_key");--> statement-breakpoint
CREATE INDEX "findings_workspace_scan_status_idx" ON "findings" USING btree ("workspace_id","scan_id","status");--> statement-breakpoint
CREATE INDEX "findings_workspace_repo_status_idx" ON "findings" USING btree ("workspace_id","repo_id","status");--> statement-breakpoint
CREATE INDEX "findings_scan_category_idx" ON "findings" USING btree ("scan_id","category");

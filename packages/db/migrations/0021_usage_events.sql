CREATE TYPE "public"."usage_event_type" AS ENUM('repo_scan', 'readiness_report_generation', 'task_recommendation_generation', 'setup_pr_generation', 'runner_execution');--> statement-breakpoint
CREATE TYPE "public"."usage_model_category" AS ENUM('scan', 'ai_generation', 'setup_pr', 'runner_execution');--> statement-breakpoint
CREATE TABLE "usage_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"usage_event_type" "usage_event_type" NOT NULL,
	"model_usage_category" "usage_model_category" NOT NULL,
	"quantity" integer DEFAULT 1 NOT NULL,
	"idempotency_key" text NOT NULL,
	"source_table" text,
	"source_id" text,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "usage_events_quantity_positive" CHECK ("usage_events"."quantity" > 0),
	CONSTRAINT "usage_events_metadata_object" CHECK (jsonb_typeof("usage_events"."metadata") = 'object'),
	CONSTRAINT "usage_events_source_pair" CHECK (("usage_events"."source_table" is null and "usage_events"."source_id" is null) or ("usage_events"."source_table" is not null and length(btrim("usage_events"."source_table")) > 0 and "usage_events"."source_id" is not null and length(btrim("usage_events"."source_id")) > 0))
);
--> statement-breakpoint
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "usage_events_workspace_idempotency_key_unique" ON "usage_events" USING btree ("workspace_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_occurred_at_idx" ON "usage_events" USING btree ("workspace_id","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_type_occurred_at_idx" ON "usage_events" USING btree ("workspace_id","usage_event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "usage_events_workspace_category_occurred_at_idx" ON "usage_events" USING btree ("workspace_id","model_usage_category","occurred_at");

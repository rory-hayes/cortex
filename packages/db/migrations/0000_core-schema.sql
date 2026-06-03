CREATE TYPE "public"."approval_decision" AS ENUM('approve', 'reject', 'request_repair', 'rerun_validation', 'cancel_run', 'close_run');--> statement-breakpoint
CREATE TYPE "public"."pr_artifact_status" AS ENUM('draft', 'open', 'closed', 'merged');--> statement-breakpoint
CREATE TYPE "public"."run_event_severity" AS ENUM('debug', 'info', 'warning', 'error', 'blocked');--> statement-breakpoint
CREATE TYPE "public"."run_state" AS ENUM('queued', 'claimed', 'dry_run_running', 'dry_run_passed', 'preflight', 'worktree_created', 'codex_running', 'changes_scanned', 'validation_running', 'blocked', 'cancel_requested', 'cancelling', 'cancelled', 'pushed', 'pr_opened', 'awaiting_approval', 'repair_requested', 'completed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."runner_heartbeat_status" AS ENUM('idle', 'busy', 'offline');--> statement-breakpoint
CREATE TYPE "public"."runner_job_type" AS ENUM('task', 'repair');--> statement-breakpoint
CREATE TYPE "public"."task_packet_mode" AS ENUM('dryRun', 'execute', 'repair');--> statement-breakpoint
CREATE TYPE "public"."task_packet_source_type" AS ENUM('manual', 'linear', 'repair');--> statement-breakpoint
CREATE TYPE "public"."validation_result_status" AS ENUM('passed', 'failed', 'skipped', 'cancelled');--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"actor_id" text NOT NULL,
	"decision" "approval_decision" NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"actor_id" text,
	"runner_id" text,
	"run_id" text,
	"task_id" text,
	"event_type" text NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "memberships" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"user_id" text NOT NULL,
	"role" text DEFAULT 'member' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pr_artifacts" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"branch_name" text NOT NULL,
	"pr_number" integer NOT NULL,
	"pr_url" text NOT NULL,
	"pr_title" text NOT NULL,
	"pr_status" "pr_artifact_status" NOT NULL,
	"changed_file_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "repo_mappings" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"provider" text DEFAULT 'github' NOT NULL,
	"repository_external_id" text,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"github_installation_id" text,
	"policy_snapshot" jsonb,
	"validation_commands" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"archived_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "run_events" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"runner_id" text,
	"contract_version" text NOT NULL,
	"idempotency_key" text NOT NULL,
	"state" "run_state" NOT NULL,
	"severity" "run_event_severity" NOT NULL,
	"message" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runners" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"display_name" text NOT NULL,
	"credential_hash" text NOT NULL,
	"status" "runner_heartbeat_status" DEFAULT 'offline' NOT NULL,
	"capabilities" jsonb NOT NULL,
	"last_heartbeat_at" timestamp with time zone,
	"linked_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "runs" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"task_id" text NOT NULL,
	"repo_mapping_id" text NOT NULL,
	"runner_id" text,
	"contract_version" text NOT NULL,
	"job_id" text NOT NULL,
	"job_type" "runner_job_type" NOT NULL,
	"state" "run_state" DEFAULT 'queued' NOT NULL,
	"mode" "task_packet_mode" NOT NULL,
	"claim_idempotency_key" text,
	"capabilities_snapshot" jsonb,
	"policy_snapshot" jsonb,
	"validation_commands" jsonb,
	"changed_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"risk_findings" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"cancellation_requested_at" timestamp with time zone,
	"claimed_at" timestamp with time zone,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"last_event_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_mapping_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"mode" "task_packet_mode" NOT NULL,
	"source_type" "task_packet_source_type" NOT NULL,
	"external_id" text,
	"title" text NOT NULL,
	"external_url" text,
	"objective" text NOT NULL,
	"acceptance_criteria" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"context_file_paths" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"policy_snapshot" jsonb,
	"validation_commands" jsonb,
	"status" text DEFAULT 'draft' NOT NULL,
	"requested_by_actor_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"approved_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "validation_results" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"run_id" text NOT NULL,
	"contract_version" text NOT NULL,
	"command_id" text NOT NULL,
	"command_label" text NOT NULL,
	"command" text NOT NULL,
	"status" "validation_result_status" NOT NULL,
	"exit_code" integer,
	"duration_ms" integer NOT NULL,
	"stdout_summary" text DEFAULT '' NOT NULL,
	"stderr_summary" text DEFAULT '' NOT NULL,
	"redaction_applied" boolean NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "workspaces" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"plan" text DEFAULT 'free' NOT NULL,
	"runner_limit" integer DEFAULT 1 NOT NULL,
	"repo_limit" integer DEFAULT 1 NOT NULL,
	"monthly_run_limit" integer DEFAULT 100 NOT NULL,
	"monthly_run_usage" integer DEFAULT 0 NOT NULL,
	"stripe_customer_id" text,
	"stripe_subscription_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD CONSTRAINT "pr_artifacts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD CONSTRAINT "pr_artifacts_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD CONSTRAINT "repo_mappings_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "run_events" ADD CONSTRAINT "run_events_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runners" ADD CONSTRAINT "runners_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_repo_mapping_id_repo_mappings_id_fk" FOREIGN KEY ("repo_mapping_id") REFERENCES "public"."repo_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runs" ADD CONSTRAINT "runs_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_repo_mapping_id_repo_mappings_id_fk" FOREIGN KEY ("repo_mapping_id") REFERENCES "public"."repo_mappings"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "validation_results" ADD CONSTRAINT "validation_results_run_id_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "approvals_run_id_created_at_idx" ON "approvals" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_workspace_id_created_at_idx" ON "approvals" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "approvals_actor_id_idx" ON "approvals" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_workspace_id_created_at_idx" ON "audit_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_actor_id_idx" ON "audit_events" USING btree ("actor_id");--> statement-breakpoint
CREATE INDEX "audit_events_run_id_idx" ON "audit_events" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "audit_events_task_id_idx" ON "audit_events" USING btree ("task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "memberships_workspace_id_user_id_unique" ON "memberships" USING btree ("workspace_id","user_id");--> statement-breakpoint
CREATE INDEX "memberships_user_id_idx" ON "memberships" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "pr_artifacts_run_id_unique" ON "pr_artifacts" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "pr_artifacts_workspace_id_status_idx" ON "pr_artifacts" USING btree ("workspace_id","pr_status");--> statement-breakpoint
CREATE UNIQUE INDEX "repo_mappings_workspace_provider_repository_unique" ON "repo_mappings" USING btree ("workspace_id","provider","repository_owner","repository_name");--> statement-breakpoint
CREATE INDEX "repo_mappings_workspace_id_idx" ON "repo_mappings" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "repo_mappings_lookup_idx" ON "repo_mappings" USING btree ("workspace_id","repository_owner","repository_name");--> statement-breakpoint
CREATE UNIQUE INDEX "run_events_run_id_idempotency_key_unique" ON "run_events" USING btree ("run_id","idempotency_key");--> statement-breakpoint
CREATE INDEX "run_events_run_id_created_at_idx" ON "run_events" USING btree ("run_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_workspace_id_created_at_idx" ON "run_events" USING btree ("workspace_id","created_at");--> statement-breakpoint
CREATE INDEX "run_events_workspace_id_severity_idx" ON "run_events" USING btree ("workspace_id","severity");--> statement-breakpoint
CREATE INDEX "runners_workspace_id_status_idx" ON "runners" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "runners_last_heartbeat_at_idx" ON "runners" USING btree ("last_heartbeat_at");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_claim_idempotency_key_unique" ON "runs" USING btree ("claim_idempotency_key");--> statement-breakpoint
CREATE UNIQUE INDEX "runs_workspace_id_job_id_unique" ON "runs" USING btree ("workspace_id","job_id");--> statement-breakpoint
CREATE INDEX "runs_workspace_id_state_idx" ON "runs" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "runs_task_id_idx" ON "runs" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "runs_runner_id_state_idx" ON "runs" USING btree ("runner_id","state");--> statement-breakpoint
CREATE INDEX "runs_created_at_idx" ON "runs" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "tasks_workspace_id_status_idx" ON "tasks" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "tasks_repo_mapping_id_idx" ON "tasks" USING btree ("repo_mapping_id");--> statement-breakpoint
CREATE INDEX "tasks_source_lookup_idx" ON "tasks" USING btree ("workspace_id","source_type","external_id");--> statement-breakpoint
CREATE INDEX "validation_results_run_id_idx" ON "validation_results" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "validation_results_workspace_id_status_idx" ON "validation_results" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "workspaces_plan_idx" ON "workspaces" USING btree ("plan");--> statement-breakpoint
CREATE INDEX "workspaces_stripe_customer_id_idx" ON "workspaces" USING btree ("stripe_customer_id");
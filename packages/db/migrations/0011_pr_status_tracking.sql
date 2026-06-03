ALTER TABLE "pr_artifacts" ADD COLUMN "github_review_state" text DEFAULT 'unknown' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD COLUMN "github_checks_summary" jsonb DEFAULT '{"conclusion":"unknown","totalCount":0,"passedCount":0,"failedCount":0,"pendingCount":0,"skippedCount":0}'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD COLUMN "github_synced_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD CONSTRAINT "pr_artifacts_github_review_state_valid" CHECK ("pr_artifacts"."github_review_state" in ('approved', 'changes_requested', 'review_required', 'unknown'));--> statement-breakpoint
ALTER TABLE "pr_artifacts" ADD CONSTRAINT "pr_artifacts_github_checks_summary_object" CHECK (jsonb_typeof("pr_artifacts"."github_checks_summary") = 'object');--> statement-breakpoint
CREATE INDEX "pr_artifacts_workspace_github_review_state_idx" ON "pr_artifacts" USING btree ("workspace_id","github_review_state");--> statement-breakpoint
CREATE INDEX "pr_artifacts_workspace_github_synced_at_idx" ON "pr_artifacts" USING btree ("workspace_id","github_synced_at");

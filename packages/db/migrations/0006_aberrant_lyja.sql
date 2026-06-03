ALTER TABLE "workspaces" RENAME COLUMN "monthly_run_usage" TO "usage_count";--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "plan" SET DEFAULT 'mvp';--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "runner_limit" SET DEFAULT 10;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "repo_limit" SET DEFAULT 25;--> statement-breakpoint
ALTER TABLE "workspaces" ALTER COLUMN "monthly_run_limit" SET DEFAULT 10000;
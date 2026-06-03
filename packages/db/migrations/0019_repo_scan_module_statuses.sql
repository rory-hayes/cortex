ALTER TABLE "repo_scans" ADD COLUMN "module_statuses" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "repo_scans" ADD CONSTRAINT "repo_scans_module_statuses_array" CHECK (jsonb_typeof("repo_scans"."module_statuses") = 'array');

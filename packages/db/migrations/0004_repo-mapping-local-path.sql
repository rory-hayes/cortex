DROP INDEX "repo_mappings_workspace_provider_repository_unique";--> statement-breakpoint
DROP INDEX "repo_mappings_workspace_id_idx";--> statement-breakpoint
DROP INDEX "repo_mappings_lookup_idx";--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD COLUMN "runner_id" text;--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD COLUMN "local_path" text;--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD COLUMN "remote_url" text;--> statement-breakpoint
UPDATE "repo_mappings" SET "archived_at" = COALESCE("archived_at", now()), "updated_at" = now() WHERE "runner_id" IS NULL OR "local_path" IS NULL;--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD CONSTRAINT "repo_mappings_runner_id_runners_id_fk" FOREIGN KEY ("runner_id") REFERENCES "public"."runners"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD CONSTRAINT "repo_mappings_active_runner_required" CHECK ("archived_at" IS NOT NULL OR "runner_id" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "repo_mappings" ADD CONSTRAINT "repo_mappings_active_local_path_required" CHECK ("archived_at" IS NOT NULL OR ("local_path" IS NOT NULL AND length(btrim("local_path")) > 0));--> statement-breakpoint
CREATE UNIQUE INDEX "repo_mappings_active_runner_repo_unique" ON "repo_mappings" USING btree ("workspace_id","runner_id","provider","repository_owner","repository_name") WHERE "repo_mappings"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "repo_mappings_active_runner_path_unique" ON "repo_mappings" USING btree ("workspace_id","runner_id","local_path") WHERE "repo_mappings"."archived_at" is null;--> statement-breakpoint
CREATE INDEX "repo_mappings_workspace_active_idx" ON "repo_mappings" USING btree ("workspace_id","archived_at");--> statement-breakpoint
CREATE INDEX "repo_mappings_workspace_runner_active_idx" ON "repo_mappings" USING btree ("workspace_id","runner_id","archived_at");--> statement-breakpoint
CREATE INDEX "repo_mappings_lookup_idx" ON "repo_mappings" USING btree ("workspace_id","runner_id","repository_owner","repository_name");

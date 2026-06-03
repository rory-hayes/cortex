ALTER TABLE "runs" ADD COLUMN "task_packet" jsonb;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "attempt_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "max_attempts" integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "claim_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "queued_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancellation_requested_by_actor_id" text;--> statement-breakpoint
ALTER TABLE "runs" ADD COLUMN "cancellation_reason" text;--> statement-breakpoint
CREATE INDEX "runs_queue_lookup_idx" ON "runs" USING btree ("workspace_id","repo_mapping_id","state","queued_at");
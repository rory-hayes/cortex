CREATE TABLE "repair_requests" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"previous_run_id" text NOT NULL,
	"queued_run_id" text NOT NULL,
	"requested_by_actor_id" text NOT NULL,
	"feedback" text NOT NULL,
	"attempt" integer NOT NULL,
	"max_attempts" integer DEFAULT 2 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "repair_requests_attempt_positive" CHECK ("repair_requests"."attempt" >= 1),
	CONSTRAINT "repair_requests_max_attempts_positive" CHECK ("repair_requests"."max_attempts" >= 1),
	CONSTRAINT "repair_requests_attempt_within_max_attempts" CHECK ("repair_requests"."attempt" <= "repair_requests"."max_attempts")
);
--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_previous_run_id_runs_id_fk" FOREIGN KEY ("previous_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "repair_requests" ADD CONSTRAINT "repair_requests_queued_run_id_runs_id_fk" FOREIGN KEY ("queued_run_id") REFERENCES "public"."runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "repair_requests_queued_run_id_unique" ON "repair_requests" USING btree ("queued_run_id");--> statement-breakpoint
CREATE UNIQUE INDEX "repair_requests_previous_run_id_attempt_unique" ON "repair_requests" USING btree ("previous_run_id","attempt");--> statement-breakpoint
CREATE INDEX "repair_requests_previous_run_id_created_at_idx" ON "repair_requests" USING btree ("previous_run_id","created_at");--> statement-breakpoint
CREATE INDEX "repair_requests_workspace_id_created_at_idx" ON "repair_requests" USING btree ("workspace_id","created_at");

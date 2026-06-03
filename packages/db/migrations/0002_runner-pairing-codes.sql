CREATE TABLE "runner_pairing_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"credential_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"used_at" timestamp with time zone,
	"used_by_runner_id" text,
	"created_by_actor_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "runner_pairing_codes" ADD CONSTRAINT "runner_pairing_codes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "runner_pairing_codes" ADD CONSTRAINT "runner_pairing_codes_used_by_runner_id_runners_id_fk" FOREIGN KEY ("used_by_runner_id") REFERENCES "public"."runners"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "runner_pairing_codes_credential_hash_unique" ON "runner_pairing_codes" USING btree ("credential_hash");--> statement-breakpoint
CREATE INDEX "runner_pairing_codes_active_lookup_idx" ON "runner_pairing_codes" USING btree ("credential_hash","expires_at","used_at");--> statement-breakpoint
CREATE INDEX "runner_pairing_codes_workspace_expiry_idx" ON "runner_pairing_codes" USING btree ("workspace_id","expires_at");
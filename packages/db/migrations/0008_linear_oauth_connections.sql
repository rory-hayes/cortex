CREATE TABLE "linear_oauth_connections" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"linear_workspace_id" text NOT NULL,
	"linear_workspace_name" text NOT NULL,
	"linear_actor_id" text NOT NULL,
	"scopes" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"expires_at" timestamp with time zone,
	"connected_by_actor_id" text NOT NULL,
	"connected_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_by_actor_id" text,
	"revoked_at" timestamp with time zone,
	"access_token_ciphertext" text,
	"access_token_key_id" text,
	"refresh_token_ciphertext" text,
	"refresh_token_key_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "linear_oauth_connections_active_access_token_ciphertext_required" CHECK ("linear_oauth_connections"."revoked_at" is not null or ("linear_oauth_connections"."access_token_ciphertext" is not null and length(btrim("linear_oauth_connections"."access_token_ciphertext")) > 0 and "linear_oauth_connections"."access_token_key_id" is not null and length(btrim("linear_oauth_connections"."access_token_key_id")) > 0)),
	CONSTRAINT "linear_oauth_connections_refresh_token_ciphertext_key_pair" CHECK (("linear_oauth_connections"."refresh_token_ciphertext" is null and "linear_oauth_connections"."refresh_token_key_id" is null) or ("linear_oauth_connections"."refresh_token_ciphertext" is not null and length(btrim("linear_oauth_connections"."refresh_token_ciphertext")) > 0 and "linear_oauth_connections"."refresh_token_key_id" is not null and length(btrim("linear_oauth_connections"."refresh_token_key_id")) > 0)),
	CONSTRAINT "linear_oauth_connections_revoked_credentials_cleared" CHECK ("linear_oauth_connections"."revoked_at" is null or ("linear_oauth_connections"."access_token_ciphertext" is null and "linear_oauth_connections"."access_token_key_id" is null and "linear_oauth_connections"."refresh_token_ciphertext" is null and "linear_oauth_connections"."refresh_token_key_id" is null)),
	CONSTRAINT "linear_oauth_connections_revoked_actor_pair" CHECK (("linear_oauth_connections"."revoked_at" is null and "linear_oauth_connections"."revoked_by_actor_id" is null) or ("linear_oauth_connections"."revoked_at" is not null and "linear_oauth_connections"."revoked_by_actor_id" is not null and length(btrim("linear_oauth_connections"."revoked_by_actor_id")) > 0)),
	CONSTRAINT "linear_oauth_connections_scopes_array" CHECK (jsonb_typeof("linear_oauth_connections"."scopes") = 'array')
);
--> statement-breakpoint
ALTER TABLE "linear_oauth_connections" ADD CONSTRAINT "linear_oauth_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "linear_oauth_connections_active_workspace_unique" ON "linear_oauth_connections" USING btree ("workspace_id","linear_workspace_id") WHERE "linear_oauth_connections"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "linear_oauth_connections_workspace_revoked_idx" ON "linear_oauth_connections" USING btree ("workspace_id","revoked_at");--> statement-breakpoint
CREATE INDEX "linear_oauth_connections_linear_workspace_id_idx" ON "linear_oauth_connections" USING btree ("linear_workspace_id");
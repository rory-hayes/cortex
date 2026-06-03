CREATE TABLE "github_app_installations" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"github_installation_id" text NOT NULL,
	"account_id" text NOT NULL,
	"account_login" text NOT NULL,
	"account_type" text NOT NULL,
	"account_html_url" text,
	"repository_selection" text NOT NULL,
	"permissions" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"installation_html_url" text,
	"suspended_at" timestamp with time zone,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_app_installations_permissions_object" CHECK (jsonb_typeof("github_app_installations"."permissions") = 'object'),
	CONSTRAINT "github_app_installations_repository_selection_valid" CHECK ("github_app_installations"."repository_selection" in ('all', 'selected'))
);
--> statement-breakpoint
ALTER TABLE "github_app_installations" ADD CONSTRAINT "github_app_installations_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_app_installations_workspace_installation_unique" ON "github_app_installations" USING btree ("workspace_id","github_installation_id");--> statement-breakpoint
CREATE INDEX "github_app_installations_workspace_id_idx" ON "github_app_installations" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "github_app_installations_account_id_idx" ON "github_app_installations" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "github_app_installations_account_login_idx" ON "github_app_installations" USING btree ("account_login");
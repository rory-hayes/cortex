CREATE TABLE "github_repositories" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"github_app_installation_id" text NOT NULL,
	"github_installation_id" text NOT NULL,
	"repository_external_id" text NOT NULL,
	"repository_owner" text NOT NULL,
	"repository_name" text NOT NULL,
	"repository_full_name" text NOT NULL,
	"default_branch" text NOT NULL,
	"is_private" boolean NOT NULL,
	"html_url" text,
	"visibility" text,
	"archived" boolean DEFAULT false NOT NULL,
	"disabled" boolean DEFAULT false NOT NULL,
	"last_synced_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "github_repositories_visibility_valid" CHECK ("github_repositories"."visibility" is null or "github_repositories"."visibility" in ('public', 'private', 'internal'))
);
--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "github_repositories" ADD CONSTRAINT "github_repositories_github_app_installation_id_github_app_installations_id_fk" FOREIGN KEY ("github_app_installation_id") REFERENCES "public"."github_app_installations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "github_repositories_workspace_installation_repo_unique" ON "github_repositories" USING btree ("workspace_id","github_installation_id","repository_external_id");--> statement-breakpoint
CREATE INDEX "github_repositories_workspace_id_idx" ON "github_repositories" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "github_repositories_app_installation_id_idx" ON "github_repositories" USING btree ("github_app_installation_id");--> statement-breakpoint
CREATE INDEX "github_repositories_github_installation_id_idx" ON "github_repositories" USING btree ("github_installation_id");--> statement-breakpoint
CREATE INDEX "github_repositories_owner_name_idx" ON "github_repositories" USING btree ("workspace_id","repository_owner","repository_name");
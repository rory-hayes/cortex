CREATE TABLE "finding_task_links" (
	"id" text PRIMARY KEY NOT NULL,
	"workspace_id" text NOT NULL,
	"repo_id" text NOT NULL,
	"finding_id" text NOT NULL,
	"cortex_task_id" text NOT NULL,
	"task_recommendation_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "finding_task_links_id_non_empty" CHECK (length(btrim("finding_task_links"."id")) > 0),
	CONSTRAINT "finding_task_links_workspace_id_non_empty" CHECK (length(btrim("finding_task_links"."workspace_id")) > 0),
	CONSTRAINT "finding_task_links_repo_id_non_empty" CHECK (length(btrim("finding_task_links"."repo_id")) > 0),
	CONSTRAINT "finding_task_links_finding_id_non_empty" CHECK (length(btrim("finding_task_links"."finding_id")) > 0),
	CONSTRAINT "finding_task_links_cortex_task_id_non_empty" CHECK (length(btrim("finding_task_links"."cortex_task_id")) > 0),
	CONSTRAINT "finding_task_links_task_recommendation_id_non_empty" CHECK ("finding_task_links"."task_recommendation_id" is null or length(btrim("finding_task_links"."task_recommendation_id")) > 0)
);
--> statement-breakpoint
ALTER TABLE "finding_task_links" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "finding_task_links" ADD CONSTRAINT "finding_task_links_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_task_links" ADD CONSTRAINT "finding_task_links_repo_id_github_repositories_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."github_repositories"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_task_links" ADD CONSTRAINT "finding_task_links_finding_id_findings_id_fk" FOREIGN KEY ("finding_id") REFERENCES "public"."findings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_task_links" ADD CONSTRAINT "finding_task_links_cortex_task_id_cortex_tasks_id_fk" FOREIGN KEY ("cortex_task_id") REFERENCES "public"."cortex_tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "finding_task_links" ADD CONSTRAINT "finding_task_links_task_recommendation_id_task_recommendations_id_fk" FOREIGN KEY ("task_recommendation_id") REFERENCES "public"."task_recommendations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "finding_task_links_workspace_finding_task_unique" ON "finding_task_links" USING btree ("workspace_id","finding_id","cortex_task_id");--> statement-breakpoint
CREATE INDEX "finding_task_links_finding_lookup_idx" ON "finding_task_links" USING btree ("workspace_id","finding_id");--> statement-breakpoint
CREATE INDEX "finding_task_links_task_lookup_idx" ON "finding_task_links" USING btree ("workspace_id","cortex_task_id");--> statement-breakpoint
CREATE INDEX "finding_task_links_recommendation_lookup_idx" ON "finding_task_links" USING btree ("workspace_id","task_recommendation_id") WHERE "task_recommendation_id" IS NOT NULL;--> statement-breakpoint
INSERT INTO "finding_task_links" (
	"id",
	"workspace_id",
	"repo_id",
	"finding_id",
	"cortex_task_id",
	"task_recommendation_id",
	"created_at",
	"updated_at"
)
SELECT DISTINCT ON ("findings"."workspace_id", "findings"."id", "cortex_tasks"."id")
	concat('finding_task_link:', "findings"."id", ':', "cortex_tasks"."id"),
	"findings"."workspace_id",
	"findings"."repo_id",
	"findings"."id",
	"cortex_tasks"."id",
	"cortex_tasks"."task_recommendation_id",
	least("findings"."created_at", "cortex_tasks"."created_at"),
	greatest("findings"."updated_at", "cortex_tasks"."updated_at")
FROM "findings"
INNER JOIN "cortex_tasks"
	ON "cortex_tasks"."workspace_id" = "findings"."workspace_id"
	AND "cortex_tasks"."repo_id" = "findings"."repo_id"
WHERE (
	jsonb_typeof("findings"."task_ids") = 'array'
	AND "findings"."task_ids" ? "cortex_tasks"."id"
) OR (
	jsonb_typeof("cortex_tasks"."finding_ids") = 'array'
	AND "cortex_tasks"."finding_ids" ? "findings"."id"
)
ORDER BY "findings"."workspace_id", "findings"."id", "cortex_tasks"."id", "cortex_tasks"."updated_at" DESC
ON CONFLICT ("workspace_id", "finding_id", "cortex_task_id") DO UPDATE SET
	"task_recommendation_id" = COALESCE(EXCLUDED."task_recommendation_id", "finding_task_links"."task_recommendation_id"),
	"updated_at" = greatest("finding_task_links"."updated_at", EXCLUDED."updated_at");

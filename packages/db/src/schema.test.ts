import { readFile, readdir } from "node:fs/promises";
import { getTableColumns, getTableName } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import { describe, expect, expectTypeOf, test } from "vitest";

import {
  APPROVAL_DECISIONS,
  CORTEX_TASK_APPROVAL_STATUSES,
  CORTEX_TASK_EXECUTION_MODES,
  CORTEX_TASK_EXTERNAL_LINK_PROVIDERS,
  CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
  CORTEX_TASK_ORIGIN_TYPES,
  CORTEX_TASK_RISK_LEVELS,
  CORTEX_TASK_STATUSES,
  DRY_RUN_RESULT_STATUSES,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_SOURCES,
  FINDING_STATUSES,
  PR_ARTIFACT_STATUSES,
  REPO_EXECUTION_READINESS_STATUSES,
  RUNNER_HEARTBEAT_STATUSES,
  RUNNER_JOB_TYPES,
  RUN_EVENT_SEVERITIES,
  RUN_STATES,
  REPO_SCAN_STATUSES,
  TASK_RECOMMENDATION_EFFORTS,
  TASK_RECOMMENDATION_STATUSES,
  SETUP_PR_PREVIEW_STATUSES,
  TASK_PACKET_MODES,
  TASK_PACKET_SOURCE_TYPES,
  VALIDATION_RESULT_STATUSES,
  type ApprovalDecision,
  type CortexTask,
  type CortexTaskExternalLink,
  type DryRunResult,
  type Finding,
  type RepoReadinessReport,
  type RepoScan,
  type RepoScanModuleStatus,
  type SetupPrPreview,
  type TaskRecommendation,
  type TaskPacket,
} from "@control-plane/shared";

import * as dbSchema from "./schema.js";

const requiredTables = {
  workspaces: "workspaces",
  memberships: "memberships",
  runners: "runners",
  repoMappings: "repo_mappings",
  tasks: "tasks",
  runs: "runs",
  runEvents: "run_events",
  dryRunResults: "dry_run_results",
  validationResults: "validation_results",
  prArtifacts: "pr_artifacts",
  repoScans: "repo_scans",
  findings: "findings",
  findingTaskLinks: "finding_task_links",
  repoReadinessReports: "repo_readiness_reports",
  cortexTasks: "cortex_tasks",
  cortexTaskExternalLinks: "cortex_task_external_links",
  taskRecommendations: "task_recommendations",
  setupPrPreviews: "setup_pr_previews",
  usageEvents: "usage_events",
  runnerPairingCodes: "runner_pairing_codes",
  linearOAuthConnections: "linear_oauth_connections",
  linearIssueCandidates: "linear_issue_candidates",
  githubAppInstallations: "github_app_installations",
  githubRepositories: "github_repositories",
  repairRequests: "repair_requests",
  approvals: "approvals",
  auditEvents: "audit_events",
} as const;

type SchemaTableName = keyof typeof requiredTables;
type DrizzleTable = Parameters<typeof getTableName>[0];

const schemaExports = dbSchema as Record<string, unknown>;

const getRequiredTable = (exportName: SchemaTableName): DrizzleTable => {
  const table = (dbSchema.schema as Record<string, unknown>)[exportName];

  if (table === undefined) {
    throw new Error(`schema export "${exportName}" is missing.`);
  }

  return table as DrizzleTable;
};

const getColumnNames = (exportName: SchemaTableName): string[] =>
  Object.values(getTableColumns(getRequiredTable(exportName)))
    .map((column) => column.name)
    .sort();

const getUniqueIndexSignatures = (exportName: SchemaTableName): string[] =>
  getTableConfig(getRequiredTable(exportName))
    .indexes.filter((index) => index.config.unique)
    .map((index) =>
      index.config.columns
        .map((column) => {
          const columnName = (column as { name?: unknown }).name;

          return typeof columnName === "string" ? columnName : "";
        })
        .join(","),
    )
    .sort();

const getIndexSignatures = (
  exportName: SchemaTableName,
): Array<{ columns: string; hasWhere: boolean; name: string; unique: boolean }> =>
  getTableConfig(getRequiredTable(exportName))
    .indexes.map((index) => ({
      columns: index.config.columns
        .map((column) => {
          const columnName = (column as { name?: unknown }).name;

          return typeof columnName === "string" ? columnName : "";
        })
        .join(","),
      hasWhere: (index.config as { where?: unknown }).where !== undefined,
      name: index.config.name ?? "",
      unique: Boolean(index.config.unique),
    }))
    .sort((left, right) => left.name.localeCompare(right.name));

const getForeignKeySignatures = (
  exportName: SchemaTableName,
): Array<{ columns: string; onDelete: string | undefined; references: string }> =>
  getTableConfig(getRequiredTable(exportName))
    .foreignKeys.map((foreignKey) => {
      const reference = foreignKey.reference();

      return {
        columns: reference.columns.map((column) => column.name).join(","),
        onDelete: foreignKey.onDelete,
        references: `${getTableName(reference.foreignTable)}.${reference.foreignColumns
          .map((column) => column.name)
          .join(",")}`,
      };
    })
    .sort((left, right) => left.columns.localeCompare(right.columns));

const getCheckConstraintNames = (exportName: SchemaTableName): string[] =>
  getTableConfig(getRequiredTable(exportName))
    .checks.map((checkConstraint) => checkConstraint.name)
    .sort();

describe("control plane database schema", () => {
  test("exports all required MVP coordinator tables", () => {
    expect(Object.keys(dbSchema.schema).sort()).toEqual(Object.keys(requiredTables).sort());

    for (const [exportName, tableName] of Object.entries(requiredTables) as [
      SchemaTableName,
      string,
    ][]) {
      expect(getTableName(getRequiredTable(exportName))).toBe(tableName);
    }
  });

  test("defines core columns for each coordinator table", () => {
    const requiredColumns: Record<SchemaTableName, string[]> = {
      workspaces: [
        "id",
        "name",
        "plan",
        "runner_limit",
        "repo_limit",
        "monthly_run_limit",
        "usage_count",
        "stripe_customer_id",
        "stripe_subscription_id",
        "created_at",
        "updated_at",
      ],
      memberships: ["id", "workspace_id", "user_id", "role", "created_at"],
      runners: [
        "id",
        "workspace_id",
        "display_name",
        "credential_hash",
        "status",
        "capabilities",
        "last_heartbeat_at",
        "revoked_at",
        "created_at",
        "updated_at",
      ],
      repoMappings: [
        "id",
        "workspace_id",
        "runner_id",
        "provider",
        "repository_external_id",
        "repository_owner",
        "repository_name",
        "default_branch",
        "local_path",
        "remote_url",
        "github_installation_id",
        "policy_snapshot",
        "validation_commands",
        "created_at",
        "updated_at",
        "archived_at",
      ],
      tasks: [
        "id",
        "workspace_id",
        "repo_mapping_id",
        "contract_version",
        "mode",
        "source_type",
        "external_id",
        "title",
        "objective",
        "acceptance_criteria",
        "policy_snapshot",
        "validation_commands",
        "status",
        "created_at",
        "updated_at",
      ],
      runs: [
        "id",
        "workspace_id",
        "task_id",
        "repo_mapping_id",
        "runner_id",
        "contract_version",
        "job_id",
        "job_type",
        "state",
        "mode",
        "task_packet",
        "attempt_count",
        "max_attempts",
        "claim_idempotency_key",
        "claim_expires_at",
        "capabilities_snapshot",
        "policy_snapshot",
        "validation_commands",
        "changed_paths",
        "risk_findings",
        "queued_at",
        "cancellation_requested_at",
        "cancellation_requested_by_actor_id",
        "cancellation_reason",
        "created_at",
        "updated_at",
      ],
      runEvents: [
        "id",
        "workspace_id",
        "run_id",
        "runner_id",
        "contract_version",
        "idempotency_key",
        "state",
        "severity",
        "message",
        "metadata",
        "created_at",
        "received_at",
      ],
      dryRunResults: [
        "id",
        "workspace_id",
        "run_id",
        "contract_version",
        "status",
        "checks",
        "capabilities",
        "blockers",
        "warnings",
        "result_created_at",
        "submitted_at",
        "created_at",
        "updated_at",
      ],
      validationResults: [
        "id",
        "workspace_id",
        "run_id",
        "contract_version",
        "command_id",
        "command_label",
        "command",
        "status",
        "exit_code",
        "duration_ms",
        "stdout_summary",
        "stderr_summary",
        "redaction_applied",
        "started_at",
        "finished_at",
      ],
      prArtifacts: [
        "id",
        "workspace_id",
        "run_id",
        "contract_version",
        "repository_owner",
        "repository_name",
        "branch_name",
        "pr_number",
        "pr_url",
        "pr_title",
        "pr_status",
        "github_review_state",
        "github_checks_summary",
        "github_synced_at",
        "changed_file_paths",
        "risk_findings",
        "created_at",
        "updated_at",
      ],
      repoScans: [
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "status",
        "status_summary",
        "module_statuses",
        "inventory",
        "finding_ids",
        "task_recommendation_ids",
        "readiness_report_id",
        "failure_summary",
        "created_at",
        "started_at",
        "finished_at",
        "updated_at",
      ],
      findings: [
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "category",
        "severity",
        "status",
        "title",
        "summary",
        "evidence",
        "recommendation",
        "source",
        "deterministic_rule_id",
        "confidence",
        "dedupe_key",
        "task_ids",
        "created_at",
        "updated_at",
      ],
      findingTaskLinks: [
        "id",
        "workspace_id",
        "repo_id",
        "finding_id",
        "cortex_task_id",
        "task_recommendation_id",
        "created_at",
        "updated_at",
      ],
      repoReadinessReports: [
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "overall_score",
        "category_scores",
        "summary",
        "strengths",
        "weaknesses",
        "blocked_reasons",
        "recommended_next_actions",
        "finding_ids",
        "task_recommendation_ids",
        "execution_readiness",
        "generated_at",
        "created_at",
        "updated_at",
      ],
      cortexTasks: [
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "origin_type",
        "origin_external_id",
        "origin_external_system",
        "title",
        "objective",
        "acceptance_criteria",
        "risk_level",
        "execution_mode",
        "status",
        "approval_status",
        "suggested_validation",
        "finding_ids",
        "task_recommendation_id",
        "task_packet_id",
        "run_ids",
        "latest_run_id",
        "pr_artifact_ids",
        "external_links",
        "metadata",
        "created_at",
        "updated_at",
      ],
      cortexTaskExternalLinks: [
        "id",
        "workspace_id",
        "repo_id",
        "cortex_task_id",
        "provider",
        "resource_type",
        "external_id",
        "url",
        "title",
        "external_status",
        "synced_at",
        "metadata",
        "created_at",
        "updated_at",
      ],
      taskRecommendations: [
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "title",
        "objective",
        "finding_ids",
        "acceptance_criteria",
        "risk_level",
        "effort",
        "execution_mode",
        "suggested_validation",
        "status",
        "cortex_task_id",
        "metadata",
        "created_at",
        "updated_at",
      ],
      setupPrPreviews: [
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "status",
        "task_ids",
        "excluded_task_ids",
        "excluded_template_ids",
        "files",
        "metadata",
        "created_at",
        "updated_at",
      ],
      usageEvents: [
        "id",
        "workspace_id",
        "usage_event_type",
        "model_usage_category",
        "quantity",
        "idempotency_key",
        "source_table",
        "source_id",
        "metadata",
        "occurred_at",
        "created_at",
      ],
      repairRequests: [
        "id",
        "workspace_id",
        "previous_run_id",
        "queued_run_id",
        "requested_by_actor_id",
        "feedback",
        "attempt",
        "max_attempts",
        "created_at",
        "updated_at",
      ],
      runnerPairingCodes: [
        "id",
        "workspace_id",
        "credential_hash",
        "expires_at",
        "used_at",
        "used_by_runner_id",
        "created_by_actor_id",
        "created_at",
        "updated_at",
      ],
      linearOAuthConnections: [
        "id",
        "workspace_id",
        "linear_workspace_id",
        "linear_workspace_name",
        "linear_actor_id",
        "scopes",
        "expires_at",
        "connected_by_actor_id",
        "connected_at",
        "revoked_by_actor_id",
        "revoked_at",
        "access_token_ciphertext",
        "access_token_key_id",
        "refresh_token_ciphertext",
        "refresh_token_key_id",
        "created_at",
        "updated_at",
      ],
      linearIssueCandidates: [
        "id",
        "workspace_id",
        "linear_oauth_connection_id",
        "linear_workspace_id",
        "linear_issue_id",
        "identifier",
        "title",
        "body_summary",
        "comments_summary",
        "status",
        "labels",
        "project_id",
        "project_name",
        "url",
        "linear_updated_at",
        "last_synced_at",
        "redaction_applied",
        "created_at",
        "updated_at",
      ],
      githubAppInstallations: [
        "id",
        "workspace_id",
        "github_installation_id",
        "account_id",
        "account_login",
        "account_type",
        "account_html_url",
        "repository_selection",
        "permissions",
        "installation_html_url",
        "suspended_at",
        "last_synced_at",
        "created_at",
        "updated_at",
      ],
      githubRepositories: [
        "id",
        "workspace_id",
        "github_app_installation_id",
        "github_installation_id",
        "repository_external_id",
        "repository_owner",
        "repository_name",
        "repository_full_name",
        "default_branch",
        "is_private",
        "html_url",
        "visibility",
        "archived",
        "disabled",
        "last_synced_at",
        "created_at",
        "updated_at",
      ],
      approvals: [
        "id",
        "workspace_id",
        "run_id",
        "contract_version",
        "actor_id",
        "decision",
        "reason",
        "created_at",
      ],
      auditEvents: [
        "id",
        "workspace_id",
        "actor_id",
        "runner_id",
        "run_id",
        "task_id",
        "event_type",
        "message",
        "metadata",
        "created_at",
      ],
    };

    for (const [exportName, columns] of Object.entries(requiredColumns) as [
      SchemaTableName,
      string[],
    ][]) {
      expect(getColumnNames(exportName)).toEqual(expect.arrayContaining(columns));
    }
  });

  test("models MVP billing hooks with defaulted limits and nullable Stripe ids", () => {
    type WorkspaceRow = typeof dbSchema.workspaces.$inferSelect;

    const workspaceColumns = getTableColumns(dbSchema.workspaces) as Record<
      string,
      {
        default: unknown;
        hasDefault: boolean;
        name: string;
        notNull: boolean;
      }
    >;

    expectTypeOf<WorkspaceRow["plan"]>().toEqualTypeOf<string>();
    expectTypeOf<WorkspaceRow["runnerLimit"]>().toEqualTypeOf<number>();
    expectTypeOf<WorkspaceRow["repoLimit"]>().toEqualTypeOf<number>();
    expectTypeOf<WorkspaceRow["monthlyRunLimit"]>().toEqualTypeOf<number>();
    expectTypeOf<WorkspaceRow["usageCount"]>().toEqualTypeOf<number>();
    expectTypeOf<WorkspaceRow["stripeCustomerId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<WorkspaceRow["stripeSubscriptionId"]>().toEqualTypeOf<string | null>();

    expect(workspaceColumns.plan).toMatchObject({
      default: "mvp",
      hasDefault: true,
      name: "plan",
      notNull: true,
    });
    expect(workspaceColumns.runnerLimit).toMatchObject({
      default: 10,
      hasDefault: true,
      name: "runner_limit",
      notNull: true,
    });
    expect(workspaceColumns.repoLimit).toMatchObject({
      default: 25,
      hasDefault: true,
      name: "repo_limit",
      notNull: true,
    });
    expect(workspaceColumns.monthlyRunLimit).toMatchObject({
      default: 10_000,
      hasDefault: true,
      name: "monthly_run_limit",
      notNull: true,
    });
    expect(workspaceColumns.usageCount).toMatchObject({
      default: 0,
      hasDefault: true,
      name: "usage_count",
      notNull: true,
    });
    expect(workspaceColumns.stripeCustomerId).toMatchObject({
      hasDefault: false,
      name: "stripe_customer_id",
      notNull: false,
    });
    expect(workspaceColumns.stripeSubscriptionId).toMatchObject({
      hasDefault: false,
      name: "stripe_subscription_id",
      notNull: false,
    });
    expect(workspaceColumns.monthlyRunUsage).toBeUndefined();
    expect(getColumnNames("workspaces")).not.toContain("monthly_run_usage");
  });

  test("models workspace-scoped usage events without prompts, source, raw output, or secrets", async () => {
    type UsageEventRow = typeof dbSchema.usageEvents.$inferSelect;
    const columns = getColumnNames("usageEvents");

    expect(dbSchema.usageEventTypeEnum.enumValues).toEqual([
      "repo_scan",
      "readiness_report_generation",
      "task_recommendation_generation",
      "setup_pr_generation",
      "runner_execution",
    ]);
    expect(dbSchema.usageModelCategoryEnum.enumValues).toEqual([
      "scan",
      "ai_generation",
      "setup_pr",
      "runner_execution",
    ]);
    expectTypeOf<UsageEventRow["workspaceId"]>().toEqualTypeOf<string>();
    expectTypeOf<UsageEventRow["usageEventType"]>().toEqualTypeOf<
      | "repo_scan"
      | "readiness_report_generation"
      | "task_recommendation_generation"
      | "setup_pr_generation"
      | "runner_execution"
    >();
    expectTypeOf<UsageEventRow["modelUsageCategory"]>().toEqualTypeOf<
      "scan" | "ai_generation" | "setup_pr" | "runner_execution"
    >();
    expectTypeOf<UsageEventRow["metadata"]>().toEqualTypeOf<Record<string, unknown>>();

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "usage_event_type",
        "model_usage_category",
        "quantity",
        "idempotency_key",
        "source_table",
        "source_id",
        "metadata",
        "occurred_at",
        "created_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "command",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "prompt",
        "raw_output",
        "secret",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("usageEvents")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
      ]),
    );
    expect(getUniqueIndexSignatures("usageEvents")).toContain("workspace_id,idempotency_key");
    expect(getIndexSignatures("usageEvents")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,occurred_at",
          hasWhere: false,
          name: "usage_events_workspace_occurred_at_idx",
          unique: false,
        },
        {
          columns: "workspace_id,usage_event_type,occurred_at",
          hasWhere: false,
          name: "usage_events_workspace_type_occurred_at_idx",
          unique: false,
        },
        {
          columns: "workspace_id,model_usage_category,occurred_at",
          hasWhere: false,
          name: "usage_events_workspace_category_occurred_at_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("usageEvents")).toEqual(
      expect.arrayContaining([
        "usage_events_metadata_object",
        "usage_events_quantity_positive",
        "usage_events_source_pair",
      ]),
    );

    const migration = await readFile(
      new URL("../migrations/0021_usage_events.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."usage_event_type"');
    expect(migration).toContain('CREATE TYPE "public"."usage_model_category"');
    expect(migration).toContain('CREATE TABLE "usage_events"');
    expect(migration).toContain('CONSTRAINT "usage_events_quantity_positive" CHECK');
    expect(migration).toContain('CONSTRAINT "usage_events_metadata_object" CHECK');
    expect(migration).not.toMatch(
      /\b(?:command|content|diff|log|output|patch|prompt|raw_output|secret|source|stderr|stdout|token)\b/i,
    );
  });

  test("keeps database enum values aligned with shared contracts", () => {
    const enumExpectations = [
      ["runStateEnum", RUN_STATES],
      ["runEventSeverityEnum", RUN_EVENT_SEVERITIES],
      ["taskPacketModeEnum", TASK_PACKET_MODES],
      ["taskPacketSourceTypeEnum", TASK_PACKET_SOURCE_TYPES],
      ["dryRunResultStatusEnum", DRY_RUN_RESULT_STATUSES],
      ["validationResultStatusEnum", VALIDATION_RESULT_STATUSES],
      ["approvalDecisionEnum", APPROVAL_DECISIONS],
      ["prArtifactStatusEnum", PR_ARTIFACT_STATUSES],
      ["runnerHeartbeatStatusEnum", RUNNER_HEARTBEAT_STATUSES],
      ["runnerJobTypeEnum", RUNNER_JOB_TYPES],
      ["repoScanStatusEnum", REPO_SCAN_STATUSES],
      ["findingCategoryEnum", FINDING_CATEGORIES],
      ["findingSeverityEnum", FINDING_SEVERITIES],
      ["findingStatusEnum", FINDING_STATUSES],
      ["findingSourceEnum", FINDING_SOURCES],
      ["repoExecutionReadinessEnum", REPO_EXECUTION_READINESS_STATUSES],
      ["cortexTaskExternalLinkProviderEnum", CORTEX_TASK_EXTERNAL_LINK_PROVIDERS],
      ["cortexTaskExternalLinkResourceTypeEnum", CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES],
      ["taskRecommendationStatusEnum", TASK_RECOMMENDATION_STATUSES],
      ["taskRecommendationEffortEnum", TASK_RECOMMENDATION_EFFORTS],
    ] as const;

    for (const [exportName, expectedValues] of enumExpectations) {
      const enumExport = schemaExports[exportName] as
        | { enumValues?: readonly string[] }
        | undefined;

      expect(enumExport?.enumValues).toEqual([...expectedValues]);
    }
  });

  test("enforces protocol idempotency and one PR artifact per run", () => {
    expect(getUniqueIndexSignatures("runEvents")).toContain("run_id,idempotency_key");
    expect(getUniqueIndexSignatures("dryRunResults")).toContain("run_id");
    expect(getUniqueIndexSignatures("runs")).toEqual(
      expect.arrayContaining(["claim_idempotency_key", "workspace_id,job_id"]),
    );
    expect(getUniqueIndexSignatures("runnerPairingCodes")).toContain("credential_hash");
    expect(getUniqueIndexSignatures("memberships")).toContain("workspace_id,user_id");
    expect(getUniqueIndexSignatures("prArtifacts")).toContain("run_id");
    expect(getUniqueIndexSignatures("repairRequests")).toEqual(
      expect.arrayContaining(["queued_run_id", "previous_run_id,attempt"]),
    );
  });

  test("models GitHub PR status tracking as safe metadata-only columns", () => {
    type PrArtifactRow = typeof dbSchema.prArtifacts.$inferSelect;

    const prArtifactColumns = getTableColumns(dbSchema.prArtifacts) as Record<
      string,
      {
        default: unknown;
        hasDefault: boolean;
        name: string;
        notNull: boolean;
      }
    >;

    expectTypeOf<PrArtifactRow["githubReviewState"]>().toEqualTypeOf<
      "approved" | "changes_requested" | "review_required" | "unknown"
    >();
    expectTypeOf<PrArtifactRow["githubChecksSummary"]>().toEqualTypeOf<{
      conclusion: "failing" | "passing" | "pending" | "unknown";
      failedCount: number;
      passedCount: number;
      pendingCount: number;
      skippedCount: number;
      totalCount: number;
    }>();
    expectTypeOf<PrArtifactRow["githubSyncedAt"]>().toEqualTypeOf<Date | null>();

    expect(prArtifactColumns.githubReviewState).toMatchObject({
      default: "unknown",
      hasDefault: true,
      name: "github_review_state",
      notNull: true,
    });
    expect(prArtifactColumns.githubChecksSummary).toMatchObject({
      hasDefault: true,
      name: "github_checks_summary",
      notNull: true,
    });
    const checksSummaryColumn = prArtifactColumns.githubChecksSummary;

    expect(checksSummaryColumn).toBeDefined();
    expect(JSON.stringify(checksSummaryColumn?.default)).toContain("unknown");
    expect(JSON.stringify(checksSummaryColumn?.default)).toContain("totalCount");
    expect(prArtifactColumns.githubSyncedAt).toMatchObject({
      hasDefault: false,
      name: "github_synced_at",
      notNull: false,
    });
    expect(getCheckConstraintNames("prArtifacts")).toEqual(
      expect.arrayContaining([
        "pr_artifacts_github_checks_summary_object",
        "pr_artifacts_github_review_state_valid",
      ]),
    );
    expect(getColumnNames("prArtifacts")).not.toEqual(
      expect.arrayContaining([
        "check_logs",
        "comments",
        "diff",
        "installation_access_token",
        "patch",
        "raw_pr_body",
        "source",
        "token",
      ]),
    );
  });

  test("adds a PR status tracking migration without source, diff, log, or token columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0011_pr_status_tracking.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('ADD COLUMN "github_review_state" text DEFAULT');
    expect(migration).toContain('ADD COLUMN "github_checks_summary" jsonb DEFAULT');
    expect(migration).toContain('ADD COLUMN "github_synced_at" timestamp with time zone');
    expect(migration).toContain('CONSTRAINT "pr_artifacts_github_review_state_valid" CHECK');
    expect(migration).toContain('CONSTRAINT "pr_artifacts_github_checks_summary_object" CHECK');
    expect(migration).not.toMatch(
      /\b(?:body|check_logs|comments|content|diff|installation_access_token|log|output|patch|raw_source|secret|source|stderr|stdout|token)\b/i,
    );
  });

  test("models dry-run results as one metadata-only result per run", () => {
    type DryRunResultRow = typeof dbSchema.dryRunResults.$inferSelect;

    expectTypeOf<DryRunResultRow["status"]>().toEqualTypeOf<DryRunResult["status"]>();
    expectTypeOf<DryRunResultRow["checks"]>().toEqualTypeOf<DryRunResult["checks"]>();
    expectTypeOf<DryRunResultRow["capabilities"]>().toEqualTypeOf<DryRunResult["capabilities"]>();
    expectTypeOf<DryRunResultRow["blockers"]>().toEqualTypeOf<DryRunResult["blockers"]>();
    expectTypeOf<DryRunResultRow["warnings"]>().toEqualTypeOf<DryRunResult["warnings"]>();
    expectTypeOf<DryRunResultRow["resultCreatedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<DryRunResultRow["submittedAt"]>().toEqualTypeOf<Date>();

    expect(getForeignKeySignatures("dryRunResults")).toEqual(
      expect.arrayContaining([
        {
          columns: "run_id",
          onDelete: "cascade",
          references: "runs.id",
        },
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
      ]),
    );
    expect(getIndexSignatures("dryRunResults")).toEqual(
      expect.arrayContaining([
        {
          columns: "run_id",
          hasWhere: false,
          name: "dry_run_results_run_id_idx",
          unique: false,
        },
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "dry_run_results_workspace_id_status_idx",
          unique: false,
        },
      ]),
    );
    expect(getColumnNames("dryRunResults")).not.toEqual(
      expect.arrayContaining([
        "code",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "raw_source",
        "snippet",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
  });

  test("models repo scans as GitHub-repository scoped metadata only", () => {
    type RepoScanRow = typeof dbSchema.repoScans.$inferSelect;
    const columns = getColumnNames("repoScans");

    expectTypeOf<RepoScanRow["contractVersion"]>().toEqualTypeOf<RepoScan["contractVersion"]>();
    expectTypeOf<RepoScanRow["status"]>().toEqualTypeOf<RepoScan["status"]>();
    expectTypeOf<RepoScanRow["moduleStatuses"]>().toEqualTypeOf<RepoScanModuleStatus[]>();
    expectTypeOf<RepoScanRow["inventory"]>().toEqualTypeOf<RepoScan["inventory"]>();
    expectTypeOf<RepoScanRow["findingIds"]>().toEqualTypeOf<RepoScan["findingIds"]>();
    expectTypeOf<RepoScanRow["taskRecommendationIds"]>().toEqualTypeOf<
      RepoScan["taskRecommendationIds"]
    >();
    expectTypeOf<RepoScanRow["readinessReportId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RepoScanRow["failureSummary"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RepoScanRow["startedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<RepoScanRow["finishedAt"]>().toEqualTypeOf<Date | null>();

    expect(dbSchema.repoScanStatusEnum.enumValues).toEqual([...REPO_SCAN_STATUSES]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "status",
        "status_summary",
        "module_statuses",
        "inventory",
        "finding_ids",
        "task_recommendation_ids",
        "readiness_report_id",
        "failure_summary",
        "created_at",
        "started_at",
        "finished_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_paths",
        "local_path",
        "patch",
        "path_inventory",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("repoScans")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
      ]),
    );
    expect(getIndexSignatures("repoScans")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "repo_scans_workspace_status_idx",
          unique: false,
        },
        {
          columns: "repo_id,created_at",
          hasWhere: false,
          name: "repo_scans_repo_created_at_idx",
          unique: false,
        },
        {
          columns: "workspace_id,created_at",
          hasWhere: false,
          name: "repo_scans_workspace_created_at_idx",
          unique: false,
        },
        {
          columns: "readiness_report_id",
          hasWhere: false,
          name: "repo_scans_readiness_report_id_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("repoScans")).toEqual(
      expect.arrayContaining([
        "repo_scans_inventory_object",
        "repo_scans_module_statuses_array",
        "repo_scans_finding_ids_array",
        "repo_scans_task_recommendation_ids_array",
        "repo_scans_running_started_at_required",
        "repo_scans_terminal_finished_at_required",
        "repo_scans_completed_report_required",
        "repo_scans_failed_failure_summary_required",
      ]),
    );
  });

  test("models findings as scan-linked metadata-only rows", () => {
    type FindingRow = typeof dbSchema.findings.$inferSelect;
    const columns = getColumnNames("findings");

    expectTypeOf<FindingRow["contractVersion"]>().toEqualTypeOf<Finding["contractVersion"]>();
    expectTypeOf<FindingRow["category"]>().toEqualTypeOf<Finding["category"]>();
    expectTypeOf<FindingRow["severity"]>().toEqualTypeOf<Finding["severity"]>();
    expectTypeOf<FindingRow["status"]>().toEqualTypeOf<Finding["status"]>();
    expectTypeOf<FindingRow["evidence"]>().toEqualTypeOf<Finding["evidence"]>();
    expectTypeOf<FindingRow["source"]>().toEqualTypeOf<Finding["source"]>();
    expectTypeOf<FindingRow["deterministicRuleId"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingRow["confidence"]>().toEqualTypeOf<number>();
    expectTypeOf<FindingRow["dedupeKey"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingRow["taskIds"]>().toEqualTypeOf<string[]>();

    expect(dbSchema.findingCategoryEnum.enumValues).toEqual([...FINDING_CATEGORIES]);
    expect(dbSchema.findingSeverityEnum.enumValues).toEqual([...FINDING_SEVERITIES]);
    expect(dbSchema.findingStatusEnum.enumValues).toEqual([...FINDING_STATUSES]);
    expect(dbSchema.findingSourceEnum.enumValues).toEqual([...FINDING_SOURCES]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "category",
        "severity",
        "status",
        "title",
        "summary",
        "evidence",
        "recommendation",
        "source",
        "deterministic_rule_id",
        "confidence",
        "dedupe_key",
        "task_ids",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "file_paths",
        "local_path",
        "patch",
        "path_inventory",
        "raw_output",
        "secret",
        "snippet",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("findings")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
        {
          columns: "scan_id",
          onDelete: "cascade",
          references: "repo_scans.id",
        },
      ]),
    );
    expect(getUniqueIndexSignatures("findings")).toContain("workspace_id,repo_id,dedupe_key");
    expect(getIndexSignatures("findings")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,scan_id,status",
          hasWhere: false,
          name: "findings_workspace_scan_status_idx",
          unique: false,
        },
        {
          columns: "workspace_id,repo_id,status",
          hasWhere: false,
          name: "findings_workspace_repo_status_idx",
          unique: false,
        },
        {
          columns: "scan_id,category",
          hasWhere: false,
          name: "findings_scan_category_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("findings")).toEqual(
      expect.arrayContaining([
        "findings_evidence_non_empty_array",
        "findings_task_ids_array",
        "findings_confidence_range",
        "findings_dedupe_key_non_empty",
      ]),
    );
  });

  test("adds a findings migration with metadata checks and no raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0014_findings.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."finding_category" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."finding_severity" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."finding_status" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."finding_source" AS ENUM');
    expect(migration).toContain('CREATE TABLE "findings"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"scan_id" text NOT NULL');
    expect(migration).toContain('"evidence" jsonb NOT NULL');
    expect(migration).toContain("\"task_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain('CONSTRAINT "findings_evidence_non_empty_array" CHECK');
    expect(migration).toContain('CONSTRAINT "findings_task_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "findings_confidence_range" CHECK');
    expect(migration).toContain('CONSTRAINT "findings_dedupe_key_non_empty" CHECK');
    expect(migration).toContain('CONSTRAINT "findings_workspace_id_workspaces_id_fk"');
    expect(migration).toContain('CONSTRAINT "findings_repo_id_github_repositories_id_fk"');
    expect(migration).toContain('CONSTRAINT "findings_scan_id_repo_scans_id_fk"');
    expect(migration).toContain('CREATE UNIQUE INDEX "findings_workspace_repo_dedupe_unique"');
    expect(migration).toContain('CREATE INDEX "findings_workspace_scan_status_idx"');
    expect(migration).toContain('CREATE INDEX "findings_workspace_repo_status_idx"');
    expect(migration).toContain('CREATE INDEX "findings_scan_category_idx"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet|path_inventory|file_paths)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models finding-task links as workspace-scoped metadata-only relationships", () => {
    type FindingTaskLinkRow = typeof dbSchema.findingTaskLinks.$inferSelect;
    const columns = getColumnNames("findingTaskLinks");

    expectTypeOf<FindingTaskLinkRow["workspaceId"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingTaskLinkRow["repoId"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingTaskLinkRow["findingId"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingTaskLinkRow["cortexTaskId"]>().toEqualTypeOf<string>();
    expectTypeOf<FindingTaskLinkRow["taskRecommendationId"]>().toEqualTypeOf<string | null>();

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "finding_id",
        "cortex_task_id",
        "task_recommendation_id",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("findingTaskLinks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
        {
          columns: "finding_id",
          onDelete: "cascade",
          references: "findings.id",
        },
        {
          columns: "cortex_task_id",
          onDelete: "cascade",
          references: "cortex_tasks.id",
        },
        {
          columns: "task_recommendation_id",
          onDelete: "set null",
          references: "task_recommendations.id",
        },
      ]),
    );
    expect(getUniqueIndexSignatures("findingTaskLinks")).toContain(
      "workspace_id,finding_id,cortex_task_id",
    );
    expect(getIndexSignatures("findingTaskLinks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,finding_id",
          hasWhere: false,
          name: "finding_task_links_finding_lookup_idx",
          unique: false,
        },
        {
          columns: "workspace_id,cortex_task_id",
          hasWhere: false,
          name: "finding_task_links_task_lookup_idx",
          unique: false,
        },
        {
          columns: "workspace_id,task_recommendation_id",
          hasWhere: true,
          name: "finding_task_links_recommendation_lookup_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("findingTaskLinks")).toEqual(
      expect.arrayContaining([
        "finding_task_links_id_non_empty",
        "finding_task_links_workspace_id_non_empty",
        "finding_task_links_repo_id_non_empty",
        "finding_task_links_finding_id_non_empty",
        "finding_task_links_cortex_task_id_non_empty",
        "finding_task_links_task_recommendation_id_non_empty",
      ]),
    );
  });

  test("adds a finding-task links migration without raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0022_finding_task_links.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "finding_task_links"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"finding_id" text NOT NULL');
    expect(migration).toContain('"cortex_task_id" text NOT NULL');
    expect(migration).toContain('"task_recommendation_id" text');
    expect(migration).toContain('CONSTRAINT "finding_task_links_workspace_id_workspaces_id_fk"');
    expect(migration).toContain(
      'CONSTRAINT "finding_task_links_repo_id_github_repositories_id_fk"',
    );
    expect(migration).toContain('CONSTRAINT "finding_task_links_finding_id_findings_id_fk"');
    expect(migration).toContain(
      'CONSTRAINT "finding_task_links_cortex_task_id_cortex_tasks_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "finding_task_links_task_recommendation_id_task_recommendations_id_fk"',
    );
    expect(migration).toContain('CONSTRAINT "finding_task_links_id_non_empty" CHECK');
    expect(migration).toContain('CONSTRAINT "finding_task_links_workspace_id_non_empty" CHECK');
    expect(migration).toContain('CONSTRAINT "finding_task_links_repo_id_non_empty" CHECK');
    expect(migration).toContain('CONSTRAINT "finding_task_links_finding_id_non_empty" CHECK');
    expect(migration).toContain('CONSTRAINT "finding_task_links_cortex_task_id_non_empty" CHECK');
    expect(migration).toContain(
      'CONSTRAINT "finding_task_links_task_recommendation_id_non_empty" CHECK',
    );
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "finding_task_links_workspace_finding_task_unique"',
    );
    expect(migration).toContain('CREATE INDEX "finding_task_links_finding_lookup_idx"');
    expect(migration).toContain('CREATE INDEX "finding_task_links_task_lookup_idx"');
    expect(migration).toContain('CREATE INDEX "finding_task_links_recommendation_lookup_idx"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models repo readiness reports as scan-linked metadata-only history", () => {
    type RepoReadinessReportRow = typeof dbSchema.repoReadinessReports.$inferSelect;
    const columns = getColumnNames("repoReadinessReports");

    expectTypeOf<RepoReadinessReportRow["contractVersion"]>().toEqualTypeOf<
      RepoReadinessReport["contractVersion"]
    >();
    expectTypeOf<RepoReadinessReportRow["overallScore"]>().toEqualTypeOf<number>();
    expectTypeOf<RepoReadinessReportRow["categoryScores"]>().toEqualTypeOf<
      RepoReadinessReport["categoryScores"]
    >();
    expectTypeOf<RepoReadinessReportRow["strengths"]>().toEqualTypeOf<
      RepoReadinessReport["strengths"]
    >();
    expectTypeOf<RepoReadinessReportRow["weaknesses"]>().toEqualTypeOf<
      RepoReadinessReport["weaknesses"]
    >();
    expectTypeOf<RepoReadinessReportRow["blockedReasons"]>().toEqualTypeOf<
      RepoReadinessReport["blockedReasons"]
    >();
    expectTypeOf<RepoReadinessReportRow["recommendedNextActions"]>().toEqualTypeOf<
      RepoReadinessReport["recommendedNextActions"]
    >();
    expectTypeOf<RepoReadinessReportRow["findingIds"]>().toEqualTypeOf<
      RepoReadinessReport["findingIds"]
    >();
    expectTypeOf<RepoReadinessReportRow["taskRecommendationIds"]>().toEqualTypeOf<
      RepoReadinessReport["taskRecommendationIds"]
    >();
    expectTypeOf<RepoReadinessReportRow["executionReadiness"]>().toEqualTypeOf<
      RepoReadinessReport["executionReadiness"]
    >();
    expectTypeOf<RepoReadinessReportRow["generatedAt"]>().toEqualTypeOf<Date>();

    expect(dbSchema.repoExecutionReadinessEnum.enumValues).toEqual([
      ...REPO_EXECUTION_READINESS_STATUSES,
    ]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "overall_score",
        "category_scores",
        "summary",
        "strengths",
        "weaknesses",
        "blocked_reasons",
        "recommended_next_actions",
        "finding_ids",
        "task_recommendation_ids",
        "execution_readiness",
        "generated_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "code",
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("repoReadinessReports")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
        {
          columns: "scan_id",
          onDelete: "cascade",
          references: "repo_scans.id",
        },
      ]),
    );
    expect(getUniqueIndexSignatures("repoReadinessReports")).toContain("workspace_id,scan_id");
    expect(getIndexSignatures("repoReadinessReports")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,repo_id,generated_at,created_at",
          hasWhere: false,
          name: "repo_readiness_reports_latest_idx",
          unique: false,
        },
        {
          columns: "workspace_id,repo_id,scan_id",
          hasWhere: false,
          name: "repo_readiness_reports_workspace_repo_scan_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("repoReadinessReports")).toEqual(
      expect.arrayContaining([
        "repo_readiness_reports_overall_score_range",
        "repo_readiness_reports_category_scores_object",
        "repo_readiness_reports_strengths_array",
        "repo_readiness_reports_weaknesses_array",
        "repo_readiness_reports_blocked_reasons_array",
        "repo_readiness_reports_recommended_next_actions_array",
        "repo_readiness_reports_finding_ids_array",
        "repo_readiness_reports_task_recommendation_ids_array",
      ]),
    );
  });

  test("adds a readiness reports migration with metadata checks and no raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0015_repo_readiness_reports.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."repo_execution_readiness" AS ENUM');
    expect(migration).toContain('CREATE TABLE "repo_readiness_reports"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"scan_id" text NOT NULL');
    expect(migration).toContain('"overall_score" double precision NOT NULL');
    expect(migration).toContain('"category_scores" jsonb NOT NULL');
    expect(migration).toContain('"finding_ids" jsonb DEFAULT');
    expect(migration).toContain('"task_recommendation_ids" jsonb DEFAULT');
    expect(migration).toContain('CONSTRAINT "repo_readiness_reports_overall_score_range" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_readiness_reports_category_scores_object" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_readiness_reports_finding_ids_array" CHECK');
    expect(migration).toContain(
      'CONSTRAINT "repo_readiness_reports_task_recommendation_ids_array" CHECK',
    );
    expect(migration).toContain(
      'CONSTRAINT "repo_readiness_reports_workspace_id_workspaces_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "repo_readiness_reports_repo_id_github_repositories_id_fk"',
    );
    expect(migration).toContain('CONSTRAINT "repo_readiness_reports_scan_id_repo_scans_id_fk"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "repo_readiness_reports_workspace_scan_unique"',
    );
    expect(migration).toContain('CREATE INDEX "repo_readiness_reports_latest_idx"');
    expect(migration).toContain('CREATE INDEX "repo_readiness_reports_workspace_repo_scan_idx"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet|path_inventory|file_paths)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models Cortex tasks as GitHub-repository scoped metadata-only rows", () => {
    const columns = getColumnNames("cortexTasks");

    expectTypeOf<CortexTask["origin"]["type"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_ORIGIN_TYPES)[number]
    >();
    expectTypeOf<CortexTask["riskLevel"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_RISK_LEVELS)[number]
    >();
    expectTypeOf<CortexTask["executionMode"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_EXECUTION_MODES)[number]
    >();
    expectTypeOf<CortexTask["status"]>().toEqualTypeOf<(typeof CORTEX_TASK_STATUSES)[number]>();
    expectTypeOf<CortexTask["approvalStatus"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_APPROVAL_STATUSES)[number]
    >();

    expect(
      (schemaExports.cortexTaskOriginTypeEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...CORTEX_TASK_ORIGIN_TYPES]);
    expect(
      (schemaExports.cortexTaskRiskLevelEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...CORTEX_TASK_RISK_LEVELS]);
    expect(
      (schemaExports.cortexTaskExecutionModeEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...CORTEX_TASK_EXECUTION_MODES]);
    expect(
      (schemaExports.cortexTaskStatusEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...CORTEX_TASK_STATUSES]);
    expect(
      (schemaExports.cortexTaskApprovalStatusEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...CORTEX_TASK_APPROVAL_STATUSES]);

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "origin_type",
        "origin_external_id",
        "origin_external_system",
        "title",
        "objective",
        "acceptance_criteria",
        "risk_level",
        "execution_mode",
        "status",
        "approval_status",
        "suggested_validation",
        "finding_ids",
        "task_recommendation_id",
        "task_packet_id",
        "run_ids",
        "latest_run_id",
        "pr_artifact_ids",
        "external_links",
        "metadata",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("cortexTasks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
      ]),
    );
    expect(getIndexSignatures("cortexTasks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "cortex_tasks_workspace_status_idx",
          unique: false,
        },
        {
          columns: "repo_id,status",
          hasWhere: false,
          name: "cortex_tasks_repo_status_idx",
          unique: false,
        },
        {
          columns: "workspace_id,approval_status",
          hasWhere: false,
          name: "cortex_tasks_approval_status_idx",
          unique: false,
        },
        {
          columns: "workspace_id,execution_mode",
          hasWhere: false,
          name: "cortex_tasks_execution_mode_idx",
          unique: false,
        },
        {
          columns: "latest_run_id",
          hasWhere: false,
          name: "cortex_tasks_latest_run_id_idx",
          unique: false,
        },
        {
          columns: "task_packet_id",
          hasWhere: false,
          name: "cortex_tasks_task_packet_id_idx",
          unique: false,
        },
        {
          columns: "task_recommendation_id",
          hasWhere: false,
          name: "cortex_tasks_task_recommendation_id_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("cortexTasks")).toEqual(
      expect.arrayContaining([
        "cortex_tasks_acceptance_criteria_non_empty_array",
        "cortex_tasks_suggested_validation_array",
        "cortex_tasks_finding_ids_array",
        "cortex_tasks_run_ids_array",
        "cortex_tasks_latest_run_id_in_run_ids",
        "cortex_tasks_pr_artifact_ids_array",
        "cortex_tasks_external_links_array",
        "cortex_tasks_metadata_object",
        "cortex_tasks_title_non_empty",
        "cortex_tasks_objective_non_empty",
        "cortex_tasks_finding_origin_requires_finding_ids",
        "cortex_tasks_recommendation_origin_requires_task_recommendation_id",
        "cortex_tasks_external_origin_requires_reference",
      ]),
    );
  });

  test("models normalized Cortex task external links as scoped metadata-only rows", () => {
    type CortexTaskExternalLinkRow = typeof dbSchema.cortexTaskExternalLinks.$inferSelect;
    const columns = getColumnNames("cortexTaskExternalLinks");

    expectTypeOf<CortexTaskExternalLink["provider"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_EXTERNAL_LINK_PROVIDERS)[number]
    >();
    expectTypeOf<CortexTaskExternalLink["resourceType"]>().toEqualTypeOf<
      (typeof CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES)[number]
    >();
    expectTypeOf<CortexTaskExternalLinkRow["provider"]>().toEqualTypeOf<
      CortexTaskExternalLink["provider"]
    >();
    expectTypeOf<CortexTaskExternalLinkRow["resourceType"]>().toEqualTypeOf<
      CortexTaskExternalLink["resourceType"]
    >();
    expectTypeOf<CortexTaskExternalLinkRow["externalId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<CortexTaskExternalLinkRow["syncedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<CortexTaskExternalLinkRow["metadata"]>().toEqualTypeOf<Record<string, unknown>>();

    expect(
      (schemaExports.cortexTaskExternalLinkProviderEnum as { enumValues?: readonly string[] })
        .enumValues,
    ).toEqual([...CORTEX_TASK_EXTERNAL_LINK_PROVIDERS]);
    expect(
      (schemaExports.cortexTaskExternalLinkResourceTypeEnum as { enumValues?: readonly string[] })
        .enumValues,
    ).toEqual([...CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "cortex_task_id",
        "provider",
        "resource_type",
        "external_id",
        "url",
        "title",
        "external_status",
        "synced_at",
        "metadata",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("cortexTaskExternalLinks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
        {
          columns: "cortex_task_id",
          onDelete: "cascade",
          references: "cortex_tasks.id",
        },
      ]),
    );
    expect(getIndexSignatures("cortexTaskExternalLinks")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,cortex_task_id",
          hasWhere: false,
          name: "cortex_task_external_links_task_lookup_idx",
          unique: false,
        },
        {
          columns: "workspace_id,provider,resource_type,external_id",
          hasWhere: true,
          name: "cortex_task_external_links_provider_external_id_unique",
          unique: true,
        },
      ]),
    );
    expect(getCheckConstraintNames("cortexTaskExternalLinks")).toEqual(
      expect.arrayContaining([
        "cortex_task_external_links_title_non_empty",
        "cortex_task_external_links_status_non_empty",
        "cortex_task_external_links_https_url",
        "cortex_task_external_links_metadata_object",
        "cortex_task_external_links_external_id_required",
        "cortex_task_external_links_provider_resource_match",
      ]),
    );
  });

  test("adds a Cortex tasks migration with metadata checks and no Linear/Jira or raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0016_cortex_tasks.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."cortex_task_origin_type" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."cortex_task_risk_level" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."cortex_task_execution_mode" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."cortex_task_status" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."cortex_task_approval_status" AS ENUM');
    expect(migration).toContain('CREATE TABLE "cortex_tasks"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain("\"acceptance_criteria\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"finding_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"run_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"pr_artifact_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"external_links\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(migration).toContain(
      'CONSTRAINT "cortex_tasks_acceptance_criteria_non_empty_array" CHECK',
    );
    expect(migration).toContain('CONSTRAINT "cortex_tasks_suggested_validation_array" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_finding_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_run_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_latest_run_id_in_run_ids" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_pr_artifact_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_external_links_array" CHECK');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_metadata_object" CHECK');
    expect(migration).toContain(
      'CONSTRAINT "cortex_tasks_finding_origin_requires_finding_ids" CHECK',
    );
    expect(migration).toContain(
      'CONSTRAINT "cortex_tasks_recommendation_origin_requires_task_recommendation_id" CHECK',
    );
    expect(migration).toContain(
      'CONSTRAINT "cortex_tasks_external_origin_requires_reference" CHECK',
    );
    expect(migration).toContain('CONSTRAINT "cortex_tasks_workspace_id_workspaces_id_fk"');
    expect(migration).toContain('CONSTRAINT "cortex_tasks_repo_id_github_repositories_id_fk"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_workspace_status_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_repo_status_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_approval_status_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_execution_mode_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_latest_run_id_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_task_packet_id_idx"');
    expect(migration).toContain('CREATE INDEX "cortex_tasks_task_recommendation_id_idx"');
    expect(migration).not.toMatch(/\b(?:linear|jira)_/i);
    expect(migration).not.toContain('REFERENCES "public"."tasks"');
    expect(migration).not.toContain('REFERENCES "public"."linear');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("adds a normalized Cortex task external links migration without raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0018_cortex_task_external_links.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain(
      'CREATE TYPE "public"."cortex_task_external_link_provider" AS ENUM',
    );
    expect(migration).toContain(
      'CREATE TYPE "public"."cortex_task_external_link_resource_type" AS ENUM',
    );
    expect(migration).toContain('CREATE TABLE "cortex_task_external_links"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"cortex_task_id" text NOT NULL');
    expect(migration).toContain('"provider" "cortex_task_external_link_provider" NOT NULL');
    expect(migration).toContain(
      '"resource_type" "cortex_task_external_link_resource_type" NOT NULL',
    );
    expect(migration).toContain('"external_id" text');
    expect(migration).toContain('"url" text NOT NULL');
    expect(migration).toContain('"title" text NOT NULL');
    expect(migration).toContain('"external_status" text DEFAULT');
    expect(migration).toContain('"synced_at" timestamp with time zone');
    expect(migration).toContain("\"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(migration).toContain(
      'CONSTRAINT "cortex_task_external_links_workspace_id_workspaces_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "cortex_task_external_links_repo_id_github_repositories_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "cortex_task_external_links_cortex_task_id_cortex_tasks_id_fk"',
    );
    expect(migration).toContain('CREATE INDEX "cortex_task_external_links_task_lookup_idx"');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "cortex_task_external_links_provider_external_id_unique"',
    );
    expect(migration).toContain('WHERE "external_id" IS NOT NULL');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet|command_output|logs?)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models task recommendations as scan-linked metadata-only rows", () => {
    type TaskRecommendationRow = typeof dbSchema.taskRecommendations.$inferSelect;
    const columns = getColumnNames("taskRecommendations");

    expectTypeOf<TaskRecommendationRow["contractVersion"]>().toEqualTypeOf<
      TaskRecommendation["contractVersion"]
    >();
    expectTypeOf<TaskRecommendationRow["findingIds"]>().toEqualTypeOf<
      TaskRecommendation["findingIds"]
    >();
    expectTypeOf<TaskRecommendationRow["acceptanceCriteria"]>().toEqualTypeOf<
      TaskRecommendation["acceptanceCriteria"]
    >();
    expectTypeOf<TaskRecommendationRow["riskLevel"]>().toEqualTypeOf<
      TaskRecommendation["riskLevel"]
    >();
    expectTypeOf<TaskRecommendationRow["effort"]>().toEqualTypeOf<TaskRecommendation["effort"]>();
    expectTypeOf<TaskRecommendationRow["executionMode"]>().toEqualTypeOf<
      TaskRecommendation["executionMode"]
    >();
    expectTypeOf<TaskRecommendationRow["suggestedValidation"]>().toEqualTypeOf<
      TaskRecommendation["suggestedValidation"]
    >();
    expectTypeOf<TaskRecommendationRow["status"]>().toEqualTypeOf<TaskRecommendation["status"]>();
    expectTypeOf<TaskRecommendationRow["cortexTaskId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<TaskRecommendationRow["metadata"]>().toEqualTypeOf<
      TaskRecommendation["metadata"]
    >();

    expect(
      (schemaExports.taskRecommendationStatusEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...TASK_RECOMMENDATION_STATUSES]);
    expect(
      (schemaExports.taskRecommendationEffortEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...TASK_RECOMMENDATION_EFFORTS]);
    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "scan_id",
        "contract_version",
        "title",
        "objective",
        "finding_ids",
        "acceptance_criteria",
        "risk_level",
        "effort",
        "execution_mode",
        "suggested_validation",
        "status",
        "cortex_task_id",
        "metadata",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("taskRecommendations")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
        {
          columns: "scan_id",
          onDelete: "cascade",
          references: "repo_scans.id",
        },
        {
          columns: "cortex_task_id",
          onDelete: "set null",
          references: "cortex_tasks.id",
        },
      ]),
    );
    expect(getUniqueIndexSignatures("taskRecommendations")).toContain("cortex_task_id");
    expect(getIndexSignatures("taskRecommendations")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "task_recommendations_workspace_status_idx",
          unique: false,
        },
        {
          columns: "repo_id,status",
          hasWhere: false,
          name: "task_recommendations_repo_status_idx",
          unique: false,
        },
        {
          columns: "scan_id,status",
          hasWhere: false,
          name: "task_recommendations_scan_status_idx",
          unique: false,
        },
        {
          columns: "cortex_task_id",
          hasWhere: false,
          name: "task_recommendations_cortex_task_id_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("taskRecommendations")).toEqual(
      expect.arrayContaining([
        "task_recommendations_title_non_empty",
        "task_recommendations_objective_non_empty",
        "task_recommendations_finding_ids_non_empty_array",
        "task_recommendations_acceptance_criteria_non_empty_array",
        "task_recommendations_suggested_validation_array",
        "task_recommendations_metadata_object",
        "task_recommendations_cortex_task_conversion_state",
      ]),
    );
  });

  test("adds a task recommendations migration with metadata checks and no raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0017_task_recommendations.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."task_recommendation_status" AS ENUM');
    expect(migration).toContain('CREATE TYPE "public"."task_recommendation_effort" AS ENUM');
    expect(migration).toContain('CREATE TABLE "task_recommendations"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"scan_id" text NOT NULL');
    expect(migration).toContain("\"finding_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"acceptance_criteria\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"suggested_validation\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_finding_ids_non_empty_array" CHECK',
    );
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_acceptance_criteria_non_empty_array" CHECK',
    );
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_suggested_validation_array" CHECK',
    );
    expect(migration).toContain('CONSTRAINT "task_recommendations_metadata_object" CHECK');
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_cortex_task_conversion_state" CHECK',
    );
    expect(migration).toContain('CONSTRAINT "task_recommendations_workspace_id_workspaces_id_fk"');
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_repo_id_github_repositories_id_fk"',
    );
    expect(migration).toContain('CONSTRAINT "task_recommendations_scan_id_repo_scans_id_fk"');
    expect(migration).toContain(
      'CONSTRAINT "task_recommendations_cortex_task_id_cortex_tasks_id_fk"',
    );
    expect(migration).toContain('CREATE INDEX "task_recommendations_workspace_status_idx"');
    expect(migration).toContain('CREATE INDEX "task_recommendations_repo_status_idx"');
    expect(migration).toContain('CREATE INDEX "task_recommendations_scan_status_idx"');
    expect(migration).toContain('CREATE INDEX "task_recommendations_cortex_task_id_idx"');
    expect(migration).toContain('CREATE UNIQUE INDEX "task_recommendations_cortex_task_id_unique"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models setup PR previews as persisted metadata-only rows", () => {
    type SetupPrPreviewRow = typeof dbSchema.setupPrPreviews.$inferSelect;
    const columns = getColumnNames("setupPrPreviews");

    expectTypeOf<SetupPrPreviewRow["contractVersion"]>().toEqualTypeOf<
      SetupPrPreview["contractVersion"]
    >();
    expectTypeOf<SetupPrPreviewRow["status"]>().toEqualTypeOf<SetupPrPreview["status"]>();
    expectTypeOf<SetupPrPreviewRow["taskIds"]>().toEqualTypeOf<SetupPrPreview["taskIds"]>();
    expectTypeOf<SetupPrPreviewRow["excludedTaskIds"]>().toEqualTypeOf<
      SetupPrPreview["excludedTaskIds"]
    >();
    expectTypeOf<SetupPrPreviewRow["excludedTemplateIds"]>().toEqualTypeOf<
      SetupPrPreview["excludedTemplateIds"]
    >();
    expectTypeOf<SetupPrPreviewRow["files"]>().toEqualTypeOf<SetupPrPreview["files"]>();
    expectTypeOf<SetupPrPreviewRow["metadata"]>().toEqualTypeOf<SetupPrPreview["metadata"]>();
    expect(
      (schemaExports.setupPrPreviewStatusEnum as { enumValues?: readonly string[] }).enumValues,
    ).toEqual([...SETUP_PR_PREVIEW_STATUSES]);

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "repo_id",
        "contract_version",
        "status",
        "task_ids",
        "excluded_task_ids",
        "excluded_template_ids",
        "files",
        "metadata",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "content",
        "diff",
        "file_content",
        "local_path",
        "patch",
        "raw_output",
        "secret",
        "snippet",
        "source",
        "source_code",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("setupPrPreviews")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "repo_id",
          onDelete: "cascade",
          references: "github_repositories.id",
        },
      ]),
    );
    expect(getIndexSignatures("setupPrPreviews")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "setup_pr_previews_workspace_status_idx",
          unique: false,
        },
        {
          columns: "repo_id,status",
          hasWhere: false,
          name: "setup_pr_previews_repo_status_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("setupPrPreviews")).toEqual(
      expect.arrayContaining([
        "setup_pr_previews_task_ids_non_empty_array",
        "setup_pr_previews_excluded_task_ids_array",
        "setup_pr_previews_excluded_template_ids_array",
        "setup_pr_previews_files_non_empty_array",
        "setup_pr_previews_metadata_object",
      ]),
    );
  });

  test("adds a setup PR previews migration with metadata checks and no raw artifact columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0020_setup_pr_previews.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."setup_pr_preview_status" AS ENUM');
    expect(migration).toContain('CREATE TABLE "setup_pr_previews"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain("\"task_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"excluded_task_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"excluded_template_ids\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"files\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain("\"metadata\" jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_task_ids_non_empty_array" CHECK');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_excluded_task_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_excluded_template_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_files_non_empty_array" CHECK');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_metadata_object" CHECK');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_workspace_id_workspaces_id_fk"');
    expect(migration).toContain('CONSTRAINT "setup_pr_previews_repo_id_github_repositories_id_fk"');
    expect(migration).toContain('CREATE INDEX "setup_pr_previews_workspace_status_idx"');
    expect(migration).toContain('CREATE INDEX "setup_pr_previews_repo_status_idx"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("adds a repo scan migration with lifecycle checks and no raw source columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0013_repo_scans.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TYPE "public"."repo_scan_status" AS ENUM');
    expect(migration).toContain('CREATE TABLE "repo_scans"');
    expect(migration).toContain('"workspace_id" text NOT NULL');
    expect(migration).toContain('"repo_id" text NOT NULL');
    expect(migration).toContain('"inventory" jsonb DEFAULT');
    expect(migration).toContain('"finding_ids" jsonb DEFAULT');
    expect(migration).toContain('"task_recommendation_ids" jsonb DEFAULT');
    expect(migration).toContain('CONSTRAINT "repo_scans_inventory_object" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_finding_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_task_recommendation_ids_array" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_running_started_at_required" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_terminal_finished_at_required" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_completed_report_required" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_failed_failure_summary_required" CHECK');
    expect(migration).toContain('CONSTRAINT "repo_scans_workspace_id_workspaces_id_fk"');
    expect(migration).toContain('CONSTRAINT "repo_scans_repo_id_github_repositories_id_fk"');
    expect(migration).toContain('CREATE INDEX "repo_scans_workspace_status_idx"');
    expect(migration).toContain('CREATE INDEX "repo_scans_repo_created_at_idx"');
    expect(migration).toContain('CREATE INDEX "repo_scans_workspace_created_at_idx"');
    expect(migration).toContain('CREATE INDEX "repo_scans_readiness_report_id_idx"');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:source|content|diff|patch|snippet|stdout|stderr|raw_output|local_path|file_paths|path_inventory|secret|token)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("adds a repo scan module statuses migration with an array check", async () => {
    const migration = await readFile(
      new URL("../migrations/0019_repo_scan_module_statuses.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('ALTER TABLE "repo_scans" ADD COLUMN "module_statuses" jsonb');
    expect(migration).toContain("DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain(
      'CONSTRAINT "repo_scans_module_statuses_array" CHECK (jsonb_typeof("repo_scans"."module_statuses") = \'array\')',
    );

    const unsafeColumnPattern =
      /(?:source|source_code|diff|patch|raw_output|stdout|stderr|secret|token|local_path|file_content|content|snippet)/iu;

    expect(migration).not.toMatch(unsafeColumnPattern);
  });

  test("models runner pairing codes as hashed, expiring, one-time credentials", () => {
    type RunnerPairingCodeRow = typeof dbSchema.runnerPairingCodes.$inferSelect;

    expectTypeOf<RunnerPairingCodeRow["credentialHash"]>().toEqualTypeOf<string>();
    expectTypeOf<RunnerPairingCodeRow["expiresAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<RunnerPairingCodeRow["usedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<RunnerPairingCodeRow["usedByRunnerId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RunnerPairingCodeRow["createdByActorId"]>().toEqualTypeOf<string>();

    expect(getColumnNames("runnerPairingCodes")).not.toEqual(
      expect.arrayContaining(["code", "pairing_code", "raw_code", "token", "secret"]),
    );
    expect(getForeignKeySignatures("runnerPairingCodes")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "used_by_runner_id",
          onDelete: "set null",
          references: "runners.id",
        },
      ]),
    );
    expect(getIndexSignatures("runnerPairingCodes")).toEqual(
      expect.arrayContaining([
        {
          columns: "credential_hash,expires_at,used_at",
          hasWhere: false,
          name: "runner_pairing_codes_active_lookup_idx",
          unique: false,
        },
        {
          columns: "workspace_id,expires_at",
          hasWhere: false,
          name: "runner_pairing_codes_workspace_expiry_idx",
          unique: false,
        },
      ]),
    );
  });

  test("models runner revocation separately from heartbeat status", () => {
    type RunnerRow = typeof dbSchema.runners.$inferSelect;

    expectTypeOf<RunnerRow["revokedAt"]>().toEqualTypeOf<Date | null>();
    expect(getColumnNames("runners")).toContain("revoked_at");
    expect(dbSchema.runnerHeartbeatStatusEnum.enumValues).toEqual(["idle", "busy", "offline"]);
  });

  test("models Linear OAuth connections with ciphertext-only credential storage", () => {
    const columns = getColumnNames("linearOAuthConnections");

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "linear_workspace_id",
        "linear_workspace_name",
        "linear_actor_id",
        "scopes",
        "expires_at",
        "connected_by_actor_id",
        "connected_at",
        "revoked_by_actor_id",
        "revoked_at",
        "access_token_ciphertext",
        "access_token_key_id",
        "refresh_token_ciphertext",
        "refresh_token_key_id",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "raw_payload",
        "raw_source",
        "refresh_token",
        "secret",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("linearOAuthConnections")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
      ]),
    );
    expect(getIndexSignatures("linearOAuthConnections")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,linear_workspace_id",
          hasWhere: true,
          name: "linear_oauth_connections_active_workspace_unique",
          unique: true,
        },
        {
          columns: "workspace_id,revoked_at",
          hasWhere: false,
          name: "linear_oauth_connections_workspace_revoked_idx",
          unique: false,
        },
        {
          columns: "linear_workspace_id",
          hasWhere: false,
          name: "linear_oauth_connections_linear_workspace_id_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("linearOAuthConnections")).toEqual(
      expect.arrayContaining([
        "linear_oauth_connections_active_access_token_ciphertext_required",
        "linear_oauth_connections_refresh_token_ciphertext_key_pair",
        "linear_oauth_connections_revoked_credentials_cleared",
        "linear_oauth_connections_revoked_actor_pair",
        "linear_oauth_connections_scopes_array",
      ]),
    );
  });

  test("models Linear issue candidates as bounded metadata awaiting manual approval", () => {
    const columns = getColumnNames("linearIssueCandidates");

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "linear_oauth_connection_id",
        "linear_workspace_id",
        "linear_issue_id",
        "identifier",
        "title",
        "body_summary",
        "comments_summary",
        "status",
        "labels",
        "project_id",
        "project_name",
        "url",
        "linear_updated_at",
        "last_synced_at",
        "redaction_applied",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "body",
        "code",
        "comments",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "raw_payload",
        "raw_source",
        "secret",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getUniqueIndexSignatures("linearIssueCandidates")).toContain(
      "workspace_id,linear_workspace_id,linear_issue_id",
    );
    expect(getForeignKeySignatures("linearIssueCandidates")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "linear_oauth_connection_id",
          onDelete: "cascade",
          references: "linear_oauth_connections.id",
        },
      ]),
    );
    expect(getIndexSignatures("linearIssueCandidates")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,status",
          hasWhere: false,
          name: "linear_issue_candidates_workspace_status_idx",
          unique: false,
        },
        {
          columns: "linear_oauth_connection_id,last_synced_at",
          hasWhere: false,
          name: "linear_issue_candidates_connection_sync_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("linearIssueCandidates")).toEqual(
      expect.arrayContaining(["linear_issue_candidates_labels_array"]),
    );
  });

  test("adds a Linear issue candidate migration without raw payload, source, token, or log columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0012_linear_issue_candidates.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "linear_issue_candidates"');
    expect(migration).toContain('"linear_oauth_connection_id" text NOT NULL');
    expect(migration).toContain("\"labels\" jsonb DEFAULT '[]'::jsonb NOT NULL");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "linear_issue_candidates_workspace_linear_issue_unique"',
    );
    expect(migration).toContain('"workspace_id","linear_workspace_id","linear_issue_id"');
    expect(migration).toContain('CREATE INDEX "linear_issue_candidates_workspace_status_idx"');
    expect(migration).toContain('CREATE INDEX "linear_issue_candidates_connection_sync_idx"');
    expect(migration).toContain(
      'CONSTRAINT "linear_issue_candidates_workspace_id_workspaces_id_fk"',
    );
    expect(migration).toContain(
      'CONSTRAINT "linear_issue_candidates_linear_oauth_connection_id_linear_oauth_connections_id_fk"',
    );
    expect(migration).toContain('CONSTRAINT "linear_issue_candidates_labels_array" CHECK');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:access_token|body|code|comments|content|diff|log|output|patch|raw_payload|raw_source|secret|source|stderr|stdout|token)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("models GitHub App installations as workspace-scoped metadata only", () => {
    type GitHubAppInstallationRow = typeof dbSchema.githubAppInstallations.$inferSelect;
    const columns = getColumnNames("githubAppInstallations");

    expectTypeOf<GitHubAppInstallationRow["workspaceId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubAppInstallationRow["githubInstallationId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubAppInstallationRow["accountId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubAppInstallationRow["accountLogin"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubAppInstallationRow["accountType"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubAppInstallationRow["accountHtmlUrl"]>().toEqualTypeOf<string | null>();
    expectTypeOf<GitHubAppInstallationRow["repositorySelection"]>().toEqualTypeOf<
      "all" | "selected"
    >();
    expectTypeOf<GitHubAppInstallationRow["permissions"]>().toEqualTypeOf<Record<string, string>>();
    expectTypeOf<GitHubAppInstallationRow["installationHtmlUrl"]>().toEqualTypeOf<string | null>();
    expectTypeOf<GitHubAppInstallationRow["suspendedAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<GitHubAppInstallationRow["lastSyncedAt"]>().toEqualTypeOf<Date>();

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "github_installation_id",
        "account_id",
        "account_login",
        "account_type",
        "account_html_url",
        "repository_selection",
        "permissions",
        "installation_html_url",
        "suspended_at",
        "last_synced_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "content",
        "diff",
        "installation_access_token",
        "log",
        "output",
        "patch",
        "private_key",
        "raw_payload",
        "raw_source",
        "secret",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("githubAppInstallations")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
      ]),
    );
    expect(getIndexSignatures("githubAppInstallations")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,github_installation_id",
          hasWhere: false,
          name: "github_app_installations_workspace_installation_unique",
          unique: true,
        },
        {
          columns: "workspace_id",
          hasWhere: false,
          name: "github_app_installations_workspace_id_idx",
          unique: false,
        },
        {
          columns: "account_id",
          hasWhere: false,
          name: "github_app_installations_account_id_idx",
          unique: false,
        },
        {
          columns: "account_login",
          hasWhere: false,
          name: "github_app_installations_account_login_idx",
          unique: false,
        },
      ]),
    );
    expect(getUniqueIndexSignatures("githubAppInstallations")).toContain(
      "workspace_id,github_installation_id",
    );
    expect(getCheckConstraintNames("githubAppInstallations")).toEqual(
      expect.arrayContaining([
        "github_app_installations_permissions_object",
        "github_app_installations_repository_selection_valid",
      ]),
    );
  });

  test("models GitHub repositories as installation-scoped safe metadata only", () => {
    type GitHubRepositoryRow = typeof dbSchema.githubRepositories.$inferSelect;
    const columns = getColumnNames("githubRepositories");

    expectTypeOf<GitHubRepositoryRow["workspaceId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["githubAppInstallationId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["githubInstallationId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["repositoryExternalId"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["repositoryOwner"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["repositoryName"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["repositoryFullName"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["defaultBranch"]>().toEqualTypeOf<string>();
    expectTypeOf<GitHubRepositoryRow["isPrivate"]>().toEqualTypeOf<boolean>();
    expectTypeOf<GitHubRepositoryRow["htmlUrl"]>().toEqualTypeOf<string | null>();
    expectTypeOf<GitHubRepositoryRow["visibility"]>().toEqualTypeOf<string | null>();
    expectTypeOf<GitHubRepositoryRow["archived"]>().toEqualTypeOf<boolean>();
    expectTypeOf<GitHubRepositoryRow["disabled"]>().toEqualTypeOf<boolean>();
    expectTypeOf<GitHubRepositoryRow["lastSyncedAt"]>().toEqualTypeOf<Date>();

    expect(columns).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "github_app_installation_id",
        "github_installation_id",
        "repository_external_id",
        "repository_owner",
        "repository_name",
        "repository_full_name",
        "default_branch",
        "is_private",
        "html_url",
        "visibility",
        "archived",
        "disabled",
        "last_synced_at",
        "created_at",
        "updated_at",
      ]),
    );
    expect(columns).not.toEqual(
      expect.arrayContaining([
        "access_token",
        "code",
        "content",
        "diff",
        "installation_access_token",
        "log",
        "output",
        "patch",
        "private_key",
        "raw_payload",
        "raw_source",
        "secret",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("githubRepositories")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "github_app_installation_id",
          onDelete: "cascade",
          references: "github_app_installations.id",
        },
      ]),
    );
    expect(getIndexSignatures("githubRepositories")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,github_installation_id,repository_external_id",
          hasWhere: false,
          name: "github_repositories_workspace_installation_repo_unique",
          unique: true,
        },
        {
          columns: "workspace_id",
          hasWhere: false,
          name: "github_repositories_workspace_id_idx",
          unique: false,
        },
        {
          columns: "github_app_installation_id",
          hasWhere: false,
          name: "github_repositories_app_installation_id_idx",
          unique: false,
        },
        {
          columns: "github_installation_id",
          hasWhere: false,
          name: "github_repositories_github_installation_id_idx",
          unique: false,
        },
        {
          columns: "workspace_id,repository_owner,repository_name",
          hasWhere: false,
          name: "github_repositories_owner_name_idx",
          unique: false,
        },
      ]),
    );
    expect(getUniqueIndexSignatures("githubRepositories")).toContain(
      "workspace_id,github_installation_id,repository_external_id",
    );
    expect(getCheckConstraintNames("githubRepositories")).toEqual(
      expect.arrayContaining(["github_repositories_visibility_valid"]),
    );
  });

  test("adds a GitHub repository metadata migration without raw payload, source, token, or log columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0010_github_repositories.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "github_repositories"');
    expect(migration).toContain('"github_app_installation_id" text NOT NULL');
    expect(migration).toContain('"repository_external_id" text NOT NULL');
    expect(migration).toContain('"repository_owner" text NOT NULL');
    expect(migration).toContain('"repository_name" text NOT NULL');
    expect(migration).toContain('"default_branch" text NOT NULL');
    expect(migration).toContain('"is_private" boolean NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "github_repositories_workspace_installation_repo_unique"',
    );
    expect(migration).toContain('CREATE INDEX "github_repositories_workspace_id_idx"');
    expect(migration).toContain('CREATE INDEX "github_repositories_app_installation_id_idx"');
    expect(migration).toContain('CREATE INDEX "github_repositories_github_installation_id_idx"');
    expect(migration).toContain('CREATE INDEX "github_repositories_owner_name_idx"');
    expect(migration).toContain('CONSTRAINT "github_repositories_visibility_valid" CHECK');

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:access_token|code|content|diff|installation_access_token|log|output|patch|private_key|raw_payload|raw_source|secret|source|stderr|stdout|token)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("adds a GitHub App installation migration without raw payload, source, token, or log columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0009_github_app_installations.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "github_app_installations"');
    expect(migration).toContain('"github_installation_id" text NOT NULL');
    expect(migration).toContain("\"permissions\" jsonb DEFAULT '{}'::jsonb NOT NULL");
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "github_app_installations_workspace_installation_unique"',
    );
    expect(migration).toContain('CREATE INDEX "github_app_installations_workspace_id_idx"');
    expect(migration).toContain('CREATE INDEX "github_app_installations_account_id_idx"');
    expect(migration).toContain('CREATE INDEX "github_app_installations_account_login_idx"');
    expect(migration).toContain('CONSTRAINT "github_app_installations_permissions_object" CHECK');
    expect(migration).toContain(
      'CONSTRAINT "github_app_installations_repository_selection_valid" CHECK',
    );

    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const unsafeColumnPattern =
      /^(?:access_token|code|content|diff|installation_access_token|log|output|patch|private_key|raw_payload|raw_source|secret|source|stderr|stdout|token)$/i;

    expect(columnDefinitions.filter((columnName) => unsafeColumnPattern.test(columnName))).toEqual(
      [],
    );
  });

  test("adds a Linear OAuth connection migration without raw token columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0008_linear_oauth_connections.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "linear_oauth_connections"');
    expect(migration).toContain('"access_token_ciphertext" text');
    expect(migration).toContain('"refresh_token_ciphertext" text');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "linear_oauth_connections_active_workspace_unique"',
    );
    expect(migration).toContain(
      'CONSTRAINT "linear_oauth_connections_active_access_token_ciphertext_required" CHECK',
    );
    const columnDefinitions = [...migration.matchAll(/^\t"([^"]+)"\s/gmu)].map(
      (match) => match[1] ?? "",
    );
    const allowedCredentialColumns = new Set([
      "access_token_ciphertext",
      "access_token_key_id",
      "refresh_token_ciphertext",
      "refresh_token_key_id",
    ]);
    const unsafeColumnPattern =
      /^(?:access_token|refresh_token|token|secret|raw_payload|source|diff|patch|log|stdout|stderr)$/i;

    expect(
      columnDefinitions.filter(
        (columnName) =>
          unsafeColumnPattern.test(columnName) && !allowedCredentialColumns.has(columnName),
      ),
    ).toEqual([]);
  });

  test("adds a runner revocation migration without raw credential or token columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0003_runner-revocation.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain(
      'ALTER TABLE "runners" ADD COLUMN "revoked_at" timestamp with time zone;',
    );
    expect(migration).not.toMatch(/\b(?:credential|token|secret|raw_code|pairing_code)\b/i);
  });

  test("registers every SQL migration with Drizzle metadata", async () => {
    const migrationsUrl = new URL("../migrations/", import.meta.url);
    const metadataUrl = new URL("../migrations/meta/", import.meta.url);

    const [migrationFiles, metadataFiles, journalContents] = await Promise.all([
      readdir(migrationsUrl),
      readdir(metadataUrl),
      readFile(new URL("_journal.json", metadataUrl), "utf8"),
    ]);

    const migrationTags = migrationFiles
      .filter((fileName) => /^\d{4}_.+\.sql$/.test(fileName))
      .map((fileName) => fileName.replace(/\.sql$/, ""))
      .sort();
    const migrationIndexes = migrationTags.map((tag) => tag.slice(0, 4));
    const snapshotIndexes = metadataFiles
      .filter((fileName) => /^\d{4}_snapshot\.json$/.test(fileName))
      .map((fileName) => fileName.slice(0, 4))
      .sort();
    const journal = JSON.parse(journalContents) as {
      entries?: Array<{ idx?: unknown; tag?: unknown }>;
    };
    const journalTags = (journal.entries ?? [])
      .map((entry) => entry.tag)
      .filter((tag): tag is string => typeof tag === "string")
      .sort();

    expect(journalTags).toEqual(migrationTags);
    expect(snapshotIndexes).toEqual(migrationIndexes);
  });

  test("models runs as durable manual queue rows for runner polling", () => {
    type RunRow = typeof dbSchema.runs.$inferSelect;

    expectTypeOf<RunRow["taskPacket"]>().toEqualTypeOf<TaskPacket | null>();
    expectTypeOf<RunRow["attemptCount"]>().toEqualTypeOf<number>();
    expectTypeOf<RunRow["maxAttempts"]>().toEqualTypeOf<number>();
    expectTypeOf<RunRow["claimExpiresAt"]>().toEqualTypeOf<Date | null>();
    expectTypeOf<RunRow["queuedAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<RunRow["cancellationRequestedByActorId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RunRow["cancellationReason"]>().toEqualTypeOf<string | null>();

    expect(getIndexSignatures("runs")).toContainEqual({
      columns: "workspace_id,repo_mapping_id,state,queued_at",
      hasWhere: false,
      name: "runs_queue_lookup_idx",
      unique: false,
    });
  });

  test("models approval decisions as shared-contract rows with safe lookup indexes", () => {
    type ApprovalRow = typeof dbSchema.approvals.$inferSelect;

    expectTypeOf<ApprovalRow["contractVersion"]>().toEqualTypeOf<string>();
    expectTypeOf<ApprovalRow["actorId"]>().toEqualTypeOf<string>();
    expectTypeOf<ApprovalRow["decision"]>().toEqualTypeOf<ApprovalDecision["decision"]>();
    expectTypeOf<ApprovalRow["reason"]>().toEqualTypeOf<string>();
    expectTypeOf<ApprovalRow["createdAt"]>().toEqualTypeOf<Date>();

    expect(dbSchema.approvalDecisionEnum.enumValues).toEqual([...APPROVAL_DECISIONS]);
    expect(getColumnNames("approvals")).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "run_id",
        "contract_version",
        "actor_id",
        "decision",
        "reason",
        "created_at",
      ]),
    );
    expect(getForeignKeySignatures("approvals")).toEqual(
      expect.arrayContaining([
        {
          columns: "run_id",
          onDelete: "cascade",
          references: "runs.id",
        },
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
      ]),
    );
    expect(getIndexSignatures("approvals")).toEqual(
      expect.arrayContaining([
        {
          columns: "run_id,created_at",
          hasWhere: false,
          name: "approvals_run_id_created_at_idx",
          unique: false,
        },
        {
          columns: "workspace_id,created_at",
          hasWhere: false,
          name: "approvals_workspace_id_created_at_idx",
          unique: false,
        },
        {
          columns: "actor_id",
          hasWhere: false,
          name: "approvals_actor_id_idx",
          unique: false,
        },
      ]),
    );
    expect(getColumnNames("approvals")).not.toEqual(
      expect.arrayContaining([
        "code",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "raw_source",
        "snippet",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
  });

  test("models repair requests with bounded attempts and safe lookup indexes", () => {
    type RepairRequestRow = typeof dbSchema.repairRequests.$inferSelect;

    expectTypeOf<RepairRequestRow["workspaceId"]>().toEqualTypeOf<string>();
    expectTypeOf<RepairRequestRow["previousRunId"]>().toEqualTypeOf<string>();
    expectTypeOf<RepairRequestRow["queuedRunId"]>().toEqualTypeOf<string>();
    expectTypeOf<RepairRequestRow["requestedByActorId"]>().toEqualTypeOf<string>();
    expectTypeOf<RepairRequestRow["feedback"]>().toEqualTypeOf<string>();
    expectTypeOf<RepairRequestRow["attempt"]>().toEqualTypeOf<number>();
    expectTypeOf<RepairRequestRow["maxAttempts"]>().toEqualTypeOf<number>();
    expectTypeOf<RepairRequestRow["createdAt"]>().toEqualTypeOf<Date>();
    expectTypeOf<RepairRequestRow["updatedAt"]>().toEqualTypeOf<Date>();

    expect(getColumnNames("repairRequests")).toEqual(
      expect.arrayContaining([
        "id",
        "workspace_id",
        "previous_run_id",
        "queued_run_id",
        "requested_by_actor_id",
        "feedback",
        "attempt",
        "max_attempts",
        "created_at",
        "updated_at",
      ]),
    );
    expect(getColumnNames("repairRequests")).not.toEqual(
      expect.arrayContaining([
        "code",
        "content",
        "diff",
        "log",
        "output",
        "patch",
        "raw_source",
        "snippet",
        "source",
        "stderr",
        "stdout",
        "token",
      ]),
    );
    expect(getForeignKeySignatures("repairRequests")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id",
          onDelete: "cascade",
          references: "workspaces.id",
        },
        {
          columns: "previous_run_id",
          onDelete: "cascade",
          references: "runs.id",
        },
        {
          columns: "queued_run_id",
          onDelete: "cascade",
          references: "runs.id",
        },
      ]),
    );
    expect(getIndexSignatures("repairRequests")).toEqual(
      expect.arrayContaining([
        {
          columns: "previous_run_id,created_at",
          hasWhere: false,
          name: "repair_requests_previous_run_id_created_at_idx",
          unique: false,
        },
        {
          columns: "workspace_id,created_at",
          hasWhere: false,
          name: "repair_requests_workspace_id_created_at_idx",
          unique: false,
        },
      ]),
    );
    expect(getUniqueIndexSignatures("repairRequests")).toEqual(
      expect.arrayContaining(["queued_run_id", "previous_run_id,attempt"]),
    );
    expect(getCheckConstraintNames("repairRequests")).toEqual(
      expect.arrayContaining([
        "repair_requests_attempt_positive",
        "repair_requests_max_attempts_positive",
        "repair_requests_attempt_within_max_attempts",
      ]),
    );
  });

  test("adds a repair request migration with attempt backstops and no unsafe payload columns", async () => {
    const migration = await readFile(
      new URL("../migrations/0005_repair-requests.sql", import.meta.url),
      "utf8",
    );

    expect(migration).toContain('CREATE TABLE "repair_requests"');
    expect(migration).toContain('"queued_run_id" text NOT NULL');
    expect(migration).toContain('"attempt" integer NOT NULL');
    expect(migration).toContain('"updated_at" timestamp with time zone DEFAULT now() NOT NULL');
    expect(migration).toContain(
      'CREATE UNIQUE INDEX "repair_requests_previous_run_id_attempt_unique"',
    );
    expect(migration).toContain('CREATE UNIQUE INDEX "repair_requests_queued_run_id_unique"');
    expect(migration).toContain('CONSTRAINT "repair_requests_attempt_positive" CHECK');
    expect(migration).toContain('CONSTRAINT "repair_requests_max_attempts_positive" CHECK');
    expect(migration).toContain('CONSTRAINT "repair_requests_attempt_within_max_attempts" CHECK');
    expect(migration).not.toMatch(
      /\b(?:content|diff|log|output|patch|raw_source|snippet|source|stderr|stdout|token)\b/i,
    );
  });

  test("models repo mappings as runner-scoped local path metadata", () => {
    type RepoMappingRow = typeof dbSchema.repoMappings.$inferSelect;

    expectTypeOf<RepoMappingRow["runnerId"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RepoMappingRow["localPath"]>().toEqualTypeOf<string | null>();
    expectTypeOf<RepoMappingRow["remoteUrl"]>().toEqualTypeOf<string | null>();

    expect(getColumnNames("repoMappings")).toEqual(
      expect.arrayContaining([
        "runner_id",
        "local_path",
        "remote_url",
        "repository_external_id",
        "github_installation_id",
        "archived_at",
      ]),
    );
    expect(getForeignKeySignatures("repoMappings")).toContainEqual({
      columns: "runner_id",
      onDelete: "cascade",
      references: "runners.id",
    });
    expect(getUniqueIndexSignatures("repoMappings")).not.toContain(
      "workspace_id,provider,repository_owner,repository_name",
    );
    expect(getIndexSignatures("repoMappings")).toEqual(
      expect.arrayContaining([
        {
          columns: "workspace_id,runner_id,provider,repository_owner,repository_name",
          hasWhere: true,
          name: "repo_mappings_active_runner_repo_unique",
          unique: true,
        },
        {
          columns: "workspace_id,runner_id,local_path",
          hasWhere: true,
          name: "repo_mappings_active_runner_path_unique",
          unique: true,
        },
        {
          columns: "workspace_id,runner_id,archived_at",
          hasWhere: false,
          name: "repo_mappings_workspace_runner_active_idx",
          unique: false,
        },
      ]),
    );
    expect(getCheckConstraintNames("repoMappings")).toEqual(
      expect.arrayContaining([
        "repo_mappings_active_runner_required",
        "repo_mappings_active_local_path_required",
      ]),
    );
  });

  test("migrates legacy repo mappings before enforcing active runner path requirements", async () => {
    const migration = await readFile(
      new URL("../migrations/0004_repo-mapping-local-path.sql", import.meta.url),
      "utf8",
    );

    expect(migration).not.toMatch(/ADD COLUMN "runner_id" text NOT NULL/);
    expect(migration).not.toMatch(/ADD COLUMN "local_path" text NOT NULL/);
    expect(migration).toContain('UPDATE "repo_mappings"');
    expect(migration).toContain('"archived_at" = COALESCE("archived_at", now())');
    expect(migration).toContain('ADD CONSTRAINT "repo_mappings_active_runner_required" CHECK');
    expect(migration).toContain('ADD CONSTRAINT "repo_mappings_active_local_path_required" CHECK');
  });

  test("does not define unsafe raw payload, raw source, secret, credential, or log columns", () => {
    const unsafeColumnNames = new Set([
      "content",
      "contents",
      "code",
      "credential",
      "diff",
      "file_content",
      "file_contents",
      "log",
      "logs",
      "output",
      "patch",
      "pairing_code",
      "private_key",
      "raw_code",
      "raw_diff",
      "raw_log",
      "raw_output",
      "raw_patch",
      "raw_source",
      "raw_stderr",
      "raw_stdout",
      "secret",
      "snippet",
      "snippets",
      "source_code",
      "source_content",
      "stderr",
      "stdout",
      "token",
      "unredacted_log",
    ]);

    const allColumns = Object.keys(requiredTables).flatMap((exportName) =>
      getColumnNames(exportName as SchemaTableName),
    );

    expect(allColumns.filter((columnName) => unsafeColumnNames.has(columnName))).toEqual([]);
    expect(getColumnNames("runners")).toContain("credential_hash");
  });
});

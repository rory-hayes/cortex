import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import {
  CORTEX_TASK_APPROVAL_STATUSES,
  CORTEX_TASK_EXECUTION_MODES,
  CORTEX_TASK_EXTERNAL_LINK_PROVIDERS,
  CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
  CORTEX_TASK_ORIGIN_TYPES,
  CORTEX_TASK_RISK_LEVELS,
  CORTEX_TASK_STATUSES,
  FINDING_CATEGORIES,
  FINDING_SEVERITIES,
  FINDING_SOURCES,
  FINDING_STATUSES,
  REPO_EXECUTION_READINESS_STATUSES,
  REPO_SCAN_STATUSES,
  SETUP_PR_PREVIEW_STATUSES,
  TASK_RECOMMENDATION_EFFORTS,
  TASK_RECOMMENDATION_STATUSES,
  type ApprovalDecision,
  type CortexTask,
  type CortexTaskExternalLink,
  type DryRunResult,
  type Finding,
  type PrArtifact,
  type RepoReadinessReport,
  type RepoPolicy,
  type RepoScan,
  type RepoScanModuleStatus,
  type RiskFinding,
  type RunEvent,
  type RunnerCapabilities,
  type SetupPrPreview,
  type TaskRecommendation,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

const emptyJsonArray = sql`'[]'::jsonb`;
const emptyJsonObject = sql`'{}'::jsonb`;
const emptyRepoScanInventory = sql`'{"totalFileCount":0,"scannedFileCount":0,"omittedFileCount":0,"totalDirectoryCount":0,"languageSummaries":[],"packageManagerLabels":[],"ciProviderLabels":[],"documentationSummaries":[],"policySummary":{"hasPolicyFile":false,"protectedPathCount":0,"sensitivePathCount":0,"validationCommandCount":0,"dryRunCheckCount":0}}'::jsonb`;
const unknownGitHubChecksSummary = sql`'{"conclusion":"unknown","totalCount":0,"passedCount":0,"failedCount":0,"pendingCount":0,"skippedCount":0}'::jsonb`;

export const githubPrReviewStateValues = [
  "approved",
  "changes_requested",
  "review_required",
  "unknown",
] as const;

export type GitHubPrReviewState = (typeof githubPrReviewStateValues)[number];

export type GitHubPrChecksSummary = {
  conclusion: "failing" | "passing" | "pending" | "unknown";
  failedCount: number;
  passedCount: number;
  pendingCount: number;
  skippedCount: number;
  totalCount: number;
};

const runStateValues = [
  "queued",
  "claimed",
  "dry_run_running",
  "dry_run_passed",
  "preflight",
  "worktree_created",
  "codex_running",
  "changes_scanned",
  "validation_running",
  "blocked",
  "cancel_requested",
  "cancelling",
  "cancelled",
  "pushed",
  "pr_opened",
  "awaiting_approval",
  "repair_requested",
  "completed",
  "failed",
] as const;

const runEventSeverityValues = ["debug", "info", "warning", "error", "blocked"] as const;
const taskPacketModeValues = ["dryRun", "execute", "repair"] as const;
const taskPacketSourceTypeValues = ["manual", "linear", "repair"] as const;
const dryRunResultStatusValues = ["passed", "failed", "warning"] as const;
const validationResultStatusValues = ["passed", "failed", "skipped", "cancelled"] as const;
const approvalDecisionValues = [
  "approve",
  "reject",
  "request_repair",
  "rerun_validation",
  "cancel_run",
  "close_run",
] as const;
const prArtifactStatusValues = ["draft", "open", "closed", "merged"] as const;
const runnerHeartbeatStatusValues = ["idle", "busy", "offline"] as const;
const runnerJobTypeValues = ["task", "repair"] as const;
export const usageEventTypeValues = [
  "repo_scan",
  "readiness_report_generation",
  "task_recommendation_generation",
  "setup_pr_generation",
  "runner_execution",
] as const;
export const usageModelCategoryValues = [
  "scan",
  "ai_generation",
  "setup_pr",
  "runner_execution",
] as const;

export type UsageEventType = (typeof usageEventTypeValues)[number];
export type UsageModelCategory = (typeof usageModelCategoryValues)[number];

export const runStateEnum = pgEnum("run_state", runStateValues);
export const runEventSeverityEnum = pgEnum("run_event_severity", runEventSeverityValues);
export const taskPacketModeEnum = pgEnum("task_packet_mode", taskPacketModeValues);
export const taskPacketSourceTypeEnum = pgEnum(
  "task_packet_source_type",
  taskPacketSourceTypeValues,
);
export const dryRunResultStatusEnum = pgEnum("dry_run_result_status", dryRunResultStatusValues);
export const validationResultStatusEnum = pgEnum(
  "validation_result_status",
  validationResultStatusValues,
);
export const approvalDecisionEnum = pgEnum("approval_decision", approvalDecisionValues);
export const prArtifactStatusEnum = pgEnum("pr_artifact_status", prArtifactStatusValues);
export const runnerHeartbeatStatusEnum = pgEnum(
  "runner_heartbeat_status",
  runnerHeartbeatStatusValues,
);
export const runnerJobTypeEnum = pgEnum("runner_job_type", runnerJobTypeValues);
export const usageEventTypeEnum = pgEnum("usage_event_type", usageEventTypeValues);
export const usageModelCategoryEnum = pgEnum("usage_model_category", usageModelCategoryValues);
export const repoScanStatusEnum = pgEnum("repo_scan_status", REPO_SCAN_STATUSES);
export const findingCategoryEnum = pgEnum("finding_category", FINDING_CATEGORIES);
export const findingSeverityEnum = pgEnum("finding_severity", FINDING_SEVERITIES);
export const findingStatusEnum = pgEnum("finding_status", FINDING_STATUSES);
export const findingSourceEnum = pgEnum("finding_source", FINDING_SOURCES);
export const repoExecutionReadinessEnum = pgEnum(
  "repo_execution_readiness",
  REPO_EXECUTION_READINESS_STATUSES,
);
export const cortexTaskOriginTypeEnum = pgEnum("cortex_task_origin_type", CORTEX_TASK_ORIGIN_TYPES);
export const cortexTaskRiskLevelEnum = pgEnum("cortex_task_risk_level", CORTEX_TASK_RISK_LEVELS);
export const cortexTaskExecutionModeEnum = pgEnum(
  "cortex_task_execution_mode",
  CORTEX_TASK_EXECUTION_MODES,
);
export const cortexTaskStatusEnum = pgEnum("cortex_task_status", CORTEX_TASK_STATUSES);
export const cortexTaskApprovalStatusEnum = pgEnum(
  "cortex_task_approval_status",
  CORTEX_TASK_APPROVAL_STATUSES,
);
export const cortexTaskExternalLinkProviderEnum = pgEnum(
  "cortex_task_external_link_provider",
  CORTEX_TASK_EXTERNAL_LINK_PROVIDERS,
);
export const cortexTaskExternalLinkResourceTypeEnum = pgEnum(
  "cortex_task_external_link_resource_type",
  CORTEX_TASK_EXTERNAL_LINK_RESOURCE_TYPES,
);
export const taskRecommendationStatusEnum = pgEnum(
  "task_recommendation_status",
  TASK_RECOMMENDATION_STATUSES,
);
export const taskRecommendationEffortEnum = pgEnum(
  "task_recommendation_effort",
  TASK_RECOMMENDATION_EFFORTS,
);
export const setupPrPreviewStatusEnum = pgEnum(
  "setup_pr_preview_status",
  SETUP_PR_PREVIEW_STATUSES,
);

export const workspaces = pgTable(
  "workspaces",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    plan: text("plan").notNull().default("mvp"),
    runnerLimit: integer("runner_limit").notNull().default(10),
    repoLimit: integer("repo_limit").notNull().default(25),
    monthlyRunLimit: integer("monthly_run_limit").notNull().default(10_000),
    usageCount: integer("usage_count").notNull().default(0),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("workspaces_plan_idx").on(table.plan),
    index("workspaces_stripe_customer_id_idx").on(table.stripeCustomerId),
  ],
);

export const memberships = pgTable(
  "memberships",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull().default("member"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("memberships_workspace_id_user_id_unique").on(table.workspaceId, table.userId),
    index("memberships_user_id_idx").on(table.userId),
  ],
);

export const usageEvents = pgTable(
  "usage_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    usageEventType: usageEventTypeEnum("usage_event_type").notNull(),
    modelUsageCategory: usageModelCategoryEnum("model_usage_category").notNull(),
    quantity: integer("quantity").notNull().default(1),
    idempotencyKey: text("idempotency_key").notNull(),
    sourceTable: text("source_table"),
    sourceId: text("source_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("usage_events_workspace_idempotency_key_unique").on(
      table.workspaceId,
      table.idempotencyKey,
    ),
    index("usage_events_workspace_occurred_at_idx").on(table.workspaceId, table.occurredAt),
    index("usage_events_workspace_type_occurred_at_idx").on(
      table.workspaceId,
      table.usageEventType,
      table.occurredAt,
    ),
    index("usage_events_workspace_category_occurred_at_idx").on(
      table.workspaceId,
      table.modelUsageCategory,
      table.occurredAt,
    ),
    check("usage_events_quantity_positive", sql`${table.quantity} > 0`),
    check("usage_events_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check(
      "usage_events_source_pair",
      sql`(${table.sourceTable} is null and ${table.sourceId} is null) or (${table.sourceTable} is not null and length(btrim(${table.sourceTable})) > 0 and ${table.sourceId} is not null and length(btrim(${table.sourceId})) > 0)`,
    ),
  ],
);

export const runners = pgTable(
  "runners",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    displayName: text("display_name").notNull(),
    credentialHash: text("credential_hash").notNull(),
    status: runnerHeartbeatStatusEnum("status").notNull().default("offline"),
    capabilities: jsonb("capabilities").$type<RunnerCapabilities>().notNull(),
    lastHeartbeatAt: timestamp("last_heartbeat_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    linkedAt: timestamp("linked_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("runners_workspace_id_status_idx").on(table.workspaceId, table.status),
    index("runners_last_heartbeat_at_idx").on(table.lastHeartbeatAt),
  ],
);

export const runnerPairingCodes = pgTable(
  "runner_pairing_codes",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    credentialHash: text("credential_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    usedAt: timestamp("used_at", { withTimezone: true }),
    usedByRunnerId: text("used_by_runner_id").references(() => runners.id, {
      onDelete: "set null",
    }),
    createdByActorId: text("created_by_actor_id").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("runner_pairing_codes_credential_hash_unique").on(table.credentialHash),
    index("runner_pairing_codes_active_lookup_idx").on(
      table.credentialHash,
      table.expiresAt,
      table.usedAt,
    ),
    index("runner_pairing_codes_workspace_expiry_idx").on(table.workspaceId, table.expiresAt),
  ],
);

export const linearOAuthConnections = pgTable(
  "linear_oauth_connections",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    linearWorkspaceId: text("linear_workspace_id").notNull(),
    linearWorkspaceName: text("linear_workspace_name").notNull(),
    linearActorId: text("linear_actor_id").notNull(),
    scopes: jsonb("scopes").$type<string[]>().notNull().default(emptyJsonArray),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    connectedByActorId: text("connected_by_actor_id").notNull(),
    connectedAt: timestamp("connected_at", { withTimezone: true }).notNull().defaultNow(),
    revokedByActorId: text("revoked_by_actor_id"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    accessTokenCiphertext: text("access_token_ciphertext"),
    accessTokenKeyId: text("access_token_key_id"),
    refreshTokenCiphertext: text("refresh_token_ciphertext"),
    refreshTokenKeyId: text("refresh_token_key_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("linear_oauth_connections_active_workspace_unique")
      .on(table.workspaceId, table.linearWorkspaceId)
      .where(sql`${table.revokedAt} is null`),
    index("linear_oauth_connections_workspace_revoked_idx").on(table.workspaceId, table.revokedAt),
    index("linear_oauth_connections_linear_workspace_id_idx").on(table.linearWorkspaceId),
    check(
      "linear_oauth_connections_active_access_token_ciphertext_required",
      sql`${table.revokedAt} is not null or (${table.accessTokenCiphertext} is not null and length(btrim(${table.accessTokenCiphertext})) > 0 and ${table.accessTokenKeyId} is not null and length(btrim(${table.accessTokenKeyId})) > 0)`,
    ),
    check(
      "linear_oauth_connections_refresh_token_ciphertext_key_pair",
      sql`(${table.refreshTokenCiphertext} is null and ${table.refreshTokenKeyId} is null) or (${table.refreshTokenCiphertext} is not null and length(btrim(${table.refreshTokenCiphertext})) > 0 and ${table.refreshTokenKeyId} is not null and length(btrim(${table.refreshTokenKeyId})) > 0)`,
    ),
    check(
      "linear_oauth_connections_revoked_credentials_cleared",
      sql`${table.revokedAt} is null or (${table.accessTokenCiphertext} is null and ${table.accessTokenKeyId} is null and ${table.refreshTokenCiphertext} is null and ${table.refreshTokenKeyId} is null)`,
    ),
    check(
      "linear_oauth_connections_revoked_actor_pair",
      sql`(${table.revokedAt} is null and ${table.revokedByActorId} is null) or (${table.revokedAt} is not null and ${table.revokedByActorId} is not null and length(btrim(${table.revokedByActorId})) > 0)`,
    ),
    check("linear_oauth_connections_scopes_array", sql`jsonb_typeof(${table.scopes}) = 'array'`),
  ],
);

export const linearIssueCandidates = pgTable(
  "linear_issue_candidates",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    linearConnectionId: text("linear_oauth_connection_id")
      .notNull()
      .references(() => linearOAuthConnections.id, { onDelete: "cascade" }),
    linearWorkspaceId: text("linear_workspace_id").notNull(),
    linearIssueId: text("linear_issue_id").notNull(),
    identifier: text("identifier").notNull(),
    title: text("title").notNull(),
    bodySummary: text("body_summary").notNull().default(""),
    commentsSummary: text("comments_summary").notNull().default(""),
    status: text("status").notNull(),
    labels: jsonb("labels").$type<string[]>().notNull().default(emptyJsonArray),
    projectId: text("project_id"),
    projectName: text("project_name"),
    url: text("url"),
    linearUpdatedAt: timestamp("linear_updated_at", { withTimezone: true }).notNull(),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    redactionApplied: boolean("redaction_applied").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("linear_issue_candidates_workspace_linear_issue_unique").on(
      table.workspaceId,
      table.linearWorkspaceId,
      table.linearIssueId,
    ),
    index("linear_issue_candidates_workspace_status_idx").on(table.workspaceId, table.status),
    index("linear_issue_candidates_connection_sync_idx").on(
      table.linearConnectionId,
      table.lastSyncedAt,
    ),
    check("linear_issue_candidates_labels_array", sql`jsonb_typeof(${table.labels}) = 'array'`),
  ],
);

export const githubAppInstallations = pgTable(
  "github_app_installations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").notNull(),
    accountId: text("account_id").notNull(),
    accountLogin: text("account_login").notNull(),
    accountType: text("account_type").notNull(),
    accountHtmlUrl: text("account_html_url"),
    repositorySelection: text("repository_selection").$type<"all" | "selected">().notNull(),
    permissions: jsonb("permissions")
      .$type<Record<string, string>>()
      .notNull()
      .default(emptyJsonObject),
    installationHtmlUrl: text("installation_html_url"),
    suspendedAt: timestamp("suspended_at", { withTimezone: true }),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("github_app_installations_workspace_installation_unique").on(
      table.workspaceId,
      table.githubInstallationId,
    ),
    index("github_app_installations_workspace_id_idx").on(table.workspaceId),
    index("github_app_installations_account_id_idx").on(table.accountId),
    index("github_app_installations_account_login_idx").on(table.accountLogin),
    check(
      "github_app_installations_permissions_object",
      sql`jsonb_typeof(${table.permissions}) = 'object'`,
    ),
    check(
      "github_app_installations_repository_selection_valid",
      sql`${table.repositorySelection} in ('all', 'selected')`,
    ),
  ],
);

export const githubRepositories = pgTable(
  "github_repositories",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    githubAppInstallationId: text("github_app_installation_id")
      .notNull()
      .references(() => githubAppInstallations.id, { onDelete: "cascade" }),
    githubInstallationId: text("github_installation_id").notNull(),
    repositoryExternalId: text("repository_external_id").notNull(),
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    repositoryFullName: text("repository_full_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    isPrivate: boolean("is_private").notNull(),
    htmlUrl: text("html_url"),
    visibility: text("visibility"),
    archived: boolean("archived").notNull().default(false),
    disabled: boolean("disabled").notNull().default(false),
    lastSyncedAt: timestamp("last_synced_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("github_repositories_workspace_installation_repo_unique").on(
      table.workspaceId,
      table.githubInstallationId,
      table.repositoryExternalId,
    ),
    index("github_repositories_workspace_id_idx").on(table.workspaceId),
    index("github_repositories_app_installation_id_idx").on(table.githubAppInstallationId),
    index("github_repositories_github_installation_id_idx").on(table.githubInstallationId),
    index("github_repositories_owner_name_idx").on(
      table.workspaceId,
      table.repositoryOwner,
      table.repositoryName,
    ),
    check(
      "github_repositories_visibility_valid",
      sql`${table.visibility} is null or ${table.visibility} in ('public', 'private', 'internal')`,
    ),
  ],
);

export const repoScans = pgTable(
  "repo_scans",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").$type<RepoScan["contractVersion"]>().notNull(),
    status: repoScanStatusEnum("status").notNull().default("queued"),
    statusSummary: text("status_summary").notNull().default("Queued for repo readiness scanning."),
    moduleStatuses: jsonb("module_statuses")
      .$type<RepoScanModuleStatus[]>()
      .notNull()
      .default(emptyJsonArray),
    inventory: jsonb("inventory")
      .$type<RepoScan["inventory"]>()
      .notNull()
      .default(emptyRepoScanInventory),
    findingIds: jsonb("finding_ids")
      .$type<RepoScan["findingIds"]>()
      .notNull()
      .default(emptyJsonArray),
    taskRecommendationIds: jsonb("task_recommendation_ids")
      .$type<RepoScan["taskRecommendationIds"]>()
      .notNull()
      .default(emptyJsonArray),
    readinessReportId: text("readiness_report_id"),
    failureSummary: text("failure_summary"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("repo_scans_workspace_status_idx").on(table.workspaceId, table.status),
    index("repo_scans_repo_created_at_idx").on(table.repoId, table.createdAt),
    index("repo_scans_workspace_created_at_idx").on(table.workspaceId, table.createdAt),
    index("repo_scans_readiness_report_id_idx").on(table.readinessReportId),
    check("repo_scans_inventory_object", sql`jsonb_typeof(${table.inventory}) = 'object'`),
    check("repo_scans_module_statuses_array", sql`jsonb_typeof(${table.moduleStatuses}) = 'array'`),
    check("repo_scans_finding_ids_array", sql`jsonb_typeof(${table.findingIds}) = 'array'`),
    check(
      "repo_scans_task_recommendation_ids_array",
      sql`jsonb_typeof(${table.taskRecommendationIds}) = 'array'`,
    ),
    check(
      "repo_scans_running_started_at_required",
      sql`${table.status} <> 'running' or ${table.startedAt} is not null`,
    ),
    check(
      "repo_scans_terminal_finished_at_required",
      sql`${table.status} not in ('completed', 'failed', 'cancelled') or ${table.finishedAt} is not null`,
    ),
    check(
      "repo_scans_completed_report_required",
      sql`${table.status} <> 'completed' or (${table.readinessReportId} is not null and length(btrim(${table.readinessReportId})) > 0)`,
    ),
    check(
      "repo_scans_failed_failure_summary_required",
      sql`${table.status} <> 'failed' or (${table.failureSummary} is not null and length(btrim(${table.failureSummary})) > 0)`,
    ),
  ],
);

export const findings = pgTable(
  "findings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    scanId: text("scan_id")
      .notNull()
      .references(() => repoScans.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").$type<Finding["contractVersion"]>().notNull(),
    category: findingCategoryEnum("category").notNull(),
    severity: findingSeverityEnum("severity").notNull(),
    status: findingStatusEnum("status").notNull().default("open"),
    title: text("title").notNull(),
    summary: text("summary").notNull(),
    evidence: jsonb("evidence").$type<Finding["evidence"]>().notNull(),
    recommendation: text("recommendation").notNull(),
    source: findingSourceEnum("source").notNull(),
    deterministicRuleId: text("deterministic_rule_id").notNull(),
    confidence: doublePrecision("confidence").notNull(),
    dedupeKey: text("dedupe_key").notNull(),
    taskIds: jsonb("task_ids").$type<string[]>().notNull().default(emptyJsonArray),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("findings_workspace_repo_dedupe_unique").on(
      table.workspaceId,
      table.repoId,
      table.dedupeKey,
    ),
    index("findings_workspace_scan_status_idx").on(table.workspaceId, table.scanId, table.status),
    index("findings_workspace_repo_status_idx").on(table.workspaceId, table.repoId, table.status),
    index("findings_scan_category_idx").on(table.scanId, table.category),
    check(
      "findings_evidence_non_empty_array",
      sql`jsonb_typeof(${table.evidence}) = 'array' and jsonb_array_length(${table.evidence}) > 0`,
    ),
    check("findings_task_ids_array", sql`jsonb_typeof(${table.taskIds}) = 'array'`),
    check("findings_confidence_range", sql`${table.confidence} >= 0 and ${table.confidence} <= 1`),
    check("findings_dedupe_key_non_empty", sql`length(btrim(${table.dedupeKey})) > 0`),
  ],
);

export const repoReadinessReports = pgTable(
  "repo_readiness_reports",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    scanId: text("scan_id")
      .notNull()
      .references(() => repoScans.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version")
      .$type<RepoReadinessReport["contractVersion"]>()
      .notNull(),
    overallScore: doublePrecision("overall_score").notNull(),
    categoryScores: jsonb("category_scores")
      .$type<RepoReadinessReport["categoryScores"]>()
      .notNull(),
    summary: text("summary").notNull(),
    strengths: jsonb("strengths")
      .$type<RepoReadinessReport["strengths"]>()
      .notNull()
      .default(emptyJsonArray),
    weaknesses: jsonb("weaknesses")
      .$type<RepoReadinessReport["weaknesses"]>()
      .notNull()
      .default(emptyJsonArray),
    blockedReasons: jsonb("blocked_reasons")
      .$type<RepoReadinessReport["blockedReasons"]>()
      .notNull()
      .default(emptyJsonArray),
    recommendedNextActions: jsonb("recommended_next_actions")
      .$type<RepoReadinessReport["recommendedNextActions"]>()
      .notNull()
      .default(emptyJsonArray),
    findingIds: jsonb("finding_ids")
      .$type<RepoReadinessReport["findingIds"]>()
      .notNull()
      .default(emptyJsonArray),
    taskRecommendationIds: jsonb("task_recommendation_ids")
      .$type<RepoReadinessReport["taskRecommendationIds"]>()
      .notNull()
      .default(emptyJsonArray),
    executionReadiness: repoExecutionReadinessEnum("execution_readiness").notNull(),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("repo_readiness_reports_workspace_scan_unique").on(table.workspaceId, table.scanId),
    index("repo_readiness_reports_latest_idx").on(
      table.workspaceId,
      table.repoId,
      table.generatedAt,
      table.createdAt,
    ),
    index("repo_readiness_reports_workspace_repo_scan_idx").on(
      table.workspaceId,
      table.repoId,
      table.scanId,
    ),
    check(
      "repo_readiness_reports_overall_score_range",
      sql`${table.overallScore} >= 0 and ${table.overallScore} <= 100`,
    ),
    check(
      "repo_readiness_reports_category_scores_object",
      sql`jsonb_typeof(${table.categoryScores}) = 'object'`,
    ),
    check(
      "repo_readiness_reports_strengths_array",
      sql`jsonb_typeof(${table.strengths}) = 'array'`,
    ),
    check(
      "repo_readiness_reports_weaknesses_array",
      sql`jsonb_typeof(${table.weaknesses}) = 'array'`,
    ),
    check(
      "repo_readiness_reports_blocked_reasons_array",
      sql`jsonb_typeof(${table.blockedReasons}) = 'array'`,
    ),
    check(
      "repo_readiness_reports_recommended_next_actions_array",
      sql`jsonb_typeof(${table.recommendedNextActions}) = 'array'`,
    ),
    check(
      "repo_readiness_reports_finding_ids_array",
      sql`jsonb_typeof(${table.findingIds}) = 'array'`,
    ),
    check(
      "repo_readiness_reports_task_recommendation_ids_array",
      sql`jsonb_typeof(${table.taskRecommendationIds}) = 'array'`,
    ),
  ],
);

export const cortexTasks = pgTable(
  "cortex_tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").$type<CortexTask["contractVersion"]>().notNull(),
    originType: cortexTaskOriginTypeEnum("origin_type").notNull(),
    originExternalId: text("origin_external_id"),
    originExternalSystem: text("origin_external_system"),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<CortexTask["acceptanceCriteria"]>()
      .notNull()
      .default(emptyJsonArray),
    riskLevel: cortexTaskRiskLevelEnum("risk_level").notNull(),
    executionMode: cortexTaskExecutionModeEnum("execution_mode").notNull(),
    status: cortexTaskStatusEnum("status").notNull().default("draft"),
    approvalStatus: cortexTaskApprovalStatusEnum("approval_status")
      .notNull()
      .default("not_requested"),
    suggestedValidation: jsonb("suggested_validation")
      .$type<CortexTask["suggestedValidation"]>()
      .notNull()
      .default(emptyJsonArray),
    findingIds: jsonb("finding_ids")
      .$type<CortexTask["findingIds"]>()
      .notNull()
      .default(emptyJsonArray),
    taskRecommendationId: text("task_recommendation_id"),
    taskPacketId: text("task_packet_id"),
    runIds: jsonb("run_ids").$type<CortexTask["runIds"]>().notNull().default(emptyJsonArray),
    latestRunId: text("latest_run_id"),
    prArtifactIds: jsonb("pr_artifact_ids")
      .$type<CortexTask["prArtifactIds"]>()
      .notNull()
      .default(emptyJsonArray),
    externalLinks: jsonb("external_links")
      .$type<CortexTask["externalLinks"]>()
      .notNull()
      .default(emptyJsonArray),
    metadata: jsonb("metadata").$type<CortexTask["metadata"]>().notNull().default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cortex_tasks_workspace_status_idx").on(table.workspaceId, table.status),
    index("cortex_tasks_repo_status_idx").on(table.repoId, table.status),
    index("cortex_tasks_approval_status_idx").on(table.workspaceId, table.approvalStatus),
    index("cortex_tasks_execution_mode_idx").on(table.workspaceId, table.executionMode),
    index("cortex_tasks_latest_run_id_idx").on(table.latestRunId),
    index("cortex_tasks_task_packet_id_idx").on(table.taskPacketId),
    index("cortex_tasks_task_recommendation_id_idx").on(table.taskRecommendationId),
    uniqueIndex("cortex_tasks_task_recommendation_id_unique").on(table.taskRecommendationId),
    check("cortex_tasks_title_non_empty", sql`length(btrim(${table.title})) > 0`),
    check("cortex_tasks_objective_non_empty", sql`length(btrim(${table.objective})) > 0`),
    check(
      "cortex_tasks_acceptance_criteria_non_empty_array",
      sql`jsonb_typeof(${table.acceptanceCriteria}) = 'array' and jsonb_array_length(${table.acceptanceCriteria}) > 0`,
    ),
    check(
      "cortex_tasks_suggested_validation_array",
      sql`jsonb_typeof(${table.suggestedValidation}) = 'array'`,
    ),
    check("cortex_tasks_finding_ids_array", sql`jsonb_typeof(${table.findingIds}) = 'array'`),
    check("cortex_tasks_run_ids_array", sql`jsonb_typeof(${table.runIds}) = 'array'`),
    check(
      "cortex_tasks_latest_run_id_in_run_ids",
      sql`${table.latestRunId} is null or ${table.runIds} ? ${table.latestRunId}`,
    ),
    check(
      "cortex_tasks_pr_artifact_ids_array",
      sql`jsonb_typeof(${table.prArtifactIds}) = 'array'`,
    ),
    check("cortex_tasks_external_links_array", sql`jsonb_typeof(${table.externalLinks}) = 'array'`),
    check("cortex_tasks_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check(
      "cortex_tasks_finding_origin_requires_finding_ids",
      sql`${table.originType} <> 'finding' or jsonb_array_length(${table.findingIds}) > 0`,
    ),
    check(
      "cortex_tasks_recommendation_origin_requires_task_recommendation_id",
      sql`${table.originType} <> 'task_recommendation' or (${table.taskRecommendationId} is not null and length(btrim(${table.taskRecommendationId})) > 0)`,
    ),
    check(
      "cortex_tasks_external_origin_requires_reference",
      sql`${table.originType} <> 'external_import' or ((${table.originExternalId} is not null and length(btrim(${table.originExternalId})) > 0) or jsonb_array_length(${table.externalLinks}) > 0)`,
    ),
  ],
);

export const cortexTaskExternalLinks = pgTable(
  "cortex_task_external_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    cortexTaskId: text("cortex_task_id")
      .notNull()
      .references(() => cortexTasks.id, { onDelete: "cascade" }),
    provider: cortexTaskExternalLinkProviderEnum("provider")
      .$type<CortexTaskExternalLink["provider"]>()
      .notNull(),
    resourceType: cortexTaskExternalLinkResourceTypeEnum("resource_type")
      .$type<CortexTaskExternalLink["resourceType"]>()
      .notNull(),
    externalId: text("external_id"),
    url: text("url").notNull(),
    title: text("title").notNull(),
    externalStatus: text("external_status").notNull().default("unknown"),
    syncedAt: timestamp("synced_at", { withTimezone: true }),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("cortex_task_external_links_task_lookup_idx").on(table.workspaceId, table.cortexTaskId),
    uniqueIndex("cortex_task_external_links_provider_external_id_unique")
      .on(table.workspaceId, table.provider, table.resourceType, table.externalId)
      .where(sql`${table.externalId} is not null`),
    check("cortex_task_external_links_title_non_empty", sql`length(btrim(${table.title})) > 0`),
    check(
      "cortex_task_external_links_status_non_empty",
      sql`length(btrim(${table.externalStatus})) > 0`,
    ),
    check("cortex_task_external_links_https_url", sql`lower(${table.url}) like 'https://%'`),
    check(
      "cortex_task_external_links_metadata_object",
      sql`jsonb_typeof(${table.metadata}) = 'object'`,
    ),
    check(
      "cortex_task_external_links_external_id_required",
      sql`${table.resourceType} = 'documentation' or (${table.externalId} is not null and length(btrim(${table.externalId})) > 0)`,
    ),
    check(
      "cortex_task_external_links_provider_resource_match",
      sql`(${table.provider} = 'github' and ${table.resourceType} in ('github_issue', 'pull_request')) or (${table.provider} = 'linear' and ${table.resourceType} = 'linear_issue') or (${table.provider} = 'jira' and ${table.resourceType} = 'jira_issue') or (${table.provider} = 'docs' and ${table.resourceType} = 'documentation')`,
    ),
  ],
);

export const taskRecommendations = pgTable(
  "task_recommendations",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    scanId: text("scan_id")
      .notNull()
      .references(() => repoScans.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version")
      .$type<TaskRecommendation["contractVersion"]>()
      .notNull(),
    title: text("title").notNull(),
    objective: text("objective").notNull(),
    findingIds: jsonb("finding_ids")
      .$type<TaskRecommendation["findingIds"]>()
      .notNull()
      .default(emptyJsonArray),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<TaskRecommendation["acceptanceCriteria"]>()
      .notNull()
      .default(emptyJsonArray),
    riskLevel: cortexTaskRiskLevelEnum("risk_level").notNull(),
    effort: taskRecommendationEffortEnum("effort").notNull(),
    executionMode: cortexTaskExecutionModeEnum("execution_mode").notNull(),
    suggestedValidation: jsonb("suggested_validation")
      .$type<TaskRecommendation["suggestedValidation"]>()
      .notNull()
      .default(emptyJsonArray),
    status: taskRecommendationStatusEnum("status").notNull().default("open"),
    cortexTaskId: text("cortex_task_id").references(() => cortexTasks.id, {
      onDelete: "set null",
    }),
    metadata: jsonb("metadata")
      .$type<TaskRecommendation["metadata"]>()
      .notNull()
      .default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("task_recommendations_workspace_status_idx").on(table.workspaceId, table.status),
    index("task_recommendations_repo_status_idx").on(table.repoId, table.status),
    index("task_recommendations_scan_status_idx").on(table.scanId, table.status),
    index("task_recommendations_cortex_task_id_idx").on(table.cortexTaskId),
    uniqueIndex("task_recommendations_cortex_task_id_unique").on(table.cortexTaskId),
    check("task_recommendations_title_non_empty", sql`length(btrim(${table.title})) > 0`),
    check("task_recommendations_objective_non_empty", sql`length(btrim(${table.objective})) > 0`),
    check(
      "task_recommendations_finding_ids_non_empty_array",
      sql`jsonb_typeof(${table.findingIds}) = 'array' and jsonb_array_length(${table.findingIds}) > 0`,
    ),
    check(
      "task_recommendations_acceptance_criteria_non_empty_array",
      sql`jsonb_typeof(${table.acceptanceCriteria}) = 'array' and jsonb_array_length(${table.acceptanceCriteria}) > 0`,
    ),
    check(
      "task_recommendations_suggested_validation_array",
      sql`jsonb_typeof(${table.suggestedValidation}) = 'array'`,
    ),
    check("task_recommendations_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
    check(
      "task_recommendations_cortex_task_conversion_state",
      sql`(${table.status} = 'converted' and ${table.cortexTaskId} is not null and length(btrim(${table.cortexTaskId})) > 0) or (${table.status} <> 'converted' and ${table.cortexTaskId} is null)`,
    ),
  ],
);

export const findingTaskLinks = pgTable(
  "finding_task_links",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    findingId: text("finding_id")
      .notNull()
      .references(() => findings.id, { onDelete: "cascade" }),
    cortexTaskId: text("cortex_task_id")
      .notNull()
      .references(() => cortexTasks.id, { onDelete: "cascade" }),
    taskRecommendationId: text("task_recommendation_id").references(() => taskRecommendations.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("finding_task_links_workspace_finding_task_unique").on(
      table.workspaceId,
      table.findingId,
      table.cortexTaskId,
    ),
    index("finding_task_links_finding_lookup_idx").on(table.workspaceId, table.findingId),
    index("finding_task_links_task_lookup_idx").on(table.workspaceId, table.cortexTaskId),
    index("finding_task_links_recommendation_lookup_idx")
      .on(table.workspaceId, table.taskRecommendationId)
      .where(sql`${table.taskRecommendationId} is not null`),
    check("finding_task_links_id_non_empty", sql`length(btrim(${table.id})) > 0`),
    check(
      "finding_task_links_workspace_id_non_empty",
      sql`length(btrim(${table.workspaceId})) > 0`,
    ),
    check("finding_task_links_repo_id_non_empty", sql`length(btrim(${table.repoId})) > 0`),
    check("finding_task_links_finding_id_non_empty", sql`length(btrim(${table.findingId})) > 0`),
    check(
      "finding_task_links_cortex_task_id_non_empty",
      sql`length(btrim(${table.cortexTaskId})) > 0`,
    ),
    check(
      "finding_task_links_task_recommendation_id_non_empty",
      sql`${table.taskRecommendationId} is null or length(btrim(${table.taskRecommendationId})) > 0`,
    ),
  ],
).enableRLS();

export const setupPrPreviews = pgTable(
  "setup_pr_previews",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoId: text("repo_id")
      .notNull()
      .references(() => githubRepositories.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").$type<SetupPrPreview["contractVersion"]>().notNull(),
    status: setupPrPreviewStatusEnum("status").$type<SetupPrPreview["status"]>().notNull(),
    taskIds: jsonb("task_ids").$type<SetupPrPreview["taskIds"]>().notNull().default(emptyJsonArray),
    excludedTaskIds: jsonb("excluded_task_ids")
      .$type<SetupPrPreview["excludedTaskIds"]>()
      .notNull()
      .default(emptyJsonArray),
    excludedTemplateIds: jsonb("excluded_template_ids")
      .$type<SetupPrPreview["excludedTemplateIds"]>()
      .notNull()
      .default(emptyJsonArray),
    files: jsonb("files").$type<SetupPrPreview["files"]>().notNull().default(emptyJsonArray),
    metadata: jsonb("metadata")
      .$type<SetupPrPreview["metadata"]>()
      .notNull()
      .default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("setup_pr_previews_workspace_status_idx").on(table.workspaceId, table.status),
    index("setup_pr_previews_repo_status_idx").on(table.repoId, table.status),
    check(
      "setup_pr_previews_task_ids_non_empty_array",
      sql`jsonb_typeof(${table.taskIds}) = 'array' and jsonb_array_length(${table.taskIds}) > 0`,
    ),
    check(
      "setup_pr_previews_excluded_task_ids_array",
      sql`jsonb_typeof(${table.excludedTaskIds}) = 'array'`,
    ),
    check(
      "setup_pr_previews_excluded_template_ids_array",
      sql`jsonb_typeof(${table.excludedTemplateIds}) = 'array'`,
    ),
    check(
      "setup_pr_previews_files_non_empty_array",
      sql`jsonb_typeof(${table.files}) = 'array' and jsonb_array_length(${table.files}) > 0`,
    ),
    check("setup_pr_previews_metadata_object", sql`jsonb_typeof(${table.metadata}) = 'object'`),
  ],
);

export const repoMappings = pgTable(
  "repo_mappings",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("github"),
    repositoryExternalId: text("repository_external_id"),
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    defaultBranch: text("default_branch").notNull(),
    localPath: text("local_path"),
    remoteUrl: text("remote_url"),
    githubInstallationId: text("github_installation_id"),
    policySnapshot: jsonb("policy_snapshot").$type<RepoPolicy>(),
    validationCommands: jsonb("validation_commands").$type<ValidationCommand[]>(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
  },
  (table) => [
    uniqueIndex("repo_mappings_active_runner_repo_unique")
      .on(
        table.workspaceId,
        table.runnerId,
        table.provider,
        table.repositoryOwner,
        table.repositoryName,
      )
      .where(sql`${table.archivedAt} is null`),
    uniqueIndex("repo_mappings_active_runner_path_unique")
      .on(table.workspaceId, table.runnerId, table.localPath)
      .where(sql`${table.archivedAt} is null`),
    index("repo_mappings_workspace_active_idx").on(table.workspaceId, table.archivedAt),
    index("repo_mappings_workspace_runner_active_idx").on(
      table.workspaceId,
      table.runnerId,
      table.archivedAt,
    ),
    index("repo_mappings_lookup_idx").on(
      table.workspaceId,
      table.runnerId,
      table.repositoryOwner,
      table.repositoryName,
    ),
    check(
      "repo_mappings_active_runner_required",
      sql`${table.archivedAt} is not null or ${table.runnerId} is not null`,
    ),
    check(
      "repo_mappings_active_local_path_required",
      sql`${table.archivedAt} is not null or (${table.localPath} is not null and length(btrim(${table.localPath})) > 0)`,
    ),
  ],
);

export const tasks = pgTable(
  "tasks",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    repoMappingId: text("repo_mapping_id")
      .notNull()
      .references(() => repoMappings.id, { onDelete: "restrict" }),
    contractVersion: text("contract_version").notNull(),
    mode: taskPacketModeEnum("mode").notNull(),
    sourceType: taskPacketSourceTypeEnum("source_type").notNull(),
    externalId: text("external_id"),
    title: text("title").notNull(),
    externalUrl: text("external_url"),
    objective: text("objective").notNull(),
    acceptanceCriteria: jsonb("acceptance_criteria")
      .$type<TaskPacket["acceptanceCriteria"]>()
      .notNull()
      .default(emptyJsonArray),
    contextFilePaths: jsonb("context_file_paths")
      .$type<TaskPacket["context"]["files"]>()
      .notNull()
      .default(emptyJsonArray),
    policySnapshot: jsonb("policy_snapshot").$type<RepoPolicy>(),
    validationCommands: jsonb("validation_commands").$type<ValidationCommand[]>(),
    status: text("status").notNull().default("draft"),
    requestedByActorId: text("requested_by_actor_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    approvedAt: timestamp("approved_at", { withTimezone: true }),
  },
  (table) => [
    index("tasks_workspace_id_status_idx").on(table.workspaceId, table.status),
    index("tasks_repo_mapping_id_idx").on(table.repoMappingId),
    index("tasks_source_lookup_idx").on(table.workspaceId, table.sourceType, table.externalId),
  ],
);

export const runs = pgTable(
  "runs",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    taskId: text("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    repoMappingId: text("repo_mapping_id")
      .notNull()
      .references(() => repoMappings.id, { onDelete: "restrict" }),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    contractVersion: text("contract_version").notNull(),
    jobId: text("job_id").notNull(),
    jobType: runnerJobTypeEnum("job_type").notNull(),
    state: runStateEnum("state").notNull().default("queued"),
    mode: taskPacketModeEnum("mode").notNull(),
    taskPacket: jsonb("task_packet").$type<TaskPacket>(),
    attemptCount: integer("attempt_count").notNull().default(0),
    maxAttempts: integer("max_attempts").notNull().default(1),
    claimIdempotencyKey: text("claim_idempotency_key"),
    claimExpiresAt: timestamp("claim_expires_at", { withTimezone: true }),
    capabilitiesSnapshot: jsonb("capabilities_snapshot").$type<RunnerCapabilities>(),
    policySnapshot: jsonb("policy_snapshot").$type<RepoPolicy>(),
    validationCommands: jsonb("validation_commands").$type<ValidationCommand[]>(),
    changedPaths: jsonb("changed_paths").$type<string[]>().notNull().default(emptyJsonArray),
    riskFindings: jsonb("risk_findings").$type<RiskFinding[]>().notNull().default(emptyJsonArray),
    queuedAt: timestamp("queued_at", { withTimezone: true }).notNull().defaultNow(),
    cancellationRequestedAt: timestamp("cancellation_requested_at", { withTimezone: true }),
    cancellationRequestedByActorId: text("cancellation_requested_by_actor_id"),
    cancellationReason: text("cancellation_reason"),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    startedAt: timestamp("started_at", { withTimezone: true }),
    finishedAt: timestamp("finished_at", { withTimezone: true }),
    lastEventAt: timestamp("last_event_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("runs_claim_idempotency_key_unique").on(table.claimIdempotencyKey),
    uniqueIndex("runs_workspace_id_job_id_unique").on(table.workspaceId, table.jobId),
    index("runs_workspace_id_state_idx").on(table.workspaceId, table.state),
    index("runs_queue_lookup_idx").on(
      table.workspaceId,
      table.repoMappingId,
      table.state,
      table.queuedAt,
    ),
    index("runs_task_id_idx").on(table.taskId),
    index("runs_runner_id_state_idx").on(table.runnerId, table.state),
    index("runs_created_at_idx").on(table.createdAt),
  ],
);

export const runEvents = pgTable(
  "run_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    contractVersion: text("contract_version").notNull(),
    idempotencyKey: text("idempotency_key").notNull(),
    state: runStateEnum("state").notNull(),
    severity: runEventSeverityEnum("severity").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata").$type<RunEvent["metadata"]>().notNull().default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull(),
    receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("run_events_run_id_idempotency_key_unique").on(table.runId, table.idempotencyKey),
    index("run_events_run_id_created_at_idx").on(table.runId, table.createdAt),
    index("run_events_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    index("run_events_workspace_id_severity_idx").on(table.workspaceId, table.severity),
  ],
);

export const dryRunResults = pgTable(
  "dry_run_results",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").notNull(),
    status: dryRunResultStatusEnum("status").notNull(),
    checks: jsonb("checks").$type<DryRunResult["checks"]>().notNull().default(emptyJsonArray),
    capabilities: jsonb("capabilities").$type<DryRunResult["capabilities"]>().notNull(),
    blockers: jsonb("blockers").$type<DryRunResult["blockers"]>().notNull().default(emptyJsonArray),
    warnings: jsonb("warnings").$type<DryRunResult["warnings"]>().notNull().default(emptyJsonArray),
    resultCreatedAt: timestamp("result_created_at", { withTimezone: true }).notNull(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("dry_run_results_run_id_unique").on(table.runId),
    index("dry_run_results_run_id_idx").on(table.runId),
    index("dry_run_results_workspace_id_status_idx").on(table.workspaceId, table.status),
  ],
);

export const validationResults = pgTable(
  "validation_results",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").notNull(),
    commandId: text("command_id").notNull(),
    commandLabel: text("command_label").notNull(),
    command: text("command").notNull(),
    status: validationResultStatusEnum("status").notNull(),
    exitCode: integer("exit_code"),
    durationMs: integer("duration_ms").notNull(),
    stdoutSummary: text("stdout_summary").notNull().default(""),
    stderrSummary: text("stderr_summary").notNull().default(""),
    redactionApplied: boolean("redaction_applied").notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    finishedAt: timestamp("finished_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("validation_results_run_id_idx").on(table.runId),
    index("validation_results_workspace_id_status_idx").on(table.workspaceId, table.status),
  ],
);

export const prArtifacts = pgTable(
  "pr_artifacts",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").notNull(),
    repositoryOwner: text("repository_owner").notNull(),
    repositoryName: text("repository_name").notNull(),
    branchName: text("branch_name").notNull(),
    prNumber: integer("pr_number").notNull(),
    prUrl: text("pr_url").notNull(),
    prTitle: text("pr_title").notNull(),
    prStatus: prArtifactStatusEnum("pr_status").notNull(),
    githubReviewState: text("github_review_state")
      .$type<GitHubPrReviewState>()
      .notNull()
      .default("unknown"),
    githubChecksSummary: jsonb("github_checks_summary")
      .$type<GitHubPrChecksSummary>()
      .notNull()
      .default(unknownGitHubChecksSummary),
    githubSyncedAt: timestamp("github_synced_at", { withTimezone: true }),
    changedFilePaths: jsonb("changed_file_paths")
      .$type<PrArtifact["changedFilePaths"]>()
      .notNull()
      .default(emptyJsonArray),
    riskFindings: jsonb("risk_findings")
      .$type<PrArtifact["riskFindings"]>()
      .notNull()
      .default(emptyJsonArray),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("pr_artifacts_run_id_unique").on(table.runId),
    index("pr_artifacts_workspace_id_status_idx").on(table.workspaceId, table.prStatus),
    index("pr_artifacts_workspace_github_review_state_idx").on(
      table.workspaceId,
      table.githubReviewState,
    ),
    index("pr_artifacts_workspace_github_synced_at_idx").on(
      table.workspaceId,
      table.githubSyncedAt,
    ),
    check(
      "pr_artifacts_github_review_state_valid",
      sql`${table.githubReviewState} in ('approved', 'changes_requested', 'review_required', 'unknown')`,
    ),
    check(
      "pr_artifacts_github_checks_summary_object",
      sql`jsonb_typeof(${table.githubChecksSummary}) = 'object'`,
    ),
  ],
);

export const repairRequests = pgTable(
  "repair_requests",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    previousRunId: text("previous_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    queuedRunId: text("queued_run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    requestedByActorId: text("requested_by_actor_id").notNull(),
    feedback: text("feedback").notNull(),
    attempt: integer("attempt").notNull(),
    maxAttempts: integer("max_attempts").notNull().default(2),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("repair_requests_queued_run_id_unique").on(table.queuedRunId),
    uniqueIndex("repair_requests_previous_run_id_attempt_unique").on(
      table.previousRunId,
      table.attempt,
    ),
    index("repair_requests_previous_run_id_created_at_idx").on(
      table.previousRunId,
      table.createdAt,
    ),
    index("repair_requests_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    check("repair_requests_attempt_positive", sql`${table.attempt} >= 1`),
    check("repair_requests_max_attempts_positive", sql`${table.maxAttempts} >= 1`),
    check(
      "repair_requests_attempt_within_max_attempts",
      sql`${table.attempt} <= ${table.maxAttempts}`,
    ),
  ],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    runId: text("run_id")
      .notNull()
      .references(() => runs.id, { onDelete: "cascade" }),
    contractVersion: text("contract_version").notNull(),
    actorId: text("actor_id").notNull(),
    decision: approvalDecisionEnum("decision").notNull(),
    reason: text("reason").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("approvals_run_id_created_at_idx").on(table.runId, table.createdAt),
    index("approvals_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    index("approvals_actor_id_idx").on(table.actorId),
  ],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    workspaceId: text("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    actorId: text("actor_id"),
    runnerId: text("runner_id").references(() => runners.id, { onDelete: "set null" }),
    runId: text("run_id").references(() => runs.id, { onDelete: "set null" }),
    taskId: text("task_id").references(() => tasks.id, { onDelete: "set null" }),
    eventType: text("event_type").notNull(),
    message: text("message").notNull(),
    metadata: jsonb("metadata")
      .$type<Record<string, unknown> | ApprovalDecision>()
      .notNull()
      .default(emptyJsonObject),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index("audit_events_workspace_id_created_at_idx").on(table.workspaceId, table.createdAt),
    index("audit_events_actor_id_idx").on(table.actorId),
    index("audit_events_run_id_idx").on(table.runId),
    index("audit_events_task_id_idx").on(table.taskId),
  ],
);

export const schema = {
  approvals,
  auditEvents,
  cortexTaskExternalLinks,
  cortexTasks,
  dryRunResults,
  findingTaskLinks,
  findings,
  githubAppInstallations,
  githubRepositories,
  linearIssueCandidates,
  linearOAuthConnections,
  memberships,
  prArtifacts,
  repoReadinessReports,
  repoMappings,
  repoScans,
  repairRequests,
  runEvents,
  runnerPairingCodes,
  runners,
  runs,
  setupPrPreviews,
  taskRecommendations,
  tasks,
  usageEvents,
  validationResults,
  workspaces,
};

export type Workspace = typeof workspaces.$inferSelect;
export type Membership = typeof memberships.$inferSelect;
export type Runner = typeof runners.$inferSelect;
export type RunnerPairingCode = typeof runnerPairingCodes.$inferSelect;
export type LinearOAuthConnection = typeof linearOAuthConnections.$inferSelect;
export type LinearIssueCandidate = typeof linearIssueCandidates.$inferSelect;
export type GitHubAppInstallation = typeof githubAppInstallations.$inferSelect;
export type GitHubRepository = typeof githubRepositories.$inferSelect;
export type CortexTaskRecord = typeof cortexTasks.$inferSelect;
export type CortexTaskExternalLinkRecord = typeof cortexTaskExternalLinks.$inferSelect;
export type FindingTaskLinkRecord = typeof findingTaskLinks.$inferSelect;
export type RepoMapping = typeof repoMappings.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Run = typeof runs.$inferSelect;
export type RunEventRecord = typeof runEvents.$inferSelect;
export type DryRunResultRecord = typeof dryRunResults.$inferSelect;
export type ValidationResultRecord = typeof validationResults.$inferSelect;
export type PrArtifactRecord = typeof prArtifacts.$inferSelect;
export type RepoScanRecord = typeof repoScans.$inferSelect;
export type FindingRecord = typeof findings.$inferSelect;
export type RepoReadinessReportRecord = typeof repoReadinessReports.$inferSelect;
export type TaskRecommendationRecord = typeof taskRecommendations.$inferSelect;
export type SetupPrPreviewRecord = typeof setupPrPreviews.$inferSelect;
export type UsageEventRecord = typeof usageEvents.$inferSelect;
export type RepairRequest = typeof repairRequests.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type AuditEvent = typeof auditEvents.$inferSelect;

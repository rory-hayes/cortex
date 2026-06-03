import "server-only";

import type {
  CortexTaskApprovalStatus,
  CortexTaskExecutionMode,
  CortexTaskRiskLevel,
  CortexTaskStatus,
  FindingCategory,
  FindingSeverity,
  FindingStatus,
  PrArtifactStatus,
  RepoScanStatus,
  RiskFinding,
  RunEventSeverity,
  RunState,
  TaskRecommendationStatus,
  TaskPacketMode,
  ValidationResultStatus,
} from "@control-plane/shared";
import { reviewGitHubAppPermissions } from "@control-plane/github";

import { and, desc, eq, getDatabase, inArray, schema, sql, type Database } from "../db";
import { hasUnsafeArtifactText, hasUnsafePathText } from "../runs/artifact-safety";
import {
  countUniquePaths,
  deriveReviewStateBucket,
  summarizeRiskFindings,
  summarizeValidationStatuses,
  type RiskCategoryCount,
  type ValidationStatusCount,
} from "../runs/review-metadata";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";

const ID_MAX_LENGTH = 160;
const RECENT_RUN_LIMIT = 6;
const RUN_TRACE_EVENT_LIMIT = 8;
const RUN_PREVIEW_LIMIT = 4;
const SAFE_TOOL_NAMES = ["git", "gh", "codex", "node", "npm", "pnpm", "yarn", "python"] as const;

type SafeToolName = (typeof SAFE_TOOL_NAMES)[number];
type RunnerHeartbeatStatus = "busy" | "idle" | "offline";
type OverviewRunnerStatus = RunnerHeartbeatStatus | "revoked";
type OverviewTaskStatus = "approved" | "draft";
type SummaryCardTone = "danger" | "neutral" | "success" | "warning";
type BuildPhaseStatus = "completed" | "current" | "upcoming";
type GitHubRepositoryVisibility = "internal" | "private" | "public" | null;
type GitHubConnectionStatus = "connected" | "not_connected" | "suspended";
type GitHubScanPermissionStatus =
  | "blocked"
  | "needs_permission"
  | "ready"
  | "suspended"
  | "unknown";

export type DashboardOverviewRunnerCapabilitiesSummary = {
  availableTools: SafeToolName[];
  maxConcurrentJobs: number;
  supportsCancellation: boolean;
  supportsDryRun: boolean;
  toolAvailability: Array<{
    available: boolean;
    name: SafeToolName;
  }>;
};

export type DashboardOverviewRunner = {
  capabilitiesSummary: DashboardOverviewRunnerCapabilitiesSummary;
  displayName: string;
  id: string;
  lastHeartbeatAt: Date | null;
  revokedAt: Date | null;
  status: OverviewRunnerStatus;
};

export type DashboardOverviewRunnerHealth = {
  busy: number;
  idle: number;
  offline: number;
  online: number;
  revoked: number;
  runners: DashboardOverviewRunner[];
  total: number;
};

export type DashboardOverviewWorkBuckets = {
  awaitingApprovalRuns: number;
  blockedRuns: number;
  failedRuns: number;
  prReadyRuns: number;
  queuedWork: number;
  readyTasks: number;
  runningRuns: number;
};

export type DashboardOverviewSummaryCard = {
  detail: string;
  id: "awaiting_approval" | "needs_attention" | "ready_work" | "runner_health" | "running_work";
  label: string;
  tone: SummaryCardTone;
  value: number;
};

export type DashboardOverviewRunSummary = {
  changedFileCount: number;
  id: string;
  mode: TaskPacketMode;
  pr: {
    number: number;
    status: PrArtifactStatus;
    title: string;
    url: string | null;
  } | null;
  repository: {
    name: string;
    owner: string;
  };
  risk: {
    blockerCount: number;
    categoryCounts: RiskCategoryCount[];
    warningCount: number;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  state: RunState;
  task: {
    id: string;
    title: string;
  };
  updatedAt: Date;
  validationStatusCounts: ValidationStatusCount[];
};

export type DashboardOverviewTraceEvent = {
  createdAt: Date;
  id: string;
  message: string;
  receivedAt: Date;
  runnerId: string | null;
  severity: RunEventSeverity;
  state: RunState;
};

export type DashboardOverviewRunTrace = {
  events: DashboardOverviewTraceEvent[];
  runId: string | null;
};

export type DashboardOverviewBuildPhase = {
  id: string;
  label: string;
  order: number;
  status: BuildPhaseStatus;
};

export type DashboardOverviewRepositoryOption = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  scanPermissionDetail: string;
  scanPermissionLabel: string;
  scanPermissionStatus: GitHubScanPermissionStatus;
  visibility: GitHubRepositoryVisibility;
  workspaceId: string;
};

export type DashboardOverviewRepoReadinessOnboarding = {
  activeInstallationCount: number;
  connectionStatus: GitHubConnectionStatus;
  hasAnyScans: boolean;
  hasRepoAccess: boolean;
  installationCount: number;
  repositoryOptions: DashboardOverviewRepositoryOption[];
};

export type DashboardOverviewActionItemId =
  | "monitor_runs"
  | "pair_runner"
  | "review_approvals"
  | "review_findings"
  | "review_recommendations"
  | "review_tasks"
  | "resolve_blockers"
  | "start_scan"
  | "watch_scans";

export type DashboardOverviewActionItem = {
  count: number;
  description: string;
  href: string;
  id: DashboardOverviewActionItemId;
  label: string;
  title: string;
  tone: SummaryCardTone;
};

export type DashboardOverviewActionability = {
  items: DashboardOverviewActionItem[];
  runnerInstalled: boolean;
  runnerOnline: boolean;
  totals: {
    activeScans: number;
    approvedLocalRunnerTasks: number;
    approvedRecommendations: number;
    awaitingApprovalRuns: number;
    blockedFindings: number;
    blockedRuns: number;
    completedScans: number;
    draftCortexTasks: number;
    openFindings: number;
    openRecommendations: number;
    queuedLocalRunnerTasks: number;
    reviewCortexTasks: number;
    runningRuns: number;
  };
};

export type WorkspaceDashboardOverview = {
  actionability: DashboardOverviewActionability;
  activeRuns: DashboardOverviewRunSummary[];
  awaitingApprovalRuns: DashboardOverviewRunSummary[];
  blockedRuns: DashboardOverviewRunSummary[];
  buildPhases: DashboardOverviewBuildPhase[];
  recentRuns: DashboardOverviewRunSummary[];
  repoReadinessOnboarding: DashboardOverviewRepoReadinessOnboarding;
  runnerHealth: DashboardOverviewRunnerHealth;
  selectedRunTrace: DashboardOverviewRunTrace;
  summaryCards: DashboardOverviewSummaryCard[];
  workBuckets: DashboardOverviewWorkBuckets;
};

export type DashboardOverviewRunnerRow = {
  codexAvailable: boolean;
  displayName: string;
  ghAvailable: boolean;
  gitAvailable: boolean;
  id: string;
  lastHeartbeatAt: Date | null;
  maxConcurrentJobs: number;
  nodeAvailable: boolean;
  npmAvailable: boolean;
  pnpmAvailable: boolean;
  pythonAvailable: boolean;
  revokedAt: Date | null;
  status: RunnerHeartbeatStatus;
  supportsCancellation: boolean;
  supportsDryRun: boolean;
  workspaceId: string;
  yarnAvailable: boolean;
};

export type DashboardOverviewTaskRow = {
  createdAt: Date;
  id: string;
  mode: TaskPacketMode;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  status: OverviewTaskStatus;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewRunRow = {
  changedPaths: string[];
  createdAt: Date;
  id: string;
  lastEventAt: Date | null;
  mode: TaskPacketMode;
  prChangedFilePaths: string[] | null;
  prNumber: number | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
  prTitle: string | null;
  prUrl: string | null;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: RiskFinding[];
  runnerDisplayName: string | null;
  runnerId: string | null;
  state: RunState;
  taskId: string;
  taskTitle: string;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewValidationResultRow = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

export type DashboardOverviewRunEventRow = {
  createdAt: Date;
  id: string;
  message: string;
  receivedAt: Date;
  runId: string;
  runnerId: string | null;
  severity: RunEventSeverity;
  state: RunState;
  workspaceId: string;
};

export type DashboardOverviewGitHubRepositoryRow = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubAppInstallationId: string;
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  visibility: GitHubRepositoryVisibility;
  workspaceId: string;
};

export type DashboardOverviewGitHubInstallationRow = {
  id: string;
  permissionGrants: Record<string, string>;
  suspendedAt: Date | null;
  workspaceId: string;
};

export type DashboardOverviewRepoScanRow = {
  createdAt: Date;
  finishedAt: Date | null;
  id: string;
  repoId: string;
  startedAt: Date | null;
  status: RepoScanStatus;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewFindingRow = {
  category: FindingCategory;
  id: string;
  repoId: string;
  scanId: string;
  severity: FindingSeverity;
  status: FindingStatus;
  taskIds: string[];
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewTaskRecommendationRow = {
  cortexTaskId: string | null;
  executionMode: CortexTaskExecutionMode;
  id: string;
  repoId: string;
  riskLevel: CortexTaskRiskLevel;
  scanId: string;
  status: TaskRecommendationStatus;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewCortexTaskRow = {
  approvalStatus: CortexTaskApprovalStatus;
  executionMode: CortexTaskExecutionMode;
  id: string;
  latestRunId: string | null;
  repoId: string;
  riskLevel: CortexTaskRiskLevel;
  status: CortexTaskStatus;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type DashboardOverviewStore = WorkspaceMembershipStore & {
  listWorkspaceOverviewCortexTasks: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewCortexTaskRow[]>;
  listWorkspaceOverviewFindings: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewFindingRow[]>;
  listWorkspaceOverviewGitHubInstallations: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewGitHubInstallationRow[]>;
  listWorkspaceOverviewGitHubRepositories: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewGitHubRepositoryRow[]>;
  listWorkspaceOverviewRepoScans: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewRepoScanRow[]>;
  listWorkspaceOverviewRunEvents: (input: {
    limit: number;
    runId: string;
    workspaceId: string;
  }) => Promise<DashboardOverviewRunEventRow[]>;
  listWorkspaceOverviewRunners: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewRunnerRow[]>;
  listWorkspaceOverviewRuns: (input: { workspaceId: string }) => Promise<DashboardOverviewRunRow[]>;
  listWorkspaceOverviewTaskRecommendations: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewTaskRecommendationRow[]>;
  listWorkspaceOverviewTasks: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewTaskRow[]>;
  listWorkspaceOverviewValidationResults: (input: {
    workspaceId: string;
  }) => Promise<DashboardOverviewValidationResultRow[]>;
};

export type DashboardOverviewService = {
  getWorkspaceDashboardOverview: (input: {
    selectedRunId?: string | undefined;
    workspaceId: string;
  }) => Promise<WorkspaceDashboardOverview>;
};

const buildPhases = [
  { id: "project_foundation", label: "Project foundation", order: 1, status: "completed" },
  { id: "shared_contracts", label: "Shared contracts", order: 2, status: "completed" },
  { id: "local_runner_proof", label: "Local runner proof", order: 3, status: "completed" },
  {
    id: "minimal_web_control_plane",
    label: "Minimal web control plane",
    order: 4,
    status: "completed",
  },
  { id: "runner_protocol", label: "Runner protocol and polling", order: 5, status: "completed" },
  { id: "github_visibility", label: "GitHub visibility", order: 6, status: "completed" },
  { id: "external_task_import", label: "External task import", order: 7, status: "completed" },
  { id: "approval_repair_loop", label: "Approval and repair loop", order: 8, status: "completed" },
  { id: "dashboard_polish", label: "Dashboard Polish", order: 9, status: "current" },
  { id: "billing_hooks", label: "Billing hooks", order: 10, status: "upcoming" },
  { id: "security_hardening", label: "Security hardening", order: 11, status: "upcoming" },
  {
    id: "end_to_end_mvp_validation",
    label: "End-to-end MVP validation",
    order: 12,
    status: "upcoming",
  },
] satisfies DashboardOverviewBuildPhase[];

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const normalizeRequiredId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    hasControlCharacter(value) ||
    normalizedValue.length === 0 ||
    normalizedValue.length > ID_MAX_LENGTH
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const normalizeOptionalId = (value: string | undefined): string | undefined => {
  if (value === undefined) {
    return undefined;
  }

  return normalizeRequiredId(value);
};

const compareUpdatedDesc = (
  left: Pick<DashboardOverviewRunRow, "createdAt" | "id" | "lastEventAt" | "updatedAt">,
  right: Pick<DashboardOverviewRunRow, "createdAt" | "id" | "lastEventAt" | "updatedAt">,
): number => {
  const leftTimestamp = (left.lastEventAt ?? left.updatedAt ?? left.createdAt).getTime();
  const rightTimestamp = (right.lastEventAt ?? right.updatedAt ?? right.createdAt).getTime();
  const timestampDelta = rightTimestamp - leftTimestamp;

  if (timestampDelta !== 0) {
    return timestampDelta;
  }

  return left.id.localeCompare(right.id);
};

const compareEventsAscending = (
  left: DashboardOverviewRunEventRow,
  right: DashboardOverviewRunEventRow,
): number => {
  const createdAtDelta = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtDelta !== 0) {
    return createdAtDelta;
  }

  const receivedAtDelta = left.receivedAt.getTime() - right.receivedAt.getTime();

  if (receivedAtDelta !== 0) {
    return receivedAtDelta;
  }

  return left.id.localeCompare(right.id);
};

const compareEventsDescending = (
  left: DashboardOverviewRunEventRow,
  right: DashboardOverviewRunEventRow,
): number => compareEventsAscending(right, left);

const toSafeArtifactText = (value: string | null, fallback: string): string => {
  const normalizedValue = value?.trim() ?? "";

  return normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)
    ? fallback
    : normalizedValue;
};

const toSafeOptionalUrl = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)) {
    return null;
  }

  try {
    const url = new URL(normalizedValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const toSafeChangedFilePaths = (changedFilePaths: readonly string[] | null | undefined): string[] =>
  Array.from(
    new Set(
      (changedFilePaths ?? [])
        .map((changedFilePath) =>
          typeof changedFilePath === "string" ? changedFilePath.trim() : "",
        )
        .filter(
          (changedFilePath) => changedFilePath.length > 0 && !hasUnsafePathText(changedFilePath),
        ),
    ),
  ).toSorted((left, right) => left.localeCompare(right));

const getToolAvailability = (
  runner: DashboardOverviewRunnerRow,
  toolName: SafeToolName,
): boolean => {
  switch (toolName) {
    case "codex":
      return runner.codexAvailable;
    case "gh":
      return runner.ghAvailable;
    case "git":
      return runner.gitAvailable;
    case "node":
      return runner.nodeAvailable;
    case "npm":
      return runner.npmAvailable;
    case "pnpm":
      return runner.pnpmAvailable;
    case "python":
      return runner.pythonAvailable;
    case "yarn":
      return runner.yarnAvailable;
  }
};

const summarizeCapabilities = (
  runner: DashboardOverviewRunnerRow,
): DashboardOverviewRunnerCapabilitiesSummary => {
  const toolAvailability = SAFE_TOOL_NAMES.map((toolName) => ({
    available: getToolAvailability(runner, toolName),
    name: toolName,
  }));

  return {
    availableTools: toolAvailability
      .filter((toolSummary) => toolSummary.available)
      .map((toolSummary) => toolSummary.name),
    maxConcurrentJobs: runner.maxConcurrentJobs,
    supportsCancellation: runner.supportsCancellation,
    supportsDryRun: runner.supportsDryRun,
    toolAvailability,
  };
};

const toRunnerStatus = (runner: DashboardOverviewRunnerRow): OverviewRunnerStatus =>
  runner.revokedAt === null ? runner.status : "revoked";

const toOverviewRunner = (runner: DashboardOverviewRunnerRow): DashboardOverviewRunner => ({
  capabilitiesSummary: summarizeCapabilities(runner),
  displayName: toSafeArtifactText(runner.displayName, "Runner unavailable"),
  id: runner.id,
  lastHeartbeatAt: runner.lastHeartbeatAt,
  revokedAt: runner.revokedAt,
  status: toRunnerStatus(runner),
});

const createRunnerHealth = (rows: DashboardOverviewRunnerRow[]): DashboardOverviewRunnerHealth => {
  const runners = rows.map(toOverviewRunner);

  return {
    busy: runners.filter((runner) => runner.status === "busy").length,
    idle: runners.filter((runner) => runner.status === "idle").length,
    offline: runners.filter((runner) => runner.status === "offline").length,
    online: runners.filter((runner) => runner.status === "busy" || runner.status === "idle").length,
    revoked: runners.filter((runner) => runner.status === "revoked").length,
    runners,
    total: runners.length,
  };
};

const getChangedFileCount = (run: DashboardOverviewRunRow): number => {
  const safePrChangedFilePaths = toSafeChangedFilePaths(run.prChangedFilePaths);

  if (safePrChangedFilePaths.length > 0) {
    return countUniquePaths(safePrChangedFilePaths);
  }

  return countUniquePaths(toSafeChangedFilePaths(run.changedPaths));
};

const toRunSummary = (
  run: DashboardOverviewRunRow,
  validationResults: DashboardOverviewValidationResultRow[],
): DashboardOverviewRunSummary => {
  const risk = summarizeRiskFindings(run.riskFindings, run.prRiskFindings);

  return {
    changedFileCount: getChangedFileCount(run),
    id: run.id,
    mode: run.mode,
    pr:
      run.prNumber === null || run.prStatus === null
        ? null
        : {
            number: run.prNumber,
            status: run.prStatus,
            title: toSafeArtifactText(run.prTitle, `Pull request #${run.prNumber}`),
            url: toSafeOptionalUrl(run.prUrl),
          },
    repository: {
      name: toSafeArtifactText(run.repositoryName, "unknown"),
      owner: toSafeArtifactText(run.repositoryOwner, "Repository unavailable"),
    },
    risk: {
      blockerCount: risk.blockerCount,
      categoryCounts: risk.categoryCounts,
      warningCount: risk.warningCount,
    },
    runner:
      run.runnerId === null || run.runnerDisplayName === null
        ? null
        : {
            displayName: toSafeArtifactText(run.runnerDisplayName, "Runner unavailable"),
            id: run.runnerId,
          },
    state: run.state,
    task: {
      id: run.taskId,
      title: toSafeArtifactText(run.taskTitle, "Task unavailable"),
    },
    updatedAt: run.lastEventAt ?? run.updatedAt,
    validationStatusCounts: summarizeValidationStatuses(
      validationResults.map((validationResult) => validationResult.status),
    ),
  };
};

const toTraceEvent = (event: DashboardOverviewRunEventRow): DashboardOverviewTraceEvent => ({
  createdAt: event.createdAt,
  id: event.id,
  message: toSafeArtifactText(event.message, "Event details unavailable."),
  receivedAt: event.receivedAt,
  runnerId: event.runnerId,
  severity: event.severity,
  state: event.state,
});

const normalizeRepositoryVisibility = (value: string | null): GitHubRepositoryVisibility => {
  if (value === "internal" || value === "private" || value === "public") {
    return value;
  }

  return null;
};

const SCAN_PERMISSION_DETAILS = {
  blocked: "Remove rejected MVP permissions before running repo-readiness scans.",
  needs_permission: "Grant metadata read and repository contents read access.",
  ready:
    "Scan-only uses GitHub metadata and repository contents read access without requiring the local runner.",
  suspended: "Reactivate the GitHub App installation before scanning repositories.",
  unknown: "Review GitHub App access before starting a scan.",
} satisfies Record<GitHubScanPermissionStatus, string>;

const SCAN_PERMISSION_LABELS = {
  blocked: "Scan blocked by rejected MVP permissions",
  needs_permission: "Scan-only needs permission upgrade",
  ready: "Scan-only ready",
  suspended: "Installation suspended",
  unknown: "Scan permissions unavailable",
} satisfies Record<GitHubScanPermissionStatus, string>;

const summarizeScanPermission = (
  installation: DashboardOverviewGitHubInstallationRow | undefined,
): Pick<
  DashboardOverviewRepositoryOption,
  "scanPermissionDetail" | "scanPermissionLabel" | "scanPermissionStatus"
> => {
  let scanPermissionStatus: GitHubScanPermissionStatus = "unknown";

  if (installation?.suspendedAt !== undefined && installation.suspendedAt !== null) {
    scanPermissionStatus = "suspended";
  } else if (installation !== undefined) {
    const permissionReview = reviewGitHubAppPermissions(installation.permissionGrants);

    if (permissionReview.rejectedPermissions.length > 0) {
      scanPermissionStatus = "blocked";
    } else if (permissionReview.profiles.scan_only.supported) {
      scanPermissionStatus = "ready";
    } else {
      scanPermissionStatus = "needs_permission";
    }
  }

  return {
    scanPermissionDetail: SCAN_PERMISSION_DETAILS[scanPermissionStatus],
    scanPermissionLabel: SCAN_PERMISSION_LABELS[scanPermissionStatus],
    scanPermissionStatus,
  };
};

const toRepositoryOption = (
  repository: DashboardOverviewGitHubRepositoryRow,
  installationsById: Map<string, DashboardOverviewGitHubInstallationRow>,
): DashboardOverviewRepositoryOption => {
  const repositoryOwner = toSafeArtifactText(repository.repositoryOwner, "unknown-owner");
  const repositoryName = toSafeArtifactText(repository.repositoryName, "repository");
  const scanPermission = summarizeScanPermission(
    installationsById.get(repository.githubAppInstallationId),
  );

  return {
    archived: repository.archived,
    defaultBranch: toSafeArtifactText(repository.defaultBranch, "default"),
    disabled: repository.disabled,
    id: repository.id,
    repositoryFullName: toSafeArtifactText(
      repository.repositoryFullName,
      `${repositoryOwner}/${repositoryName}`,
    ),
    repositoryName,
    repositoryOwner,
    ...scanPermission,
    visibility: normalizeRepositoryVisibility(repository.visibility),
    workspaceId: repository.workspaceId,
  };
};

const createRepoReadinessOnboarding = (input: {
  installations: DashboardOverviewGitHubInstallationRow[];
  repositories: DashboardOverviewGitHubRepositoryRow[];
  repoScans: DashboardOverviewRepoScanRow[];
  workspaceId: string;
}): DashboardOverviewRepoReadinessOnboarding => {
  const installations = input.installations.filter(
    (installation) => installation.workspaceId === input.workspaceId,
  );
  const installationsById = new Map(
    installations.map((installation) => [installation.id, installation]),
  );
  const installationCount = installations.length;
  const activeInstallationCount = installations.filter(
    (installation) => installation.suspendedAt === null,
  ).length;
  const connectionStatus: GitHubConnectionStatus =
    installationCount === 0
      ? "not_connected"
      : activeInstallationCount === 0
        ? "suspended"
        : "connected";
  const repositoryOptions = input.repositories
    .filter(
      (repository) =>
        repository.workspaceId === input.workspaceId &&
        !repository.archived &&
        !repository.disabled,
    )
    .map((repository) => toRepositoryOption(repository, installationsById))
    .toSorted((left, right) => left.repositoryFullName.localeCompare(right.repositoryFullName));

  return {
    activeInstallationCount,
    connectionStatus,
    hasAnyScans: input.repoScans.some((scan) => scan.workspaceId === input.workspaceId),
    hasRepoAccess: repositoryOptions.length > 0,
    installationCount,
    repositoryOptions,
  };
};

const createValidationResultsByRunId = (
  validationResults: DashboardOverviewValidationResultRow[],
  workspaceId: string,
): Map<string, DashboardOverviewValidationResultRow[]> => {
  const validationResultsByRunId = new Map<string, DashboardOverviewValidationResultRow[]>();

  validationResults
    .filter((validationResult) => validationResult.workspaceId === workspaceId)
    .forEach((validationResult) => {
      const currentResults = validationResultsByRunId.get(validationResult.runId) ?? [];

      currentResults.push(validationResult);
      validationResultsByRunId.set(validationResult.runId, currentResults);
    });

  return validationResultsByRunId;
};

const createWorkBuckets = (input: {
  runs: DashboardOverviewRunRow[];
  tasks: DashboardOverviewTaskRow[];
}): DashboardOverviewWorkBuckets => {
  const taskIdsWithRuns = new Set(input.runs.map((run) => run.taskId));
  const readyTasks = input.tasks.filter((task) => task.status === "draft").length;
  const approvedTasksWithoutRuns = input.tasks.filter(
    (task) => task.status === "approved" && !taskIdsWithRuns.has(task.id),
  ).length;
  const reviewBuckets = input.runs.map((run) =>
    deriveReviewStateBucket({ prStatus: run.prStatus, state: run.state }),
  );

  return {
    awaitingApprovalRuns: reviewBuckets.filter((bucket) => bucket === "awaiting_approval").length,
    blockedRuns: reviewBuckets.filter((bucket) => bucket === "blocked").length,
    failedRuns: reviewBuckets.filter((bucket) => bucket === "failed").length,
    prReadyRuns: reviewBuckets.filter((bucket) => bucket === "pr_ready").length,
    queuedWork:
      approvedTasksWithoutRuns + reviewBuckets.filter((bucket) => bucket === "ready").length,
    readyTasks,
    runningRuns: reviewBuckets.filter((bucket) => bucket === "running").length,
  };
};

const createSummaryCards = (input: {
  runnerHealth: DashboardOverviewRunnerHealth;
  workBuckets: DashboardOverviewWorkBuckets;
}): DashboardOverviewSummaryCard[] => [
  {
    detail: `${input.runnerHealth.offline} offline, ${input.runnerHealth.revoked} revoked`,
    id: "runner_health",
    label: "Runner health",
    tone: input.runnerHealth.online > 0 ? "success" : "warning",
    value: input.runnerHealth.online,
  },
  {
    detail: `${input.workBuckets.readyTasks} ready, ${input.workBuckets.queuedWork} queued`,
    id: "ready_work",
    label: "Ready work",
    tone: "neutral",
    value: input.workBuckets.readyTasks + input.workBuckets.queuedWork,
  },
  {
    detail: "Runs currently moving through the local runner",
    id: "running_work",
    label: "Running",
    tone: input.workBuckets.runningRuns > 0 ? "success" : "neutral",
    value: input.workBuckets.runningRuns,
  },
  {
    detail: `${input.workBuckets.blockedRuns} blocked, ${input.workBuckets.failedRuns} failed`,
    id: "needs_attention",
    label: "Needs attention",
    tone: input.workBuckets.blockedRuns + input.workBuckets.failedRuns > 0 ? "danger" : "neutral",
    value: input.workBuckets.blockedRuns + input.workBuckets.failedRuns,
  },
  {
    detail: `${input.workBuckets.prReadyRuns} PR-ready`,
    id: "awaiting_approval",
    label: "Awaiting approval",
    tone:
      input.workBuckets.awaitingApprovalRuns + input.workBuckets.prReadyRuns > 0
        ? "warning"
        : "neutral",
    value: input.workBuckets.awaitingApprovalRuns + input.workBuckets.prReadyRuns,
  },
];

const ACTIVE_SCAN_STATUSES = new Set<RepoScanStatus>(["queued", "running"]);

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  `${count} ${count === 1 ? singular : plural}`;

const createActionability = (input: {
  cortexTasks: DashboardOverviewCortexTaskRow[];
  findings: DashboardOverviewFindingRow[];
  repoReadinessOnboarding: DashboardOverviewRepoReadinessOnboarding;
  repoScans: DashboardOverviewRepoScanRow[];
  runnerHealth: DashboardOverviewRunnerHealth;
  taskRecommendations: DashboardOverviewTaskRecommendationRow[];
  workBuckets: DashboardOverviewWorkBuckets;
}): DashboardOverviewActionability => {
  const activeScans = input.repoScans.filter((scan) =>
    ACTIVE_SCAN_STATUSES.has(scan.status),
  ).length;
  const completedScans = input.repoScans.filter((scan) => scan.status === "completed").length;
  const openFindings = input.findings.filter((finding) => finding.status === "open");
  const openRecommendations = input.taskRecommendations.filter(
    (recommendation) => recommendation.status === "open",
  ).length;
  const approvedRecommendations = input.taskRecommendations.filter(
    (recommendation) => recommendation.status === "approved",
  ).length;
  const draftCortexTasks = input.cortexTasks.filter((task) => task.status === "draft").length;
  const reviewCortexTasks = input.cortexTasks.filter(
    (task) => task.status === "needs_review",
  ).length;
  const approvedLocalRunnerTasks = input.cortexTasks.filter(
    (task) => task.executionMode === "local_runner" && task.status === "approved",
  ).length;
  const queuedLocalRunnerTasks = input.cortexTasks.filter(
    (task) => task.executionMode === "local_runner" && task.status === "queued",
  ).length;
  const awaitingApprovalRuns =
    input.workBuckets.awaitingApprovalRuns + input.workBuckets.prReadyRuns;
  const blockedRuns = input.workBuckets.blockedRuns + input.workBuckets.failedRuns;
  const runnerInstalled = input.runnerHealth.total > 0;
  const runnerOnline = input.runnerHealth.online > 0;
  const blockedFindings = openFindings.filter((finding) => finding.severity === "blocked").length;
  const recommendationActionCount = openRecommendations + approvedRecommendations;
  const reviewTaskCount = draftCortexTasks + reviewCortexTasks;
  const localRunnerActionCount = approvedLocalRunnerTasks + queuedLocalRunnerTasks;
  const items: DashboardOverviewActionItem[] = [];

  if (activeScans > 0) {
    items.push({
      count: activeScans,
      description: "Repo-readiness scans are still collecting metadata-only findings.",
      href: "/dashboard/repositories",
      id: "watch_scans",
      label: "Scans",
      title: "Watch running scans",
      tone: "success",
    });
  } else if (completedScans === 0 && input.repoReadinessOnboarding.hasRepoAccess) {
    items.push({
      count: input.repoReadinessOnboarding.repositoryOptions.length,
      description: "Start with a scan to surface findings and AI-ready work before runner setup.",
      href: "/dashboard/repositories",
      id: "start_scan",
      label: "Scan",
      title: "Start repo readiness scan",
      tone: "neutral",
    });
  }

  if (openFindings.length > 0) {
    items.push({
      count: openFindings.length,
      description:
        blockedFindings > 0
          ? `${pluralize(blockedFindings, "blocked finding")} needs review before execution.`
          : "Open readiness findings can be reviewed before any local source execution.",
      href: "/dashboard/findings?status=open",
      id: "review_findings",
      label: "Findings",
      title: "Review readiness findings",
      tone: blockedFindings > 0 ? "danger" : "warning",
    });
  }

  if (recommendationActionCount > 0) {
    items.push({
      count: recommendationActionCount,
      description: "Approve or convert AI-ready recommendations into Cortex Tasks.",
      href: "/dashboard/task-recommendations",
      id: "review_recommendations",
      label: "Recommendations",
      title: "Approve AI-ready recommendations",
      tone: "warning",
    });
  }

  if (reviewTaskCount > 0) {
    items.push({
      count: reviewTaskCount,
      description: "Draft or needs-review tasks are waiting for a human decision.",
      href: "/dashboard/tasks?status=draft",
      id: "review_tasks",
      label: "Tasks",
      title: "Review Cortex Tasks",
      tone: "neutral",
    });
  }

  if (localRunnerActionCount > 0) {
    items.push(
      runnerOnline
        ? {
            count: localRunnerActionCount,
            description: "Approved and queued local-runner tasks can move with the paired runner.",
            href: "/dashboard/tasks?executionMode=local_runner",
            id: "monitor_runs",
            label: "Runner",
            title: "Monitor local execution",
            tone: "success",
          }
        : {
            count: localRunnerActionCount,
            description: "Approved local-runner work is waiting; source execution stays local.",
            href: "/dashboard/runners",
            id: "pair_runner",
            label: "Runner",
            title: "Pair local runner",
            tone: "warning",
          },
    );
  }

  if (awaitingApprovalRuns > 0) {
    items.push({
      count: awaitingApprovalRuns,
      description: "Validated runner output is waiting for human review.",
      href: "/dashboard/approvals",
      id: "review_approvals",
      label: "Approvals",
      title: "Review validated PRs",
      tone: "warning",
    });
  }

  if (blockedRuns > 0) {
    items.push({
      count: blockedRuns,
      description: "Blocked or failed runner work needs repair before it can proceed.",
      href: "/dashboard/runs?state=blocked",
      id: "resolve_blockers",
      label: "Blockers",
      title: "Resolve blocked runner work",
      tone: "danger",
    });
  }

  if (items.length === 0) {
    items.push({
      count: input.repoReadinessOnboarding.repositoryOptions.length,
      description:
        "No immediate blockers are visible; run another scan or review repository setup.",
      href: "/dashboard/repositories",
      id: "start_scan",
      label: "Scan",
      title: completedScans > 0 ? "Run another repo scan" : "Start repo readiness scan",
      tone: completedScans > 0 ? "success" : "neutral",
    });
  }

  return {
    items,
    runnerInstalled,
    runnerOnline,
    totals: {
      activeScans,
      approvedLocalRunnerTasks,
      approvedRecommendations,
      awaitingApprovalRuns,
      blockedFindings,
      blockedRuns,
      completedScans,
      draftCortexTasks,
      openFindings: openFindings.length,
      openRecommendations,
      queuedLocalRunnerTasks,
      reviewCortexTasks,
      runningRuns: input.workBuckets.runningRuns,
    },
  };
};

const selectRunSummaries = (input: {
  runs: DashboardOverviewRunRow[];
  validationResultsByRunId: Map<string, DashboardOverviewValidationResultRow[]>;
}): {
  activeRuns: DashboardOverviewRunSummary[];
  awaitingApprovalRuns: DashboardOverviewRunSummary[];
  blockedRuns: DashboardOverviewRunSummary[];
  recentRuns: DashboardOverviewRunSummary[];
} => {
  const sortedRuns = input.runs.toSorted(compareUpdatedDesc);
  const toSummary = (run: DashboardOverviewRunRow): DashboardOverviewRunSummary =>
    toRunSummary(run, input.validationResultsByRunId.get(run.id) ?? []);
  const bucketFor = (run: DashboardOverviewRunRow) =>
    deriveReviewStateBucket({ prStatus: run.prStatus, state: run.state });

  return {
    activeRuns: sortedRuns
      .filter((run) => bucketFor(run) === "running")
      .slice(0, RUN_PREVIEW_LIMIT)
      .map(toSummary),
    awaitingApprovalRuns: sortedRuns
      .filter((run) => run.state === "awaiting_approval")
      .slice(0, RUN_PREVIEW_LIMIT)
      .map(toSummary),
    blockedRuns: sortedRuns
      .filter((run) => {
        const bucket = bucketFor(run);

        return bucket === "blocked" || bucket === "failed";
      })
      .slice(0, RUN_PREVIEW_LIMIT)
      .map(toSummary),
    recentRuns: sortedRuns.slice(0, RECENT_RUN_LIMIT).map(toSummary),
  };
};

const createSelectedRunTrace = (input: {
  events: DashboardOverviewRunEventRow[];
  runId: string | null;
  workspaceId: string;
}): DashboardOverviewRunTrace => {
  if (input.runId === null) {
    return {
      events: [],
      runId: null,
    };
  }

  return {
    events: input.events
      .filter((event) => event.workspaceId === input.workspaceId && event.runId === input.runId)
      .toSorted(compareEventsDescending)
      .slice(0, RUN_TRACE_EVENT_LIMIT)
      .toSorted(compareEventsAscending)
      .map(toTraceEvent),
    runId: input.runId,
  };
};

export const createDrizzleDashboardOverviewStore = (db: Database): DashboardOverviewStore => ({
  findWorkspaceMembership: async ({ userId, workspaceId }) => {
    const [membership] = await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return membership ?? null;
  },
  listWorkspaceOverviewGitHubInstallations: async ({ workspaceId }) =>
    db
      .select({
        id: schema.githubAppInstallations.id,
        permissionGrants: schema.githubAppInstallations.permissions,
        suspendedAt: schema.githubAppInstallations.suspendedAt,
        workspaceId: schema.githubAppInstallations.workspaceId,
      })
      .from(schema.githubAppInstallations)
      .where(eq(schema.githubAppInstallations.workspaceId, workspaceId)),
  listWorkspaceOverviewGitHubRepositories: async ({ workspaceId }) =>
    db
      .select({
        archived: schema.githubRepositories.archived,
        defaultBranch: schema.githubRepositories.defaultBranch,
        disabled: schema.githubRepositories.disabled,
        githubAppInstallationId: schema.githubRepositories.githubAppInstallationId,
        id: schema.githubRepositories.id,
        repositoryFullName: schema.githubRepositories.repositoryFullName,
        repositoryName: schema.githubRepositories.repositoryName,
        repositoryOwner: schema.githubRepositories.repositoryOwner,
        visibility: schema.githubRepositories.visibility,
        workspaceId: schema.githubRepositories.workspaceId,
      })
      .from(schema.githubRepositories)
      .innerJoin(
        schema.githubAppInstallations,
        and(
          eq(schema.githubRepositories.githubAppInstallationId, schema.githubAppInstallations.id),
          eq(schema.githubAppInstallations.workspaceId, workspaceId),
        ),
      )
      .where(eq(schema.githubRepositories.workspaceId, workspaceId))
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          visibility: normalizeRepositoryVisibility(row.visibility),
        })),
      ),
  listWorkspaceOverviewRepoScans: async ({ workspaceId }) =>
    db
      .select({
        createdAt: schema.repoScans.createdAt,
        finishedAt: schema.repoScans.finishedAt,
        id: schema.repoScans.id,
        repoId: schema.repoScans.repoId,
        startedAt: schema.repoScans.startedAt,
        status: schema.repoScans.status,
        updatedAt: schema.repoScans.updatedAt,
        workspaceId: schema.repoScans.workspaceId,
      })
      .from(schema.repoScans)
      .where(eq(schema.repoScans.workspaceId, workspaceId))
      .orderBy(desc(schema.repoScans.createdAt), desc(schema.repoScans.updatedAt)),
  listWorkspaceOverviewFindings: async ({ workspaceId }) =>
    db
      .select({
        category: schema.findings.category,
        id: schema.findings.id,
        repoId: schema.findings.repoId,
        scanId: schema.findings.scanId,
        severity: schema.findings.severity,
        status: schema.findings.status,
        taskIds: schema.findings.taskIds,
        title: schema.findings.title,
        updatedAt: schema.findings.updatedAt,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(eq(schema.findings.workspaceId, workspaceId))
      .orderBy(desc(schema.findings.updatedAt)),
  listWorkspaceOverviewTaskRecommendations: async ({ workspaceId }) =>
    db
      .select({
        cortexTaskId: schema.taskRecommendations.cortexTaskId,
        executionMode: schema.taskRecommendations.executionMode,
        id: schema.taskRecommendations.id,
        repoId: schema.taskRecommendations.repoId,
        riskLevel: schema.taskRecommendations.riskLevel,
        scanId: schema.taskRecommendations.scanId,
        status: schema.taskRecommendations.status,
        title: schema.taskRecommendations.title,
        updatedAt: schema.taskRecommendations.updatedAt,
        workspaceId: schema.taskRecommendations.workspaceId,
      })
      .from(schema.taskRecommendations)
      .where(eq(schema.taskRecommendations.workspaceId, workspaceId))
      .orderBy(desc(schema.taskRecommendations.updatedAt)),
  listWorkspaceOverviewCortexTasks: async ({ workspaceId }) =>
    db
      .select({
        approvalStatus: schema.cortexTasks.approvalStatus,
        executionMode: schema.cortexTasks.executionMode,
        id: schema.cortexTasks.id,
        latestRunId: schema.cortexTasks.latestRunId,
        repoId: schema.cortexTasks.repoId,
        riskLevel: schema.cortexTasks.riskLevel,
        status: schema.cortexTasks.status,
        title: schema.cortexTasks.title,
        updatedAt: schema.cortexTasks.updatedAt,
        workspaceId: schema.cortexTasks.workspaceId,
      })
      .from(schema.cortexTasks)
      .where(eq(schema.cortexTasks.workspaceId, workspaceId))
      .orderBy(desc(schema.cortexTasks.updatedAt)),
  listWorkspaceOverviewRunEvents: async ({ limit, runId, workspaceId }) =>
    db
      .select({
        createdAt: schema.runEvents.createdAt,
        id: schema.runEvents.id,
        message: schema.runEvents.message,
        receivedAt: schema.runEvents.receivedAt,
        runId: schema.runEvents.runId,
        runnerId: schema.runEvents.runnerId,
        severity: schema.runEvents.severity,
        state: schema.runEvents.state,
        workspaceId: schema.runEvents.workspaceId,
      })
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.workspaceId, workspaceId), eq(schema.runEvents.runId, runId)))
      .orderBy(
        desc(schema.runEvents.createdAt),
        desc(schema.runEvents.receivedAt),
        desc(schema.runEvents.id),
      )
      .limit(limit),
  listWorkspaceOverviewRunners: async ({ workspaceId }) =>
    db
      .select({
        codexAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'codex' ->> 'available')::boolean, false)`,
        displayName: schema.runners.displayName,
        ghAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'gh' ->> 'available')::boolean, false)`,
        gitAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'git' ->> 'available')::boolean, false)`,
        id: schema.runners.id,
        lastHeartbeatAt: schema.runners.lastHeartbeatAt,
        maxConcurrentJobs: sql<number>`coalesce((${schema.runners.capabilities} ->> 'maxConcurrentJobs')::integer, 1)`,
        nodeAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'node' ->> 'available')::boolean, false)`,
        npmAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'npm' ->> 'available')::boolean, false)`,
        pnpmAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'pnpm' ->> 'available')::boolean, false)`,
        pythonAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'python' ->> 'available')::boolean, false)`,
        revokedAt: schema.runners.revokedAt,
        status: schema.runners.status,
        supportsCancellation: sql<boolean>`coalesce((${schema.runners.capabilities} ->> 'supportsCancellation')::boolean, false)`,
        supportsDryRun: sql<boolean>`coalesce((${schema.runners.capabilities} ->> 'supportsDryRun')::boolean, false)`,
        workspaceId: schema.runners.workspaceId,
        yarnAvailable: sql<boolean>`coalesce((${schema.runners.capabilities} -> 'tools' -> 'yarn' ->> 'available')::boolean, false)`,
      })
      .from(schema.runners)
      .where(eq(schema.runners.workspaceId, workspaceId)),
  listWorkspaceOverviewRuns: async ({ workspaceId }) =>
    db
      .select({
        changedPaths: schema.runs.changedPaths,
        createdAt: schema.runs.createdAt,
        id: schema.runs.id,
        lastEventAt: schema.runs.lastEventAt,
        mode: schema.runs.mode,
        prChangedFilePaths: schema.prArtifacts.changedFilePaths,
        prNumber: schema.prArtifacts.prNumber,
        prRiskFindings: schema.prArtifacts.riskFindings,
        prStatus: schema.prArtifacts.prStatus,
        prTitle: schema.prArtifacts.prTitle,
        prUrl: schema.prArtifacts.prUrl,
        repoMappingId: schema.repoMappings.id,
        repositoryName: schema.repoMappings.repositoryName,
        repositoryOwner: schema.repoMappings.repositoryOwner,
        riskFindings: schema.runs.riskFindings,
        runnerDisplayName: schema.runners.displayName,
        runnerId: schema.runners.id,
        state: schema.runs.state,
        taskId: schema.tasks.id,
        taskTitle: schema.tasks.title,
        updatedAt: schema.runs.updatedAt,
        workspaceId: schema.runs.workspaceId,
      })
      .from(schema.runs)
      .innerJoin(
        schema.tasks,
        and(eq(schema.runs.taskId, schema.tasks.id), eq(schema.tasks.workspaceId, workspaceId)),
      )
      .innerJoin(
        schema.repoMappings,
        and(
          eq(schema.runs.repoMappingId, schema.repoMappings.id),
          eq(schema.repoMappings.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.runners,
        and(
          eq(schema.runs.runnerId, schema.runners.id),
          eq(schema.runners.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.prArtifacts,
        and(
          eq(schema.prArtifacts.runId, schema.runs.id),
          eq(schema.prArtifacts.workspaceId, workspaceId),
        ),
      )
      .where(eq(schema.runs.workspaceId, workspaceId))
      .orderBy(desc(schema.runs.updatedAt), desc(schema.runs.createdAt)),
  listWorkspaceOverviewTasks: async ({ workspaceId }) =>
    db
      .select({
        createdAt: schema.tasks.createdAt,
        id: schema.tasks.id,
        mode: schema.tasks.mode,
        repoMappingId: schema.repoMappings.id,
        repositoryName: schema.repoMappings.repositoryName,
        repositoryOwner: schema.repoMappings.repositoryOwner,
        status: schema.tasks.status,
        title: schema.tasks.title,
        updatedAt: schema.tasks.updatedAt,
        workspaceId: schema.tasks.workspaceId,
      })
      .from(schema.tasks)
      .innerJoin(
        schema.repoMappings,
        and(
          eq(schema.repoMappings.id, schema.tasks.repoMappingId),
          eq(schema.repoMappings.workspaceId, workspaceId),
        ),
      )
      .where(
        and(
          eq(schema.tasks.workspaceId, workspaceId),
          inArray(schema.tasks.status, ["draft", "approved"]),
        ),
      )
      .orderBy(desc(schema.tasks.updatedAt), desc(schema.tasks.createdAt))
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          status: row.status as OverviewTaskStatus,
        })),
      ),
  listWorkspaceOverviewValidationResults: async ({ workspaceId }) =>
    db
      .select({
        runId: schema.validationResults.runId,
        status: schema.validationResults.status,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(eq(schema.validationResults.workspaceId, workspaceId)),
});

export const createDashboardOverviewService = (input: {
  getAuthContext?: GetAuthContext;
  store: DashboardOverviewStore;
}): DashboardOverviewService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    getWorkspaceDashboardOverview: async ({ selectedRunId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeRequiredId(workspaceId);
      const normalizedSelectedRunId = normalizeOptionalId(selectedRunId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [
        githubInstallationRows,
        githubRepositoryRows,
        repoScanRows,
        findingRows,
        taskRecommendationRows,
        cortexTaskRows,
        runnerRows,
        taskRows,
        runRows,
        validationRows,
      ] = await Promise.all([
        input.store.listWorkspaceOverviewGitHubInstallations({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewGitHubRepositories({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewRepoScans({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewFindings({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewTaskRecommendations({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewCortexTasks({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewRunners({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewTasks({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewRuns({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceOverviewValidationResults({ workspaceId: scope.workspaceId }),
      ]);
      const githubInstallations = githubInstallationRows.filter(
        (installation) => installation.workspaceId === scope.workspaceId,
      );
      const githubRepositories = githubRepositoryRows.filter(
        (repository) => repository.workspaceId === scope.workspaceId,
      );
      const repoScans = repoScanRows.filter((scan) => scan.workspaceId === scope.workspaceId);
      const findings = findingRows.filter((finding) => finding.workspaceId === scope.workspaceId);
      const taskRecommendations = taskRecommendationRows.filter(
        (recommendation) => recommendation.workspaceId === scope.workspaceId,
      );
      const cortexTasks = cortexTaskRows.filter((task) => task.workspaceId === scope.workspaceId);
      const runners = runnerRows.filter((runner) => runner.workspaceId === scope.workspaceId);
      const tasks = taskRows.filter((task) => task.workspaceId === scope.workspaceId);
      const runs = runRows.filter((run) => run.workspaceId === scope.workspaceId);
      const validationResultsByRunId = createValidationResultsByRunId(
        validationRows,
        scope.workspaceId,
      );
      const selectedRun =
        normalizedSelectedRunId === undefined
          ? runs.toSorted(compareUpdatedDesc)[0]
          : runs.find((run) => run.id === normalizedSelectedRunId);
      const selectedRunEvents =
        selectedRun === undefined
          ? []
          : await input.store.listWorkspaceOverviewRunEvents({
              limit: RUN_TRACE_EVENT_LIMIT,
              runId: selectedRun.id,
              workspaceId: scope.workspaceId,
            });
      const runnerHealth = createRunnerHealth(runners);
      const workBuckets = createWorkBuckets({ runs, tasks });
      const repoReadinessOnboarding = createRepoReadinessOnboarding({
        installations: githubInstallations,
        repositories: githubRepositories,
        repoScans,
        workspaceId: scope.workspaceId,
      });

      return {
        ...selectRunSummaries({ runs, validationResultsByRunId }),
        actionability: createActionability({
          cortexTasks,
          findings,
          repoReadinessOnboarding,
          repoScans,
          runnerHealth,
          taskRecommendations,
          workBuckets,
        }),
        buildPhases,
        repoReadinessOnboarding,
        runnerHealth,
        selectedRunTrace: createSelectedRunTrace({
          events: selectedRunEvents,
          runId: selectedRun?.id ?? null,
          workspaceId: scope.workspaceId,
        }),
        summaryCards: createSummaryCards({ runnerHealth, workBuckets }),
        workBuckets,
      };
    },
  };
};

export const getWorkspaceDashboardOverview = async (input: {
  selectedRunId?: string | undefined;
  workspaceId: string;
}): Promise<WorkspaceDashboardOverview> => {
  const { db } = getDatabase();
  const service = createDashboardOverviewService({
    store: createDrizzleDashboardOverviewStore(db),
  });

  return service.getWorkspaceDashboardOverview(input);
};

import { describe, expect, test, vi } from "vitest";

import {
  type CortexTaskApprovalStatus,
  type CortexTaskExecutionMode,
  type CortexTaskRiskLevel,
  type CortexTaskStatus,
  type FindingCategory,
  type FindingSeverity,
  type FindingStatus,
  type PrArtifactStatus,
  type RepoScanStatus,
  type RiskFinding,
  type RunEventSeverity,
  type RunState,
  type TaskRecommendationStatus,
  type TaskPacketMode,
  type ValidationResultStatus,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importOverview = async () => import("./overview");

type StoredRunner = {
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
  status: "busy" | "idle" | "offline";
  supportsCancellation: boolean;
  supportsDryRun: boolean;
  workspaceId: string;
  yarnAvailable: boolean;
};

type StoredTask = {
  createdAt: Date;
  id: string;
  mode: TaskPacketMode;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  status: "approved" | "draft";
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredRun = {
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

type StoredValidationResult = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

type StoredRunEvent = {
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

type StoredGitHubRepository = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubAppInstallationId: string;
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  visibility: "internal" | "private" | "public" | null;
  workspaceId: string;
};

type StoredGitHubInstallation = {
  id: string;
  permissionGrants: Record<string, string>;
  suspendedAt: Date | null;
  workspaceId: string;
};

type StoredRepoScan = {
  createdAt: Date;
  finishedAt: Date | null;
  id: string;
  repoId: string;
  startedAt: Date | null;
  status: RepoScanStatus;
  updatedAt: Date;
  workspaceId: string;
};

type StoredFinding = {
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

type StoredTaskRecommendation = {
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

type StoredCortexTask = {
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

const packageLockRisk = (): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
});

const protectedPathRisk = (): RiskFinding => ({
  category: "protected_path",
  id: "risk:protected_path",
  message: "Protected path changed.",
  paths: ["apps/web/src/server/actions.ts"],
  severity: "blocked",
});

const createRunner = (overrides: Partial<StoredRunner> = {}): StoredRunner => ({
  codexAvailable: true,
  displayName: "Mac Studio",
  ghAvailable: false,
  gitAvailable: true,
  id: "runner_1",
  lastHeartbeatAt: new Date("2026-05-23T10:00:00.000Z"),
  maxConcurrentJobs: 2,
  nodeAvailable: true,
  npmAvailable: false,
  pnpmAvailable: false,
  pythonAvailable: false,
  revokedAt: null,
  status: "idle",
  supportsCancellation: true,
  supportsDryRun: true,
  workspaceId: "workspace_1",
  yarnAvailable: false,
  ...overrides,
});

const createTask = (overrides: Partial<StoredTask> = {}): StoredTask => ({
  createdAt: new Date("2026-05-23T09:00:00.000Z"),
  id: "task_1",
  mode: "execute",
  repoMappingId: "repo_mapping_1",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  status: "draft",
  title: "Ready dashboard task",
  updatedAt: new Date("2026-05-23T09:30:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createRun = (overrides: Partial<StoredRun> = {}): StoredRun => ({
  changedPaths: ["apps/web/src/dashboard/overview.ts"],
  createdAt: new Date("2026-05-23T10:00:00.000Z"),
  id: "run_1",
  lastEventAt: new Date("2026-05-23T10:30:00.000Z"),
  mode: "execute",
  prChangedFilePaths: null,
  prNumber: null,
  prRiskFindings: null,
  prStatus: null,
  prTitle: null,
  prUrl: null,
  repoMappingId: "repo_mapping_1",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  riskFindings: [],
  runnerDisplayName: "Mac Studio",
  runnerId: "runner_1",
  state: "queued",
  taskId: "task_1",
  taskTitle: "Ready dashboard task",
  updatedAt: new Date("2026-05-23T10:15:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createGitHubRepository = (
  overrides: Partial<StoredGitHubRepository> = {},
): StoredGitHubRepository => ({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  githubAppInstallationId: "github_installation_1",
  id: "github_repo_1",
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  visibility: "private",
  workspaceId: "workspace_1",
  ...overrides,
});

const createGitHubInstallation = (
  overrides: Partial<StoredGitHubInstallation> = {},
): StoredGitHubInstallation => ({
  id: "github_installation_1",
  permissionGrants: {
    contents: "read",
    metadata: "read",
  },
  suspendedAt: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const createRepoScan = (overrides: Partial<StoredRepoScan> = {}): StoredRepoScan => ({
  createdAt: new Date("2026-05-24T10:00:00.000Z"),
  finishedAt: null,
  id: "repo_scan_1",
  repoId: "github_repo_1",
  startedAt: null,
  status: "queued",
  updatedAt: new Date("2026-05-24T10:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createFinding = (overrides: Partial<StoredFinding> = {}): StoredFinding => ({
  category: "validation",
  id: "finding_1",
  repoId: "github_repo_1",
  scanId: "repo_scan_1",
  severity: "high",
  status: "open",
  taskIds: [],
  title: "Validation commands are missing",
  updatedAt: new Date("2026-05-24T10:10:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createTaskRecommendation = (
  overrides: Partial<StoredTaskRecommendation> = {},
): StoredTaskRecommendation => ({
  cortexTaskId: null,
  executionMode: "local_runner",
  id: "task_recommendation_1",
  repoId: "github_repo_1",
  riskLevel: "medium",
  scanId: "repo_scan_1",
  status: "open",
  title: "Add deterministic validation gates",
  updatedAt: new Date("2026-05-24T10:20:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createCortexTask = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => ({
  approvalStatus: "pending",
  executionMode: "local_runner",
  id: "cortex_task_1",
  latestRunId: null,
  repoId: "github_repo_1",
  riskLevel: "medium",
  status: "draft",
  title: "Prepare validation cleanup",
  updatedAt: new Date("2026-05-24T10:30:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    cortexTasks?: StoredCortexTask[];
    events?: StoredRunEvent[];
    findings?: StoredFinding[];
    githubInstallations?: StoredGitHubInstallation[];
    githubRepositories?: StoredGitHubRepository[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repoScans?: StoredRepoScan[];
    runners?: StoredRunner[];
    runs?: StoredRun[];
    taskRecommendations?: StoredTaskRecommendation[];
    tasks?: StoredTask[];
    validationResults?: StoredValidationResult[];
  } = {},
) => ({
  findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
    input.memberships?.some(
      (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
    )
      ? { id: "membership_1", role: "member" }
      : null,
  ),
  listWorkspaceOverviewCortexTasks: vi.fn(async () => input.cortexTasks ?? []),
  listWorkspaceOverviewFindings: vi.fn(async () => input.findings ?? []),
  listWorkspaceOverviewGitHubInstallations: vi.fn(async () => input.githubInstallations ?? []),
  listWorkspaceOverviewGitHubRepositories: vi.fn(async () => input.githubRepositories ?? []),
  listWorkspaceOverviewRepoScans: vi.fn(async () => input.repoScans ?? []),
  listWorkspaceOverviewRunEvents: vi.fn(async () => input.events ?? []),
  listWorkspaceOverviewRunners: vi.fn(async () => input.runners ?? []),
  listWorkspaceOverviewRuns: vi.fn(async () => input.runs ?? []),
  listWorkspaceOverviewTaskRecommendations: vi.fn(async () => input.taskRecommendations ?? []),
  listWorkspaceOverviewTasks: vi.fn(async () => input.tasks ?? []),
  listWorkspaceOverviewValidationResults: vi.fn(async () => input.validationResults ?? []),
});

const collectObjectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));

    return keys;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    keys.push(key);
    collectObjectKeys(childValue, keys);
  });

  return keys;
};

const expectNoUnsafeOverviewMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys = collectObjectKeys(value).map((key) => key.toLowerCase());

  [
    "acceptancecriteria",
    "contextfilepaths",
    "diff",
    "evidence",
    "localpath",
    "metadata",
    "objective",
    "patch",
    "rawlogs",
    "recommendation",
    "sourcecode",
    "stderr",
    "stdout",
    "taskpacket",
    "validationcommands",
  ].forEach((unsafeKey) => {
    expect(keys).not.toContain(unsafeKey);
  });
  expect(serialized).not.toContain("Implement by reading src/private.ts");
  expect(serialized).not.toContain("Acceptance raw text");
  expect(serialized).not.toContain("apps/web/src/private.ts");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane");
  expect(serialized).not.toContain("pnpm test -- --reporter=verbose");
  expect(serialized).not.toContain("diff --git a/app.ts b/app.ts");
  expect(serialized).not.toContain("@@ -1 +1 @@");
  expect(serialized).not.toContain("const leaked = process.env.SECRET");
  expect(serialized).not.toContain("raw runner log line");
  expect(serialized).not.toContain("token=SECRET_VALUE_1234567890");
  expect(serialized).not.toContain("/bin/zsh");
  expect(serialized).not.toContain("/usr/bin/git");
  expect(serialized).not.toContain("/opt/private/bin/codex");
};

describe("dashboard overview service", () => {
  test("rejects unauthenticated and non-member users before loading overview rows", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const unauthenticatedStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });

    await expect(
      createDashboardOverviewService({
        getAuthContext: async () => ({ userId: null }),
        store: unauthenticatedStore,
      }).getWorkspaceDashboardOverview({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(unauthenticatedStore.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(unauthenticatedStore.listWorkspaceOverviewRuns).not.toHaveBeenCalled();

    await expect(
      createDashboardOverviewService({
        getAuthContext: async () => ({ userId: "user_1" }),
        store: nonMemberStore,
      }).getWorkspaceDashboardOverview({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(nonMemberStore.listWorkspaceOverviewRuns).not.toHaveBeenCalled();
  });

  test("rejects blank and control-character workspace ids before store access", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.getWorkspaceDashboardOverview({ workspaceId: "  " }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1\n" }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.listWorkspaceOverviewRunners).not.toHaveBeenCalled();
  });

  test("returns repo-readiness onboarding with no scan history and no repository options", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.repoReadinessOnboarding).toEqual({
      activeInstallationCount: 0,
      connectionStatus: "not_connected",
      hasAnyScans: false,
      hasRepoAccess: false,
      installationCount: 0,
      repositoryOptions: [],
    });
    expect(store.listWorkspaceOverviewGitHubInstallations).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewGitHubRepositories).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewRepoScans).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expectNoUnsafeOverviewMaterial(result);
  });

  test("returns safe active GitHub repository options before the first scan", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const activeRepository = createGitHubRepository();
    const store = createStore({
      githubInstallations: [createGitHubInstallation()],
      githubRepositories: [
        activeRepository,
        createGitHubRepository({
          archived: true,
          id: "github_repo_archived",
          repositoryFullName: "rory/archived",
          repositoryName: "archived",
        }),
        createGitHubRepository({
          disabled: true,
          id: "github_repo_disabled",
          repositoryFullName: "rory/disabled",
          repositoryName: "disabled",
        }),
        createGitHubRepository({
          id: "github_repo_hidden",
          repositoryFullName: "hidden/private",
          repositoryName: "private",
          repositoryOwner: "hidden",
          workspaceId: "workspace_2",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.repoReadinessOnboarding).toEqual({
      activeInstallationCount: 1,
      connectionStatus: "connected",
      hasAnyScans: false,
      hasRepoAccess: true,
      installationCount: 1,
      repositoryOptions: [
        {
          archived: false,
          defaultBranch: "main",
          disabled: false,
          id: "github_repo_1",
          repositoryFullName: "rory/control-plane",
          repositoryName: "control-plane",
          repositoryOwner: "rory",
          scanPermissionDetail:
            "Scan-only uses GitHub metadata and repository contents read access without requiring the local runner.",
          scanPermissionLabel: "Scan-only ready",
          scanPermissionStatus: "ready",
          visibility: "private",
          workspaceId: "workspace_1",
        },
      ],
    });
    expectNoUnsafeOverviewMaterial(result);
  });

  test("distinguishes connected workspaces with no active repository access", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      githubInstallations: [createGitHubInstallation()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.repoReadinessOnboarding).toEqual({
      activeInstallationCount: 1,
      connectionStatus: "connected",
      hasAnyScans: false,
      hasRepoAccess: false,
      installationCount: 1,
      repositoryOptions: [],
    });
    expectNoUnsafeOverviewMaterial(result);
  });

  test("derives repository scan permission states from installation permissions", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      githubInstallations: [
        createGitHubInstallation(),
        createGitHubInstallation({
          id: "github_installation_missing_contents",
          permissionGrants: { metadata: "read" },
        }),
        createGitHubInstallation({
          id: "github_installation_rejected",
          permissionGrants: {
            administration: "read",
            contents: "read",
            metadata: "read",
          },
        }),
        createGitHubInstallation({
          id: "github_installation_suspended",
          suspendedAt: new Date("2026-05-24T09:00:00.000Z"),
        }),
      ],
      githubRepositories: [
        createGitHubRepository(),
        createGitHubRepository({
          githubAppInstallationId: "github_installation_missing_contents",
          id: "github_repo_missing_contents",
          repositoryFullName: "rory/missing-contents",
          repositoryName: "missing-contents",
        }),
        createGitHubRepository({
          githubAppInstallationId: "github_installation_rejected",
          id: "github_repo_rejected",
          repositoryFullName: "rory/rejected",
          repositoryName: "rejected",
        }),
        createGitHubRepository({
          githubAppInstallationId: "github_installation_suspended",
          id: "github_repo_suspended",
          repositoryFullName: "rory/suspended",
          repositoryName: "suspended",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(
      result.repoReadinessOnboarding.repositoryOptions.map((repository) => ({
        label: repository.scanPermissionLabel,
        name: repository.repositoryName,
        status: repository.scanPermissionStatus,
      })),
    ).toEqual([
      { label: "Scan-only ready", name: "control-plane", status: "ready" },
      {
        label: "Scan-only needs permission upgrade",
        name: "missing-contents",
        status: "needs_permission",
      },
      {
        label: "Scan blocked by rejected MVP permissions",
        name: "rejected",
        status: "blocked",
      },
      { label: "Installation suspended", name: "suspended", status: "suspended" },
    ]);
    expectNoUnsafeOverviewMaterial(result);
  });

  test.each(["queued", "running", "completed"] satisfies RepoScanStatus[])(
    "keeps the operational overview when a %s repo-readiness scan exists",
    async (status) => {
      const { createDashboardOverviewService } = await importOverview();
      const store = createStore({
        githubInstallations: [createGitHubInstallation()],
        githubRepositories: [createGitHubRepository()],
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        repoScans: [createRepoScan({ status })],
      });
      const service = createDashboardOverviewService({
        getAuthContext: async () => ({ userId: "user_1" }),
        store,
      });

      const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

      expect(result.repoReadinessOnboarding.hasAnyScans).toBe(true);
      expect(result.repoReadinessOnboarding.repositoryOptions).toEqual([
        expect.objectContaining({
          id: "github_repo_1",
          repositoryFullName: "rory/control-plane",
          scanPermissionStatus: "ready",
          workspaceId: "workspace_1",
        }),
      ]);
      expectNoUnsafeOverviewMaterial(result);
    },
  );

  test("summarizes what can safely move forward before a runner is paired", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      cortexTasks: [
        createCortexTask({ id: "cortex_task_draft", status: "draft" }),
        createCortexTask({
          approvalStatus: "approved",
          id: "cortex_task_approved",
          status: "approved",
          title: "Execute approved setup locally",
        }),
      ],
      findings: [
        createFinding({ id: "finding_blocked", severity: "blocked" }),
        createFinding({ id: "finding_high", severity: "high" }),
        createFinding({
          id: "finding_resolved",
          severity: "blocked",
          status: "resolved",
        }),
      ],
      githubInstallations: [createGitHubInstallation()],
      githubRepositories: [createGitHubRepository()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repoScans: [createRepoScan({ status: "completed" })],
      taskRecommendations: [
        createTaskRecommendation({ id: "recommendation_open", status: "open" }),
        createTaskRecommendation({
          id: "recommendation_approved",
          status: "approved",
          title: "Approve local execution packet",
        }),
        createTaskRecommendation({
          id: "recommendation_converted",
          status: "converted",
        }),
      ],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.actionability).toMatchObject({
      runnerInstalled: false,
      runnerOnline: false,
      totals: {
        activeScans: 0,
        approvedLocalRunnerTasks: 1,
        approvedRecommendations: 1,
        blockedFindings: 1,
        draftCortexTasks: 1,
        openFindings: 2,
        openRecommendations: 1,
        queuedLocalRunnerTasks: 0,
        reviewCortexTasks: 0,
      },
    });
    expect(result.actionability.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 2,
          href: "/dashboard/findings?status=open",
          id: "review_findings",
          title: "Review readiness findings",
          tone: "danger",
        }),
        expect.objectContaining({
          count: 2,
          href: "/dashboard/task-recommendations",
          id: "review_recommendations",
          title: "Approve AI-ready recommendations",
        }),
        expect.objectContaining({
          count: 1,
          href: "/dashboard/tasks?status=draft",
          id: "review_tasks",
          title: "Review Cortex Tasks",
        }),
        expect.objectContaining({
          count: 1,
          href: "/dashboard/runners",
          id: "pair_runner",
          title: "Pair local runner",
          tone: "warning",
        }),
      ]),
    );
    expect(result.actionability.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "monitor_runs" })]),
    );
    expectNoUnsafeOverviewMaterial(result);
  });

  test("moves approved local work toward runner monitoring when a runner is online", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const store = createStore({
      cortexTasks: [
        createCortexTask({
          approvalStatus: "approved",
          id: "cortex_task_approved",
          status: "approved",
        }),
        createCortexTask({
          approvalStatus: "approved",
          id: "cortex_task_queued",
          status: "queued",
        }),
      ],
      githubInstallations: [createGitHubInstallation()],
      githubRepositories: [createGitHubRepository()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repoScans: [createRepoScan({ status: "completed" })],
      runners: [createRunner({ status: "idle" })],
      runs: [
        createRun({ id: "run_waiting", state: "awaiting_approval" }),
        createRun({ id: "run_blocked", state: "blocked" }),
      ],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.actionability).toMatchObject({
      runnerInstalled: true,
      runnerOnline: true,
      totals: {
        approvedLocalRunnerTasks: 1,
        awaitingApprovalRuns: 1,
        blockedRuns: 1,
        queuedLocalRunnerTasks: 1,
      },
    });
    expect(result.actionability.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          count: 2,
          href: "/dashboard/tasks?executionMode=local_runner",
          id: "monitor_runs",
          title: "Monitor local execution",
          tone: "success",
        }),
        expect.objectContaining({
          count: 1,
          href: "/dashboard/approvals",
          id: "review_approvals",
          title: "Review validated PRs",
          tone: "warning",
        }),
        expect.objectContaining({
          count: 1,
          href: "/dashboard/runs?state=blocked",
          id: "resolve_blockers",
          title: "Resolve blocked runner work",
          tone: "danger",
        }),
      ]),
    );
    expect(result.actionability.items).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ id: "pair_runner" })]),
    );
    expectNoUnsafeOverviewMaterial(result);
  });

  test("aggregates workspace-filtered runner health, work buckets, runs, trace, and build phases", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const traceEvents = Array.from({ length: 10 }, (_, index): StoredRunEvent => {
      const minute = String(index).padStart(2, "0");

      return {
        createdAt: new Date(`2026-05-23T10:${minute}:00.000Z`),
        id: `event_${index}`,
        message: `Trace event ${index}`,
        receivedAt: new Date(`2026-05-23T10:${minute}:30.000Z`),
        runId: "run_pr_ready",
        runnerId: "runner_busy",
        severity: index === 9 ? "warning" : "info",
        state: index === 9 ? "awaiting_approval" : "codex_running",
        workspaceId: "workspace_1",
      };
    });
    const store = createStore({
      events: [
        traceEvents[9]!,
        traceEvents[0]!,
        traceEvents[8]!,
        traceEvents[7]!,
        traceEvents[6]!,
        traceEvents[5]!,
        traceEvents[4]!,
        traceEvents[3]!,
        traceEvents[2]!,
        traceEvents[1]!,
        {
          ...traceEvents[9]!,
          id: "event_hidden_workspace",
          workspaceId: "workspace_2",
        },
      ],
      githubInstallations: [createGitHubInstallation()],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [
        createRunner({ id: "runner_idle", status: "idle" }),
        createRunner({
          displayName: "Build Mini",
          id: "runner_busy",
          status: "busy",
        }),
        createRunner({
          displayName: "Offline runner",
          id: "runner_offline",
          status: "offline",
        }),
        createRunner({
          displayName: "Revoked runner",
          id: "runner_revoked",
          revokedAt: new Date("2026-05-23T09:15:00.000Z"),
          status: "idle",
        }),
        createRunner({
          displayName: "Hidden runner",
          id: "runner_hidden",
          workspaceId: "workspace_2",
        }),
      ],
      runs: [
        createRun({
          id: "run_pr_ready",
          lastEventAt: new Date("2026-05-23T10:55:00.000Z"),
          prChangedFilePaths: [
            "apps/web/src/dashboard/overview.ts",
            ".env.local",
            "/Users/rory/repos/control-plane/private.ts",
          ],
          prNumber: 42,
          prRiskFindings: [protectedPathRisk()],
          prStatus: "open",
          prTitle: "TASK-164: Add overview data query",
          prUrl: "https://github.com/rory/control-plane/pull/42",
          riskFindings: [packageLockRisk()],
          runnerDisplayName: "Build Mini",
          runnerId: "runner_busy",
          state: "awaiting_approval",
          taskId: "task_pr_ready",
          taskTitle: "Ready for approval",
        }),
        createRun({
          id: "run_active",
          lastEventAt: new Date("2026-05-23T10:45:00.000Z"),
          state: "codex_running",
          taskId: "task_active",
          taskTitle: "Implement active work",
        }),
        createRun({
          id: "run_blocked",
          lastEventAt: new Date("2026-05-23T10:35:00.000Z"),
          riskFindings: [protectedPathRisk()],
          state: "blocked",
          taskId: "task_blocked",
          taskTitle: "Blocked work",
        }),
        createRun({
          id: "run_failed",
          lastEventAt: new Date("2026-05-23T10:25:00.000Z"),
          state: "failed",
          taskId: "task_failed",
          taskTitle: "Failed work",
        }),
        createRun({
          id: "run_awaiting",
          lastEventAt: new Date("2026-05-23T10:15:00.000Z"),
          state: "awaiting_approval",
          taskId: "task_awaiting",
          taskTitle: "Awaiting metadata",
        }),
        createRun({
          id: "run_queued",
          lastEventAt: new Date("2026-05-23T10:05:00.000Z"),
          state: "queued",
          taskId: "task_queued",
          taskTitle: "Queued work",
        }),
        createRun({
          id: "run_hidden",
          repositoryName: "hidden-repo",
          repositoryOwner: "hidden-owner",
          workspaceId: "workspace_2",
        }),
      ],
      githubRepositories: [createGitHubRepository()],
      repoScans: [createRepoScan({ status: "completed" })],
      tasks: [
        createTask({ id: "task_ready", status: "draft" }),
        createTask({ id: "task_approved_no_run", status: "approved" }),
        createTask({ id: "task_hidden", status: "draft", workspaceId: "workspace_2" }),
      ],
      validationResults: [
        { runId: "run_pr_ready", status: "passed", workspaceId: "workspace_1" },
        { runId: "run_pr_ready", status: "failed", workspaceId: "workspace_1" },
        { runId: "run_active", status: "skipped", workspaceId: "workspace_1" },
        { runId: "run_hidden", status: "cancelled", workspaceId: "workspace_2" },
      ],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: " workspace_1 " });

    expect(result.runnerHealth).toMatchObject({
      busy: 1,
      idle: 1,
      offline: 1,
      online: 2,
      revoked: 1,
      total: 4,
    });
    expect(result.runnerHealth.runners).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          capabilitiesSummary: expect.objectContaining({
            availableTools: ["git", "codex", "node"],
            maxConcurrentJobs: 2,
            supportsCancellation: true,
            supportsDryRun: true,
          }),
          id: "runner_idle",
          status: "idle",
        }),
        expect.objectContaining({ id: "runner_revoked", status: "revoked" }),
      ]),
    );
    expect(result.workBuckets).toMatchObject({
      awaitingApprovalRuns: 1,
      blockedRuns: 1,
      failedRuns: 1,
      prReadyRuns: 1,
      queuedWork: 2,
      readyTasks: 1,
      runningRuns: 1,
    });
    expect(result.summaryCards).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "runner_health", value: 2 }),
        expect.objectContaining({ id: "ready_work", value: 3 }),
        expect.objectContaining({ id: "needs_attention", value: 2 }),
        expect.objectContaining({ id: "awaiting_approval", value: 2 }),
      ]),
    );
    expect(result.activeRuns.map((run) => run.id)).toEqual(["run_active"]);
    expect(result.blockedRuns.map((run) => run.id)).toEqual(["run_blocked", "run_failed"]);
    expect(result.awaitingApprovalRuns.map((run) => run.id)).toEqual([
      "run_pr_ready",
      "run_awaiting",
    ]);
    expect(result.recentRuns.map((run) => run.id)).toEqual([
      "run_pr_ready",
      "run_active",
      "run_blocked",
      "run_failed",
      "run_awaiting",
      "run_queued",
    ]);
    expect(result.recentRuns[0]).toMatchObject({
      changedFileCount: 1,
      id: "run_pr_ready",
      pr: {
        number: 42,
        status: "open",
        title: "TASK-164: Add overview data query",
        url: "https://github.com/rory/control-plane/pull/42",
      },
      repository: {
        name: "control-plane",
        owner: "rory",
      },
      risk: {
        blockerCount: 1,
        categoryCounts: [
          { category: "package_lock", count: 1 },
          { category: "protected_path", count: 1 },
        ],
        warningCount: 1,
      },
      runner: {
        displayName: "Build Mini",
        id: "runner_busy",
      },
      state: "awaiting_approval",
      task: {
        id: "task_pr_ready",
        title: "Ready for approval",
      },
      validationStatusCounts: [
        { count: 1, status: "failed" },
        { count: 1, status: "passed" },
      ],
    });
    expect(result.selectedRunTrace.runId).toBe("run_pr_ready");
    expect(result.selectedRunTrace.events.map((event) => event.id)).toEqual([
      "event_2",
      "event_3",
      "event_4",
      "event_5",
      "event_6",
      "event_7",
      "event_8",
      "event_9",
    ]);
    expect(result.selectedRunTrace.events[7]).toEqual({
      createdAt: new Date("2026-05-23T10:09:00.000Z"),
      id: "event_9",
      message: "Trace event 9",
      receivedAt: new Date("2026-05-23T10:09:30.000Z"),
      runnerId: "runner_busy",
      severity: "warning",
      state: "awaiting_approval",
    });
    expect(result.buildPhases).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "local_runner_proof", status: "completed" }),
        expect.objectContaining({
          id: "external_task_import",
          label: "External task import",
          status: "completed",
        }),
        expect.objectContaining({ id: "dashboard_polish", status: "current" }),
        expect.objectContaining({ id: "billing_hooks", status: "upcoming" }),
      ]),
    );
    expect(result.buildPhases).not.toEqual(
      expect.arrayContaining([expect.objectContaining({ label: "Linear intake" })]),
    );
    expect(store.listWorkspaceOverviewRunners).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWorkspaceOverviewGitHubRepositories).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewRepoScans).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewFindings).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewTaskRecommendations).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewCortexTasks).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewTasks).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWorkspaceOverviewRuns).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWorkspaceOverviewValidationResults).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceOverviewRunEvents).toHaveBeenCalledWith({
      limit: 8,
      runId: "run_pr_ready",
      workspaceId: "workspace_1",
    });
    expectNoUnsafeOverviewMaterial(result);
  });

  test("omits unsafe extra row fields and nulls unsafe PR artifacts", async () => {
    const { createDashboardOverviewService } = await importOverview();
    const unsafeRun = {
      ...createRun({
        changedPaths: ["/Users/rory/repos/control-plane/src/secret.ts", ".env.local"],
        prChangedFilePaths: [
          "/Users/rory/repos/control-plane/src/secret.ts",
          ".env.local",
          "apps/web/src/dashboard/overview.ts",
        ],
        prNumber: 7,
        prStatus: "draft",
        prTitle: "const leaked = process.env.SECRET;",
        prUrl: "https://github.com/rory/control-plane/pull/7?token=SECRET_VALUE_1234567890",
        state: "awaiting_approval",
      }),
      acceptanceCriteria: ["Acceptance raw text"],
      contextFilePaths: ["apps/web/src/private.ts"],
      diff: "diff --git a/app.ts b/app.ts",
      localPath: "/Users/rory/repos/control-plane",
      objective: "Implement by reading src/private.ts",
      patch: "@@ -1 +1 @@",
      rawLogs: "raw runner log line",
      sourceCode: "const leaked = process.env.SECRET",
      stderr: "raw stderr",
      stdout: "raw stdout",
      taskPacket: { objective: "Implement by reading src/private.ts" },
      validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
    } as unknown as StoredRun;
    const unsafeTask = {
      ...createTask({ status: "draft" }),
      acceptanceCriteria: ["Acceptance raw text"],
      contextFilePaths: ["apps/web/src/private.ts"],
      objective: "Implement by reading src/private.ts",
      validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
    } as unknown as StoredTask;
    const unsafeEvent = {
      createdAt: new Date("2026-05-23T11:00:00.000Z"),
      id: "event_unsafe",
      message: "raw stdout: const leaked = process.env.SECRET",
      metadata: {
        diff: "diff --git a/app.ts b/app.ts",
        localPath: "/Users/rory/repos/control-plane",
      },
      rawLogs: "raw runner log line",
      receivedAt: new Date("2026-05-23T11:00:30.000Z"),
      runId: "run_1",
      runnerId: "runner_1",
      severity: "info",
      state: "awaiting_approval",
      workspaceId: "workspace_1",
    } as unknown as StoredRunEvent;
    const store = createStore({
      events: [unsafeEvent],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner()],
      runs: [unsafeRun],
      tasks: [unsafeTask],
    });
    const service = createDashboardOverviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.getWorkspaceDashboardOverview({ workspaceId: "workspace_1" });

    expect(result.recentRuns[0]?.changedFileCount).toBe(1);
    expect(result.recentRuns[0]?.pr).toEqual({
      number: 7,
      status: "draft",
      title: "Pull request #7",
      url: null,
    });
    expect(result.selectedRunTrace.events).toEqual([
      {
        createdAt: new Date("2026-05-23T11:00:00.000Z"),
        id: "event_unsafe",
        message: "Event details unavailable.",
        receivedAt: new Date("2026-05-23T11:00:30.000Z"),
        runnerId: "runner_1",
        severity: "info",
        state: "awaiting_approval",
      },
    ]);
    expectNoUnsafeOverviewMaterial(result);
  });

  test("Drizzle store methods select only safe overview columns", async () => {
    const { createDrizzleDashboardOverviewStore } = await importOverview();
    const selectedKeys: string[][] = [];
    const chain = {
      from: vi.fn(() => chain),
      innerJoin: vi.fn(() => chain),
      leftJoin: vi.fn(() => chain),
      limit: vi.fn(async () => []),
      orderBy: vi.fn(() => chain),
      where: vi.fn(() => chain),
      then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve([]).then(resolve),
    };
    const db = {
      select: vi.fn((projection: Record<string, unknown>) => {
        selectedKeys.push(Object.keys(projection));

        return chain;
      }),
    };
    const store = createDrizzleDashboardOverviewStore(db as never);

    await store.findWorkspaceMembership({ userId: "user_1", workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewGitHubInstallations({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewGitHubRepositories({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewRepoScans({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewFindings({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewTaskRecommendations({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewCortexTasks({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewRunners({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewTasks({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewRuns({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewValidationResults({ workspaceId: "workspace_1" });
    await store.listWorkspaceOverviewRunEvents({
      limit: 8,
      runId: "run_1",
      workspaceId: "workspace_1",
    });

    const selectedKeyNames = selectedKeys.flat().map((key) => key.toLowerCase());

    [
      "acceptancecriteria",
      "capabilities",
      "capabilitiessnapshot",
      "command",
      "contextfilepaths",
      "credentialhash",
      "evidence",
      "failuresummary",
      "htmlurl",
      "inventory",
      "localpath",
      "metadata",
      "modulestatuses",
      "objective",
      "rawoutput",
      "recommendation",
      "stderrsummary",
      "stdoutsummary",
      "taskpacket",
      "validationcommands",
    ].forEach((unsafeKey) => {
      expect(selectedKeyNames).not.toContain(unsafeKey);
    });
    expect(selectedKeys).toEqual(
      expect.arrayContaining([
        expect.arrayContaining(["id", "permissionGrants", "suspendedAt", "workspaceId"]),
        expect.arrayContaining([
          "archived",
          "defaultBranch",
          "disabled",
          "githubAppInstallationId",
          "id",
          "repositoryFullName",
          "repositoryName",
          "repositoryOwner",
          "visibility",
          "workspaceId",
        ]),
        expect.arrayContaining([
          "createdAt",
          "finishedAt",
          "id",
          "repoId",
          "startedAt",
          "status",
          "updatedAt",
          "workspaceId",
        ]),
        expect.arrayContaining([
          "category",
          "id",
          "repoId",
          "scanId",
          "severity",
          "status",
          "taskIds",
          "title",
          "updatedAt",
          "workspaceId",
        ]),
        expect.arrayContaining([
          "cortexTaskId",
          "executionMode",
          "id",
          "repoId",
          "riskLevel",
          "scanId",
          "status",
          "title",
          "updatedAt",
          "workspaceId",
        ]),
        expect.arrayContaining([
          "approvalStatus",
          "executionMode",
          "id",
          "latestRunId",
          "repoId",
          "riskLevel",
          "status",
          "title",
          "updatedAt",
          "workspaceId",
        ]),
        expect.arrayContaining([
          "codexAvailable",
          "displayName",
          "ghAvailable",
          "gitAvailable",
          "id",
          "lastHeartbeatAt",
          "maxConcurrentJobs",
          "nodeAvailable",
          "npmAvailable",
          "pnpmAvailable",
          "pythonAvailable",
          "revokedAt",
          "status",
          "supportsCancellation",
          "supportsDryRun",
          "workspaceId",
          "yarnAvailable",
        ]),
        expect.arrayContaining([
          "changedPaths",
          "prChangedFilePaths",
          "prNumber",
          "prRiskFindings",
          "prStatus",
          "prTitle",
          "prUrl",
          "riskFindings",
          "taskTitle",
        ]),
        expect.arrayContaining([
          "createdAt",
          "id",
          "message",
          "receivedAt",
          "runId",
          "runnerId",
          "severity",
          "state",
        ]),
      ]),
    );
  });
});

import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  type CortexTask,
  type Finding,
  type SetupPrPreview,
} from "@control-plane/shared";

import type { ApprovalQueueItem } from "../src/approvals/list";
import type { WorkspaceDashboardOverview } from "../src/dashboard/overview";
import type { PersistedFinding } from "../src/repo-readiness/findings";
import type { RunListItem } from "../src/runs/list";
import type { RunnerListItem } from "../src/runners/list";

vi.mock("server-only", () => ({}));
vi.mock("@/src/server/actions", () => ({
  convertFindingToTaskAction: vi.fn(),
  createSetupPrFromPreviewAction: vi.fn(),
  createSetupPrPreviewAction: vi.fn(),
  requestRepairAction: vi.fn(async () => ({
    data: {
      queuedRunId: "run_repair_1",
    },
    ok: true,
  })),
  transitionCortexTaskStatusAction: vi.fn(),
  triggerRepoScanAction: vi.fn(),
  updateCortexTaskExecutionModeAction: vi.fn(),
  updateFindingStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const now = "2026-06-02T10:00:00.000Z";

const repository = {
  id: "github_repository_1",
  repositoryFullName: "rory/payslip-peeks-and-probes",
  repositoryName: "payslip-peeks-and-probes",
  repositoryOwner: "rory",
};

const onboarding = {
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
      id: repository.id,
      repositoryFullName: repository.repositoryFullName,
      repositoryName: repository.repositoryName,
      repositoryOwner: repository.repositoryOwner,
      scanPermissionDetail:
        "Scan-only uses GitHub metadata and repository contents read access before runner pairing.",
      scanPermissionLabel: "Scan-only ready",
      scanPermissionStatus: "ready",
      visibility: "private",
      workspaceId: "workspace_1",
    },
  ],
  workspaceId: "workspace_1",
} satisfies WorkspaceDashboardOverview["repoReadinessOnboarding"];

const createFinding = (
  overrides: Partial<Finding> & Record<string, unknown> = {},
): PersistedFinding =>
  ({
    dedupeKey: "fd_0".padEnd(67, "0"),
    finding: {
      category: "validation",
      confidence: 0.92,
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      deterministicRuleId: "validation.commands.missing",
      evidence: [
        {
          metadata: {
            ruleKind: "validation-metadata",
          },
          paths: [".aicp/policy.json"],
          summary: "Validation command metadata is not configured.",
        },
      ],
      findingId: "finding_1",
      recommendation: "Add explicit validation metadata before approving local execution.",
      repoId: repository.id,
      scanId: "repo_scan_1",
      severity: "high",
      source: "deterministic_rule",
      status: "open",
      summary: "The repository does not declare validation commands for Cortex.",
      title: "Validation commands are missing",
      updatedAt: now,
      workspaceId: "workspace_1",
      ...overrides,
    },
    taskIds: ["cortex_task_setup"],
  }) as PersistedFinding;

const createTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: ["Validation evidence is recorded before completion."],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_1"],
  metadata: {
    generationSource: "repo_readiness",
  },
  objective: "Prepare repository setup artifacts before local execution is approved.",
  origin: {
    externalId: "task_recommendation_1",
    type: "task_recommendation",
  },
  prArtifactIds: [],
  repoId: repository.id,
  riskLevel: "medium",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    {
      label: "Run full validation gates",
      required: true,
      validationId: "validation-posture:full",
    },
  ],
  taskId: "cortex_task_setup",
  taskRecommendationId: "task_recommendation_1",
  title: "Add validation setup",
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const createPreview = (overrides: Partial<SetupPrPreview> = {}): SetupPrPreview => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  excludedTaskIds: [],
  excludedTemplateIds: [],
  files: [
    {
      omittedContent: true,
      operation: "create_or_update",
      path: ".aicp/policy.json",
      reviewInstructions: ["Confirm generated policy metadata before PR creation."],
      reviewRequired: true,
      sourceTaskIds: ["cortex_task_setup"],
      summary: "Create repository policy metadata for runner safety checks.",
      templateId: "repo_policy",
    },
  ],
  metadata: {
    sourceLabel: "setup_pr_preview_service",
  },
  previewId: "setup_pr_preview_1",
  repoId: repository.id,
  status: "draft",
  taskIds: ["cortex_task_setup"],
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const createRun = (overrides: Partial<RunListItem> & Record<string, unknown> = {}): RunListItem =>
  ({
    id: "run_1",
    mode: "execute",
    pr: {
      number: 42,
      status: "open",
      url: "https://github.com/rory/payslip-peeks-and-probes/pull/42",
    },
    repoMapping: {
      id: "repo_mapping_1",
      repositoryName: repository.repositoryName,
      repositoryOwner: repository.repositoryOwner,
    },
    review: {
      blockerCount: 0,
      changedFileCount: 2,
      prReady: true,
      riskCategoryCounts: [{ category: "package_lock", count: 1 }],
      stateBucket: "pr_ready",
      validationStatusCounts: [{ count: 1, status: "passed" }],
      warningCount: 1,
    },
    runner: {
      displayName: "Mac Studio",
      id: "runner_1",
    },
    state: "pr_opened",
    task: {
      id: "cortex_task_runner",
      title: "Execute approved readiness work",
    },
    updatedAt: new Date(now),
    ...overrides,
  }) as RunListItem;

const createRunner = (overrides: Partial<RunnerListItem> = {}): RunnerListItem => ({
  capabilitiesSummary: {
    availableTools: ["git", "gh", "codex", "node", "pnpm"],
    maxConcurrentJobs: 1,
    supportsCancellation: true,
    supportsDryRun: true,
    toolAvailability: [
      { available: true, name: "git" },
      { available: true, name: "gh" },
      { available: true, name: "codex" },
      { available: true, name: "node" },
      { available: false, name: "npm" },
      { available: true, name: "pnpm" },
      { available: false, name: "yarn" },
      { available: false, name: "python" },
    ],
  },
  displayName: "Mac Studio",
  id: "runner_1",
  isRevoked: false,
  lastHeartbeatAt: new Date(now),
  linkedAt: new Date(now),
  revokedAt: null,
  status: "idle",
  ...overrides,
});

const createApproval = (overrides: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem => ({
  evidence: {
    blockerCount: 0,
    changedFileCount: 2,
    reviewReady: true,
    riskCategoryCounts: [{ category: "package_lock", count: 1 }],
    validationStatusCounts: [{ count: 1, status: "passed" }],
    warningCount: 1,
  },
  id: "run_1",
  mode: "execute",
  pr: {
    number: 42,
    status: "open",
    title: "TASK-184: Browser happy path smoke",
    url: "https://github.com/rory/payslip-peeks-and-probes/pull/42",
  },
  repoMapping: {
    id: "repo_mapping_1",
    repositoryName: repository.repositoryName,
    repositoryOwner: repository.repositoryOwner,
  },
  repair: {
    attemptCount: 0,
    latestRequestedAt: null,
    maxAttempts: null,
  },
  runner: {
    displayName: "Mac Studio",
    id: "runner_1",
  },
  state: "awaiting_approval",
  task: {
    id: "cortex_task_runner",
    title: "Execute approved readiness work",
  },
  updatedAt: new Date(now),
  ...overrides,
});

const routeSmokeTargets = [
  { component: "OverviewDashboard", path: "./(app)/dashboard/page.tsx" },
  { component: "FindingList", path: "./(app)/dashboard/findings/page.tsx" },
  { component: "CortexTaskQueue", path: "./(app)/dashboard/tasks/page.tsx" },
  { component: "SetupPrFlow", path: "./(app)/dashboard/setup-prs/page.tsx" },
  { component: "RunTable", path: "./(app)/dashboard/runs/page.tsx" },
  { component: "RunnerList", path: "./(app)/dashboard/runners/page.tsx" },
  { component: "ApprovalQueueTable", path: "./(app)/dashboard/approvals/page.tsx" },
] as const;

const expectNoUnsafeBrowserSmokeMaterial = (source: string) => {
  expect(source).not.toMatch(
    /raw source|source code|sourceCode|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
  expect(source).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|localPath|stdout|stderr)["']/i,
  );
};

describe("TASK-184 browser happy-path smoke", () => {
  test("keeps the onboarding-to-review route path reachable in the protected shell", async () => {
    await Promise.all(routeSmokeTargets.map((target) => expectFile(target.path)));

    const navSource = await readAppFile("../components/nav.tsx");

    const routeSources = await Promise.all(
      routeSmokeTargets.map(async (target) => ({
        ...target,
        source: await readAppFile(target.path),
      })),
    );

    for (const target of routeSmokeTargets) {
      expect(navSource).toContain(
        `href: "${target.path.replace("./(app)", "").replace("/page.tsx", "")}"`,
      );
    }

    for (const target of routeSources) {
      expect(target.source).toContain(target.component);
      expect(target.source).toContain('export const dynamic = "force-dynamic";');
      expectNoUnsafeBrowserSmokeMaterial(target.source);
    }

    expect(navSource.indexOf('label: "Repositories"')).toBeLessThan(
      navSource.indexOf('label: "Findings"'),
    );
    expect(navSource.indexOf('label: "Findings"')).toBeLessThan(
      navSource.indexOf('label: "Tasks"'),
    );
    expect(navSource.indexOf('label: "Tasks"')).toBeLessThan(
      navSource.indexOf('label: "Setup PRs"'),
    );
    expect(navSource.indexOf('label: "Setup PRs"')).toBeLessThan(
      navSource.indexOf('label: "Runs"'),
    );
    expect(navSource.indexOf('label: "Runs"')).toBeLessThan(
      navSource.indexOf('label: "Approvals"'),
    );
  });

  test("server-renders the scan, findings, tasks, setup PR, runs, runners, and approvals path", async () => {
    const { RepoReadinessOnboarding } =
      await import("../components/overview/repo-readiness-onboarding");
    const { FindingList } = await import("../components/finding-list");
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const { SetupPrFlow } = await import("../components/setup-pr-flow");
    const { RunTable } = await import("../components/run-table");
    const { RunnerList } = await import("../components/runner-list");
    const { ApprovalQueueTable } = await import("../components/approval-queue-table");

    const onboardingHtml = renderToStaticMarkup(
      createElement(RepoReadinessOnboarding, {
        onboarding,
        workspaceName: "Manual testing",
      }),
    );
    const findingsHtml = renderToStaticMarkup(
      createElement(FindingList, {
        findings: [createFinding()],
        repositories: [repository],
        workspaceId: "workspace_1",
      }),
    );
    const tasksHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: true,
        repositories: [repository],
        tasks: [
          createTask(),
          createTask({
            executionMode: "local_runner",
            taskId: "cortex_task_runner",
            title: "Execute approved readiness work",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );
    const setupPrHtml = renderToStaticMarkup(
      createElement(SetupPrFlow, {
        previews: [createPreview()],
        repositories: [repository],
        tasks: [createTask()],
        workspaceId: "workspace_1",
      }),
    );
    const runsHtml = renderToStaticMarkup(createElement(RunTable, { runs: [createRun()] }));
    const runnersHtml = renderToStaticMarkup(
      createElement(RunnerList, {
        revokeRunner: () => undefined,
        runners: [createRunner()],
        workspaceId: "workspace_1",
      }),
    );
    const approvalsHtml = renderToStaticMarkup(
      createElement(ApprovalQueueTable, {
        approvals: [createApproval()],
      }),
    );

    expect(onboardingHtml).toContain("Start repo scan");
    expect(onboardingHtml).toContain("rory/payslip-peeks-and-probes");
    expect(findingsHtml).toContain("Findings review");
    expect(findingsHtml).toContain("Convert to task");
    expect(tasksHtml).toContain("Execution-readiness queue");
    expect(tasksHtml).toContain("Execute locally");
    expect(tasksHtml).toContain("Open setup PR flow");
    expect(setupPrHtml).toContain("Setup PR generation");
    expect(setupPrHtml).toContain("Create setup PR preview");
    expect(setupPrHtml).toContain("Create draft setup PR");
    expect(runsHtml).toContain("Run coordination");
    expect(runsHtml).toContain("View timeline");
    expect(runnersHtml).toContain("Paired runners");
    expect(runnersHtml).toContain("Revoke");
    expect(approvalsHtml).toContain("Approval queue");
    expect(approvalsHtml).toContain("Review run");

    expectNoUnsafeBrowserSmokeMaterial(
      `${onboardingHtml}\n${findingsHtml}\n${tasksHtml}\n${setupPrHtml}\n${runsHtml}\n${runnersHtml}\n${approvalsHtml}`,
    );
  });

  test("keeps mobile smoke surfaces scrollable and primary CTAs reachable", async () => {
    const [
      tableSource,
      onboardingSource,
      findingSource,
      taskSource,
      setupPrSource,
      runSource,
      runnerSource,
      approvalSource,
    ] = await Promise.all([
      readAppFile("../components/ui/table.tsx"),
      readAppFile("../components/overview/repo-readiness-onboarding.tsx"),
      readAppFile("../components/finding-list.tsx"),
      readAppFile("../components/cortex-task-queue.tsx"),
      readAppFile("../components/setup-pr-flow.tsx"),
      readAppFile("../components/run-table.tsx"),
      readAppFile("../components/runner-list.tsx"),
      readAppFile("../components/approval-queue-table.tsx"),
    ]);

    expect(tableSource).toContain('data-slot="table-container"');
    expect(tableSource).toContain("overflow-x-auto");
    expect(onboardingSource).toContain(
      'className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between"',
    );
    expect(onboardingSource).toContain('Button className="w-fit" type="submit"');
    expect(findingSource).toContain('className="flex min-w-40 flex-col gap-2"');
    expect(taskSource).toContain('className="mt-2 flex flex-col gap-2 sm:flex-row"');
    expect(taskSource).toContain('className="flex flex-wrap gap-2"');
    expect(setupPrSource).toContain('className="flex flex-wrap gap-2"');
    expect(runSource).toContain('<Table aria-label="Workspace runs">');
    expect(runnerSource).toContain('<Table aria-label="Paired runners">');
    expect(approvalSource).toContain('<Table aria-label="Approval queue">');
  });
});

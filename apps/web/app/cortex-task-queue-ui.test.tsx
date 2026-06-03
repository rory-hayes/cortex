import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type CortexTask } from "@control-plane/shared";

vi.mock("@/src/server/actions", () => ({
  requestRepairAction: vi.fn(async () => ({
    data: {
      queuedRunId: "run_repair_1",
    },
    ok: true,
  })),
  transitionCortexTaskStatusAction: vi.fn(),
  updateCortexTaskExecutionModeAction: vi.fn(),
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

const now = "2026-05-26T10:00:00.000Z";

const createTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: [
    "Repository policy includes required validation entries.",
    "Validation evidence is recorded before completion.",
  ],
  approvalStatus: "not_requested",
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  executionMode: "setup_pr",
  externalLinks: [
    {
      externalId: "ENG-222",
      provider: "linear",
      resourceType: "linear_issue",
      status: "Todo",
      syncedAt: now,
      title: "ENG-222 Add validation map",
      url: "https://linear.app/control-plane/issue/ENG-222/add-validation-map",
    },
  ],
  findingIds: ["finding_1"],
  metadata: {
    generationSource: "repo_readiness",
  },
  objective: "Prepare validation command coverage before local execution is approved.",
  origin: {
    externalId: "task_recommendation_1",
    type: "task_recommendation",
  },
  prArtifactIds: [],
  repoId: "github_repository_1",
  riskLevel: "medium",
  runIds: [],
  status: "draft",
  suggestedValidation: [
    {
      label: "Run full validation gates",
      required: true,
      validationId: "validation-posture:full",
    },
  ],
  taskId: "cortex_task_1",
  taskRecommendationId: "task_recommendation_1",
  title: "Add validation command map",
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const repositories = [
  {
    id: "github_repository_1",
    repositoryFullName: "rory/control-plane",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
  },
  {
    id: "github_repository_2",
    repositoryFullName: "rory/worker",
    repositoryName: "worker",
    repositoryOwner: "rory",
  },
];

const expectNoUnsafeTaskMaterial = (source: string) => {
  expect(source).not.toMatch(
    /type=["']file["']|upload|raw source|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
  expect(source).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|localPath|stdout|stderr)["']/i,
  );
  expect(source).not.toMatch(/JSON\.stringify|policySnapshot|validationCommands/);
};

describe("Cortex Task queue UI", () => {
  test("defines a protected Cortex Tasks queue route with workspace-scoped loading", async () => {
    await expectFile("./(app)/dashboard/tasks/page.tsx");

    const source = await readAppFile("./(app)/dashboard/tasks/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createCortexTaskService");
    expect(source).toContain("createDrizzleCortexTaskStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("createRunnerListService");
    expect(source).toContain("createCortexTaskRepairContextService");
    expect(source).toContain("createDrizzleCortexTaskRepairContextStore");
    expect(source).toMatch(/listCortexTasks\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).toMatch(
      /listCortexTaskRepairContexts\(\{[\s\S]*workspaceId: verifiedWorkspace\.workspaceId/,
    );
    expect(source).not.toMatch(/listCortexTasks\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).not.toMatch(/listCortexTaskRepairContexts\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toContain("hasAvailableLocalRunner");
    expect(source).toContain("<CortexTaskQueue");
    expect(source).toContain("repairContextByTaskId={repairContextByTaskId}");
    expect(source).toContain("Runner execution is gated");
    expectNoUnsafeTaskMaterial(source);
  });

  test("renders Cortex Tasks with filters, linked findings, validation, external links, and gated actions", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: true,
        repositories,
        tasks: [
          createTask(),
          createTask({
            approvalStatus: "pending",
            executionMode: "local_runner",
            externalLinks: [],
            findingIds: ["finding_2", "finding_3"],
            repoId: "github_repository_2",
            riskLevel: "high",
            status: "needs_review",
            suggestedValidation: [
              {
                label: "Typecheck, lint, format, and test",
                required: true,
                validationId: "full-repo:validation",
              },
            ],
            taskId: "cortex_task_2",
            title: "Review runner queue gates",
          }),
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            externalLinks: [],
            repoId: "github_repository_2",
            riskLevel: "high",
            status: "approved",
            taskId: "cortex_task_3",
            title: "Harden runner queue gates",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Cortex Tasks queue");
    expect(html).toContain("3 tasks");
    expect(html).toContain("1 draft");
    expect(html).toContain("1 in review");
    expect(html).toContain("1 approved");
    expect(html).toContain("1 approval not requested");
    expect(html).toContain("1 approval approved");
    expect(html).toContain("Add validation command map");
    expect(html).toContain("Review runner queue gates");
    expect(html).toContain("Harden runner queue gates");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("rory/worker");
    expect(html).toContain("medium");
    expect(html).toContain("high");
    expect(html).toContain("setup_pr");
    expect(html).toContain("local_runner");
    expect(html).toContain("finding_1");
    expect(html).toContain("finding_2");
    expect(html).toContain("Run full validation gates");
    expect(html).toContain("Typecheck, lint, format, and test");
    expect(html).toContain("ENG-222 Add validation map");
    expect(html).toContain("Todo");
    expect(html).toContain(
      'href="https://linear.app/control-plane/issue/ENG-222/add-validation-map"',
    );
    expect(html).toContain('href="/dashboard/tasks/sync-linear"');
    expect(html).toContain("Review");
    expect(html).toContain("Approve");
    expect(html).toContain("Reject");
    expect(html).toContain("Defer");
    expect(html).toContain("Execute locally");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="cortex_task_1"');
    expect(html).toContain('value="needs_review"');
    expect(html).toContain('value="approved"');
    expect(html).toContain('value="rejected"');
    expect(html).toContain('value="deferred"');
    expect(html).toContain('value="queued"');
    expect(html).toContain("Queueing marks approved intent for the local runner queue only");
    expect(html).not.toContain("Auto-run");
    expect(html).not.toContain("Start runner");
    expectNoUnsafeTaskMaterial(html);
  });

  test("renders an optional runner gate and only shows runner setup for approved local execution", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const reviewHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repositories,
        tasks: [
          createTask({
            executionMode: "planning_only",
            status: "needs_review",
            taskId: "cortex_task_plan",
            title: "Clarify task acceptance criteria",
          }),
          createTask({
            approvalStatus: "approved",
            executionMode: "setup_pr",
            status: "approved",
            taskId: "cortex_task_setup",
            title: "Prepare repository setup PR",
          }),
          createTask({
            approvalStatus: "pending",
            executionMode: "local_runner",
            status: "needs_review",
            taskId: "cortex_task_pending_runner",
            title: "Review local execution request",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(reviewHtml).toContain("Runner gate");
    expect(reviewHtml).toContain("Local execution is optional");
    expect(reviewHtml).toContain("Planning only");
    expect(reviewHtml).toContain("Setup PR");
    expect(reviewHtml).toContain("Local runner");
    expect(reviewHtml).toContain("Continue without runner");
    expect(reviewHtml).toContain('href="/dashboard/task-recommendations"');
    expect(reviewHtml).toContain('href="/dashboard/setup-prs"');
    expect(reviewHtml).not.toContain("Set up local runner");
    expectNoUnsafeTaskMaterial(reviewHtml);

    const approvedRunnerHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repositories,
        tasks: [
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            status: "approved",
            taskId: "cortex_task_approved_runner",
            title: "Run validated local execution",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(approvedRunnerHtml).toContain("1 task needs local runner setup");
    expect(approvedRunnerHtml).toContain("Set up local runner");
    expect(approvedRunnerHtml).toContain('href="/dashboard/runners"');
    expect(approvedRunnerHtml).toContain("source stays local");
    expectNoUnsafeTaskMaterial(approvedRunnerHtml);
  });

  test("shows runner eligibility reasons and withholds queueing for ineligible tasks", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: false,
        repositories,
        runnerEligibilityByTaskId: {
          cortex_task_ineligible: {
            eligible: false,
            reasons: [
              {
                code: "runner_unavailable",
                fixHref: "/dashboard/runners",
                message: "Pair an available local runner with dry-run and git support.",
              },
              {
                code: "repo_mapping_missing",
                fixHref: "/dashboard/repositories",
                message: "Register an active local repository mapping for this GitHub repository.",
              },
              {
                code: "validation_required_missing",
                fixHref: "/dashboard/repositories",
                message: "Add at least one required validation command to the repository mapping.",
              },
            ],
          },
        },
        tasks: [
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            status: "approved",
            taskId: "cortex_task_ineligible",
            title: "Queue only after local setup is ready",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Runner eligibility");
    expect(html).toContain("Pair an available local runner with dry-run and git support.");
    expect(html).toContain(
      "Register an active local repository mapping for this GitHub repository.",
    );
    expect(html).toContain(
      "Add at least one required validation command to the repository mapping.",
    );
    expect(html).toContain('href="/dashboard/runners"');
    expect(html).toContain('href="/dashboard/repositories"');
    expect(html).toContain("Cannot execute locally");
    expect(html).not.toContain(">Execute locally<");
    expect(html).not.toContain('name="status" type="hidden" value="queued"');
    expectNoUnsafeTaskMaterial(html);
  });

  test("renders a metadata-only repair request flow for PR-opened Cortex Tasks", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: true,
        repairContextByTaskId: {
          cortex_task_repair: {
            attemptCount: 1,
            canRequestRepair: true,
            disabledReason: null,
            maxAttempts: 2,
            nextAttempt: 2,
            previousRunId: "run_previous_1",
            pr: {
              number: 42,
              status: "open",
              url: "https://github.com/rory/control-plane/pull/42",
            },
            remainingAttempts: 1,
            taskId: "cortex_task_repair",
            validationEvidence: {
              statusCounts: [
                { count: 1, status: "failed" },
                { count: 1, status: "passed" },
              ],
              totalCount: 2,
            },
          },
        },
        repositories,
        tasks: [
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            latestRunId: "run_previous_1",
            prArtifactIds: ["pr_artifact_1"],
            runIds: ["run_previous_1"],
            status: "pr_opened",
            taskId: "cortex_task_repair",
            title: "Repair the opened PR",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Repair request");
    expect(html).toContain("Run run_previous_1");
    expect(html).toContain("PR #42");
    expect(html).toContain('href="https://github.com/rory/control-plane/pull/42"');
    expect(html).toContain("Validation evidence");
    expect(html).toContain("2 records");
    expect(html).toContain("1 failed");
    expect(html).toContain("1 passed");
    expect(html).toContain("Request repair");
    expect(html).toContain("Queue repair attempt 2 of 2.");
    expect(html).toContain("Repair attempts: 1 / 2, 1 remaining");
    expect(html).not.toContain("policySnapshot");
    expect(html).not.toContain("validationCommands");
    expectNoUnsafeTaskMaterial(html);
  });

  test("shows repair attempt limits from Cortex Task context", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repairContextByTaskId: {
          cortex_task_repair_limit: {
            attemptCount: 2,
            canRequestRepair: false,
            disabledReason: "Repair attempt limit reached.",
            maxAttempts: 2,
            nextAttempt: 3,
            previousRunId: "run_previous_limit",
            pr: {
              number: 43,
              status: "open",
              url: null,
            },
            remainingAttempts: 0,
            taskId: "cortex_task_repair_limit",
            validationEvidence: {
              statusCounts: [{ count: 1, status: "failed" }],
              totalCount: 1,
            },
          },
        },
        repositories,
        tasks: [
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            latestRunId: "run_previous_limit",
            prArtifactIds: ["pr_artifact_limit"],
            runIds: ["run_previous_limit"],
            status: "pr_opened",
            taskId: "cortex_task_repair_limit",
            title: "Repair limit reached",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Repair attempt limit reached.");
    expect(html).toContain("Repair attempts: 2 / 2, limit reached");
    expect(html).toContain("Request repair");
    expect(html).toContain("disabled");
    expect(html).not.toContain('href="https://github.com');
    expectNoUnsafeTaskMaterial(html);
  });

  test("renders execution mode selectors only before approval and gates local runner mode on availability", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const unavailableHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: false,
        repositories,
        tasks: [
          createTask({
            executionMode: "setup_pr",
            status: "draft",
            taskId: "cortex_task_draft",
            title: "Choose setup path",
          }),
          createTask({
            approvalStatus: "approved",
            executionMode: "setup_pr",
            status: "approved",
            taskId: "cortex_task_approved",
            title: "Approved setup work",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(unavailableHtml).toContain("Execution mode");
    expect(unavailableHtml).toContain("Update mode");
    expect(unavailableHtml).toContain('name="executionMode"');
    expect(unavailableHtml).toContain('value="planning_only"');
    expect(unavailableHtml).toContain('value="setup_pr"');
    expect(unavailableHtml).toContain('value="local_runner" disabled=""');
    expect(unavailableHtml).toContain("Pair an available runner before selecting local runner.");
    expect(unavailableHtml).toContain("Mode locked after approval.");
    expectNoUnsafeTaskMaterial(unavailableHtml);

    const availableHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: true,
        repositories,
        tasks: [
          createTask({
            approvalStatus: "pending",
            executionMode: "setup_pr",
            status: "needs_review",
            taskId: "cortex_task_review",
            title: "Select local execution",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(availableHtml).toContain('value="local_runner"');
    expect(availableHtml).not.toContain('value="local_runner" disabled=""');
    expect(availableHtml).not.toContain("Pair an available runner before selecting local runner.");
    expectNoUnsafeTaskMaterial(availableHtml);
  });

  test("filters tasks by status, repo, risk, execution mode, and approval status", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repositories,
        selectedFilters: {
          approvalStatus: "approved",
          executionMode: "local_runner",
          repoId: "github_repository_2",
          risk: "high",
          status: "approved",
        },
        tasks: [
          createTask(),
          createTask({
            approvalStatus: "approved",
            executionMode: "local_runner",
            repoId: "github_repository_2",
            riskLevel: "high",
            status: "approved",
            taskId: "cortex_task_2",
            title: "Filtered approved runner task",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Showing 1 of 2 tasks.");
    expect(html).toContain("Filtered approved runner task");
    expect(html).toContain("status=approved");
    expect(html).toContain("repo=github_repository_2");
    expect(html).toContain("risk=high");
    expect(html).toContain("mode=local_runner");
    expect(html).toContain("approval=approved");
    expect(html).not.toContain("Add validation command map");
  });

  test("guides an empty task queue back through repo scanning and recommendations", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repositories,
        selectedFilters: {},
        tasks: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No Cortex Tasks yet.");
    expect(html).toContain("Run a repo readiness scan");
    expect(html).toContain('href="/dashboard/repositories"');
    expect(html).toContain("Review recommendations");
    expect(html).toContain('href="/dashboard/task-recommendations"');
  });

  test("does not render unsafe extra fields or unsafe known-field text", async () => {
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const html = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        repositories: [
          {
            id: "github_repository_1",
            repositoryFullName: "/Users/rory/private/repo",
            repositoryName: ".env.local",
            repositoryOwner: "Bearer unsafeFixtureToken12345",
          },
        ],
        tasks: [
          {
            ...createTask({
              acceptanceCriteria: ["```ts\nconst leakedCriterion = true;\n```"],
              externalLinks: [
                {
                  externalId: "rawOutput",
                  provider: "docs",
                  resourceType: "documentation",
                  status: "stdout: raw output",
                  title: "diff --git a/app.ts b/app.ts",
                  url: "https://example.com/docs?token=unsafe",
                },
              ],
              objective: "stdout: raw validation output",
              suggestedValidation: [
                {
                  label: "Bearer unsafeFixtureToken12345",
                  required: true,
                  validationId: "validation-posture:review",
                },
              ],
              title: "diff --git a/app.ts b/app.ts",
            }),
            diff: "diff --git a/app.ts b/app.ts",
            localPath: "/Users/rory/private/repo",
            patch: "@@ -1 +1 @@",
            rawOutput: "stderr: failed command output",
            sourceCode: "const leaked = process.env.SECRET",
            validationCommands: ["pnpm test -- --verbose"],
          } as CortexTask,
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("cortex_task_1");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain(".env.local");
    expect(html).not.toContain("unsafeFixtureToken12345");
    expect(html).not.toContain("leakedCriterion");
    expect(html).not.toContain("failed command output");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("pnpm test -- --verbose");
    expectNoUnsafeTaskMaterial(html);
  });
});

import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type CortexTask, type SetupPrPreview } from "@control-plane/shared";

vi.mock("@/src/server/actions", () => ({
  createSetupPrFromPreviewAction: vi.fn(),
  createSetupPrPreviewAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const now = "2026-06-02T10:00:00.000Z";

const createTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: ["Generated setup artifacts are reviewed before merge."],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_1"],
  metadata: {
    generationSource: "repo_readiness",
  },
  objective: "Prepare reviewer-owned setup artifacts.",
  origin: {
    type: "task_recommendation",
  },
  prArtifactIds: [],
  repoId: "github_repository_1",
  riskLevel: "medium",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    {
      label: "Review validation command map",
      required: true,
      validationId: "validation-posture:review",
    },
  ],
  taskId: "cortex_task_1",
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
      reviewInstructions: ["Confirm generated policy before PR creation."],
      reviewRequired: true,
      sourceTaskIds: ["cortex_task_1"],
      summary: "Create or update repository policy metadata for runner safety checks.",
      templateId: "repo_policy",
    },
  ],
  metadata: {
    sourceLabel: "setup_pr_preview_service",
  },
  previewId: "setup_pr_preview_1",
  repoId: "github_repository_1",
  status: "draft",
  taskIds: ["cortex_task_1"],
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

const expectNoUnsafeSetupPrMaterial = (source: string) => {
  expect(source).not.toMatch(
    /type=["']file["']|upload|raw source|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
  expect(source).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|localPath|stdout|stderr)["']/i,
  );
  expect(source).not.toMatch(/JSON\.stringify|policySnapshot|validationCommands/);
};

describe("setup PR flow UI", () => {
  test("defines a protected setup PR route with workspace-scoped task and preview loading", async () => {
    await expectFile("./(app)/dashboard/setup-prs/page.tsx");

    const source = await readAppFile("./(app)/dashboard/setup-prs/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createCortexTaskService");
    expect(source).toContain("createDrizzleCortexTaskStore");
    expect(source).toContain("createSetupPrPreviewService");
    expect(source).toContain("createDrizzleSetupPrPreviewStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toMatch(/listCortexTasks\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).toMatch(/listSetupPrPreviews\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).not.toMatch(/listCortexTasks\(\{[\s\S]*workspaceId: cookieWorkspaceId/);
    expect(source).not.toMatch(/listSetupPrPreviews\(\{[\s\S]*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toContain("<SetupPrFlow");
    expectNoUnsafeSetupPrMaterial(source);
  });

  test("renders eligible approved tasks, existing previews, addressed findings, and PR links", async () => {
    const { SetupPrFlow } = await import("../components/setup-pr-flow");
    const html = renderToStaticMarkup(
      createElement(SetupPrFlow, {
        previews: [
          createPreview(),
          createPreview({
            files: [
              {
                omittedContent: true,
                operation: "create_or_update",
                path: ".github/workflows/cortex-validation.yml",
                reviewInstructions: ["Confirm generated validation workflow before PR creation."],
                reviewRequired: true,
                sourceTaskIds: ["cortex_task_2"],
                summary: "Create or update CI validation metadata for runner safety checks.",
                templateId: "ci_workflow",
              },
            ],
            metadata: {
              baseBranch: "main",
              headBranch: "cortex/setup-pr/setup-pr-preview-2",
              pullRequestNumber: 22,
              pullRequestUrl: "https://github.com/rory/control-plane/pull/22",
              sourceLabel: "setup_pr_creation_service",
            },
            previewId: "setup_pr_preview_2",
            status: "pr_created",
            taskIds: ["cortex_task_2"],
          }),
        ],
        repositories,
        tasks: [
          createTask(),
          createTask({
            findingIds: ["finding_2", "finding_3"],
            taskId: "cortex_task_2",
            title: "Add CI validation setup",
          }),
          createTask({
            approvalStatus: "pending",
            executionMode: "local_runner",
            taskId: "cortex_task_3",
            title: "Not eligible for setup PR",
          }),
        ],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Setup PRs");
    expect(html).toContain("2 approved setup tasks");
    expect(html).toContain("1 draft");
    expect(html).toContain("1 PR created");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("Add validation setup");
    expect(html).toContain("Add CI validation setup");
    expect(html).not.toContain("Not eligible for setup PR");
    expect(html).toContain("finding_1");
    expect(html).toContain("finding_2");
    expect(html).toContain("finding_3");
    expect(html).toContain(".aicp/policy.json");
    expect(html).toContain(".github/workflows/cortex-validation.yml");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="repoId"');
    expect(html).toContain('value="github_repository_1"');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="cortex_task_1"');
    expect(html).toContain('value="cortex_task_2"');
    expect(html).toContain("Create setup PR preview");
    expect(html).toContain('name="previewId"');
    expect(html).toContain('value="setup_pr_preview_1"');
    expect(html).toContain("Create draft setup PR");
    expect(html).toContain('href="https://github.com/rory/control-plane/pull/22"');
    expect(html).toContain("#22");
    expect(html).toContain("cortex/setup-pr/setup-pr-preview-2");
    expectNoUnsafeSetupPrMaterial(html);
  });

  test("renders empty setup PR states without exposing execution controls", async () => {
    const { SetupPrFlow } = await import("../components/setup-pr-flow");
    const html = renderToStaticMarkup(
      createElement(SetupPrFlow, {
        previews: [],
        repositories,
        tasks: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No approved setup PR tasks yet.");
    expect(html).toContain("No setup PR previews yet.");
    expect(html).not.toContain("Run locally");
    expect(html).not.toContain("Auto-run");
    expect(html).not.toContain("Queue runner");
    expectNoUnsafeSetupPrMaterial(html);
  });
});

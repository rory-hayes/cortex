import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type TaskRecommendation } from "@control-plane/shared";

import type { PersistedTaskRecommendation } from "../src/repo-readiness/task-recommendations";

vi.mock("@/src/server/actions", () => ({
  approveTaskRecommendationAction: vi.fn(),
  approveTaskRecommendationsAction: vi.fn(),
  updateTaskRecommendationStatusAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const now = "2026-05-26T09:00:00.000Z";

const createRecommendation = (
  overrides: Partial<TaskRecommendation> & Record<string, unknown> = {},
): PersistedTaskRecommendation =>
  ({
    recommendation: {
      acceptanceCriteria: [
        "Repository policy includes required validation entries for typecheck, lint, format, and test gates.",
        "Each validation entry has a stable identifier, human-readable label, timeout, and required flag.",
      ],
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      effort: "small",
      executionMode: "setup_pr",
      findingIds: ["finding_1"],
      metadata: {
        findingCount: 1,
        generationSource: "deterministic_fallback",
      },
      objective: "Add a clear validation command map before approving AI-assisted execution.",
      repoId: "github_repository_1",
      riskLevel: "medium",
      scanId: "repo_scan_1",
      status: "open",
      suggestedValidation: [
        {
          label: "Review validation command map",
          required: true,
          validationId: "validation-posture:review",
        },
      ],
      taskRecommendationId: "task_recommendation_1",
      title: "Add validation command map",
      updatedAt: now,
      workspaceId: "workspace_1",
      ...overrides,
    },
  }) as PersistedTaskRecommendation;

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

const expectNoUnsafeRecommendationMaterial = (source: string) => {
  expect(source).not.toMatch(
    /JSON\.stringify|rawOutput|validationCommands|localPath|sourceCode|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
};

describe("task recommendations UI", () => {
  test("defines a protected task recommendations route with workspace-scoped recommendation loading", async () => {
    await expectFile("./(app)/dashboard/task-recommendations/page.tsx");

    const source = await readAppFile("./(app)/dashboard/task-recommendations/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createTaskRecommendationService");
    expect(source).toContain("createDrizzleTaskRecommendationStore");
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toMatch(
      /listTaskRecommendations\(\{[\s\S]*workspaceId: verifiedWorkspace\.workspaceId/,
    );
    expect(source).not.toMatch(/listTaskRecommendations\(\{[\s\S]*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toContain("<TaskRecommendationList");
    expectNoUnsafeRecommendationMaterial(source);
  });

  test("renders grouped recommendation review, editable approval fields, bulk low-risk setup approval, and status actions", async () => {
    const { TaskRecommendationList } = await import("../components/task-recommendation-list");
    const html = renderToStaticMarkup(
      createElement(TaskRecommendationList, {
        recommendations: [
          createRecommendation(),
          createRecommendation({
            effort: "small",
            executionMode: "setup_pr",
            repoId: "github_repository_2",
            riskLevel: "low",
            scanId: "repo_scan_2",
            suggestedValidation: [
              {
                label: "Review CI validation coverage",
                required: true,
                validationId: "ci-cd:review",
              },
            ],
            taskRecommendationId: "task_recommendation_2",
            title: "Add CI validation workflow",
          }),
        ],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Task recommendations");
    expect(html).toContain("2 recommendations");
    expect(html).toContain("2 open");
    expect(html).toContain("1 low risk");
    expect(html).toContain("1 medium risk");
    expect(html).toContain("Medium risk / Validation");
    expect(html).toContain("Low risk / CI/CD");
    expect(html).toContain("Add validation command map");
    expect(html).toContain("Add CI validation workflow");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("rory/worker");
    expect(html).toContain("repo_scan_1");
    expect(html).toContain("setup_pr");
    expect(html).toContain("Review validation command map");
    expect(html).toContain("Repository policy includes required validation entries");
    expect(html).toContain('name="title"');
    expect(html).toContain('name="objective"');
    expect(html).toContain('name="acceptanceCriteria"');
    expect(html).toContain('name="taskRecommendationId"');
    expect(html).toContain('value="task_recommendation_1"');
    expect(html).toContain('value="task_recommendation_2"');
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain("Approve edited draft");
    expect(html).toContain("Approve selected");
    expect(html).toContain("Approve all low-risk setup tasks");
    expect(html).toContain("Defer");
    expect(html).toContain("Dismiss");
    expect(html).toContain('value="deferred"');
    expect(html).toContain('value="dismissed"');
    expect(html).toContain("Approving creates draft Cortex Tasks only");
    expect(html).not.toContain("Approve to run");
    expect(html).not.toContain("Queue runner");
    expectNoUnsafeRecommendationMaterial(html);
  });

  test("filters recommendations by status, risk, repo, and scan without losing grouped counts", async () => {
    const { TaskRecommendationList } = await import("../components/task-recommendation-list");
    const html = renderToStaticMarkup(
      createElement(TaskRecommendationList, {
        recommendations: [
          createRecommendation(),
          createRecommendation({
            repoId: "github_repository_2",
            riskLevel: "low",
            scanId: "repo_scan_2",
            status: "deferred",
            taskRecommendationId: "task_recommendation_2",
            title: "Deferred hygiene task",
          }),
        ],
        repositories,
        selectedFilters: {
          repoId: "github_repository_2",
          risk: "low",
          scanId: "repo_scan_2",
          status: "deferred",
        },
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("Showing 1 of 2 recommendations.");
    expect(html).toContain("Deferred hygiene task");
    expect(html).toContain("rory/worker");
    expect(html).not.toContain("Add validation command map");
    expect(html).toContain("status=open");
    expect(html).toContain("risk=low");
    expect(html).toContain("repo=github_repository_2");
    expect(html).toContain("scan=repo_scan_2");
  });

  test("guides empty recommendations back to repo scanning", async () => {
    const { TaskRecommendationList } = await import("../components/task-recommendation-list");
    const html = renderToStaticMarkup(
      createElement(TaskRecommendationList, {
        recommendations: [],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("No task recommendations yet.");
    expect(html).toContain("Run a repo readiness scan");
    expect(html).toContain('href="/dashboard/repositories"');
  });

  test("does not render unsafe extra fields or unsafe known-field text", async () => {
    const { TaskRecommendationList } = await import("../components/task-recommendation-list");
    const html = renderToStaticMarkup(
      createElement(TaskRecommendationList, {
        recommendations: [
          createRecommendation({
            acceptanceCriteria: ["```ts\nconst leakedCriterion = true;\n```"],
            diff: "diff --git a/app.ts b/app.ts",
            localPath: "/Users/rory/private/repo",
            objective: "stdout: raw validation output",
            patch: "@@ -1 +1 @@",
            rawOutput: "stderr: failed command output",
            sourceCode: "const leaked = process.env.SECRET",
            suggestedValidation: [
              {
                label: "Bearer unsafeFixtureToken12345",
                required: true,
                validationId: "validation-posture:review",
              },
            ],
            title: "diff --git a/app.ts b/app.ts",
            validationCommands: ["pnpm test -- --verbose"],
          }),
        ],
        repositories,
        selectedFilters: {},
        workspaceId: "workspace_1",
      }),
    );

    expect(html).toContain("task_recommendation_1");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("failed command output");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("leakedCriterion");
    expect(html).not.toContain("unsafeFixtureToken12345");
    expect(html).not.toContain("pnpm test -- --verbose");
    expectNoUnsafeRecommendationMaterial(html);
  });
});

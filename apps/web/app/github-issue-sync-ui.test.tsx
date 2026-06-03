import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { GitHubIssueSyncPageData } from "../src/github/issues";

vi.mock("@/src/server/actions", () => ({
  requestRepairAction: vi.fn(),
  syncCortexTaskToGitHubIssueAction: vi.fn(),
  transitionCortexTaskStatusAction: vi.fn(),
  updateCortexTaskExecutionModeAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const pageData = (overrides: Partial<GitHubIssueSyncPageData> = {}): GitHubIssueSyncPageData => ({
  tasks: [
    {
      existingGitHubIssueLink: null,
      executionMode: "setup_pr",
      originType: "finding",
      repoId: "github_repository_1",
      repositoryFullName: "rory/control-plane",
      riskLevel: "medium",
      status: "approved",
      taskId: "cortex_task_1",
      title: "Sync approved task to GitHub Issues",
    },
    {
      existingGitHubIssueLink: {
        status: "open",
        syncedAt: new Date("2026-05-27T15:45:00.000Z"),
        title: "#31 Existing GitHub issue",
        url: "https://github.com/rory/control-plane/issues/31",
      },
      executionMode: "local_runner",
      originType: "task_recommendation",
      repoId: "github_repository_1",
      repositoryFullName: "rory/control-plane",
      riskLevel: "high",
      status: "approved",
      taskId: "cortex_task_2",
      title: "Sync existing task",
    },
  ],
  workspaceId: "workspace_1",
  ...overrides,
});

const expectNoUnsafeSyncSurfaceMaterial = (html: string) => {
  expect(html).not.toMatch(
    /type=["']file["']|upload|raw issue body|issue body|raw source|source code|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory/i,
  );
  expect(html).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|localPath|stdout|stderr|issueBody)["']/i,
  );
  expect(html).not.toMatch(/\b(?:Auto-run|Approve to run|Start here)\b/);
};

describe("GitHub Issues task sync UI", () => {
  test("renders eligible Cortex Tasks with GitHub issue sync actions", async () => {
    const { GitHubIssueSyncList } = await import("../components/github-issue-sync-list");
    const html = renderToStaticMarkup(
      createElement(GitHubIssueSyncList, {
        data: pageData(),
      }),
    );

    expect(html).toContain("Sync Cortex Tasks to GitHub Issues");
    expect(html).toContain("Sync approved task to GitHub Issues");
    expect(html).toContain("Sync existing task");
    expect(html).toContain("finding");
    expect(html).toContain("task_recommendation");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="cortex_task_1"');
    expect(html).toContain("Push to GitHub Issues");
    expect(html).toContain("Already synced");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("shows existing GitHub issue link status without exposing raw issue material", async () => {
    const { GitHubIssueSyncList } = await import("../components/github-issue-sync-list");
    const html = renderToStaticMarkup(
      createElement(GitHubIssueSyncList, {
        data: pageData({
          tasks: [
            {
              existingGitHubIssueLink: {
                status: "open",
                syncedAt: new Date("2026-05-27T15:45:00.000Z"),
                title: "#31 Existing GitHub issue",
                url: "https://github.com/rory/control-plane/issues/31",
              },
              executionMode: "setup_pr",
              originType: "finding",
              repoId: "github_repository_1",
              repositoryFullName: "rory/control-plane",
              riskLevel: "medium",
              status: "approved",
              taskId: "cortex_task_1",
              title: "Sync existing task",
            },
          ],
        }),
      }),
    );

    expect(html).toContain("Existing GitHub issue");
    expect(html).toContain("#31 Existing GitHub issue");
    expect(html).toContain("open");
    expect(html).toContain("Already synced");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("renders a safe empty state when no eligible Cortex Tasks are available", async () => {
    const { GitHubIssueSyncList } = await import("../components/github-issue-sync-list");
    const html = renderToStaticMarkup(
      createElement(GitHubIssueSyncList, {
        data: pageData({ tasks: [] }),
      }),
    );

    expect(html).toContain("No eligible Cortex Tasks");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("adds GitHub Issues sync CTAs without replacing manual task or Linear flows", async () => {
    const { TaskList } = await import("../components/task-list");
    const { CortexTaskQueue } = await import("../components/cortex-task-queue");
    const taskListHtml = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [],
      }),
    );
    const queueHtml = renderToStaticMarkup(
      createElement(CortexTaskQueue, {
        hasAvailableLocalRunner: false,
        repositories: [
          {
            id: "github_repository_1",
            repositoryFullName: "rory/control-plane",
            repositoryName: "control-plane",
            repositoryOwner: "rory",
          },
        ],
        tasks: [],
        workspaceId: "workspace_1",
      }),
    );

    expect(taskListHtml).toContain("Create manual task");
    expect(taskListHtml).toContain("Import from Linear");
    expect(taskListHtml).toContain("Sync to Linear");
    expect(taskListHtml).toContain("Sync to GitHub Issues");
    expect(taskListHtml).toContain('href="/dashboard/tasks/sync-github-issues"');
    expect(queueHtml).toContain("Sync external links");
    expect(queueHtml).toContain("GitHub Issues");
    expect(queueHtml).toContain('href="/dashboard/tasks/sync-github-issues"');
    expect(taskListHtml).not.toContain("Start here");
    expect(queueHtml).not.toContain("Start here");
  });

  test("defines a protected GitHub Issues task sync page that verifies workspace membership before loading data", async () => {
    await expectFile("./(app)/dashboard/tasks/sync-github-issues/page.tsx");

    const source = await readAppFile("./(app)/dashboard/tasks/sync-github-issues/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createGitHubIssueSyncService");
    expect(source).toContain("createDrizzleGitHubIssueSyncStore");
    expect(source).toContain("createGitHubAppClient");
    expect(source).toContain("createGitHubAppRequestFunction");
    expect(source).toContain("listGitHubIssueSyncPageData");
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toMatch(/<GitHubIssueSyncList[\s\S]*data={syncData}/);
    expect(source).toContain("Sync Cortex Tasks to GitHub Issues");
    expectNoUnsafeSyncSurfaceMaterial(source);
  });
});

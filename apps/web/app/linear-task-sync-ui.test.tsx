import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { LinearTaskSyncPageData } from "../src/linear/task-sync";

vi.mock("@/src/server/actions", () => ({
  syncCortexTaskToLinearAction: vi.fn(),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const pageData = (overrides: Partial<LinearTaskSyncPageData> = {}): LinearTaskSyncPageData => ({
  connections: [
    {
      id: "linear_connection_1",
      linearWorkspaceId: "linear_workspace_1",
      linearWorkspaceName: "Linear Platform",
    },
  ],
  projects: [{ id: "linear_project_1", name: "Control Plane" }],
  selectedConnectionId: "linear_connection_1",
  tasks: [
    {
      existingLinearLink: null,
      executionMode: "setup_pr",
      originType: "finding",
      repoId: "github_repository_1",
      repositoryFullName: "rory/control-plane",
      riskLevel: "medium",
      status: "approved",
      taskId: "cortex_task_1",
      title: "Sync approved task to Linear",
    },
    {
      existingLinearLink: {
        status: "Todo",
        syncedAt: new Date("2026-05-26T15:45:00.000Z"),
        title: "ENG-222 Sync existing task",
        url: "https://linear.app/control-plane/issue/ENG-222/sync-existing-task",
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
  teams: [{ id: "linear_team_1", key: "ENG", name: "Engineering" }],
  workflowStates: [
    { id: "linear_state_todo", name: "Todo", teamId: "linear_team_1", type: "unstarted" },
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

describe("Linear task sync UI", () => {
  test("renders connection, team, project, and status selectors for eligible Cortex Tasks", async () => {
    const { LinearTaskSyncList } = await import("../components/linear-task-sync-list");
    const data = pageData();
    const html = renderToStaticMarkup(
      createElement(LinearTaskSyncList, {
        data,
      }),
    );

    expect(html).toContain("Sync Cortex Tasks to Linear");
    expect(html).toContain("Linear Platform");
    expect(html).toContain("Engineering");
    expect(html).toContain("Control Plane");
    expect(html).toContain("Todo");
    expect(html).toContain("Sync approved task to Linear");
    expect(html).toContain("Sync existing task");
    expect(html).toContain("finding");
    expect(html).toContain("task_recommendation");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="cortex_task_1"');
    expect(html).toContain('name="linearConnectionId"');
    expect(html).toContain('value="linear_connection_1"');
    expect(html).toContain('name="teamId"');
    expect(html).toContain('value="linear_team_1"');
    expect(html).toContain('name="projectId"');
    expect(html).toContain('value="linear_project_1"');
    expect(html).toContain('name="statusId"');
    expect(html).toContain('value="linear_state_todo"');
    expect(html).toContain("Push to Linear");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("keeps task sync submissions bound to the selected Linear connection options", async () => {
    const { LinearTaskSyncList } = await import("../components/linear-task-sync-list");
    const html = renderToStaticMarkup(
      createElement(LinearTaskSyncList, {
        data: pageData({
          connections: [
            {
              id: "linear_connection_1",
              linearWorkspaceId: "linear_workspace_1",
              linearWorkspaceName: "Linear Platform",
            },
            {
              id: "linear_connection_2",
              linearWorkspaceId: "linear_workspace_2",
              linearWorkspaceName: "Linear Support",
            },
          ],
          selectedConnectionId: "linear_connection_2",
          teams: [{ id: "support_team_1", key: "SUP", name: "Support" }],
          workflowStates: [
            {
              id: "support_state_todo",
              name: "Support Todo",
              teamId: "support_team_1",
              type: "unstarted",
            },
          ],
        }),
      }),
    );

    expect(html).toContain('method="get"');
    expect(html).toContain('action="/dashboard/tasks/sync-linear"');
    expect(html).toContain("Linear Support");
    expect(html).toContain('type="hidden"');
    expect(html).toContain('name="linearConnectionId"');
    expect(html).toContain('value="linear_connection_2"');
    expect(html.match(/name="linearConnectionId"/g)).toHaveLength(3);
    expect(html).not.toMatch(
      /<form class="grid min-w-64 gap-2"[\s\S]*<select[^>]+name="linearConnectionId"/,
    );
    expect(html).toContain("Support");
    expect(html).toContain("Support Todo");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("shows existing Linear link status and does not expose raw issue body or local material", async () => {
    const { LinearTaskSyncList } = await import("../components/linear-task-sync-list");
    const html = renderToStaticMarkup(
      createElement(LinearTaskSyncList, {
        data: pageData({
          tasks: [
            {
              existingLinearLink: {
                status: "In Progress",
                syncedAt: new Date("2026-05-26T15:45:00.000Z"),
                title: "ENG-222 Sync existing task",
                url: "https://linear.app/control-plane/issue/ENG-222/sync-existing-task",
              },
              executionMode: "local_runner",
              originType: "finding",
              repoId: "github_repository_1",
              repositoryFullName: "rory/control-plane",
              riskLevel: "high",
              status: "approved",
              taskId: "cortex_task_2",
              title: "Sync existing task",
            },
          ],
        }),
      }),
    );

    expect(html).toContain("Existing Linear link");
    expect(html).toContain("In Progress");
    expect(html).toContain("ENG-222 Sync existing task");
    expect(html).toContain("Update Linear");
    expectNoUnsafeSyncSurfaceMaterial(html);
  });

  test("renders safe empty and blocked states when connections or options are unavailable", async () => {
    const { LinearTaskSyncList } = await import("../components/linear-task-sync-list");
    const noConnectionsHtml = renderToStaticMarkup(
      createElement(LinearTaskSyncList, {
        data: pageData({ connections: [], selectedConnectionId: null, teams: [], tasks: [] }),
      }),
    );
    const noTasksHtml = renderToStaticMarkup(
      createElement(LinearTaskSyncList, {
        data: pageData({ tasks: [] }),
      }),
    );

    expect(noConnectionsHtml).toContain("Active Linear connection required");
    expect(noConnectionsHtml).toContain("No eligible Cortex Tasks");
    expect(noTasksHtml).toContain("No eligible Cortex Tasks");
    expectNoUnsafeSyncSurfaceMaterial(noConnectionsHtml);
    expectNoUnsafeSyncSurfaceMaterial(noTasksHtml);
  });

  test("adds a Linear sync CTA to the tasks list without replacing manual task or import flows", async () => {
    const { TaskList } = await import("../components/task-list");
    const html = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [],
      }),
    );

    expect(html).toContain("Create manual task");
    expect(html).toContain("Import from Linear");
    expect(html).toContain("Sync to Linear");
    expect(html).toContain('href="/dashboard/tasks/sync-linear"');
    expect(html).not.toContain("Start here");
  });

  test("defines a protected Linear task sync page that verifies workspace membership before loading data", async () => {
    await expectFile("./(app)/dashboard/tasks/sync-linear/page.tsx");

    const source = await readAppFile("./(app)/dashboard/tasks/sync-linear/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toContain("searchParams?: Promise");
    expect(source).toContain("resolvedSearchParams.linearConnectionId");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createLinearTaskSyncService");
    expect(source).toContain("createDrizzleLinearTaskSyncStore");
    expect(source).toMatch(/listLinearTaskSyncPageData\(\{\s*[\s\S]*linearConnectionId/);
    expect(source).not.toMatch(/listLinearTaskSyncPageData\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toMatch(/<LinearTaskSyncList[\s\S]*data={syncData}/);
    expect(source).toContain("Sync Cortex Tasks to Linear");
    expectNoUnsafeSyncSurfaceMaterial(source);
  });
});

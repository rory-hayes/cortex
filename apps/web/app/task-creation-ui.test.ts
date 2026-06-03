import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { TaskWorkflowItem } from "../src/tasks/workflow";

vi.mock("@/src/server/actions", () => ({
  approveManualTaskAction: vi.fn(),
  createManualTaskAction: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: vi.fn(),
  }),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const expectNoManualTaskSourceUploadMaterial = (source: string) => {
  expect(source).not.toMatch(/type=["']file["']|upload|raw source/i);
  expect(source).not.toMatch(
    /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands)["']/i,
  );
  expect(source).not.toMatch(/JSON\.stringify|policySnapshot|validationCommands/);
};

const createdAt = new Date("2026-05-23T10:30:00.000Z");

const createTask = (overrides: Partial<TaskWorkflowItem> = {}): TaskWorkflowItem => ({
  createdAt,
  id: "task_1",
  latestRun: null,
  mode: "dryRun",
  repoMapping: {
    id: "repo_mapping_1",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
  },
  requestedByActorId: "user_1",
  sourceType: "manual",
  status: "draft",
  title: "Manual task UI",
  updatedAt: createdAt,
  workflow: {
    bucket: "draft",
    label: "Ready to approve",
  },
  workspaceId: "workspace_1",
  ...overrides,
});

const addUnsafeHiddenPayload = (task: TaskWorkflowItem): TaskWorkflowItem =>
  ({
    ...task,
    acceptanceCriteria: ["Acceptance criteria raw text"],
    contextFilePaths: ["apps/private/context.ts"],
    diff: "SHOULD_NOT_RENDER_DIFF",
    localPath: "/Users/rory/private/SHOULD_NOT_RENDER_LOCAL_PATH",
    objective: "SHOULD_NOT_RENDER_OBJECTIVE",
    patch: "SHOULD_NOT_RENDER_PATCH",
    policySnapshot: "SHOULD_NOT_RENDER_POLICY",
    rawLog: "SHOULD_NOT_RENDER_RAW_LOG",
    snippet: "SHOULD_NOT_RENDER_SNIPPET",
    sourceCode: "SHOULD_NOT_RENDER_SOURCE_CODE",
    validationCommands: "SHOULD_NOT_RENDER_VALIDATION",
  }) as TaskWorkflowItem;

describe("manual task UI source conventions", () => {
  test("defines a protected new task route that verifies workspace membership before loading mappings", async () => {
    await expectFile("./(app)/dashboard/tasks/new/page.tsx");

    const source = await readAppFile("./(app)/dashboard/tasks/new/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("createRepoMappingService");
    expect(source).toContain("createDrizzleRepoMappingStore");
    expect(source).toMatch(
      /listRepoMappings\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).not.toMatch(
      /repoMappingService\s*\.\s*listRepoMappings\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expect(source).toMatch(/repoMappings\.length === 0[\s\S]*No repository mappings/);
    expect(source).toMatch(
      /<TaskForm[\s\S]*repoMappings={safeRepoMappings}[\s\S]*workspaceId={verifiedWorkspace\.workspaceId}/,
    );
    expectNoManualTaskSourceUploadMaterial(source);
  });

  test("renders metadata-only task form fields and explicit paste warnings", async () => {
    await expectFile("../components/task-form.tsx");

    const source = await readAppFile("../components/task-form.tsx");

    expect(source.trimStart()).toMatch(/^"use client";/);
    expect(source).toContain("useActionState");
    expect(source).toContain("createManualTaskAction");
    expect(source).toContain("useState");
    expect(source).toContain('name="workspaceId"');
    expect(source).toContain('name="repoMappingId"');
    expect(source).toContain('name="title"');
    expect(source).toContain('name="objective"');
    expect(source).toContain('name="acceptanceCriteria"');
    expect(source).toContain('name="contextFilePaths"');
    expect(source).toContain('<input name="mode" type="hidden" value={mode} />');
    expect(source).toContain('setMode("dryRun")');
    expect(source).toContain('setMode("execute")');
    expect(source).toContain("acceptanceCriteriaRows.map");
    expect(source).toContain("contextPathRows.map");
    expect(source).toContain("addAcceptanceCriterion");
    expect(source).toContain("addContextPath");
    expect(source).toContain("removeAcceptanceCriterion");
    expect(source).toContain("removeContextPath");
    expect(source).toContain("Field");
    expect(source).toContain("Select");
    expect(source).toContain("Path references only");
    expect(source).toContain("Do not paste source, diffs, patches, logs, snippets, secrets");
    expect(source).toContain(".env contents");
    expect(source).toContain('href="/dashboard/tasks"');
    expectNoManualTaskSourceUploadMaterial(source);
  });

  test("lists manual tasks with approval state and metadata-only columns", async () => {
    const { TaskList } = await import("../components/task-list");
    const draftTask = addUnsafeHiddenPayload(
      createTask({
        requestedByActorId: "user_draft",
        title: "Manual draft task",
      }),
    );
    const approvedTask = addUnsafeHiddenPayload(
      createTask({
        id: "task_approved",
        latestRun: {
          id: "run_approved",
          mode: "execute",
          pr: null,
          risk: {
            blockerCount: 0,
            riskCategoryCounts: [],
            warningCount: 0,
          },
          runner: null,
          state: "queued",
          updatedAt: new Date("2026-05-23T11:00:00.000Z"),
          validationStatusCounts: [],
        },
        mode: "execute",
        requestedByActorId: "user_approved",
        status: "approved",
        title: "Manual approved task",
        workflow: {
          bucket: "queued",
          label: "Queued for runner",
        },
      }),
    );

    const html = renderToStaticMarkup(
      createElement(TaskList, {
        repoMappings: [
          {
            id: "repo_mapping_1",
            label: "rory/control-plane",
          },
        ],
        tasks: [draftTask, approvedTask],
      }),
    );

    expect(html).toContain("Workspace tasks");
    expect(html).not.toContain("Manual drafts");
    expect(html).toMatch(
      /Task[\s\S]*Repository[\s\S]*Workflow[\s\S]*Mode[\s\S]*Source[\s\S]*Created by[\s\S]*Updated[\s\S]*Action/,
    );
    expect(html).toContain("Workflow queue");
    expect(html).toContain("1 draft");
    expect(html).toContain("1 queued");
    expect(html).toContain("0 running");
    expect(html).toContain("0 blocked/failed");
    expect(html).toContain("0 awaiting approval");
    expect(html).toContain("0 PR-ready");
    expect(html).toContain("Manual draft task");
    expect(html).toContain("Manual approved task");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("Manual");
    expect(html).toContain("Ready to approve");
    expect(html).toContain("Queued for runner");
    expect(html).toContain("Dry run");
    expect(html).toContain("Execute");
    expect(html).toContain("Queued for runner");
    expect(html).toContain("user_draft");
    expect(html).toContain("user_approved");
    expect(html).toContain("May 23, 2026");
    expect(html.match(/Approve to run/g)).toHaveLength(1);
    expect(html).not.toContain("repo_mapping_1");
    expect(html).not.toContain("SHOULD_NOT_RENDER_OBJECTIVE");
    expect(html).not.toContain("SHOULD_NOT_RENDER_CONTEXT_PATH");
    expect(html).not.toContain("Acceptance criteria raw text");
    expect(html).not.toContain("apps/private/context.ts");
    expect(html).not.toContain("SHOULD_NOT_RENDER_POLICY");
    expect(html).not.toContain("SHOULD_NOT_RENDER_VALIDATION");
    expect(html).not.toContain("SHOULD_NOT_RENDER_LOCAL_PATH");
    expect(html).not.toContain("SHOULD_NOT_RENDER_RAW_LOG");
    expect(html).not.toContain("SHOULD_NOT_RENDER_DIFF");
    expect(html).not.toContain("SHOULD_NOT_RENDER_PATCH");
    expect(html).not.toContain("SHOULD_NOT_RENDER_SNIPPET");
    expect(html).not.toContain("SHOULD_NOT_RENDER_SOURCE_CODE");
  });

  test("does not render unsafe known task-list fields from hostile task props", async () => {
    const { TaskList } = await import("../components/task-list");
    const html = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [
          createTask({
            latestRun: {
              id: "run_unsafe",
              mode: "execute",
              pr: null,
              risk: {
                blockerCount: 0,
                riskCategoryCounts: [],
                warningCount: 0,
              },
              runner: null,
              state: "queued",
              updatedAt: createdAt,
              validationStatusCounts: [],
            },
            repoMapping: {
              id: "repo_mapping_1",
              repositoryName: ".env.local",
              repositoryOwner: "/Users/rory/private/repo",
            },
            requestedByActorId: "Bearer unsafeFixtureToken12345",
            title: "diff --git a/app.ts b/app.ts",
            workflow: {
              bucket: "draft",
              label: "stdout: raw task output",
            },
          }),
        ],
      }),
    );

    expect(html).toContain("task_1");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain(".env.local");
    expect(html).not.toContain("unsafeFixtureToken12345");
    expect(html).not.toContain("raw task output");
  });

  test("renders an explicit approve-to-run action with hidden task scope and no raw payload fields", async () => {
    await expectFile("../components/task-list.tsx");

    const source = await readAppFile("../components/task-list.tsx");
    expect(source).toContain("approveManualTaskAction");
    expect(source).toContain("approveManualTaskAction(formData)");
    expect(source).toContain("<form action={submitApproveManualTaskAction}");
    expect(source).toContain('name="workspaceId"');
    expect(source).toContain('name="taskId"');
    expect(source).toContain("Approve to run");
    expect(source).not.toContain("acceptanceCriteria");
    expect(source).not.toContain("contextFilePaths");
    expectNoManualTaskSourceUploadMaterial(source);

    const { TaskList } = await import("../components/task-list");
    const task = createTask();
    const html = renderToStaticMarkup(
      createElement(TaskList, {
        repoMappings: [
          {
            id: "repo_mapping_1",
            label: "rory/control-plane",
          },
        ],
        tasks: [task],
      }),
    );

    expect(html).toContain("Approve to run");
    expect(html).toContain('name="workspaceId"');
    expect(html).toContain('value="workspace_1"');
    expect(html).toContain('name="taskId"');
    expect(html).toContain('value="task_1"');
    expect(html).not.toMatch(
      /name=["'](?:diff|patch|log|rawOutput|rawSource|sourceCode|snippet|policySnapshot|validationCommands|objective|acceptanceCriteria|contextFilePaths)["']/i,
    );
    expect(html).not.toContain("Create a manual draft task.");
  });

  test("filters task workflow rows by Cortex queue bucket", async () => {
    const { TaskList } = await import("../components/task-list");
    const html = renderToStaticMarkup(
      createElement(TaskList, {
        tasks: [
          createTask({ id: "task_draft", title: "Draft task" }),
          createTask({
            id: "task_blocked",
            latestRun: {
              id: "run_blocked",
              mode: "execute",
              pr: null,
              risk: {
                blockerCount: 1,
                riskCategoryCounts: [{ category: "validation_failed", count: 1 }],
                warningCount: 0,
              },
              runner: null,
              state: "blocked",
              updatedAt: createdAt,
              validationStatusCounts: [{ count: 1, status: "failed" }],
            },
            status: "approved",
            title: "Blocked task",
            workflow: {
              bucket: "blocked_failed",
              label: "Blocked or failed",
            },
          }),
        ],
        workflowFilter: "blocked_failed",
      }),
    );

    expect(html).toContain("All work");
    expect(html).toContain('href="/dashboard/tasks?workflow=blocked_failed"');
    expect(html).toContain("Showing 1 of 2 tasks.");
    expect(html).toContain("Blocked task");
    expect(html).toContain("1 failed");
    expect(html).not.toContain("Draft task");
  });

  test("renders an empty task list state linked to manual task creation", async () => {
    const { TaskList } = await import("../components/task-list");

    const html = renderToStaticMarkup(
      createElement(TaskList, {
        repoMappings: [],
        tasks: [],
      }),
    );

    expect(html).toContain("No manual tasks yet.");
    expect(html).toContain('href="/dashboard/tasks/new"');
    expect(html).toContain("Create first manual task");
    expect(html).not.toMatch(/localPath|\/Users\/|repo_mapping_/);
  });

  test("keeps manual draft creation reachable from the Cortex Tasks queue", async () => {
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
    expect(source).toMatch(/listCortexTasks\(\{\s*workspaceId: verifiedWorkspace\.workspaceId/);
    expect(source).not.toMatch(/listCortexTasks\(\{\s*workspaceId: cookieWorkspaceId/);
    expect(source).toMatch(/<CortexTaskQueue[\s\S]*tasks={tasks}/);
    expect(source).toContain('href="/dashboard/tasks/new"');
    expect(source).toContain("Create manual draft");
    expect(source).toContain("Cortex Tasks");
    expect(source).toContain("Runner execution is gated");
    expect(source).not.toContain("Manual task drafts");
    expect(source).not.toContain("draft task intent");
    expectNoManualTaskSourceUploadMaterial(source);
  });
});

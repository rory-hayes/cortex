import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));
vi.mock("next/headers", () => ({
  cookies: vi.fn(),
}));

const importActionFactories = async () => import("./action-factories");

describe("Cortex Task queue actions", () => {
  test("updateCortexTaskExecutionModeAction accepts only workspace, task, and execution mode metadata", async () => {
    const { createUpdateCortexTaskExecutionModeAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateCortexTaskExecutionMode = vi.fn(async () => ({
      approvalStatus: "pending" as const,
      executionMode: "planning_only" as const,
      repoId: "github_repository_1",
      status: "needs_review" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createUpdateCortexTaskExecutionModeAction({
      revalidatePath,
      updateCortexTaskExecutionMode,
    });

    await expect(
      action({
        executionMode: " planning_only ",
        taskId: " cortex_task_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        approvalStatus: "pending",
        executionMode: "planning_only",
        repoId: "github_repository_1",
        status: "needs_review",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(updateCortexTaskExecutionMode).toHaveBeenCalledWith({
      executionMode: "planning_only",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/task-recommendations");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("updateCortexTaskExecutionModeAction parses FormData input", async () => {
    const { createUpdateCortexTaskExecutionModeAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateCortexTaskExecutionMode = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      executionMode: "setup_pr" as const,
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createUpdateCortexTaskExecutionModeAction({
      revalidatePath,
      updateCortexTaskExecutionMode,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskId", " cortex_task_1 ");
    formData.set("executionMode", " setup_pr ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        executionMode: "setup_pr",
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(updateCortexTaskExecutionMode).toHaveBeenCalledWith({
      executionMode: "setup_pr",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
  });

  test.each(["execute", "hosted_execution", "queued", ""])(
    "updateCortexTaskExecutionModeAction rejects unsupported execution mode %s before service call",
    async (executionMode) => {
      const { createUpdateCortexTaskExecutionModeAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateCortexTaskExecutionMode = vi.fn();
      const action = createUpdateCortexTaskExecutionModeAction({
        revalidatePath,
        updateCortexTaskExecutionMode,
      });

      await expect(
        action({
          executionMode,
          taskId: "cortex_task_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateCortexTaskExecutionMode).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "updateCortexTaskExecutionModeAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createUpdateCortexTaskExecutionModeAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateCortexTaskExecutionMode = vi.fn();
      const action = createUpdateCortexTaskExecutionModeAction({
        revalidatePath,
        updateCortexTaskExecutionMode,
      });

      await expect(
        action({
          executionMode: "setup_pr",
          taskId: "cortex_task_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateCortexTaskExecutionMode).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test("transitionCortexTaskStatusAction accepts only workspace, task, and status metadata", async () => {
    const { createTransitionCortexTaskStatusAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const transitionCortexTaskStatus = vi.fn(async () => ({
      approvalStatus: "approved" as const,
      repoId: "github_repository_1",
      status: "queued" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createTransitionCortexTaskStatusAction({
      revalidatePath,
      transitionCortexTaskStatus,
    });

    await expect(
      action({
        status: " queued ",
        taskId: " cortex_task_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        approvalStatus: "approved",
        repoId: "github_repository_1",
        status: "queued",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(transitionCortexTaskStatus).toHaveBeenCalledWith({
      status: "queued",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/task-recommendations");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("transitionCortexTaskStatusAction parses FormData input", async () => {
    const { createTransitionCortexTaskStatusAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const transitionCortexTaskStatus = vi.fn(async () => ({
      approvalStatus: "pending" as const,
      repoId: "github_repository_1",
      status: "needs_review" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createTransitionCortexTaskStatusAction({
      revalidatePath,
      transitionCortexTaskStatus,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskId", " cortex_task_1 ");
    formData.set("status", " needs_review ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        approvalStatus: "pending",
        repoId: "github_repository_1",
        status: "needs_review",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(transitionCortexTaskStatus).toHaveBeenCalledWith({
      status: "needs_review",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
  });

  test.each(["open", "cancelled", "hosted_execution", ""])(
    "transitionCortexTaskStatusAction rejects unsupported status %s before service call",
    async (status) => {
      const { createTransitionCortexTaskStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const transitionCortexTaskStatus = vi.fn();
      const action = createTransitionCortexTaskStatusAction({
        revalidatePath,
        transitionCortexTaskStatus,
      });

      await expect(
        action({
          status,
          taskId: "cortex_task_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(transitionCortexTaskStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "transitionCortexTaskStatusAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createTransitionCortexTaskStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const transitionCortexTaskStatus = vi.fn();
      const action = createTransitionCortexTaskStatusAction({
        revalidatePath,
        transitionCortexTaskStatus,
      });

      await expect(
        action({
          status: "queued",
          taskId: "cortex_task_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(transitionCortexTaskStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("linear import actions", () => {
  test("importLinearIssueCandidateAction accepts only workspace, Linear candidate, and repo ids", async () => {
    const { createImportLinearIssueCandidateAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const importLinearIssueCandidate = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      externalLinkCount: 1,
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createImportLinearIssueCandidateAction({
      importLinearIssueCandidate,
      revalidatePath,
    });

    await expect(
      action({
        linearIssueCandidateId: " linear_issue_candidate_1 ",
        repoId: " github_repository_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        externalLinkCount: 1,
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(importLinearIssueCandidate).toHaveBeenCalledWith({
      linearIssueCandidateId: "linear_issue_candidate_1",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("importLinearIssueCandidateAction parses FormData input", async () => {
    const { createImportLinearIssueCandidateAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const importLinearIssueCandidate = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      externalLinkCount: 1,
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createImportLinearIssueCandidateAction({
      importLinearIssueCandidate,
      revalidatePath,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("linearIssueCandidateId", " linear_issue_candidate_1 ");
    formData.set("repoId", " github_repository_1 ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        taskId: "cortex_task_1",
      },
      ok: true,
    });
    expect(importLinearIssueCandidate).toHaveBeenCalledWith({
      linearIssueCandidateId: "linear_issue_candidate_1",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "importLinearIssueCandidateAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createImportLinearIssueCandidateAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const importLinearIssueCandidate = vi.fn();
      const action = createImportLinearIssueCandidateAction({
        importLinearIssueCandidate,
        revalidatePath,
      });

      await expect(
        action({
          linearIssueCandidateId: "linear_issue_candidate_1",
          repoId: "github_repository_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(importLinearIssueCandidate).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test("importLinearIssueCandidateAction does not echo rejected hidden field values", async () => {
    const { createImportLinearIssueCandidateAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const importLinearIssueCandidate = vi.fn();
    const action = createImportLinearIssueCandidateAction({
      importLinearIssueCandidate,
      revalidatePath,
    });
    const value = "diff --git a/app.ts b/app.ts";

    const result = await action({
      linearIssueCandidateId: "linear_issue_candidate_1",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
      rawDiff: value,
    });

    expect(result).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(value);
    expect(importLinearIssueCandidate).not.toHaveBeenCalled();
  });
});

describe("linear task sync actions", () => {
  test("syncCortexTaskToLinearAction accepts only workspace, task, connection, team, project, and status ids", async () => {
    const { createSyncCortexTaskToLinearAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const syncCortexTaskToLinear = vi.fn(async () => ({
      action: "created" as const,
      externalLinkCount: 1,
      issueIdentifier: "ENG-222",
      issueId: "linear_issue_222",
      linearConnectionId: "linear_connection_1",
      status: "Todo",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createSyncCortexTaskToLinearAction({
      revalidatePath,
      syncCortexTaskToLinear,
    });

    await expect(
      action({
        linearConnectionId: " linear_connection_1 ",
        projectId: " linear_project_1 ",
        statusId: " linear_state_todo ",
        taskId: " cortex_task_1 ",
        teamId: " linear_team_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        action: "created",
        externalLinkCount: 1,
        issueIdentifier: "ENG-222",
        issueId: "linear_issue_222",
        linearConnectionId: "linear_connection_1",
        status: "Todo",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(syncCortexTaskToLinear).toHaveBeenCalledWith({
      linearConnectionId: "linear_connection_1",
      projectId: "linear_project_1",
      statusId: "linear_state_todo",
      taskId: "cortex_task_1",
      teamId: "linear_team_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("syncCortexTaskToLinearAction parses FormData and allows omitted optional project or status", async () => {
    const { createSyncCortexTaskToLinearAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const syncCortexTaskToLinear = vi.fn(async () => ({
      action: "updated" as const,
      externalLinkCount: 1,
      issueIdentifier: "ENG-222",
      issueId: "linear_issue_222",
      linearConnectionId: "linear_connection_1",
      status: "Todo",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createSyncCortexTaskToLinearAction({
      revalidatePath,
      syncCortexTaskToLinear,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskId", " cortex_task_1 ");
    formData.set("linearConnectionId", " linear_connection_1 ");
    formData.set("teamId", " linear_team_1 ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        action: "updated",
        taskId: "cortex_task_1",
      },
      ok: true,
    });
    expect(syncCortexTaskToLinear).toHaveBeenCalledWith({
      linearConnectionId: "linear_connection_1",
      taskId: "cortex_task_1",
      teamId: "linear_team_1",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "syncCortexTaskToLinearAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createSyncCortexTaskToLinearAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const syncCortexTaskToLinear = vi.fn();
      const action = createSyncCortexTaskToLinearAction({
        revalidatePath,
        syncCortexTaskToLinear,
      });

      await expect(
        action({
          linearConnectionId: "linear_connection_1",
          taskId: "cortex_task_1",
          teamId: "linear_team_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(syncCortexTaskToLinear).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["raw-source", "const leaked = true;"],
    ["Raw Diff", "diff --git a/app.ts b/app.ts"],
    ["patch_text", "@@ -1 +1 @@"],
    ["codeSnippet", "export const leaked = true;"],
    ["fileContents", "private file body"],
    ["raw-logs", "raw logs: failed command output"],
    ["rawCommandOutput", "command output: failed"],
    ["status-id", "diff --git a/app.ts b/app.ts"],
    ["stdoutSummary", "stdout: hidden validation output"],
    ["stderrSummary", "stderr: hidden validation output"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ])(
    "syncCortexTaskToLinearAction rejects hostile hidden field spelling %s generically",
    async (field, value) => {
      const { createSyncCortexTaskToLinearAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const syncCortexTaskToLinear = vi.fn();
      const action = createSyncCortexTaskToLinearAction({
        revalidatePath,
        syncCortexTaskToLinear,
      });
      const formData = new FormData();

      formData.set("$ACTION_ID_123", "opaque-next-action-id");
      formData.set("workspaceId", "workspace_1");
      formData.set("taskId", "cortex_task_1");
      formData.set("linearConnectionId", "linear_connection_1");
      formData.set("teamId", "linear_team_1");
      formData.set(field, value);

      const result = await action(formData);

      expect(result).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain(value);
      expect(syncCortexTaskToLinear).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("GitHub issue task sync actions", () => {
  test("syncCortexTaskToGitHubIssueAction accepts only workspace and task ids", async () => {
    const { createSyncCortexTaskToGitHubIssueAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const syncCortexTaskToGitHubIssue = vi.fn(async () => ({
      action: "created" as const,
      externalLinkCount: 1,
      issueId: "601",
      issueNumber: 31,
      status: "open",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createSyncCortexTaskToGitHubIssueAction({
      revalidatePath,
      syncCortexTaskToGitHubIssue,
    });

    await expect(
      action({
        taskId: " cortex_task_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        action: "created",
        externalLinkCount: 1,
        issueId: "601",
        issueNumber: 31,
        status: "open",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(syncCortexTaskToGitHubIssue).toHaveBeenCalledWith({
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("syncCortexTaskToGitHubIssueAction parses FormData input", async () => {
    const { createSyncCortexTaskToGitHubIssueAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const syncCortexTaskToGitHubIssue = vi.fn(async () => ({
      action: "existing" as const,
      externalLinkCount: 1,
      issueId: "601",
      issueNumber: 31,
      status: "open",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createSyncCortexTaskToGitHubIssueAction({
      revalidatePath,
      syncCortexTaskToGitHubIssue,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskId", " cortex_task_1 ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        action: "existing",
        taskId: "cortex_task_1",
      },
      ok: true,
    });
    expect(syncCortexTaskToGitHubIssue).toHaveBeenCalledWith({
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "syncCortexTaskToGitHubIssueAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createSyncCortexTaskToGitHubIssueAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const syncCortexTaskToGitHubIssue = vi.fn();
      const action = createSyncCortexTaskToGitHubIssueAction({
        revalidatePath,
        syncCortexTaskToGitHubIssue,
      });

      await expect(
        action({
          taskId: "cortex_task_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(syncCortexTaskToGitHubIssue).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["raw-source", "const leaked = true;"],
    ["Raw Diff", "diff --git a/app.ts b/app.ts"],
    ["patch_text", "@@ -1 +1 @@"],
    ["codeSnippet", "export const leaked = true;"],
    ["fileContents", "private file body"],
    ["raw-logs", "raw logs: failed command output"],
    ["rawCommandOutput", "command output: failed"],
    ["issueBody", "body text from GitHub"],
    ["stdoutSummary", "stdout: hidden validation output"],
    ["stderrSummary", "stderr: hidden validation output"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ])(
    "syncCortexTaskToGitHubIssueAction rejects hostile hidden field spelling %s generically",
    async (field, value) => {
      const { createSyncCortexTaskToGitHubIssueAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const syncCortexTaskToGitHubIssue = vi.fn();
      const action = createSyncCortexTaskToGitHubIssueAction({
        revalidatePath,
        syncCortexTaskToGitHubIssue,
      });
      const formData = new FormData();

      formData.set("$ACTION_ID_123", "opaque-next-action-id");
      formData.set("workspaceId", "workspace_1");
      formData.set("taskId", "cortex_task_1");
      formData.set(field, value);

      const result = await action(formData);

      expect(result).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain(value);
      expect(syncCortexTaskToGitHubIssue).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("finding actions", () => {
  test("updateFindingStatusAction permits dismissed status and revalidates finding/audit surfaces", async () => {
    const { createUpdateFindingStatusAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateFindingStatus = vi.fn(async () => ({
      findingId: "finding_1",
      status: "dismissed" as const,
      taskIdCount: 0,
      workspaceId: "workspace_1",
    }));
    const action = createUpdateFindingStatusAction({
      revalidatePath,
      updateFindingStatus,
    });

    await expect(
      action({
        findingId: " finding_1 ",
        status: " dismissed ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        findingId: "finding_1",
        status: "dismissed",
        taskIdCount: 0,
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(updateFindingStatus).toHaveBeenCalledWith({
      findingId: "finding_1",
      status: "dismissed",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("updateFindingStatusAction permits deferred status from FormData", async () => {
    const { createUpdateFindingStatusAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateFindingStatus = vi.fn(async () => ({
      findingId: "finding_1",
      status: "deferred" as const,
      taskIdCount: 1,
      workspaceId: "workspace_1",
    }));
    const action = createUpdateFindingStatusAction({
      revalidatePath,
      updateFindingStatus,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("findingId", " finding_1 ");
    formData.set("status", " deferred ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        findingId: "finding_1",
        status: "deferred",
        taskIdCount: 1,
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(updateFindingStatus).toHaveBeenCalledWith({
      findingId: "finding_1",
      status: "deferred",
      workspaceId: "workspace_1",
    });
  });

  test.each(["open", "resolved", "", "blocked"])(
    "updateFindingStatusAction rejects unsupported status %s before service call",
    async (status) => {
      const { createUpdateFindingStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateFindingStatus = vi.fn();
      const action = createUpdateFindingStatusAction({
        revalidatePath,
        updateFindingStatus,
      });

      await expect(
        action({
          findingId: "finding_1",
          status,
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateFindingStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
  ])(
    "updateFindingStatusAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createUpdateFindingStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateFindingStatus = vi.fn();
      const action = createUpdateFindingStatusAction({
        revalidatePath,
        updateFindingStatus,
      });

      await expect(
        action({
          findingId: "finding_1",
          status: "dismissed",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateFindingStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["raw-source", "const leaked = true;"],
    ["Raw Diff", "diff --git a/app.ts b/app.ts"],
    ["patch_text", "@@ -1 +1 @@"],
    ["codeSnippet", "export const leaked = true;"],
    ["fileContents", "private file body"],
    ["raw-logs", "raw logs: failed command output"],
    ["rawCommandOutput", "command output: failed"],
    ["stdoutSummary", "stdout: hidden validation output"],
    ["stderrSummary", "stderr: hidden validation output"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ])(
    "updateFindingStatusAction rejects hostile hidden field spelling %s generically",
    async (field, value) => {
      const { createUpdateFindingStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateFindingStatus = vi.fn();
      const action = createUpdateFindingStatusAction({
        revalidatePath,
        updateFindingStatus,
      });
      const formData = new FormData();

      formData.set("$ACTION_ID_123", "opaque-next-action-id");
      formData.set("workspaceId", "workspace_1");
      formData.set("findingId", "finding_1");
      formData.set("status", "dismissed");
      formData.set(field, value);

      const result = await action(formData);

      expect(result).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain(value);
      expect(updateFindingStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test("convertFindingToTaskAction accepts only workspace and finding ids and revalidates queue surfaces", async () => {
    const { createConvertFindingToTaskAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const convertFindingToTask = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      findingId: "finding_1",
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    }));
    const action = createConvertFindingToTaskAction({
      convertFindingToTask,
      revalidatePath,
    });

    await expect(
      action({
        findingId: " finding_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        findingId: "finding_1",
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(convertFindingToTask).toHaveBeenCalledWith({
      findingId: "finding_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
  ])(
    "convertFindingToTaskAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createConvertFindingToTaskAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const convertFindingToTask = vi.fn();
      const action = createConvertFindingToTaskAction({
        convertFindingToTask,
        revalidatePath,
      });

      await expect(
        action({
          findingId: "finding_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(convertFindingToTask).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["raw-source", "const leaked = true;"],
    ["Raw Diff", "diff --git a/app.ts b/app.ts"],
    ["patch_text", "@@ -1 +1 @@"],
    ["codeSnippet", "export const leaked = true;"],
    ["fileContents", "private file body"],
    ["raw-logs", "raw logs: failed command output"],
    ["rawCommandOutput", "command output: failed"],
    ["stdoutSummary", "stdout: hidden validation output"],
    ["stderrSummary", "stderr: hidden validation output"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ])(
    "convertFindingToTaskAction rejects hostile hidden field spelling %s generically",
    async (field, value) => {
      const { createConvertFindingToTaskAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const convertFindingToTask = vi.fn();
      const action = createConvertFindingToTaskAction({
        convertFindingToTask,
        revalidatePath,
      });
      const formData = new FormData();

      formData.set("$ACTION_ID_123", "opaque-next-action-id");
      formData.set("workspaceId", "workspace_1");
      formData.set("findingId", "finding_1");
      formData.set(field, value);

      const result = await action(formData);

      expect(result).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain(value);
      expect(convertFindingToTask).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("task recommendation actions", () => {
  test("approveTaskRecommendationAction accepts only workspace and recommendation ids", async () => {
    const { createApproveTaskRecommendationAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const approveTaskRecommendation = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      taskRecommendationId: "task_recommendation_1",
      workspaceId: "workspace_1",
    }));
    const action = createApproveTaskRecommendationAction({
      approveTaskRecommendation,
      revalidatePath,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskRecommendationId", " task_recommendation_1 ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(approveTaskRecommendation).toHaveBeenCalledWith({
      taskRecommendationId: "task_recommendation_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/task-recommendations");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("approveTaskRecommendationAction forwards optional reviewer edits", async () => {
    const { createApproveTaskRecommendationAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const approveTaskRecommendation = vi.fn(async () => ({
      approvalStatus: "not_requested" as const,
      repoId: "github_repository_1",
      status: "draft" as const,
      taskId: "cortex_task_1",
      taskRecommendationId: "task_recommendation_1",
      workspaceId: "workspace_1",
    }));
    const action = createApproveTaskRecommendationAction({
      approveTaskRecommendation,
      revalidatePath,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskRecommendationId", " task_recommendation_1 ");
    formData.set("title", " Reviewer edited task ");
    formData.set("objective", " Prepare reviewer edited setup work. ");
    formData.append("acceptanceCriteria", " First reviewed criterion. ");
    formData.append("acceptanceCriteria", " Second reviewed criterion. ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        approvalStatus: "not_requested",
        repoId: "github_repository_1",
        status: "draft",
        taskId: "cortex_task_1",
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(approveTaskRecommendation).toHaveBeenCalledWith({
      acceptanceCriteria: ["First reviewed criterion.", "Second reviewed criterion."],
      objective: "Prepare reviewer edited setup work.",
      taskRecommendationId: "task_recommendation_1",
      title: "Reviewer edited task",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
  });

  test("approveTaskRecommendationsAction supports bulk approval requests", async () => {
    const { createApproveTaskRecommendationsAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const approveTaskRecommendations = vi.fn(async () => ({
      approvals: [
        {
          approvalStatus: "not_requested" as const,
          repoId: "github_repository_1",
          status: "draft" as const,
          taskId: "cortex_task_1",
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        },
        {
          approvalStatus: "not_requested" as const,
          repoId: "github_repository_1",
          status: "draft" as const,
          taskId: "cortex_task_2",
          taskRecommendationId: "task_recommendation_2",
          workspaceId: "workspace_1",
        },
      ],
    }));
    const action = createApproveTaskRecommendationsAction({
      approveTaskRecommendations,
      revalidatePath,
    });

    await expect(
      action({
        recommendations: [
          { taskRecommendationId: " task_recommendation_1 " },
          {
            acceptanceCriteria: [" Reviewed criterion. "],
            taskRecommendationId: " task_recommendation_2 ",
            title: " Reviewer edited recommendation ",
          },
        ],
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        approvals: [
          {
            approvalStatus: "not_requested",
            repoId: "github_repository_1",
            status: "draft",
            taskId: "cortex_task_1",
            taskRecommendationId: "task_recommendation_1",
            workspaceId: "workspace_1",
          },
          {
            approvalStatus: "not_requested",
            repoId: "github_repository_1",
            status: "draft",
            taskId: "cortex_task_2",
            taskRecommendationId: "task_recommendation_2",
            workspaceId: "workspace_1",
          },
        ],
      },
      ok: true,
    });
    expect(approveTaskRecommendations).toHaveBeenCalledWith({
      recommendations: [
        { taskRecommendationId: "task_recommendation_1" },
        {
          acceptanceCriteria: ["Reviewed criterion."],
          taskRecommendationId: "task_recommendation_2",
          title: "Reviewer edited recommendation",
        },
      ],
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/task-recommendations");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("approveTaskRecommendationsAction rejects unsafe nested approval fields before service call", async () => {
    const { createApproveTaskRecommendationsAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const approveTaskRecommendations = vi.fn();
    const action = createApproveTaskRecommendationsAction({
      approveTaskRecommendations,
      revalidatePath,
    });

    await expect(
      action({
        recommendations: [
          {
            sourceCode: "const leaked = true;",
            taskRecommendationId: "task_recommendation_1",
          },
        ],
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(approveTaskRecommendations).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each([
    ["dismissed", "ignored"],
    ["ignored", "ignored"],
    ["deferred", "deferred"],
  ] as const)(
    "updateTaskRecommendationStatusAction maps %s to %s",
    async (inputStatus, serviceStatus) => {
      const { createUpdateTaskRecommendationStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateTaskRecommendationStatus = vi.fn(async () => ({
        status: serviceStatus,
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      }));
      const action = createUpdateTaskRecommendationStatusAction({
        revalidatePath,
        updateTaskRecommendationStatus,
      });

      await expect(
        action({
          status: ` ${inputStatus} `,
          taskRecommendationId: " task_recommendation_1 ",
          workspaceId: " workspace_1 ",
        }),
      ).resolves.toEqual({
        data: {
          status: serviceStatus,
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        },
        ok: true,
      });
      expect(updateTaskRecommendationStatus).toHaveBeenCalledWith({
        status: serviceStatus,
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      });
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/findings");
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
      expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
    },
  );

  test.each(["open", "converted", "approved", "resolved", ""])(
    "updateTaskRecommendationStatusAction rejects unsupported status %s before service call",
    async (status) => {
      const { createUpdateTaskRecommendationStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateTaskRecommendationStatus = vi.fn();
      const action = createUpdateTaskRecommendationStatusAction({
        revalidatePath,
        updateTaskRecommendationStatus,
      });

      await expect(
        action({
          status,
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateTaskRecommendationStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
  ])(
    "approveTaskRecommendationAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createApproveTaskRecommendationAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const approveTaskRecommendation = vi.fn();
      const action = createApproveTaskRecommendationAction({
        approveTaskRecommendation,
        revalidatePath,
      });

      await expect(
        action({
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(approveTaskRecommendation).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
  ])(
    "updateTaskRecommendationStatusAction rejects unsafe hidden field $field before service call",
    async ({ field, value }) => {
      const { createUpdateTaskRecommendationStatusAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const updateTaskRecommendationStatus = vi.fn();
      const action = createUpdateTaskRecommendationStatusAction({
        revalidatePath,
        updateTaskRecommendationStatus,
      });

      await expect(
        action({
          status: "ignored",
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
          [field]: value,
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(updateTaskRecommendationStatus).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("requestRepairAction", () => {
  test("trims FormData, requests repair, and revalidates previous plus queued run surfaces", async () => {
    const { createRequestRepairAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createdAt = new Date("2026-05-23T12:00:00.000Z");
    const requestRepair = vi.fn(async () => ({
      actorId: "user_1",
      attempt: 1,
      createdAt,
      maxAttempts: 2,
      previousRunId: "run_previous",
      queuedRunId: "run_repair_1",
      redactionApplied: false,
      repairJobId: "job_repair_1",
      repairRequestId: "repair_request_1",
      workspaceId: "workspace_1",
    }));
    const action = createRequestRepairAction({
      requestRepair,
      revalidatePath,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("previousRunId", " run_previous ");
    formData.set("feedback", " Please keep the original scope and address the failing check. ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        actorId: "user_1",
        attempt: 1,
        createdAt,
        maxAttempts: 2,
        previousRunId: "run_previous",
        queuedRunId: "run_repair_1",
        redactionApplied: false,
        repairJobId: "job_repair_1",
        repairRequestId: "repair_request_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(requestRepair).toHaveBeenCalledWith({
      feedback: "Please keep the original scope and address the failing check.",
      previousRunId: "run_previous",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_previous");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/approvals");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/pull-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_repair_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("trims object input, requests repair, and does not echo feedback", async () => {
    const { createRequestRepairAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createdAt = new Date("2026-05-23T12:00:00.000Z");
    const requestRepair = vi.fn(async () => ({
      actorId: "user_1",
      attempt: 2,
      createdAt,
      maxAttempts: 2,
      previousRunId: "run_previous",
      queuedRunId: "run_repair_2",
      redactionApplied: true,
      repairJobId: "job_repair_2",
      repairRequestId: "repair_request_2",
      workspaceId: "workspace_1",
    }));
    const action = createRequestRepairAction({
      requestRepair,
      revalidatePath,
    });

    const result = await action({
      feedback: "  Keep the original scope and address the failing typecheck.  ",
      previousRunId: " run_previous ",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual({
      data: {
        actorId: "user_1",
        attempt: 2,
        createdAt,
        maxAttempts: 2,
        previousRunId: "run_previous",
        queuedRunId: "run_repair_2",
        redactionApplied: true,
        repairJobId: "job_repair_2",
        repairRequestId: "repair_request_2",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(requestRepair).toHaveBeenCalledWith({
      feedback: "Keep the original scope and address the failing typecheck.",
      previousRunId: "run_previous",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(result)).not.toContain("Keep the original scope");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_previous");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/approvals");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/pull-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_repair_2");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test.each([
    { feedback: "Please repair.", previousRunId: "run_previous", workspaceId: "" },
    { feedback: "Please repair.", previousRunId: "", workspaceId: "workspace_1" },
    { feedback: "", previousRunId: "run_previous", workspaceId: "workspace_1" },
    { feedback: "x".repeat(2_001), previousRunId: "run_previous", workspaceId: "workspace_1" },
  ])("returns validation_error for invalid repair input %#", async (input) => {
    const { createRequestRepairAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const requestRepair = vi.fn();
    const action = createRequestRepairAction({
      requestRepair,
      revalidatePath,
    });

    await expect(action(input)).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(requestRepair).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "taskPacket", value: "{}" },
    { field: "validationCommands", value: "pnpm test" },
  ])("rejects unsafe repair payload field $field before service call", async ({ field, value }) => {
    const { createRequestRepairAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const requestRepair = vi.fn();
    const action = createRequestRepairAction({
      requestRepair,
      revalidatePath,
    });

    await expect(
      action({
        feedback: "Please keep the repair focused on the reviewer request.",
        previousRunId: "run_previous",
        workspaceId: "workspace_1",
        [field]: value,
      }),
    ).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(requestRepair).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(["unauthenticated", "forbidden", "validation_error"] as const)(
    "returns %s service errors without revalidation",
    async (code) => {
      const { createActionError } = await import("./errors");
      const { createRequestRepairAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const requestRepair = vi.fn(async () => {
        throw createActionError(code);
      });
      const action = createRequestRepairAction({
        requestRepair,
        revalidatePath,
      });

      await expect(
        action({
          feedback: "Please adjust the failing readiness check.",
          previousRunId: "run_previous",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error:
          code === "unauthenticated"
            ? {
                code,
                message: "Sign in to continue.",
              }
            : code === "forbidden"
              ? {
                  code,
                  message: "You do not have access to this workspace.",
                }
              : {
                  code,
                  message: "Check the submitted fields and try again.",
                },
        ok: false,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("cancelRunAction", () => {
  test("parses object input, cancels the run, and revalidates run surfaces", async () => {
    const { createCancelRunAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const cancelledAt = new Date("2026-05-22T12:00:00.000Z");
    const cancelRun = vi.fn(async () => ({
      cancellationRequestedAt: cancelledAt,
      cancellationRequestedByActorId: "user_1",
      redactionApplied: false,
      runId: "run_1",
      state: "cancel_requested" as const,
      workspaceId: "workspace_1",
    }));
    const action = createCancelRunAction({
      cancelRun,
      revalidatePath,
    });

    await expect(
      action({
        reason: " Cancel before validation finishes. ",
        runId: " run_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        cancellationRequestedAt: cancelledAt,
        cancellationRequestedByActorId: "user_1",
        redactionApplied: false,
        runId: "run_1",
        state: "cancel_requested",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(cancelRun).toHaveBeenCalledWith({
      reason: "Cancel before validation finishes.",
      runId: "run_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_1");
  });

  test("parses FormData input before cancelling a run", async () => {
    const { createCancelRunAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const cancelledAt = new Date("2026-05-22T12:00:00.000Z");
    const cancelRun = vi.fn(async () => ({
      cancellationRequestedAt: cancelledAt,
      cancellationRequestedByActorId: "user_1",
      redactionApplied: true,
      runId: "run_1",
      state: "cancel_requested" as const,
      workspaceId: "workspace_1",
    }));
    const action = createCancelRunAction({
      cancelRun,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("runId", " run_1 ");
    formData.set("reason", " Cancel with redaction. ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        redactionApplied: true,
        runId: "run_1",
        state: "cancel_requested",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(cancelRun).toHaveBeenCalledWith({
      reason: "Cancel with redaction.",
      runId: "run_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_1");
  });

  test.each([
    { reason: "Cancel.", runId: "run_1", workspaceId: "" },
    { reason: "Cancel.", runId: "", workspaceId: "workspace_1" },
    { reason: "", runId: "run_1", workspaceId: "workspace_1" },
    { reason: "x".repeat(501), runId: "run_1", workspaceId: "workspace_1" },
    { reason: "Cancel.", runId: "x".repeat(161), workspaceId: "workspace_1" },
    { reason: "Cancel.", runId: "run_1", workspaceId: "x".repeat(161) },
  ])("returns validation_error for invalid cancellation input %#", async (input) => {
    const { createCancelRunAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const cancelRun = vi.fn();
    const action = createCancelRunAction({
      cancelRun,
      revalidatePath,
    });

    await expect(action(input)).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(cancelRun).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(["unauthenticated", "forbidden"] as const)(
    "returns %s service errors without revalidation",
    async (code) => {
      const { createActionError } = await import("./errors");
      const { createCancelRunAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const cancelRun = vi.fn(async () => {
        throw createActionError(code);
      });
      const action = createCancelRunAction({
        cancelRun,
        revalidatePath,
      });

      await expect(
        action({
          reason: "Cancel before validation.",
          runId: "run_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error:
          code === "unauthenticated"
            ? {
                code,
                message: "Sign in to continue.",
              }
            : {
                code,
                message: "You do not have access to this workspace.",
              },
        ok: false,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("run approval actions", () => {
  const decidedAt = new Date("2026-05-24T10:00:00.000Z");

  test("approve action parses object input, approves the run, and revalidates approval surfaces", async () => {
    const { createApproveRunAction } = await importActionFactories();
    const approveRun = vi.fn(async () => ({
      actorId: "user_1",
      approvalDecisionId: "approval_1",
      createdAt: decidedAt,
      decision: "approve" as const,
      redactionApplied: false,
      runId: "run_1",
      state: "completed" as const,
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createApproveRunAction({
      approveRun,
      revalidatePath,
    });

    await expect(
      action({
        reason: " Approved after human metadata review. ",
        runId: " run_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        actorId: "user_1",
        approvalDecisionId: "approval_1",
        createdAt: decidedAt,
        decision: "approve",
        redactionApplied: false,
        runId: "run_1",
        state: "completed",
        workspaceId: "workspace_1",
      },
      ok: true,
    });

    expect(approveRun).toHaveBeenCalledWith({
      reason: "Approved after human metadata review.",
      runId: "run_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/approvals");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/pull-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("reject action parses FormData input before rejecting the run", async () => {
    const { createRejectRunAction } = await importActionFactories();
    const rejectRun = vi.fn(async () => ({
      actorId: "user_1",
      approvalDecisionId: "approval_1",
      createdAt: decidedAt,
      decision: "reject" as const,
      redactionApplied: false,
      runId: "run_1",
      state: "failed" as const,
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createRejectRunAction({
      rejectRun,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("$ACTION_REF_123", "opaque-next-action-ref");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("runId", " run_1 ");
    formData.set("reason", " Reject after human metadata review. ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        approvalDecisionId: "approval_1",
        decision: "reject",
        runId: "run_1",
        state: "failed",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(rejectRun).toHaveBeenCalledWith({
      reason: "Reject after human metadata review.",
      runId: "run_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs/run_1");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/approvals");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/pull-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test.each(["diff", "patch", "rawOutput", "sourceCode", "taskPacket", "validationCommands"])(
    "rejects unsafe approval action field %s before service calls",
    async (field) => {
      const { createApproveRunAction } = await importActionFactories();
      const approveRun = vi.fn();
      const revalidatePath = vi.fn();
      const action = createApproveRunAction({
        approveRun,
        revalidatePath,
      });

      const result = await action({
        [field]: "function leak() { return process.env.SECRET; }",
        reason: "Approved after human review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      });

      expect(result).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(JSON.stringify(result)).not.toContain(field);
      expect(approveRun).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test.each([
    { reason: "", runId: "run_1", workspaceId: "workspace_1" },
    { reason: "Approved.", runId: "", workspaceId: "workspace_1" },
    { reason: "Approved.", runId: "run_1", workspaceId: "" },
    { reason: "x".repeat(1_001), runId: "run_1", workspaceId: "workspace_1" },
    { reason: "Approved.", runId: "x".repeat(161), workspaceId: "workspace_1" },
    { reason: "Approved.", runId: "run_1", workspaceId: "x".repeat(161) },
  ])("returns validation_error for invalid approval action input %#", async (input) => {
    const { createApproveRunAction } = await importActionFactories();
    const approveRun = vi.fn();
    const revalidatePath = vi.fn();
    const action = createApproveRunAction({
      approveRun,
      revalidatePath,
    });

    await expect(action(input)).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(approveRun).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(["unauthenticated", "forbidden", "validation_error"] as const)(
    "returns safe %s service errors without revalidation",
    async (code) => {
      const { createActionError } = await import("./errors");
      const { createRejectRunAction } = await importActionFactories();
      const rejectRun = vi.fn(async () => {
        throw createActionError(code);
      });
      const revalidatePath = vi.fn();
      const action = createRejectRunAction({
        rejectRun,
        revalidatePath,
      });

      const result = await action({
        reason: "Reject after human review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      });

      expect(result).toEqual({
        error:
          code === "unauthenticated"
            ? {
                code,
                message: "Sign in to continue.",
              }
            : code === "forbidden"
              ? {
                  code,
                  message: "You do not have access to this workspace.",
                }
              : {
                  code,
                  message: "Check the submitted fields and try again.",
                },
        ok: false,
      });
      expect(rejectRun).toHaveBeenCalledWith({
        reason: "Reject after human review.",
        runId: "run_1",
        workspaceId: "workspace_1",
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("createRunnerPairingCodeAction", () => {
  test("trims workspace input, creates a pairing code, revalidates runners, and returns immediate action data", async () => {
    const { createCreateRunnerPairingCodeAction } = await importActionFactories();
    const expiresAt = new Date("2026-05-22T20:45:00.000Z");
    const createRunnerPairingCode = vi.fn(async () => ({
      code: "PAIR-RAW-CODE",
      expiresAt,
      pairingId: "pairing_1",
      ttlSeconds: 600,
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createCreateRunnerPairingCodeAction({
      createRunnerPairingCode,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");

    await expect(action(null, formData)).resolves.toEqual({
      data: {
        code: "PAIR-RAW-CODE",
        expiresAt,
        pairingId: "pairing_1",
        ttlSeconds: 600,
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createRunnerPairingCode).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runners");
  });

  test("validates workspace id before creating a pairing code", async () => {
    const { createCreateRunnerPairingCodeAction } = await importActionFactories();
    const createRunnerPairingCode = vi.fn();
    const revalidatePath = vi.fn();
    const action = createCreateRunnerPairingCodeAction({
      createRunnerPairingCode,
      revalidatePath,
    });

    await expect(action(null, { workspaceId: " " })).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(createRunnerPairingCode).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("returns safe auth and scope envelopes without revalidation", async () => {
    const { createActionError } = await import("./errors");
    const { createCreateRunnerPairingCodeAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createRunnerPairingCode = vi.fn(async () => {
      throw createActionError("forbidden");
    });
    const action = createCreateRunnerPairingCodeAction({
      createRunnerPairingCode,
      revalidatePath,
    });

    await expect(action(null, { workspaceId: "workspace_1" })).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });
    expect(createRunnerPairingCode).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("revokeRunnerAction", () => {
  test("parses object input, revokes the runner, and revalidates runners", async () => {
    const { createRevokeRunnerAction } = await importActionFactories();
    const revokedAt = new Date("2026-05-22T13:30:00.000Z");
    const revokeRunner = vi.fn(async () => ({
      revokedAt,
      runnerId: "runner_1",
      status: "revoked" as const,
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createRevokeRunnerAction({
      revalidatePath,
      revokeRunner,
    });

    await expect(
      action({
        runnerId: " runner_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        revokedAt,
        runnerId: "runner_1",
        status: "revoked",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(revokeRunner).toHaveBeenCalledWith({
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runners");
  });

  test("parses FormData input before revoking a runner", async () => {
    const { createRevokeRunnerAction } = await importActionFactories();
    const revokedAt = new Date("2026-05-22T13:30:00.000Z");
    const revokeRunner = vi.fn(async () => ({
      revokedAt,
      runnerId: "runner_1",
      status: "revoked" as const,
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createRevokeRunnerAction({
      revalidatePath,
      revokeRunner,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("runnerId", " runner_1 ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        revokedAt,
        runnerId: "runner_1",
        status: "revoked",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(revokeRunner).toHaveBeenCalledWith({
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runners");
  });

  test.each([
    { runnerId: "", workspaceId: "workspace_1" },
    { runnerId: "runner_1", workspaceId: "" },
    { runnerId: "x".repeat(161), workspaceId: "workspace_1" },
    { runnerId: "runner_1", workspaceId: "x".repeat(161) },
  ])("returns validation_error for invalid runner revocation input %#", async (input) => {
    const { createRevokeRunnerAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const revokeRunner = vi.fn();
    const action = createRevokeRunnerAction({
      revalidatePath,
      revokeRunner,
    });

    await expect(action(input)).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(revokeRunner).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(["unauthenticated", "forbidden"] as const)(
    "returns %s service errors without revalidation",
    async (code) => {
      const { createActionError } = await import("./errors");
      const { createRevokeRunnerAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const revokeRunner = vi.fn(async () => {
        throw createActionError(code);
      });
      const action = createRevokeRunnerAction({
        revalidatePath,
        revokeRunner,
      });

      await expect(
        action({
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error:
          code === "unauthenticated"
            ? {
                code,
                message: "Sign in to continue.",
              }
            : {
                code,
                message: "You do not have access to this workspace.",
              },
        ok: false,
      });
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("updateWorkspaceNameAction", () => {
  test("validates input, runs the scoped mutation, revalidates dashboard paths, and returns data", async () => {
    const { createUpdateWorkspaceNameAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateWorkspaceName = vi.fn(async () => ({
      name: "Platform Ops",
      workspaceId: "workspace_1",
    }));
    const action = createUpdateWorkspaceNameAction({
      revalidatePath,
      updateWorkspaceName,
    });

    await expect(action({ name: " Platform Ops ", workspaceId: "workspace_1" })).resolves.toEqual({
      data: {
        name: "Platform Ops",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(updateWorkspaceName).toHaveBeenCalledWith({
      name: "Platform Ops",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/settings");
  });

  test("returns a validation envelope without mutating invalid input", async () => {
    const { createUpdateWorkspaceNameAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateWorkspaceName = vi.fn();
    const action = createUpdateWorkspaceNameAction({
      revalidatePath,
      updateWorkspaceName,
    });

    await expect(action({ name: "", workspaceId: "workspace_1" })).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(updateWorkspaceName).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("returns auth and scope errors without revalidation", async () => {
    const { createActionError } = await import("./errors");
    const { createUpdateWorkspaceNameAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const updateWorkspaceName = vi.fn(async () => {
      throw createActionError("forbidden");
    });
    const action = createUpdateWorkspaceNameAction({
      revalidatePath,
      updateWorkspaceName,
    });

    await expect(action({ name: "Platform Ops", workspaceId: "workspace_1" })).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("repo mapping actions", () => {
  test("create action parses object input, trims fields, calls service, and revalidates repositories", async () => {
    const { createCreateRepoMappingAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createRepoMapping = vi.fn(async () => ({
      archivedAt: null,
      createdAt: new Date("2026-05-22T16:00:00.000Z"),
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_1",
      localPath: "/repos/control-plane",
      policySummary: {
        maxChangedFiles: null,
        protectedPathCount: 0,
        sensitivePathCount: 0,
        untrackedFiles: "not_reported" as const,
        warningPathCount: 0,
      },
      policyStatus: "not_reported" as const,
      provider: "github",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryExternalId: null,
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: new Date("2026-05-22T16:00:00.000Z"),
      validationCommandCount: 0,
      validationSummary: {
        labels: [],
        optionalCount: 0,
        requiredCount: 0,
      },
      workspaceId: "workspace_1",
    }));
    const action = createCreateRepoMappingAction({
      createRepoMapping,
      revalidatePath,
    });

    await expect(
      action({
        defaultBranch: " main ",
        localPath: " /repos/control-plane ",
        remoteUrl: " https://github.com/rory/control-plane.git ",
        repositoryName: " control-plane ",
        repositoryOwner: " rory ",
        runnerId: " runner_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toMatchObject({
      data: {
        id: "repo_mapping_1",
        localPath: "/repos/control-plane",
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createRepoMapping).toHaveBeenCalledWith({
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/repositories");
  });

  test("create action parses FormData input and omits blank optional fields", async () => {
    const { createCreateRepoMappingAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createRepoMapping = vi.fn(async () => ({
      archivedAt: null,
      createdAt: new Date("2026-05-22T16:00:00.000Z"),
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_1",
      localPath: "/repos/control-plane",
      policySummary: {
        maxChangedFiles: null,
        protectedPathCount: 0,
        sensitivePathCount: 0,
        untrackedFiles: "not_reported" as const,
        warningPathCount: 0,
      },
      policyStatus: "not_reported" as const,
      provider: "github",
      remoteUrl: null,
      repositoryExternalId: null,
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: new Date("2026-05-22T16:00:00.000Z"),
      validationCommandCount: 0,
      validationSummary: {
        labels: [],
        optionalCount: 0,
        requiredCount: 0,
      },
      workspaceId: "workspace_1",
    }));
    const action = createCreateRepoMappingAction({
      createRepoMapping,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("runnerId", " runner_1 ");
    formData.set("localPath", " /repos/control-plane ");
    formData.set("repositoryOwner", " rory ");
    formData.set("repositoryName", " control-plane ");
    formData.set("defaultBranch", " main ");
    formData.set("remoteUrl", " ");

    await expect(action(formData)).resolves.toMatchObject({ ok: true });

    expect(createRepoMapping).toHaveBeenCalledWith({
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/repositories");
  });

  test("delete action parses object and FormData input, calls service, and revalidates repositories", async () => {
    const { createDeleteRepoMappingAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const deleteRepoMapping = vi.fn(async () => ({
      archivedAt: new Date("2026-05-22T16:05:00.000Z"),
      id: "repo_mapping_1",
      workspaceId: "workspace_1",
    }));
    const action = createDeleteRepoMappingAction({
      deleteRepoMapping,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("repoMappingId", " repo_mapping_2 ");

    await expect(
      action({
        repoMappingId: " repo_mapping_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        archivedAt: new Date("2026-05-22T16:05:00.000Z"),
        id: "repo_mapping_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    await expect(action(formData)).resolves.toMatchObject({ ok: true });

    expect(deleteRepoMapping).toHaveBeenNthCalledWith(1, {
      repoMappingId: "repo_mapping_1",
      workspaceId: "workspace_1",
    });
    expect(deleteRepoMapping).toHaveBeenNthCalledWith(2, {
      repoMappingId: "repo_mapping_2",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledTimes(2);
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/repositories");
  });

  test("repo mapping actions return validation errors without service calls or revalidation", async () => {
    const { createCreateRepoMappingAction, createDeleteRepoMappingAction } =
      await importActionFactories();
    const revalidatePath = vi.fn();
    const createRepoMapping = vi.fn();
    const deleteRepoMapping = vi.fn();
    const createAction = createCreateRepoMappingAction({
      createRepoMapping,
      revalidatePath,
    });
    const deleteAction = createDeleteRepoMappingAction({
      deleteRepoMapping,
      revalidatePath,
    });

    await expect(
      createAction({
        defaultBranch: "main",
        localPath: "",
        repositoryName: "control-plane",
        repositoryOwner: "rory",
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    await expect(
      deleteAction({
        repoMappingId: "",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "validation_error",
      },
      ok: false,
    });
    expect(createRepoMapping).not.toHaveBeenCalled();
    expect(deleteRepoMapping).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("repo mapping actions return auth and scope errors without revalidation", async () => {
    const { createActionError } = await import("./errors");
    const { createCreateRepoMappingAction, createDeleteRepoMappingAction } =
      await importActionFactories();
    const revalidatePath = vi.fn();
    const createRepoMapping = vi.fn(async () => {
      throw createActionError("forbidden");
    });
    const deleteRepoMapping = vi.fn(async () => {
      throw createActionError("unauthenticated");
    });
    const createAction = createCreateRepoMappingAction({
      createRepoMapping,
      revalidatePath,
    });
    const deleteAction = createDeleteRepoMappingAction({
      deleteRepoMapping,
      revalidatePath,
    });

    await expect(
      createAction({
        defaultBranch: "main",
        localPath: "/repos/control-plane",
        repositoryName: "control-plane",
        repositoryOwner: "rory",
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "forbidden",
      },
      ok: false,
    });
    await expect(
      deleteAction({
        repoMappingId: "repo_mapping_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      error: {
        code: "unauthenticated",
      },
      ok: false,
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("createManualTaskAction", () => {
  const createdAt = new Date("2026-05-23T10:30:00.000Z");

  test("parses repeated FormData fields, creates a draft task, and revalidates task surfaces", async () => {
    const { createCreateManualTaskAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const createManualTask = vi.fn(async () => ({
      acceptanceCriteria: ["Draft task is stored.", "No runner job is queued."],
      approvedAt: null,
      contextFilePaths: ["apps/web/app/page.tsx", "packages/shared/src/index.ts"],
      contractVersion: "2026-05-10.v1",
      createdAt,
      externalId: null,
      externalUrl: null,
      id: "task_1",
      mode: "dryRun" as const,
      objective: "Add a metadata-only creation flow.",
      repoMappingId: "repo_mapping_1",
      requestedByActorId: "user_1",
      sourceType: "manual" as const,
      status: "draft",
      title: "Manual task UI",
      updatedAt: createdAt,
      workspaceId: "workspace_1",
    }));
    const action = createCreateManualTaskAction({
      createManualTask,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("repoMappingId", " repo_mapping_1 ");
    formData.set("title", " Manual task UI ");
    formData.set("objective", " Add a metadata-only creation flow. ");
    formData.append("acceptanceCriteria", " Draft task is stored. ");
    formData.append("acceptanceCriteria", "");
    formData.append("acceptanceCriteria", " No runner job is queued. ");
    formData.append("contextFilePaths", " apps/web/app/page.tsx ");
    formData.append("contextFilePaths", " packages/shared/src/index.ts ");
    formData.append("contextFilePaths", "");
    formData.set("mode", "dryRun");

    const result = await action(null, formData);

    expect(result).toEqual({
      data: {
        acceptanceCriteriaCount: 2,
        contextFilePathCount: 2,
        id: "task_1",
        mode: "dryRun",
        repoMappingId: "repo_mapping_1",
        status: "draft",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createManualTask).toHaveBeenCalledWith({
      acceptanceCriteria: ["Draft task is stored.", "No runner job is queued."],
      contextFilePaths: ["apps/web/app/page.tsx", "packages/shared/src/index.ts"],
      mode: "dryRun",
      objective: "Add a metadata-only creation flow.",
      repoMappingId: "repo_mapping_1",
      title: "Manual task UI",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks/new");

    const responsePayload = JSON.stringify(result);
    expect(responsePayload).not.toContain("Manual task UI");
    expect(responsePayload).not.toContain("Add a metadata-only creation flow");
    expect(responsePayload).not.toContain("Draft task is stored");
    expect(responsePayload).not.toContain("apps/web/app/page.tsx");
  });

  test("returns safe validation envelopes for invalid input without service calls or raw echo", async () => {
    const { createCreateManualTaskAction } = await importActionFactories();
    const createManualTask = vi.fn();
    const revalidatePath = vi.fn();
    const action = createCreateManualTaskAction({
      createManualTask,
      revalidatePath,
    });
    const formData = new FormData();
    const unsafeText = "function leak() { return process.env.SECRET; }";
    formData.set("workspaceId", "workspace_1");
    formData.set("repoMappingId", "repo_mapping_1");
    formData.set("title", "Manual task UI");
    formData.set("objective", "Add a metadata-only creation flow.");
    formData.set("acceptanceCriteria", "Draft task is stored.");
    formData.set("mode", "execute");
    formData.set("rawSource", unsafeText);

    const result = await action(null, formData);

    expect(result).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(unsafeText);
    expect(JSON.stringify(result)).not.toContain("rawSource");
    expect(createManualTask).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("returns safe service errors without revalidation", async () => {
    const { createActionError } = await import("./errors");
    const { createCreateManualTaskAction } = await importActionFactories();
    const createManualTask = vi.fn(async () => {
      throw createActionError("forbidden");
    });
    const revalidatePath = vi.fn();
    const action = createCreateManualTaskAction({
      createManualTask,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", "workspace_1");
    formData.set("repoMappingId", "repo_mapping_1");
    formData.set("title", "Manual task UI");
    formData.set("objective", "Add a metadata-only creation flow.");
    formData.set("acceptanceCriteria", "Draft task is stored.");
    formData.set("mode", "execute");

    await expect(action(null, formData)).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });
    expect(createManualTask).toHaveBeenCalledTimes(1);
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("approveManualTaskAction", () => {
  const approvedAt = new Date("2026-05-23T11:00:00.000Z");

  test("parses object input, approves the task, revalidates task and run surfaces, and returns safe data", async () => {
    const { createApproveManualTaskAction } = await importActionFactories();
    const approveManualTask = vi.fn(async () => ({
      approvedAt,
      jobId: "job_1",
      repoMappingId: "repo_mapping_1",
      runId: "run_1",
      runState: "queued" as const,
      status: "approved" as const,
      taskId: "task_1",
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createApproveManualTaskAction({
      approveManualTask,
      revalidatePath,
    });

    const result = await action({
      taskId: " task_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual({
      data: {
        approvedAt,
        jobId: "job_1",
        repoMappingId: "repo_mapping_1",
        runId: "run_1",
        runState: "queued",
        status: "approved",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(approveManualTask).toHaveBeenCalledWith({
      taskId: "task_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/runs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");

    const responsePayload = JSON.stringify(result);
    expect(responsePayload).not.toContain("Manual task UI");
    expect(responsePayload).not.toContain("Create a manual draft task.");
    expect(responsePayload).not.toContain("apps/web/app/page.tsx");
    expect(responsePayload).not.toContain("pnpm test");
  });

  test("parses FormData input before approving a manual task", async () => {
    const { createApproveManualTaskAction } = await importActionFactories();
    const approveManualTask = vi.fn(async () => ({
      approvedAt,
      jobId: "job_1",
      repoMappingId: "repo_mapping_1",
      runId: "run_1",
      runState: "queued" as const,
      status: "approved" as const,
      taskId: "task_1",
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createApproveManualTaskAction({
      approveManualTask,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("workspaceId", " workspace_1 ");
    formData.set("taskId", " task_1 ");

    await expect(action(formData)).resolves.toMatchObject({
      data: {
        jobId: "job_1",
        runId: "run_1",
        runState: "queued",
        status: "approved",
        taskId: "task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(approveManualTask).toHaveBeenCalledWith({
      taskId: "task_1",
      workspaceId: "workspace_1",
    });
  });

  test("returns validation errors without service calls, revalidation, or raw submitted values", async () => {
    const { createApproveManualTaskAction } = await importActionFactories();
    const approveManualTask = vi.fn();
    const revalidatePath = vi.fn();
    const action = createApproveManualTaskAction({
      approveManualTask,
      revalidatePath,
    });
    const rawSubmittedValue = "task_1_with_rawSource_and_secret";

    const result = await action({
      rawSource: "function leak() { return process.env.SECRET; }",
      taskId: rawSubmittedValue,
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(JSON.stringify(result)).not.toContain(rawSubmittedValue);
    expect(JSON.stringify(result)).not.toContain("rawSource");
    expect(approveManualTask).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test.each(["unauthenticated", "forbidden"] as const)(
    "returns safe %s service errors without revalidation or raw submitted values",
    async (code) => {
      const { createActionError } = await import("./errors");
      const { createApproveManualTaskAction } = await importActionFactories();
      const approveManualTask = vi.fn(async () => {
        throw createActionError(code);
      });
      const revalidatePath = vi.fn();
      const action = createApproveManualTaskAction({
        approveManualTask,
        revalidatePath,
      });
      const rawSubmittedValue = " task_1_sensitive_value ";

      const result = await action({
        taskId: rawSubmittedValue,
        workspaceId: " workspace_1 ",
      });

      expect(result).toEqual({
        error:
          code === "unauthenticated"
            ? {
                code,
                message: "Sign in to continue.",
              }
            : {
                code,
                message: "You do not have access to this workspace.",
              },
        ok: false,
      });
      expect(approveManualTask).toHaveBeenCalledWith({
        taskId: "task_1_sensitive_value",
        workspaceId: "workspace_1",
      });
      expect(JSON.stringify(result)).not.toContain(rawSubmittedValue);
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );
});

describe("createWorkspaceAction", () => {
  test("validates FormData input, creates a workspace, revalidates workspace surfaces, and returns data", async () => {
    const { createCreateWorkspaceAction } = await importActionFactories();
    const createWorkspace = vi.fn(async () => ({
      name: "Platform Ops",
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createCreateWorkspaceAction({
      createWorkspace,
      revalidatePath,
    });
    const formData = new FormData();
    formData.set("name", " Platform Ops ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        name: "Platform Ops",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createWorkspace).toHaveBeenCalledWith({ name: "Platform Ops" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("validates object input before workspace creation", async () => {
    const { createCreateWorkspaceAction } = await importActionFactories();
    const createWorkspace = vi.fn(async () => ({
      name: "Platform Ops",
      workspaceId: "workspace_1",
    }));
    const revalidatePath = vi.fn();
    const action = createCreateWorkspaceAction({
      createWorkspace,
      revalidatePath,
    });

    await expect(action({ name: " Platform Ops " })).resolves.toEqual({
      data: {
        name: "Platform Ops",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createWorkspace).toHaveBeenCalledWith({ name: "Platform Ops" });
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("returns a validation envelope without creating invalid workspace names", async () => {
    const { createCreateWorkspaceAction } = await importActionFactories();
    const createWorkspace = vi.fn();
    const revalidatePath = vi.fn();
    const action = createCreateWorkspaceAction({
      createWorkspace,
      revalidatePath,
    });

    await expect(action({ name: " " })).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(createWorkspace).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

describe("selectWorkspaceAction", () => {
  test("validates workspace id, verifies membership, writes selected workspace state, and revalidates workspace surfaces", async () => {
    const { createSelectWorkspaceAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const selectWorkspace = vi.fn(async () => ({
      name: "Platform Ops",
      role: "owner",
      workspaceId: "workspace_1",
    }));
    const setSelectedWorkspaceId = vi.fn();
    const action = createSelectWorkspaceAction({
      revalidatePath,
      selectWorkspace,
      setSelectedWorkspaceId,
    });

    await expect(action({ workspaceId: " workspace_1 " })).resolves.toEqual({
      data: {
        name: "Platform Ops",
        role: "owner",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(selectWorkspace).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(setSelectedWorkspaceId).toHaveBeenCalledWith("workspace_1");
    expect(revalidatePath).toHaveBeenCalledWith("/workspaces");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("does not write selected workspace state when membership verification fails", async () => {
    const { createActionError } = await import("./errors");
    const { createSelectWorkspaceAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const selectWorkspace = vi.fn(async () => {
      throw createActionError("forbidden");
    });
    const setSelectedWorkspaceId = vi.fn();
    const action = createSelectWorkspaceAction({
      revalidatePath,
      selectWorkspace,
      setSelectedWorkspaceId,
    });

    await expect(action({ workspaceId: "workspace_1" })).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });
    expect(selectWorkspace).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("validates workspace id before membership verification", async () => {
    const { createSelectWorkspaceAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const selectWorkspace = vi.fn();
    const setSelectedWorkspaceId = vi.fn();
    const action = createSelectWorkspaceAction({
      revalidatePath,
      selectWorkspace,
      setSelectedWorkspaceId,
    });

    await expect(action({ workspaceId: "" })).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(selectWorkspace).not.toHaveBeenCalled();
    expect(setSelectedWorkspaceId).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});

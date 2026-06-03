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

describe("action factory focused exports", () => {
  test("createCreateSetupPrPreviewAction accepts selected approved task ids only", async () => {
    const { createCreateSetupPrPreviewAction } = (await importActionFactories()) as unknown as {
      createCreateSetupPrPreviewAction: (deps: {
        createSetupPrPreview: (input: {
          excludedTaskIds?: string[];
          excludedTemplateIds?: string[];
          repoId: string;
          taskIds: string[];
          workspaceId: string;
        }) => Promise<{
          files: Array<{ path: string }>;
          previewId: string;
          repoId: string;
          status: "draft";
          taskIds: string[];
          workspaceId: string;
        }>;
        revalidatePath: (path: string) => void;
      }) => (input: unknown) => Promise<unknown>;
    };
    const revalidatePath = vi.fn();
    const createSetupPrPreview = vi.fn(async () => ({
      files: [{ path: ".aicp/policy.json" }, { path: ".github/workflows/cortex-validation.yml" }],
      previewId: "setup_pr_preview_1",
      repoId: "github_repository_1",
      status: "draft" as const,
      taskIds: ["cortex_task_1", "cortex_task_2"],
      workspaceId: "workspace_1",
    }));
    const action = createCreateSetupPrPreviewAction({
      createSetupPrPreview,
      revalidatePath,
    });
    const formData = new FormData();

    formData.set("$ACTION_ID_123", "opaque-next-action-id");
    formData.set("workspaceId", " workspace_1 ");
    formData.set("repoId", " github_repository_1 ");
    formData.append("taskId", " cortex_task_1 ");
    formData.append("taskId", " cortex_task_2 ");

    await expect(action(formData)).resolves.toEqual({
      data: {
        fileCount: 2,
        previewId: "setup_pr_preview_1",
        repoId: "github_repository_1",
        status: "draft",
        taskCount: 2,
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createSetupPrPreview).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      taskIds: ["cortex_task_1", "cortex_task_2"],
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/setup-prs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/tasks");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("createCreateSetupPrPreviewAction rejects unsafe fields before service call", async () => {
    const { createCreateSetupPrPreviewAction } = (await importActionFactories()) as unknown as {
      createCreateSetupPrPreviewAction: (deps: {
        createSetupPrPreview: (input: unknown) => Promise<unknown>;
        revalidatePath: (path: string) => void;
      }) => (input: unknown) => Promise<unknown>;
    };
    const revalidatePath = vi.fn();
    const createSetupPrPreview = vi.fn();
    const action = createCreateSetupPrPreviewAction({
      createSetupPrPreview,
      revalidatePath,
    });

    await expect(
      action({
        diff: "diff --git a/app.ts b/app.ts",
        repoId: "github_repository_1",
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
    expect(createSetupPrPreview).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("createCreateSetupPrFromPreviewAction creates a draft PR from preview metadata", async () => {
    const { createCreateSetupPrFromPreviewAction } = (await importActionFactories()) as unknown as {
      createCreateSetupPrFromPreviewAction: (deps: {
        createSetupPrFromPreview: (input: { previewId: string; workspaceId: string }) => Promise<{
          branchName: string;
          preview: {
            previewId: string;
            repoId: string;
            status: "pr_created";
            workspaceId: string;
          };
          pullRequestNumber: number;
          pullRequestUrl: string;
        }>;
        revalidatePath: (path: string) => void;
      }) => (input: unknown) => Promise<unknown>;
    };
    const revalidatePath = vi.fn();
    const createSetupPrFromPreview = vi.fn(async () => ({
      branchName: "cortex/setup-pr/setup-pr-preview-1",
      preview: {
        previewId: "setup_pr_preview_1",
        repoId: "github_repository_1",
        status: "pr_created" as const,
        workspaceId: "workspace_1",
      },
      pullRequestNumber: 22,
      pullRequestUrl: "https://github.com/rory/control-plane/pull/22",
    }));
    const action = createCreateSetupPrFromPreviewAction({
      createSetupPrFromPreview,
      revalidatePath,
    });

    await expect(
      action({
        previewId: " setup_pr_preview_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        branchName: "cortex/setup-pr/setup-pr-preview-1",
        previewId: "setup_pr_preview_1",
        pullRequestNumber: 22,
        pullRequestUrl: "https://github.com/rory/control-plane/pull/22",
        repoId: "github_repository_1",
        status: "pr_created",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(createSetupPrFromPreview).toHaveBeenCalledWith({
      previewId: "setup_pr_preview_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/setup-prs");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/pull-requests");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("createTriggerRepoScanAction accepts canonical workspace, repo, and optional product goal", async () => {
    const { createTriggerRepoScanAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const triggerRepoScan = vi.fn(async () => ({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued" as const,
      workspaceId: "workspace_1",
    }));
    const action = createTriggerRepoScanAction({
      revalidatePath,
      triggerRepoScan,
    });

    await expect(
      action({
        productGoal: " Build a hosted control room for safe AI-assisted engineering readiness. ",
        repoId: " github_repository_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: {
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "queued",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(triggerRepoScan).toHaveBeenCalledWith({
      productGoal: "Build a hosted control room for safe AI-assisted engineering readiness.",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/repositories");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard/audit-log");
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test("createTriggerRepoScanAction rejects unsafe hidden fields before service call", async () => {
    const { createTriggerRepoScanAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const triggerRepoScan = vi.fn();
    const action = createTriggerRepoScanAction({
      revalidatePath,
      triggerRepoScan,
    });
    const value = "diff --git a/app.ts b/app.ts";

    await expect(
      action({
        diff: value,
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(triggerRepoScan).not.toHaveBeenCalled();
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  test("createTriggerRepoScanAction treats a blank product goal as an intentional skip", async () => {
    const { createTriggerRepoScanAction } = await importActionFactories();
    const revalidatePath = vi.fn();
    const triggerRepoScan = vi.fn(async () => ({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued" as const,
      workspaceId: "workspace_1",
    }));
    const action = createTriggerRepoScanAction({
      revalidatePath,
      triggerRepoScan,
    });

    await expect(
      action({
        productGoal: "   ",
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      data: {
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "queued",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(triggerRepoScan).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    expect(revalidatePath).toHaveBeenCalledWith("/dashboard");
  });

  test.each([
    { field: "repo-id", value: "diff --git a/app.ts b/app.ts" },
    { field: "workspace_id", value: "ghp_scantriggersecret1234567890" },
  ])(
    "createTriggerRepoScanAction rejects normalized alias field $field before service call",
    async ({ field, value }) => {
      const { createTriggerRepoScanAction } = await importActionFactories();
      const revalidatePath = vi.fn();
      const triggerRepoScan = vi.fn();
      const action = createTriggerRepoScanAction({
        revalidatePath,
        triggerRepoScan,
      });

      await expect(
        action({
          [field]: value,
          repoId: "github_repository_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(triggerRepoScan).not.toHaveBeenCalled();
      expect(revalidatePath).not.toHaveBeenCalled();
    },
  );

  test("createGetRepoScanStatusAction accepts canonical repo or scan lookup without revalidation", async () => {
    const { createGetRepoScanStatusAction } = await importActionFactories();
    const getRepoScanStatus = vi.fn(async () => ({
      blockedFindingCount: 1,
      createdAt: "2026-05-25T10:00:00.000Z",
      findingCount: 2,
      inventoryCounts: {
        ciProviderCount: 1,
        documentationCount: 1,
        dryRunCheckCount: 11,
        hasPolicyFile: true,
        languageCount: 1,
        omittedFileCount: 0,
        packageManagerCount: 1,
        presentDocumentationCount: 1,
        protectedPathCount: 2,
        scannedFileCount: 10,
        sensitivePathCount: 3,
        totalDirectoryCount: 4,
        totalFileCount: 10,
        validationCommandCount: 4,
      },
      moduleStatuses: [],
      openFindingCount: 1,
      readinessReportStatus: "pending" as const,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "running" as const,
      statusSummary: "Repo readiness scan is running.",
      taskRecommendationCount: 3,
      updatedAt: "2026-05-25T10:01:00.000Z",
      workspaceId: "workspace_1",
    }));
    const action = createGetRepoScanStatusAction({
      getRepoScanStatus,
    });

    await expect(
      action({
        repoId: " github_repository_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      data: expect.objectContaining({
        scanId: "repo_scan_1",
        status: "running",
      }),
      ok: true,
    });
    expect(getRepoScanStatus).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });

    await action({
      scanId: " repo_scan_1 ",
      workspaceId: " workspace_1 ",
    });
    expect(getRepoScanStatus).toHaveBeenLastCalledWith({
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "repo-id", value: "github_repository_1" },
  ])(
    "createGetRepoScanStatusAction rejects unsafe or alias field $field before service call",
    async ({ field, value }) => {
      const { createGetRepoScanStatusAction } = await importActionFactories();
      const getRepoScanStatus = vi.fn();
      const action = createGetRepoScanStatusAction({
        getRepoScanStatus,
      });

      await expect(
        action({
          [field]: value,
          repoId: "github_repository_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(getRepoScanStatus).not.toHaveBeenCalled();
    },
  );

  test("createGetRepoScanStatusAction rejects missing or ambiguous lookup ids", async () => {
    const { createGetRepoScanStatusAction } = await importActionFactories();
    const getRepoScanStatus = vi.fn();
    const action = createGetRepoScanStatusAction({
      getRepoScanStatus,
    });

    await expect(action({ workspaceId: "workspace_1" })).resolves.toMatchObject({
      error: { code: "validation_error" },
      ok: false,
    });
    await expect(
      action({
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toMatchObject({
      error: { code: "validation_error" },
      ok: false,
    });
    expect(getRepoScanStatus).not.toHaveBeenCalled();
  });

  test("createSyncCortexTaskToLinearAction accepts only canonical sync ids", async () => {
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
    ).resolves.toMatchObject({
      data: {
        issueId: "linear_issue_222",
        taskId: "cortex_task_1",
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
  });

  test("createSyncCortexTaskToGitHubIssueAction accepts only workspace and task ids", async () => {
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
    ).resolves.toMatchObject({
      data: {
        issueId: "601",
        issueNumber: 31,
        taskId: "cortex_task_1",
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
});

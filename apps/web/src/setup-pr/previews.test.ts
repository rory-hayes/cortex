import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  CortexTaskSchema,
  SetupPrPreviewSchema,
  type CortexTask,
  type SetupPrPreview,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

type StoredRepository = {
  id: string;
  workspaceId: string;
};

type StoredCortexTask = {
  acceptanceCriteria: string[];
  approvalStatus: CortexTask["approvalStatus"];
  contractVersion: CortexTask["contractVersion"];
  createdAt: Date;
  executionMode: CortexTask["executionMode"];
  externalLinks: CortexTask["externalLinks"];
  findingIds: string[];
  id: string;
  latestRunId: string | null;
  metadata: CortexTask["metadata"];
  objective: string;
  originExternalId: string | null;
  originExternalSystem: string | null;
  originType: CortexTask["origin"]["type"];
  prArtifactIds: string[];
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  runIds: string[];
  status: CortexTask["status"];
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredSetupPrPreview = {
  contractVersion: SetupPrPreview["contractVersion"];
  createdAt: Date;
  excludedTaskIds: string[];
  excludedTemplateIds: string[];
  files: SetupPrPreview["files"];
  id: string;
  metadata: SetupPrPreview["metadata"];
  repoId: string;
  status: SetupPrPreview["status"];
  taskIds: string[];
  updatedAt: Date;
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

type SetupPrPreviewStore = {
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<StoredRepository | null>;
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<{ id: string; role: string } | null>;
  getSetupPrPreview: (input: {
    previewId: string;
    workspaceId: string;
  }) => Promise<StoredSetupPrPreview | null>;
  listSetupPrPreviews: (input: {
    repoId?: string;
    workspaceId: string;
  }) => Promise<StoredSetupPrPreview[]>;
  listCortexTasksByIds: (input: {
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<StoredCortexTask[]>;
  persistSetupPrPreviewWithAudit: (input: {
    auditEvent: StoredAuditEvent;
    preview: Omit<StoredSetupPrPreview, "createdAt" | "updatedAt"> & {
      createdAt?: Date;
      updatedAt?: Date;
    };
  }) => Promise<StoredSetupPrPreview>;
};

type SetupPrPreviewService = {
  createSetupPrPreview: (input: {
    excludedTaskIds?: string[];
    excludedTemplateIds?: string[];
    repoId: string;
    taskIds: string[];
    workspaceId: string;
  }) => Promise<SetupPrPreview>;
  getSetupPrPreview: (input: { previewId: string; workspaceId: string }) => Promise<SetupPrPreview>;
  listSetupPrPreviews: (input: {
    repoId?: string;
    workspaceId: string;
  }) => Promise<SetupPrPreview[]>;
};

const importPreviews = async () =>
  (await import("./previews")) as {
    createSetupPrPreviewService: (input: {
      createAuditEventId?: () => string;
      createPreviewId?: () => string;
      getAuthContext?: () => Promise<{ userId: string | null }>;
      now?: () => Date;
      store: SetupPrPreviewStore;
    }) => SetupPrPreviewService;
  };

const now = new Date("2026-06-02T08:00:00.000Z");

const cortexTask = (overrides: Partial<CortexTask> = {}): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: ["Generated setup files are reviewed before PR creation."],
    approvalStatus: "approved",
    contractVersion: CONTRACT_VERSION,
    createdAt: now.toISOString(),
    executionMode: "setup_pr",
    externalLinks: [],
    findingIds: ["finding_1"],
    metadata: {
      sourceLabel: "setup_pr_preview_test",
    },
    objective: "Prepare setup PR metadata for reviewer approval.",
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
    updatedAt: now.toISOString(),
    workspaceId: "workspace_1",
    ...overrides,
  });

const taskRow = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => {
  const task = cortexTask({
    ...(overrides.id === undefined ? {} : { taskId: overrides.id }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.suggestedValidation === undefined
      ? {}
      : { suggestedValidation: overrides.suggestedValidation }),
  });

  return {
    acceptanceCriteria: task.acceptanceCriteria,
    approvalStatus: task.approvalStatus,
    contractVersion: task.contractVersion,
    createdAt: now,
    executionMode: task.executionMode,
    externalLinks: task.externalLinks,
    findingIds: task.findingIds,
    id: task.taskId,
    latestRunId: task.latestRunId ?? null,
    metadata: task.metadata,
    objective: task.objective,
    originExternalId: task.origin.externalId ?? null,
    originExternalSystem: task.origin.externalSystem ?? null,
    originType: task.origin.type,
    prArtifactIds: task.prArtifactIds,
    repoId: task.repoId,
    riskLevel: task.riskLevel,
    runIds: task.runIds,
    status: task.status,
    suggestedValidation: task.suggestedValidation,
    taskPacketId: task.taskPacketId ?? null,
    taskRecommendationId: task.taskRecommendationId ?? null,
    title: task.title,
    updatedAt: now,
    workspaceId: task.workspaceId,
    ...overrides,
  };
};

const toCortexTask = (row: StoredCortexTask): CortexTask =>
  CortexTaskSchema.parse({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: row.createdAt.toISOString(),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    latestRunId: row.latestRunId ?? undefined,
    metadata: row.metadata,
    objective: row.objective,
    origin: {
      externalId: row.originExternalId ?? undefined,
      externalSystem: row.originExternalSystem ?? undefined,
      type: row.originType,
    },
    prArtifactIds: row.prArtifactIds,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    runIds: row.runIds,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskId: row.id,
    taskPacketId: row.taskPacketId ?? undefined,
    taskRecommendationId: row.taskRecommendationId ?? undefined,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
  });

const previewFromRow = (row: StoredSetupPrPreview): SetupPrPreview =>
  SetupPrPreviewSchema.parse({
    contractVersion: row.contractVersion,
    createdAt: row.createdAt.toISOString(),
    excludedTaskIds: row.excludedTaskIds,
    excludedTemplateIds: row.excludedTemplateIds,
    files: row.files,
    metadata: row.metadata,
    previewId: row.id,
    repoId: row.repoId,
    status: row.status,
    taskIds: row.taskIds,
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
  });

const createStore = (
  options: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    previews?: StoredSetupPrPreview[];
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const previews = [...(options.previews ?? [])];
  const repositories = [
    ...(options.repositories ?? [{ id: "github_repository_1", workspaceId: "workspace_1" }]),
  ];
  const tasks = [
    ...(options.tasks ?? [
      taskRow(),
      taskRow({
        id: "cortex_task_2",
        suggestedValidation: [
          {
            label: "Review repository policy coverage",
            required: true,
            validationId: "security-policy-coverage:review",
          },
          {
            label: "Review CI validation coverage",
            required: true,
            validationId: "ci-cd:review",
          },
        ],
      }),
    ]),
  ];

  const store: SetupPrPreviewStore & {
    auditEvents: StoredAuditEvent[];
    previews: StoredSetupPrPreview[];
  } = {
    auditEvents,
    findGithubRepository: vi.fn<SetupPrPreviewStore["findGithubRepository"]>(
      async ({ repoId, workspaceId }) =>
        repositories.find((repo) => repo.id === repoId && repo.workspaceId === workspaceId) ?? null,
    ),
    findWorkspaceMembership: vi.fn<SetupPrPreviewStore["findWorkspaceMembership"]>(
      async ({ userId, workspaceId }) =>
        (options.memberships ?? [{ userId: "user_1", workspaceId: "workspace_1" }]).some(
          (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
        )
          ? { id: "membership_1", role: "admin" }
          : null,
    ),
    getSetupPrPreview: vi.fn<SetupPrPreviewStore["getSetupPrPreview"]>(
      async ({ previewId, workspaceId }) =>
        previews.find(
          (preview) => preview.id === previewId && preview.workspaceId === workspaceId,
        ) ?? null,
    ),
    listSetupPrPreviews: vi.fn<SetupPrPreviewStore["listSetupPrPreviews"]>(
      async ({ repoId, workspaceId }) =>
        previews.filter(
          (preview) =>
            preview.workspaceId === workspaceId &&
            (repoId === undefined || preview.repoId === repoId),
        ),
    ),
    listCortexTasksByIds: vi.fn<SetupPrPreviewStore["listCortexTasksByIds"]>(
      async ({ repoId, taskIds, workspaceId }) =>
        tasks.filter(
          (task) =>
            taskIds.includes(task.id) && task.repoId === repoId && task.workspaceId === workspaceId,
        ),
    ),
    persistSetupPrPreviewWithAudit: vi.fn<SetupPrPreviewStore["persistSetupPrPreviewWithAudit"]>(
      async ({ auditEvent, preview }) => {
        const row: StoredSetupPrPreview = {
          createdAt: now,
          updatedAt: now,
          ...preview,
        };

        previews.push(row);
        auditEvents.push(auditEvent);

        return row;
      },
    ),
    previews,
  };

  return store;
};

const createService = async (store = createStore()) => {
  const { createSetupPrPreviewService } = await importPreviews();

  return createSetupPrPreviewService({
    createAuditEventId: () => "audit_event_1",
    createPreviewId: () => "setup_pr_preview_1",
    getAuthContext: async () => ({ userId: "user_1" }),
    now: () => now,
    store,
  });
};

const unsafePreviewTextPattern =
  /diff --git|@@ -|process\.env|PRIVATE KEY|rawSource|sourceCode|patchText|rawOutput|\/Users\/rory/u;

describe("setup PR preview service", () => {
  test("creates and persists a metadata-only setup PR preview from approved setup tasks", async () => {
    const store = createStore();
    const service = await createService(store);

    const preview = await service.createSetupPrPreview({
      repoId: "github_repository_1",
      taskIds: ["cortex_task_1", "cortex_task_2", "cortex_task_2"],
      workspaceId: "workspace_1",
    });

    expect(preview.previewId).toBe("setup_pr_preview_1");
    expect(preview.taskIds).toEqual(["cortex_task_1", "cortex_task_2"]);
    expect(preview.files.map((file) => file.path)).toEqual([
      ".aicp/policy.json",
      ".github/workflows/cortex-validation.yml",
    ]);
    expect(preview.files[0]).toEqual(
      expect.objectContaining({
        omittedContent: true,
        reviewRequired: true,
        sourceTaskIds: ["cortex_task_1", "cortex_task_2"],
        templateId: "repo_policy",
      }),
    );
    expect(JSON.stringify(preview)).not.toMatch(unsafePreviewTextPattern);
    expect(JSON.stringify(preview.files)).not.toContain("content");
    expect(store.previews).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "setup_pr.preview_created",
        metadata: {
          excludedTaskCount: 0,
          excludedTemplateCount: 0,
          fileCount: 2,
          previewId: "setup_pr_preview_1",
          repoId: "github_repository_1",
          taskCount: 2,
        },
      }),
    ]);
  });

  test("honors removed tasks and files before persisting preview metadata", async () => {
    const service = await createService();

    const preview = await service.createSetupPrPreview({
      excludedTaskIds: ["cortex_task_2"],
      excludedTemplateIds: ["ci_workflow"],
      repoId: "github_repository_1",
      taskIds: ["cortex_task_1", "cortex_task_2"],
      workspaceId: "workspace_1",
    });

    expect(preview.taskIds).toEqual(["cortex_task_1"]);
    expect(preview.excludedTaskIds).toEqual(["cortex_task_2"]);
    expect(preview.excludedTemplateIds).toEqual(["ci_workflow"]);
    expect(preview.files.map((file) => file.templateId)).toEqual(["repo_policy"]);
    expect(preview.files).toEqual([
      expect.objectContaining({
        sourceTaskIds: ["cortex_task_1"],
      }),
    ]);
  });

  test.each([
    ["unapproved approval", taskRow({ approvalStatus: "pending" })],
    ["draft task status", taskRow({ status: "draft" })],
    ["local runner task", taskRow({ executionMode: "local_runner" })],
    ["blocked task", taskRow({ riskLevel: "blocked" })],
  ])("rejects ineligible setup preview tasks: %s", async (_name, storedTask) => {
    const store = createStore({ tasks: [storedTask] });
    const service = await createService(store);

    await expect(
      service.createSetupPrPreview({
        repoId: "github_repository_1",
        taskIds: [storedTask.id],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.previews).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects preview creation when no metadata templates remain after removals", async () => {
    const service = await createService();

    await expect(
      service.createSetupPrPreview({
        excludedTemplateIds: ["repo_policy"],
        repoId: "github_repository_1",
        taskIds: ["cortex_task_1"],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test("loads persisted previews through the shared metadata-only contract", async () => {
    const row: StoredSetupPrPreview = {
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
      id: "setup_pr_preview_existing",
      metadata: {
        sourceLabel: "setup_pr_preview_service",
      },
      repoId: "github_repository_1",
      status: "draft",
      taskIds: ["cortex_task_1"],
      updatedAt: now,
      workspaceId: "workspace_1",
    };
    const service = await createService(createStore({ previews: [row] }));

    const preview = await service.getSetupPrPreview({
      previewId: "setup_pr_preview_existing",
      workspaceId: "workspace_1",
    });

    expect(preview).toEqual(previewFromRow(row));
  });

  test("lists persisted setup PR previews scoped to the workspace and optional repository", async () => {
    const rows: StoredSetupPrPreview[] = [
      {
        contractVersion: CONTRACT_VERSION,
        createdAt: new Date("2026-06-02T08:02:00.000Z"),
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
        id: "setup_pr_preview_existing_1",
        metadata: {
          sourceLabel: "setup_pr_preview_service",
        },
        repoId: "github_repository_1",
        status: "draft",
        taskIds: ["cortex_task_1"],
        updatedAt: new Date("2026-06-02T08:03:00.000Z"),
        workspaceId: "workspace_1",
      },
      {
        contractVersion: CONTRACT_VERSION,
        createdAt: new Date("2026-06-02T08:04:00.000Z"),
        excludedTaskIds: [],
        excludedTemplateIds: [],
        files: [
          {
            omittedContent: true,
            operation: "create_or_update",
            path: ".github/workflows/cortex-validation.yml",
            reviewInstructions: ["Confirm generated validation workflow before PR creation."],
            reviewRequired: true,
            sourceTaskIds: ["cortex_task_3"],
            summary: "Create or update CI validation metadata for runner safety checks.",
            templateId: "ci_workflow",
          },
        ],
        id: "setup_pr_preview_existing_2",
        metadata: {
          baseBranch: "main",
          headBranch: "cortex/setup-pr/setup-pr-preview-existing-2",
          pullRequestNumber: 22,
          pullRequestUrl: "https://github.com/rory/control-plane/pull/22",
          sourceLabel: "setup_pr_creation_service",
        },
        repoId: "github_repository_2",
        status: "pr_created",
        taskIds: ["cortex_task_3"],
        updatedAt: new Date("2026-06-02T08:05:00.000Z"),
        workspaceId: "workspace_1",
      },
      {
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
            sourceTaskIds: ["cortex_task_other"],
            summary: "Create or update repository policy metadata for runner safety checks.",
            templateId: "repo_policy",
          },
        ],
        id: "setup_pr_preview_other_workspace",
        metadata: {
          sourceLabel: "setup_pr_preview_service",
        },
        repoId: "github_repository_1",
        status: "draft",
        taskIds: ["cortex_task_other"],
        updatedAt: now,
        workspaceId: "workspace_2",
      },
    ];
    const store = createStore({ previews: rows });
    const service = await createService(store);

    await expect(
      service.listSetupPrPreviews({
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([previewFromRow(rows[0]!), previewFromRow(rows[1]!)]);
    await expect(
      service.listSetupPrPreviews({
        repoId: "github_repository_2",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([previewFromRow(rows[1]!)]);
    expect(store.listSetupPrPreviews).toHaveBeenLastCalledWith({
      repoId: "github_repository_2",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(rows)).not.toMatch(unsafePreviewTextPattern);
  });

  test("requires workspace membership before preview reads or writes", async () => {
    const service = await createService(createStore({ memberships: [] }));

    await expect(
      service.createSetupPrPreview({
        repoId: "github_repository_1",
        taskIds: ["cortex_task_1"],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.getSetupPrPreview({
        previewId: "setup_pr_preview_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.listSetupPrPreviews({
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  test("uses shared task parsing before creating previews", async () => {
    const store = createStore({
      tasks: [
        {
          ...taskRow(),
          metadata: {
            rawSource: "not allowed",
          },
        },
      ],
    });
    const service = await createService(store);

    await expect(
      service.createSetupPrPreview({
        repoId: "github_repository_1",
        taskIds: ["cortex_task_1"],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.previews).toEqual([]);
  });

  test("test helper row conversion stays aligned with shared Cortex Task parsing", () => {
    expect(toCortexTask(taskRow()).taskId).toBe("cortex_task_1");
  });
});

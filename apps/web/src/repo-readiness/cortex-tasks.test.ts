import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  type CortexTask,
  type CortexTaskExecutionMode,
  type CortexTaskStatus,
  type CortexTaskTransitionActor,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

type StoredRepository = {
  id: string;
  workspaceId: string;
};

type StoredFinding = {
  id: string;
  repoId: string;
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
  status: CortexTaskStatus;
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
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

type CortexTaskStore = {
  findFindingsByIds: (input: {
    findingIds: string[];
    repoId: string;
    workspaceId: string;
  }) => Promise<StoredFinding[]>;
  findGithubRepository: (input: {
    repoId: string;
    workspaceId: string;
  }) => Promise<StoredRepository | null>;
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<{ id: string; role: string } | null>;
  getCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<StoredCortexTask | null>;
  listCortexTasks: (input: {
    repoId?: string;
    status?: CortexTaskStatus;
    workspaceId: string;
  }) => Promise<StoredCortexTask[]>;
  hasAvailableLocalRunner: (input: { workspaceId: string }) => Promise<boolean>;
  updateCortexTaskExecutionModeWithAudit: (input: {
    auditEvent: StoredAuditEvent;
    executionMode: CortexTaskExecutionMode;
    expectedCurrentApprovalStatus: CortexTask["approvalStatus"];
    expectedCurrentExecutionMode: CortexTaskExecutionMode;
    expectedCurrentStatus: CortexTaskStatus;
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<StoredCortexTask | null>;
  transitionCortexTaskStatusWithAudit: (input: {
    approvalStatus: CortexTask["approvalStatus"];
    auditEvent: StoredAuditEvent;
    expectedCurrentApprovalStatus: CortexTask["approvalStatus"];
    expectedCurrentStatus: CortexTaskStatus;
    status: CortexTaskStatus;
    taskId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<StoredCortexTask | null>;
  upsertCortexTaskWithAudit: (input: {
    createAuditEvent: (task: StoredCortexTask) => StoredAuditEvent;
    task: Omit<StoredCortexTask, "createdAt" | "updatedAt"> & {
      createdAt?: Date;
      updatedAt?: Date;
    };
  }) => Promise<StoredCortexTask>;
};

type CortexTaskService = {
  listCortexTasks: (input: {
    repoId?: string;
    status?: CortexTaskStatus;
    workspaceId: string;
  }) => Promise<CortexTask[]>;
  persistCortexTask: (input: {
    repoId: string;
    task: CortexTask;
    workspaceId: string;
  }) => Promise<CortexTask>;
  transitionCortexTaskStatus: (input: {
    actor?: CortexTaskTransitionActor;
    actorId?: string;
    status: CortexTaskStatus;
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTask>;
  updateCortexTaskExecutionMode: (input: {
    executionMode: CortexTaskExecutionMode;
    taskId: string;
    workspaceId: string;
  }) => Promise<CortexTask>;
};

const importCortexTasks = async () =>
  (await import("./cortex-tasks")) as {
    createCortexTaskService: (input: {
      createAuditEventId?: () => string;
      createTaskId?: () => string;
      getAuthContext?: () => Promise<{ userId: string | null }>;
      now?: () => Date;
      store: CortexTaskStore;
    }) => CortexTaskService;
  };

const now = new Date("2026-05-26T09:00:00.000Z");
const later = new Date("2026-05-26T09:05:00.000Z");

const validTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: ["Validation setup can be reviewed from metadata only."],
  approvalStatus: "not_requested",
  contractVersion: CONTRACT_VERSION,
  createdAt: now.toISOString(),
  executionMode: "setup_pr",
  externalLinks: [
    {
      externalId: "1",
      provider: "github",
      resourceType: "github_issue",
      status: "open",
      syncedAt: "2026-05-26T08:55:00.000Z",
      title: "GitHub issue 1",
      url: "https://github.com/example/repo/issues/1",
    },
  ],
  findingIds: ["finding_1"],
  latestRunId: "run_1",
  metadata: {
    sourceLabel: "readiness_report",
  },
  objective: "Create an AI-ready setup task for validation metadata.",
  origin: {
    type: "finding",
  },
  prArtifactIds: ["pr_artifact_1"],
  repoId: "github_repository_1",
  riskLevel: "medium",
  runIds: ["run_1"],
  status: "draft",
  suggestedValidation: [
    {
      label: "Typecheck",
      required: true,
      validationId: "typecheck",
    },
  ],
  taskId: "client_task",
  taskPacketId: "task_packet_1",
  title: "Add validation setup task",
  updatedAt: now.toISOString(),
  workspaceId: "workspace_1",
  ...overrides,
});

const taskRow = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => {
  const task = validTask({
    ...(overrides.id === undefined ? {} : { taskId: overrides.id }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.findingIds === undefined ? {} : { findingIds: overrides.findingIds }),
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

const createStore = (
  options: {
    beforeTransitionUpdate?: () => void;
    findings?: StoredFinding[];
    localRunnerAvailable?: boolean;
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const repositories = [
    ...(options.repositories ?? [{ id: "github_repository_1", workspaceId: "workspace_1" }]),
  ];
  const findings = [
    ...(options.findings ?? [
      {
        id: "finding_1",
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      },
    ]),
  ];
  const tasks = [...(options.tasks ?? [])];

  const store: CortexTaskStore & {
    auditEvents: StoredAuditEvent[];
    tasks: StoredCortexTask[];
  } = {
    auditEvents,
    findFindingsByIds: vi.fn<CortexTaskStore["findFindingsByIds"]>(
      async (input: { findingIds: string[]; repoId: string; workspaceId: string }) =>
        findings.filter(
          (finding) =>
            input.findingIds.includes(finding.id) &&
            finding.repoId === input.repoId &&
            finding.workspaceId === input.workspaceId,
        ),
    ),
    findGithubRepository: vi.fn<CortexTaskStore["findGithubRepository"]>(
      async (input: { repoId: string; workspaceId: string }) =>
        repositories.find(
          (repo) => repo.id === input.repoId && repo.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findWorkspaceMembership: vi.fn<CortexTaskStore["findWorkspaceMembership"]>(
      async (input: { userId: string; workspaceId: string }) =>
        options.memberships?.some(
          (membership) =>
            membership.userId === input.userId && membership.workspaceId === input.workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    getCortexTask: vi.fn<CortexTaskStore["getCortexTask"]>(
      async (input: { taskId: string; workspaceId: string }) =>
        tasks.find((task) => task.id === input.taskId && task.workspaceId === input.workspaceId) ??
        null,
    ),
    listCortexTasks: vi.fn<CortexTaskStore["listCortexTasks"]>(
      async (input: { repoId?: string; status?: CortexTaskStatus; workspaceId: string }) =>
        tasks
          .filter(
            (task) =>
              task.workspaceId === input.workspaceId &&
              (input.repoId === undefined || task.repoId === input.repoId) &&
              (input.status === undefined || task.status === input.status),
          )
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    hasAvailableLocalRunner: vi.fn<CortexTaskStore["hasAvailableLocalRunner"]>(
      async ({ workspaceId }) =>
        workspaceId === "workspace_1" && options.localRunnerAvailable === true,
    ),
    tasks,
    updateCortexTaskExecutionModeWithAudit: vi.fn<
      CortexTaskStore["updateCortexTaskExecutionModeWithAudit"]
    >(async (input) => {
      const task = tasks.find(
        (candidate) =>
          candidate.id === input.taskId &&
          candidate.workspaceId === input.workspaceId &&
          candidate.status === input.expectedCurrentStatus &&
          candidate.approvalStatus === input.expectedCurrentApprovalStatus &&
          candidate.executionMode === input.expectedCurrentExecutionMode,
      );

      if (task === undefined) {
        return null;
      }

      task.executionMode = input.executionMode;
      task.updatedAt = input.updatedAt;
      auditEvents.push(input.auditEvent);

      return task;
    }),
    transitionCortexTaskStatusWithAudit: vi.fn<
      CortexTaskStore["transitionCortexTaskStatusWithAudit"]
    >(async (input) => {
      options.beforeTransitionUpdate?.();
      const task = tasks.find(
        (candidate) =>
          candidate.id === input.taskId &&
          candidate.workspaceId === input.workspaceId &&
          candidate.status === input.expectedCurrentStatus &&
          candidate.approvalStatus === input.expectedCurrentApprovalStatus,
      );

      if (task === undefined) {
        return null;
      }

      task.status = input.status;
      task.approvalStatus = input.approvalStatus;
      task.updatedAt = input.updatedAt;
      auditEvents.push(input.auditEvent);

      return task;
    }),
    upsertCortexTaskWithAudit: vi.fn<CortexTaskStore["upsertCortexTaskWithAudit"]>(
      async (input) => {
        const row = {
          ...input.task,
          createdAt: input.task.createdAt ?? now,
          updatedAt: input.task.updatedAt ?? now,
        };
        const existing = tasks.find((task) => task.id === row.id);

        if (existing === undefined) {
          tasks.push(row);
          auditEvents.push(input.createAuditEvent(row));

          return row;
        }

        Object.assign(existing, row, {
          approvalStatus: existing.approvalStatus,
          createdAt: existing.createdAt,
          status: existing.status,
        });
        auditEvents.push(input.createAuditEvent(existing));

        return existing;
      },
    ),
  };

  return store;
};

const createService = async (input: {
  currentTime?: Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createCortexTaskService } = await importCortexTasks();

  return createCortexTaskService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createTaskId: () => `cortex_task_${input.store.tasks.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: () => input.currentTime ?? now,
    store: input.store,
  });
};

const expectNoUnsafeTaskMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);

      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(?:code|content|diff|fileContent|localPath|patch|rawOutput|secret|source|sourceCode|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain("repo-secret-token");
  expect(serialized).not.toContain("/Users/rory/private/repo");
  expect(unsafeKeys).toEqual([]);
};

describe("Cortex task service", () => {
  test("persists a valid task only for a workspace member with matching repo and findings", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.persistCortexTask({
      repoId: "github_repository_1",
      task: validTask({ taskId: "client_supplied_id" }),
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual(
      expect.objectContaining({
        approvalStatus: "not_requested",
        findingIds: ["finding_1"],
        repoId: "github_repository_1",
        runIds: ["run_1"],
        status: "draft",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.tasks).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_cortex_tasks.upserted",
        metadata: {
          acceptanceCriteriaCount: 1,
          approvalStatus: "not_requested",
          executionMode: "setup_pr",
          externalLinkCount: 1,
          externalLinkProviders: ["github"],
          externalLinkStatusLabels: ["open"],
          findingCount: 1,
          objectiveLength: 54,
          originType: "finding",
          prArtifactCount: 1,
          repoId: "github_repository_1",
          riskLevel: "medium",
          runCount: 1,
          status: "draft",
          suggestedValidationCount: 1,
          taskId: "cortex_task_1",
          titleLength: 25,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeTaskMaterial({ audit: store.auditEvents, result, stored: store.tasks });

    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });

    await expect(
      nonMemberService.persistCortexTask({
        repoId: "github_repository_1",
        task: validTask(),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.upsertCortexTaskWithAudit).not.toHaveBeenCalled();
  });

  test("rejects task, repo, and finding scope mismatches before persistence", async () => {
    const baseInput = {
      repoId: "github_repository_1",
      task: validTask(),
      workspaceId: "workspace_1",
    };

    const repoMismatchStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [{ id: "github_repository_1", workspaceId: "workspace_2" }],
    });
    const repoMismatchService = await createService({ store: repoMismatchStore });

    await expect(repoMismatchService.persistCortexTask(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(repoMismatchStore.upsertCortexTaskWithAudit).not.toHaveBeenCalled();

    const taskScopeMismatchStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const taskScopeMismatchService = await createService({ store: taskScopeMismatchStore });

    await expect(
      taskScopeMismatchService.persistCortexTask({
        ...baseInput,
        task: validTask({ workspaceId: "workspace_2" }),
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(taskScopeMismatchStore.upsertCortexTaskWithAudit).not.toHaveBeenCalled();

    const findingMismatchStore = createStore({
      findings: [
        {
          id: "finding_1",
          repoId: "github_repository_2",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const findingMismatchService = await createService({ store: findingMismatchStore });

    await expect(findingMismatchService.persistCortexTask(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(findingMismatchStore.upsertCortexTaskWithAudit).not.toHaveBeenCalled();
  });

  test("accepts canonical safe external links and rejects credentialed links or source-like payloads", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const safeResult = await service.persistCortexTask({
      repoId: "github_repository_1",
      task: validTask({
        externalLinks: [
          {
            externalId: "setup-1",
            provider: "linear",
            resourceType: "linear_issue",
            status: "triaged",
            syncedAt: "2026-05-26T08:59:00.000Z",
            title: "Setup ticket",
            url: "https://tracker.example.test/tasks/setup-1",
          },
        ],
      }),
      workspaceId: "workspace_1",
    });

    expect(safeResult.externalLinks).toEqual([
      {
        externalId: "setup-1",
        provider: "linear",
        resourceType: "linear_issue",
        status: "triaged",
        syncedAt: "2026-05-26T08:59:00.000Z",
        title: "Setup ticket",
        url: "https://tracker.example.test/tasks/setup-1",
      },
    ]);
    expect(store.auditEvents.at(-1)?.metadata).toEqual(
      expect.objectContaining({
        externalLinkCount: 1,
        externalLinkProviders: ["linear"],
        externalLinkStatusLabels: ["triaged"],
      }),
    );

    const noLinkResult = await service.persistCortexTask({
      repoId: "github_repository_1",
      task: validTask({ externalLinks: [] }),
      workspaceId: "workspace_1",
    });

    expect(noLinkResult.externalLinks).toEqual([]);

    await expect(
      service.persistCortexTask({
        repoId: "github_repository_1",
        task: validTask({
          externalLinks: [
            {
              provider: "docs",
              resourceType: "documentation",
              status: "unknown",
              title: "Credentialed ticket",
              url: "https://user:repo-secret-token@tracker.example.test/tasks/setup-1",
            },
          ],
        }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    await expect(
      service.persistCortexTask({
        repoId: "github_repository_1",
        task: validTask({
          metadata: {
            rawOutput: "diff --git a/file b/file",
          },
        }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    await expect(
      service.persistCortexTask({
        repoId: "github_repository_1",
        task: validTask({
          title: "diff --git a/file b/file",
        }),
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });

  test.each([
    [
      "unsafe task metadata alias",
      validTask({
        metadata: {
          nested: [{ rawCommandOutput: "command output must stay local" }],
        },
      }),
    ],
    [
      "unsafe objective text",
      validTask({
        objective: "```ts\nconst leaked = true;\n```",
      }),
    ],
    [
      "unsafe acceptance criteria text",
      validTask({
        acceptanceCriteria: ["stdout: raw validation output must not become task text"],
      }),
    ],
    [
      "unsafe suggested validation label",
      validTask({
        suggestedValidation: [
          {
            label: "raw logs: pnpm test output",
            required: true,
            validationId: "typecheck",
          },
        ],
      }),
    ],
    [
      "unsafe external link query parameter",
      validTask({
        externalLinks: [
          {
            externalId: "setup-1",
            provider: "linear",
            resourceType: "linear_issue",
            status: "triaged",
            title: "Tracker ticket",
            url: "https://tracker.example.test/tasks/setup-1?token=repo-secret-token",
          },
        ],
      }),
    ],
    [
      "unsafe external link title snippet",
      validTask({
        externalLinks: [
          {
            externalId: "1",
            provider: "github",
            resourceType: "github_issue",
            status: "open",
            title: "```ts\nconst leaked = true;\n```",
            url: "https://github.com/example/repo/issues/1",
          },
        ],
      }),
    ],
    [
      "unsafe external link status raw logs",
      validTask({
        externalLinks: [
          {
            externalId: "1",
            provider: "github",
            resourceType: "github_issue",
            status: "raw logs: pnpm test output",
            title: "GitHub issue 1",
            url: "https://github.com/example/repo/issues/1",
          },
        ],
      }),
    ],
    [
      "unsafe external link local path",
      validTask({
        externalLinks: [
          {
            provider: "docs",
            resourceType: "documentation",
            status: "unknown",
            title: "/Users/rory/private/repo",
            url: "https://docs.example.test/runbooks/validation",
          },
        ],
      }),
    ],
    [
      "missing issue external id",
      validTask({
        externalLinks: [
          {
            provider: "github",
            resourceType: "github_issue",
            status: "open",
            title: "GitHub issue without id",
            url: "https://github.com/example/repo/issues/1",
          },
        ],
      }),
    ],
    [
      "mismatched provider and resource",
      validTask({
        externalLinks: [
          {
            externalId: "OPS-1",
            provider: "github",
            resourceType: "jira_issue",
            status: "open",
            title: "Jira issue OPS-1",
            url: "https://example.atlassian.net/browse/OPS-1",
          },
        ],
      }),
    ],
  ])("rejects widened hostile task payload before persistence: %s", async (_name, task) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    let thrown: unknown;
    try {
      await service.persistCortexTask({
        repoId: "github_repository_1",
        task,
        workspaceId: "workspace_1",
      });
    } catch (error) {
      thrown = error;
    }

    expect(thrown).toMatchObject({ code: "validation_error" });
    expect(JSON.stringify(thrown)).not.toMatch(
      /rawCommandOutput|const leaked|raw validation output|repo-secret-token|pnpm test/i,
    );
    expect(store.upsertCortexTaskWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects direct persistence attempts that set approved or execution state", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    for (const task of [
      validTask({ status: "approved" }),
      validTask({ status: "queued" }),
      validTask({ approvalStatus: "approved" }),
    ]) {
      await expect(
        service.persistCortexTask({
          repoId: "github_repository_1",
          task,
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
    }

    expect(store.upsertCortexTaskWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("preserves persisted status and approval status when upserting an existing task", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          approvalStatus: "pending",
          id: "cortex_task_2",
          status: "needs_review",
        }),
      ],
    });
    const service = await createService({ currentTime: later, store });

    const result = await service.persistCortexTask({
      repoId: "github_repository_1",
      task: validTask({
        approvalStatus: "not_requested",
        status: "draft",
      }),
      workspaceId: "workspace_1",
    });

    expect(result).toEqual(
      expect.objectContaining({
        approvalStatus: "pending",
        status: "needs_review",
        taskId: "cortex_task_2",
      }),
    );
    expect(store.tasks[0]).toEqual(
      expect.objectContaining({
        approvalStatus: "pending",
        status: "needs_review",
      }),
    );
  });

  test("lists tasks by workspace, repo, and status", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({ id: "task_old", status: "draft", updatedAt: now }),
        taskRow({ id: "task_latest", status: "approved", updatedAt: later }),
        taskRow({
          id: "task_other_repo",
          repoId: "github_repository_2",
          status: "approved",
          updatedAt: later,
        }),
        taskRow({ id: "task_other_workspace", workspaceId: "workspace_2" }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.listCortexTasks({
        repoId: "github_repository_1",
        status: "approved",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        repoId: "github_repository_1",
        status: "approved",
        taskId: "task_latest",
        workspaceId: "workspace_1",
      }),
    ]);
  });

  test("normalizes legacy stored external links when reading Cortex tasks", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          externalLinks: [
            {
              externalId: "42",
              label: "GitHub issue",
              url: "https://github.com/example/repo/issues/42",
            },
          ] as unknown as CortexTask["externalLinks"],
        }),
      ],
    });
    const service = await createService({ store });

    const [task] = await service.listCortexTasks({ workspaceId: "workspace_1" });

    expect(task?.externalLinks).toEqual([
      {
        externalId: "42",
        provider: "github",
        resourceType: "github_issue",
        status: "unknown",
        title: "GitHub issue",
        url: "https://github.com/example/repo/issues/42",
      },
    ]);
  });

  test("rejects unsafe stored task rows before returning list results", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          metadata: {
            nested: [{ rawCommandOutput: "stored command output must not return" }],
          },
        }),
      ],
    });
    const service = await createService({ store });

    await expect(service.listCortexTasks({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "validation_error",
    });
  });

  test("rejects unsafe transition actors and stored rows before audit mutation", async () => {
    const unsafeActorStore = createStore({
      tasks: [taskRow({ approvalStatus: "approved", id: "task_queued", status: "queued" })],
    });
    const unsafeActorService = await createService({ store: unsafeActorStore });

    await expect(
      unsafeActorService.transitionCortexTaskStatus({
        actor: "runner",
        actorId: "stdout: raw runner output",
        status: "running",
        taskId: "task_queued",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(unsafeActorStore.transitionCortexTaskStatusWithAudit).not.toHaveBeenCalled();
    expect(unsafeActorStore.auditEvents).toEqual([]);

    const unsafeStoredRowStore = createStore({
      tasks: [
        taskRow({
          approvalStatus: "approved",
          id: "task_queued",
          metadata: {
            stdoutSummary: "stored stdout summary must not be audited",
          },
          status: "queued",
        }),
      ],
    });
    const unsafeStoredRowService = await createService({ store: unsafeStoredRowStore });

    await expect(
      unsafeStoredRowService.transitionCortexTaskStatus({
        actor: "runner",
        actorId: "runner_1",
        status: "running",
        taskId: "task_queued",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(unsafeStoredRowStore.transitionCortexTaskStatusWithAudit).not.toHaveBeenCalled();
    expect(unsafeStoredRowStore.auditEvents).toEqual([]);
  });

  test("updates execution mode before approval with metadata-only audit", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          approvalStatus: "pending",
          executionMode: "setup_pr",
          id: "task_review",
          status: "needs_review",
        }),
      ],
    });
    const service = await createService({ currentTime: later, store });

    await expect(
      service.updateCortexTaskExecutionMode({
        executionMode: "planning_only",
        taskId: "task_review",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        approvalStatus: "pending",
        executionMode: "planning_only",
        status: "needs_review",
        taskId: "task_review",
      }),
    );

    expect(store.updateCortexTaskExecutionModeWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        executionMode: "planning_only",
        expectedCurrentApprovalStatus: "pending",
        expectedCurrentExecutionMode: "setup_pr",
        expectedCurrentStatus: "needs_review",
        taskId: "task_review",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_cortex_tasks.execution_mode_updated",
        metadata: {
          actorId: "user_1",
          nextExecutionMode: "planning_only",
          previousExecutionMode: "setup_pr",
          repoId: "github_repository_1",
          riskLevel: "medium",
          status: "needs_review",
          taskId: "task_review",
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.auditEvents[0]).not.toHaveProperty("taskId");
    expectNoUnsafeTaskMaterial({ audit: store.auditEvents, stored: store.tasks });
  });

  test("requires an available local runner before selecting local runner mode", async () => {
    const unavailableStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [taskRow({ id: "task_draft", status: "draft" })],
    });
    const unavailableService = await createService({ store: unavailableStore });

    await expect(
      unavailableService.updateCortexTaskExecutionMode({
        executionMode: "local_runner",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(unavailableStore.updateCortexTaskExecutionModeWithAudit).not.toHaveBeenCalled();

    const availableStore = createStore({
      localRunnerAvailable: true,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [taskRow({ id: "task_draft", status: "draft" })],
    });
    const availableService = await createService({ currentTime: later, store: availableStore });

    await expect(
      availableService.updateCortexTaskExecutionMode({
        executionMode: "local_runner",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        executionMode: "local_runner",
        status: "draft",
        taskId: "task_draft",
      }),
    );
  });

  test("blocks execution mode edits after approval and unsafe blocked-risk modes", async () => {
    const approvedStore = createStore({
      localRunnerAvailable: true,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          approvalStatus: "approved",
          executionMode: "setup_pr",
          id: "task_approved",
          status: "approved",
        }),
      ],
    });
    const approvedService = await createService({ store: approvedStore });

    await expect(
      approvedService.updateCortexTaskExecutionMode({
        executionMode: "planning_only",
        taskId: "task_approved",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(approvedStore.updateCortexTaskExecutionModeWithAudit).not.toHaveBeenCalled();

    const blockedRiskStore = createStore({
      localRunnerAvailable: true,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({
          id: "task_blocked_risk",
          riskLevel: "blocked",
          status: "draft",
        }),
      ],
    });
    const blockedRiskService = await createService({ store: blockedRiskStore });

    await expect(
      blockedRiskService.updateCortexTaskExecutionMode({
        executionMode: "setup_pr",
        taskId: "task_blocked_risk",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(blockedRiskStore.updateCortexTaskExecutionModeWithAudit).not.toHaveBeenCalled();
  });

  test("enforces conservative Cortex task status transitions", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        taskRow({ approvalStatus: "not_requested", id: "task_draft", status: "draft" }),
        taskRow({ approvalStatus: "approved", id: "task_completed", status: "completed" }),
      ],
    });
    const service = await createService({ currentTime: later, store });

    await expect(
      service.transitionCortexTaskStatus({
        status: "needs_review",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        approvalStatus: "pending",
        status: "needs_review",
        taskId: "task_draft",
      }),
    );

    await expect(
      service.transitionCortexTaskStatus({
        status: "approved",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        approvalStatus: "approved",
        status: "approved",
        taskId: "task_draft",
      }),
    );

    await expect(
      service.transitionCortexTaskStatus({
        status: "completed",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    await expect(
      service.transitionCortexTaskStatus({
        status: "running",
        taskId: "task_completed",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.auditEvents).toHaveLength(2);
    expectNoUnsafeTaskMaterial({ audit: store.auditEvents, stored: store.tasks });
  });

  test("writes one metadata-only audit event for accepted user transitions", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [taskRow({ approvalStatus: "not_requested", id: "task_draft", status: "draft" })],
    });
    const service = await createService({ currentTime: later, store });

    await expect(
      service.transitionCortexTaskStatus({
        actor: "user",
        status: "needs_review",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        approvalStatus: "pending",
        status: "needs_review",
        taskId: "task_draft",
      }),
    );

    expect(store.transitionCortexTaskStatusWithAudit).toHaveBeenCalledTimes(1);
    expect(store.transitionCortexTaskStatusWithAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        approvalStatus: "pending",
        expectedCurrentApprovalStatus: "not_requested",
        expectedCurrentStatus: "draft",
        status: "needs_review",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_cortex_tasks.status_updated",
        metadata: {
          actorId: "user_1",
          actorType: "user",
          nextApprovalStatus: "pending",
          nextStatus: "needs_review",
          previousApprovalStatus: "not_requested",
          previousStatus: "draft",
          repoId: "github_repository_1",
          taskId: "task_draft",
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.auditEvents[0]).not.toHaveProperty("taskId");
    expectNoUnsafeTaskMaterial({ audit: store.auditEvents, stored: store.tasks });
  });

  test("rejects invalid actor transitions before mutation or audit", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [taskRow({ approvalStatus: "pending", id: "task_review", status: "needs_review" })],
    });
    const service = await createService({ store });

    await expect(
      service.transitionCortexTaskStatus({
        actor: "runner",
        status: "approved",
        taskId: "task_review",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.transitionCortexTaskStatusWithAudit).not.toHaveBeenCalled();
    expect(store.auditEvents).toEqual([]);
  });

  test("treats stale transition updates as validation errors without writing audit events", async () => {
    const store = createStore({
      beforeTransitionUpdate: () => {
        const staleTask = store.tasks[0];

        if (staleTask === undefined) {
          throw new Error("Missing stale-update fixture task.");
        }

        staleTask.status = "approved";
        staleTask.approvalStatus = "approved";
      },
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [taskRow({ approvalStatus: "not_requested", id: "task_draft", status: "draft" })],
    });
    const service = await createService({ currentTime: later, store });

    await expect(
      service.transitionCortexTaskStatus({
        status: "needs_review",
        taskId: "task_draft",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    expect(store.transitionCortexTaskStatusWithAudit).toHaveBeenCalledTimes(1);
    expect(store.auditEvents).toEqual([]);
  });
});

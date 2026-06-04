import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  type CortexTask,
  type TaskRecommendation,
  type TaskRecommendationStatus,
} from "@control-plane/shared";
import { schema } from "../db";

import type {
  ApprovedTaskRecommendation,
  RepoTaskRecommendationStore,
  TaskRecommendationStatusUpdate,
} from "./task-recommendations";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importTaskRecommendations = async () => import("./task-recommendations");

type StoredRepo = {
  id: string;
  workspaceId: string;
};

type StoredRepoScan = {
  id: string;
  repoId: string;
  taskRecommendationIds: string[];
  workspaceId: string;
};

type StoredFinding = {
  id: string;
  repoId: string;
  scanId: string;
  taskIds: string[];
  workspaceId: string;
};

type StoredTaskRecommendation = {
  acceptanceCriteria: TaskRecommendation["acceptanceCriteria"];
  contractVersion: TaskRecommendation["contractVersion"];
  cortexTaskId: string | null;
  createdAt: Date;
  effort: TaskRecommendation["effort"];
  executionMode: TaskRecommendation["executionMode"];
  findingIds: TaskRecommendation["findingIds"];
  id: string;
  metadata: TaskRecommendation["metadata"];
  objective: string;
  repoId: string;
  riskLevel: TaskRecommendation["riskLevel"];
  scanId: string;
  status: TaskRecommendation["status"];
  suggestedValidation: TaskRecommendation["suggestedValidation"];
  title: string;
  updatedAt: Date;
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

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  taskId?: string;
  workspaceId: string;
};

type RecommendationInsert = Parameters<
  RepoTaskRecommendationStore["upsertTaskRecommendationWithAuditAndScanUpdate"]
>[0]["recommendation"];
type CortexTaskInsert = Parameters<
  RepoTaskRecommendationStore["approveTaskRecommendationWithAudit"]
>[0]["task"];

const now = new Date("2026-05-26T09:00:00.000Z");
const later = new Date("2026-05-26T09:10:00.000Z");

const validRecommendation = (overrides: Partial<TaskRecommendation> = {}): TaskRecommendation => ({
  acceptanceCriteria: [
    "Document the validation metadata needed before runner execution.",
    "Keep the recommendation linked to its readiness finding.",
  ],
  contractVersion: CONTRACT_VERSION,
  createdAt: now.toISOString(),
  effort: "small",
  executionMode: "setup_pr",
  findingIds: ["finding_1"],
  metadata: {
    findingCount: 1,
    sourceLabel: "repo_readiness_scan",
  },
  objective: "Create safe validation metadata for Cortex review.",
  repoId: "github_repository_1",
  riskLevel: "medium",
  scanId: "repo_scan_1",
  status: "open",
  suggestedValidation: [
    {
      label: "Typecheck",
      required: true,
      validationId: "typecheck",
    },
  ],
  taskRecommendationId: "task_recommendation_1",
  title: "Add validation metadata",
  updatedAt: now.toISOString(),
  workspaceId: "workspace_1",
  ...overrides,
});

const createRecommendationRow = (
  overrides: Partial<StoredTaskRecommendation> = {},
): StoredTaskRecommendation => {
  const recommendation = validRecommendation({
    ...(overrides.id === undefined ? {} : { taskRecommendationId: overrides.id }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.scanId === undefined ? {} : { scanId: overrides.scanId }),
    ...(overrides.status === undefined ? {} : { status: overrides.status }),
    ...(overrides.cortexTaskId === undefined || overrides.cortexTaskId === null
      ? {}
      : { cortexTaskId: overrides.cortexTaskId }),
  });

  return {
    acceptanceCriteria: recommendation.acceptanceCriteria,
    contractVersion: recommendation.contractVersion,
    cortexTaskId: recommendation.cortexTaskId ?? null,
    createdAt: now,
    effort: recommendation.effort,
    executionMode: recommendation.executionMode,
    findingIds: recommendation.findingIds,
    id: recommendation.taskRecommendationId,
    metadata: recommendation.metadata,
    objective: recommendation.objective,
    repoId: recommendation.repoId,
    riskLevel: recommendation.riskLevel,
    scanId: recommendation.scanId,
    status: recommendation.status,
    suggestedValidation: recommendation.suggestedValidation,
    title: recommendation.title,
    updatedAt: now,
    workspaceId: recommendation.workspaceId,
    ...overrides,
  };
};

const createRecommendationRowFromInsert = (
  insert: RecommendationInsert,
): StoredTaskRecommendation => ({
  acceptanceCriteria: insert.acceptanceCriteria ?? [],
  contractVersion: insert.contractVersion,
  cortexTaskId: insert.cortexTaskId ?? null,
  createdAt: insert.createdAt ?? now,
  effort: insert.effort,
  executionMode: insert.executionMode,
  findingIds: insert.findingIds ?? [],
  id: insert.id,
  metadata: insert.metadata ?? {},
  objective: insert.objective,
  repoId: insert.repoId,
  riskLevel: insert.riskLevel,
  scanId: insert.scanId,
  status: insert.status ?? "open",
  suggestedValidation: insert.suggestedValidation ?? [],
  title: insert.title,
  updatedAt: insert.updatedAt ?? now,
  workspaceId: insert.workspaceId,
});

const createTaskRowFromInsert = (insert: CortexTaskInsert): StoredCortexTask => ({
  acceptanceCriteria: insert.acceptanceCriteria ?? [],
  approvalStatus: insert.approvalStatus ?? "not_requested",
  contractVersion: insert.contractVersion,
  createdAt: insert.createdAt ?? now,
  executionMode: insert.executionMode,
  externalLinks: insert.externalLinks ?? [],
  findingIds: insert.findingIds ?? [],
  id: insert.id,
  latestRunId: insert.latestRunId ?? null,
  metadata: insert.metadata ?? {},
  objective: insert.objective,
  originExternalId: insert.originExternalId ?? null,
  originExternalSystem: insert.originExternalSystem ?? null,
  originType: insert.originType,
  prArtifactIds: insert.prArtifactIds ?? [],
  repoId: insert.repoId,
  riskLevel: insert.riskLevel,
  runIds: insert.runIds ?? [],
  status: insert.status ?? "draft",
  suggestedValidation: insert.suggestedValidation ?? [],
  taskPacketId: insert.taskPacketId ?? null,
  taskRecommendationId: insert.taskRecommendationId ?? null,
  title: insert.title,
  updatedAt: insert.updatedAt ?? now,
  workspaceId: insert.workspaceId,
});

const createStore = (
  options: {
    findings?: StoredFinding[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    recommendations?: StoredTaskRecommendation[];
    repos?: StoredRepo[];
    scans?: StoredRepoScan[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const repos = [...(options.repos ?? [{ id: "github_repository_1", workspaceId: "workspace_1" }])];
  const scans = [
    ...(options.scans ?? [
      {
        id: "repo_scan_1",
        repoId: "github_repository_1",
        taskRecommendationIds: [],
        workspaceId: "workspace_1",
      },
    ]),
  ];
  const findings = [
    ...(options.findings ?? [
      {
        id: "finding_1",
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        taskIds: [],
        workspaceId: "workspace_1",
      },
    ]),
  ];
  const recommendations = [...(options.recommendations ?? [])];
  const tasks = [...(options.tasks ?? [])];

  return {
    approveTaskRecommendationWithAudit: vi.fn<
      RepoTaskRecommendationStore["approveTaskRecommendationWithAudit"]
    >(async (input) => {
      const recommendation = recommendations.find(
        (candidate) =>
          candidate.id === input.taskRecommendationId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (recommendation === undefined) {
        return null;
      }

      if (recommendation.cortexTaskId !== null) {
        const existingTask = tasks.find(
          (task) =>
            task.id === recommendation.cortexTaskId && task.workspaceId === input.workspaceId,
        );

        return existingTask === undefined ? null : { recommendation, task: existingTask };
      }

      if (tasks.some((task) => task.taskRecommendationId === input.taskRecommendationId)) {
        return null;
      }

      const task = createTaskRowFromInsert(input.task);
      recommendation.status = "converted";
      recommendation.cortexTaskId = input.taskId;
      recommendation.updatedAt = input.updatedAt;
      tasks.push(task);

      for (const finding of findings) {
        if (
          finding.workspaceId === recommendation.workspaceId &&
          finding.repoId === recommendation.repoId &&
          recommendation.findingIds.includes(finding.id) &&
          !finding.taskIds.includes(input.taskId)
        ) {
          finding.taskIds.push(input.taskId);
        }
      }

      auditEvents.push(...input.auditEvents);

      return {
        recommendation,
        task,
      };
    }),
    auditEvents,
    findFindingsByIds: vi.fn<RepoTaskRecommendationStore["findFindingsByIds"]>(async (input) =>
      findings.filter(
        (finding) =>
          input.findingIds.includes(finding.id) &&
          finding.workspaceId === input.workspaceId &&
          finding.repoId === input.repoId &&
          finding.scanId === input.scanId,
      ),
    ),
    findings,
    findGithubRepository: vi.fn<RepoTaskRecommendationStore["findGithubRepository"]>(
      async (input) =>
        repos.find((repo) => repo.id === input.repoId && repo.workspaceId === input.workspaceId) ??
        null,
    ),
    findRepoScan: vi.fn<RepoTaskRecommendationStore["findRepoScan"]>(
      async (input) =>
        scans.find((scan) => scan.id === input.scanId && scan.workspaceId === input.workspaceId) ??
        null,
    ),
    findWorkspaceMembership: vi.fn<RepoTaskRecommendationStore["findWorkspaceMembership"]>(
      async (input) =>
        options.memberships?.some(
          (membership) =>
            membership.userId === input.userId && membership.workspaceId === input.workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    getCortexTask: vi.fn<RepoTaskRecommendationStore["getCortexTask"]>(
      async (input) =>
        tasks.find((task) => task.id === input.taskId && task.workspaceId === input.workspaceId) ??
        null,
    ),
    getTaskRecommendation: vi.fn<RepoTaskRecommendationStore["getTaskRecommendation"]>(
      async (input) =>
        recommendations.find(
          (recommendation) =>
            recommendation.id === input.taskRecommendationId &&
            recommendation.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    listTaskRecommendations: vi.fn<RepoTaskRecommendationStore["listTaskRecommendations"]>(
      async (filter) =>
        recommendations
          .filter(
            (recommendation) =>
              recommendation.workspaceId === filter.workspaceId &&
              (filter.repoId === undefined || recommendation.repoId === filter.repoId) &&
              (filter.scanId === undefined || recommendation.scanId === filter.scanId) &&
              (filter.status === undefined || recommendation.status === filter.status),
          )
          .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    recommendations,
    repos,
    scans,
    tasks,
    updateTaskRecommendationStatusWithAudit: vi.fn<
      RepoTaskRecommendationStore["updateTaskRecommendationStatusWithAudit"]
    >(async (input) => {
      const recommendation = recommendations.find(
        (candidate) =>
          candidate.id === input.taskRecommendationId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (recommendation === undefined) {
        return null;
      }

      recommendation.status = input.status;
      recommendation.updatedAt = input.updatedAt;
      auditEvents.push(input.auditEvent);

      return recommendation;
    }),
    upsertTaskRecommendationWithAuditAndScanUpdate: vi.fn<
      RepoTaskRecommendationStore["upsertTaskRecommendationWithAuditAndScanUpdate"]
    >(async (input) => {
      const nextRecommendation = createRecommendationRowFromInsert(input.recommendation);
      const existing = recommendations.find(
        (recommendation) =>
          recommendation.id === nextRecommendation.id &&
          recommendation.workspaceId === nextRecommendation.workspaceId,
      );

      if (existing === undefined) {
        recommendations.push(nextRecommendation);
      } else {
        Object.assign(existing, {
          ...nextRecommendation,
          cortexTaskId: existing.cortexTaskId,
          createdAt: existing.createdAt,
          status: existing.status,
        });
      }

      const stored = existing ?? nextRecommendation;
      const scan = scans.find(
        (candidate) =>
          candidate.id === stored.scanId && candidate.workspaceId === stored.workspaceId,
      );

      if (scan !== undefined && !scan.taskRecommendationIds.includes(stored.id)) {
        scan.taskRecommendationIds.push(stored.id);
      }

      auditEvents.push(input.createAuditEvent(stored));

      return stored;
    }),
  };
};

const createService = async (input: {
  currentTime?: Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createTaskRecommendationService } = await importTaskRecommendations();

  return createTaskRecommendationService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createTaskId: () => `cortex_task_${input.store.tasks.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: () => input.currentTime ?? now,
    store: input.store,
  });
};

const expectNoUnsafeRecommendationMaterial = (value: unknown) => {
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
        /^(?:code|content|diff|fileContent|localPath|patch|rawOutput|secret|sourceCode|stderr|stdout|token)$/u.test(
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
  expect(serialized).not.toContain("pnpm test");
  expect(unsafeKeys).toEqual([]);
};

const containsInspectableText = (
  value: unknown,
  searchText: string,
  seen = new WeakSet<object>(),
  depth = 0,
): boolean => {
  if (typeof value === "string") {
    return value.toLowerCase().includes(searchText.toLowerCase());
  }

  if (typeof value === "symbol") {
    return (value.description ?? "").toLowerCase().includes(searchText.toLowerCase());
  }

  if (typeof value !== "object" || value === null || depth > 8 || seen.has(value)) {
    return false;
  }

  seen.add(value);

  for (const propertyName of Object.getOwnPropertyNames(value)) {
    if (propertyName.toLowerCase().includes(searchText.toLowerCase())) {
      return true;
    }

    if (
      containsInspectableText(
        (value as Record<string, unknown>)[propertyName],
        searchText,
        seen,
        depth + 1,
      )
    ) {
      return true;
    }
  }

  for (const propertySymbol of Object.getOwnPropertySymbols(value)) {
    if (containsInspectableText(propertySymbol, searchText, seen, depth + 1)) {
      return true;
    }

    if (
      containsInspectableText(
        (value as Record<PropertyKey, unknown>)[propertySymbol],
        searchText,
        seen,
        depth + 1,
      )
    ) {
      return true;
    }
  }

  return false;
};

const renderSqlConditionText = (condition: unknown): string => {
  if (
    typeof condition !== "object" ||
    condition === null ||
    typeof (condition as { toQuery?: unknown }).toQuery !== "function"
  ) {
    return "";
  }

  try {
    return (condition as { toQuery: (config: unknown) => { sql: string } }).toQuery({
      casing: {
        getColumnCasing: (column: { name?: string }) => column.name ?? "",
      },
      escapeName: (name: string) => `"${name}"`,
      escapeParam: () => "?",
      escapeString: (value: string) => value.replaceAll("'", "''"),
      paramStartIndex: {
        value: 0,
      },
    }).sql;
  } catch {
    return "";
  }
};

describe("task recommendation service", () => {
  test("persists a valid recommendation only for scoped workspace, repo, scan, and findings", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.persistTaskRecommendation({
      recommendation: validRecommendation(),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual(
      expect.objectContaining({
        recommendation: expect.objectContaining({
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "open",
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        }),
      }),
    );
    expect(store.recommendations).toHaveLength(1);
    expect(store.scans[0]?.taskRecommendationIds).toEqual(["task_recommendation_1"]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_task_recommendations.upserted",
        metadata: {
          acceptanceCriteriaCount: 2,
          effort: "small",
          executionMode: "setup_pr",
          findingCount: 1,
          objectiveLength: 50,
          recommendationId: "task_recommendation_1",
          repoId: "github_repository_1",
          riskLevel: "medium",
          scanId: "repo_scan_1",
          status: "open",
          suggestedValidationCount: 1,
          titleLength: 23,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeRecommendationMaterial({
      audit: store.auditEvents,
      result,
      stored: store.recommendations,
    });
  });

  test.each(["ignored", "deferred", "converted"] as const)(
    "preserves %s lifecycle state when a repeated scan upserts the same recommendation",
    async (status) => {
      const existing = createRecommendationRow({
        ...(status === "converted" ? { cortexTaskId: "cortex_task_existing" } : {}),
        status,
        title: "Persisted lifecycle title",
      });
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        recommendations: [existing],
      });
      const service = await createService({ currentTime: later, store });

      const result = await service.persistTaskRecommendation({
        recommendation: validRecommendation({
          status: "open",
          title: "Updated scan title",
        }),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      });

      expect(result.recommendation).toEqual(
        expect.objectContaining({
          cortexTaskId: status === "converted" ? "cortex_task_existing" : undefined,
          status,
          taskRecommendationId: "task_recommendation_1",
          title: "Updated scan title",
        }),
      );
      expect(store.recommendations[0]).toEqual(
        expect.objectContaining({
          cortexTaskId: status === "converted" ? "cortex_task_existing" : null,
          status,
          title: "Updated scan title",
        }),
      );
    },
  );

  test("rejects non-members and mismatched repo, scan, or finding scope before storage", async () => {
    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });

    await expect(
      nonMemberService.persistTaskRecommendation({
        recommendation: validRecommendation(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.upsertTaskRecommendationWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const missingRepoStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repos: [],
    });
    const missingRepoService = await createService({ store: missingRepoStore });

    await expect(
      missingRepoService.persistTaskRecommendation({
        recommendation: validRecommendation(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(missingRepoStore.upsertTaskRecommendationWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const wrongScanStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        {
          id: "repo_scan_1",
          repoId: "github_repository_2",
          taskRecommendationIds: [],
          workspaceId: "workspace_1",
        },
      ],
    });
    const wrongScanService = await createService({ store: wrongScanStore });

    await expect(
      wrongScanService.persistTaskRecommendation({
        recommendation: validRecommendation(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(wrongScanStore.upsertTaskRecommendationWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const wrongFindingStore = createStore({
      findings: [
        {
          id: "finding_1",
          repoId: "github_repository_1",
          scanId: "repo_scan_2",
          taskIds: [],
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const wrongFindingService = await createService({ store: wrongFindingStore });

    await expect(
      wrongFindingService.persistTaskRecommendation({
        recommendation: validRecommendation(),
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(wrongFindingStore.upsertTaskRecommendationWithAuditAndScanUpdate).not.toHaveBeenCalled();
  });

  test("lists recommendations by workspace, repo, scan, and status", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [
        createRecommendationRow({ id: "recommendation_old", updatedAt: now }),
        createRecommendationRow({
          id: "recommendation_deferred",
          status: "deferred",
          updatedAt: later,
        }),
        createRecommendationRow({
          id: "recommendation_other_scan",
          scanId: "repo_scan_2",
          updatedAt: new Date("2026-05-26T09:05:00.000Z"),
        }),
        createRecommendationRow({
          id: "recommendation_other_repo",
          repoId: "github_repository_2",
          updatedAt: new Date("2026-05-26T09:06:00.000Z"),
        }),
        createRecommendationRow({
          id: "recommendation_other_workspace",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.listTaskRecommendations({
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        status: "open",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({
        recommendation: expect.objectContaining({
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          status: "open",
          taskRecommendationId: "recommendation_old",
        }),
      }),
    ]);
    expect(store.listTaskRecommendations).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "open",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    ["dismissed", "ignored"],
    ["ignored", "ignored"],
    ["deferred", "deferred"],
  ] as Array<[TaskRecommendationStatusUpdate, TaskRecommendationStatus]>)(
    "maps %s status updates to stored %s recommendations",
    async (inputStatus, storedStatus) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        recommendations: [createRecommendationRow()],
      });
      const service = await createService({ currentTime: later, store });

      await expect(
        service.updateTaskRecommendationStatus({
          status: inputStatus,
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        }),
      ).resolves.toEqual(
        expect.objectContaining({
          recommendation: expect.objectContaining({
            status: storedStatus,
            taskRecommendationId: "task_recommendation_1",
            updatedAt: later.toISOString(),
          }),
        }),
      );
      expect(store.auditEvents).toEqual([
        expect.objectContaining({
          actorId: "user_1",
          eventType: "repo_readiness_task_recommendations.status_updated",
          metadata: expect.objectContaining({
            recommendationId: "task_recommendation_1",
            status: storedStatus,
          }),
          workspaceId: "workspace_1",
        }),
      ]);
      expectNoUnsafeRecommendationMaterial(store.auditEvents);
    },
  );

  test("approves an open recommendation into exactly one draft Cortex Task", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [
        createRecommendationRow({
          acceptanceCriteria: [
            "Add metadata-only validation guidance.",
            "Keep the recommendation linked to findings.",
          ],
          effort: "medium",
          executionMode: "setup_pr",
          findingIds: ["finding_1"],
          metadata: {
            safeCount: 2,
          },
          objective: "Add validation docs for safe Cortex execution.",
          riskLevel: "high",
          suggestedValidation: [
            {
              label: "Lint",
              required: true,
              validationId: "lint",
            },
          ],
          title: "Document validation setup",
        }),
      ],
    });
    const service = await createService({ currentTime: later, store });

    const result = (await service.approveTaskRecommendation({
      taskRecommendationId: "task_recommendation_1",
      workspaceId: "workspace_1",
    })) as ApprovedTaskRecommendation;

    expect(result.recommendation.recommendation).toEqual(
      expect.objectContaining({
        cortexTaskId: "cortex_task_1",
        status: "converted",
        taskRecommendationId: "task_recommendation_1",
      }),
    );
    expect(result.task).toEqual(
      expect.objectContaining({
        acceptanceCriteria: [
          "Add metadata-only validation guidance.",
          "Keep the recommendation linked to findings.",
        ],
        approvalStatus: "not_requested",
        executionMode: "setup_pr",
        findingIds: ["finding_1"],
        origin: {
          externalId: "task_recommendation_1",
          type: "task_recommendation",
        },
        prArtifactIds: [],
        repoId: "github_repository_1",
        riskLevel: "high",
        runIds: [],
        status: "draft",
        suggestedValidation: [
          {
            label: "Lint",
            required: true,
            validationId: "lint",
          },
        ],
        taskId: "cortex_task_1",
        taskRecommendationId: "task_recommendation_1",
        title: "Document validation setup",
        workspaceId: "workspace_1",
      }),
    );
    expect(result.task.metadata).toEqual({
      effort: "medium",
      recommendationStatus: "open",
      scanId: "repo_scan_1",
      sourceLabel: "task_recommendation",
    });
    expect(store.tasks).toHaveLength(1);
    expect(store.findings[0]?.taskIds).toEqual(["cortex_task_1"]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_readiness_cortex_tasks.created_from_recommendation",
        metadata: expect.objectContaining({
          approvalStatus: "not_requested",
          recommendationId: "task_recommendation_1",
          status: "draft",
          taskId: "cortex_task_1",
        }),
      }),
      expect.objectContaining({
        eventType: "repo_readiness_task_recommendations.converted",
        metadata: expect.objectContaining({
          cortexTaskId: "cortex_task_1",
          recommendationId: "task_recommendation_1",
          status: "converted",
        }),
      }),
    ]);
    expect(store.auditEvents[0]).not.toHaveProperty("taskId");
    expectNoUnsafeRecommendationMaterial({ audit: store.auditEvents, result, stored: store });
  });

  test("approves a recommendation with user-edited task text without changing safety fields", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [createRecommendationRow()],
    });
    const service = await createService({ currentTime: later, store });

    const result = await service.approveTaskRecommendation({
      acceptanceCriteria: [
        "Create a bounded validation policy summary for reviewer approval.",
        "Keep all generated task details linked to the readiness finding.",
        "Do not expose command output or source excerpts in task metadata.",
      ],
      objective: "Prepare reviewer-edited validation setup work for Cortex.",
      taskRecommendationId: "task_recommendation_1",
      title: "Review validation setup task",
      workspaceId: "workspace_1",
    });

    expect(result.task).toEqual(
      expect.objectContaining({
        acceptanceCriteria: [
          "Create a bounded validation policy summary for reviewer approval.",
          "Keep all generated task details linked to the readiness finding.",
          "Do not expose command output or source excerpts in task metadata.",
        ],
        approvalStatus: "not_requested",
        executionMode: "setup_pr",
        findingIds: ["finding_1"],
        objective: "Prepare reviewer-edited validation setup work for Cortex.",
        riskLevel: "medium",
        status: "draft",
        suggestedValidation: [
          {
            label: "Typecheck",
            required: true,
            validationId: "typecheck",
          },
        ],
        taskRecommendationId: "task_recommendation_1",
        title: "Review validation setup task",
      }),
    );
    expect(result.recommendation.recommendation).toEqual(
      expect.objectContaining({
        cortexTaskId: "cortex_task_1",
        status: "converted",
        title: "Add validation metadata",
      }),
    );
    expect(store.auditEvents[0]).toEqual(
      expect.objectContaining({
        eventType: "repo_readiness_cortex_tasks.created_from_recommendation",
        metadata: expect.objectContaining({
          acceptanceCriteriaCount: 3,
          approvalStatus: "not_requested",
          objectiveLength: 57,
          recommendationId: "task_recommendation_1",
          titleLength: 28,
        }),
      }),
    );
    expectNoUnsafeRecommendationMaterial({ audit: store.auditEvents, result, stored: store });
  });

  test("approves multiple recommendations into draft Cortex Tasks in one request", async () => {
    const store = createStore({
      findings: [
        {
          id: "finding_1",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          taskIds: [],
          workspaceId: "workspace_1",
        },
        {
          id: "finding_2",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          taskIds: [],
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [
        createRecommendationRow(),
        createRecommendationRow({
          findingIds: ["finding_2"],
          id: "task_recommendation_2",
          objective: "Improve agent instructions for safer setup work.",
          title: "Improve agent instructions",
        }),
      ],
    });
    const service = await createService({ currentTime: later, store });

    const result = await service.approveTaskRecommendations({
      recommendations: [
        { taskRecommendationId: "task_recommendation_1" },
        {
          acceptanceCriteria: [
            "Root agent instructions explain security boundaries.",
            "Instructions identify the validation evidence reviewers need.",
          ],
          taskRecommendationId: "task_recommendation_2",
          title: "Reviewer-edited agent instruction task",
        },
      ],
      workspaceId: "workspace_1",
    });

    expect(result).toHaveLength(2);
    expect(result.map((item) => item.task.taskId)).toEqual(["cortex_task_1", "cortex_task_2"]);
    expect(result.map((item) => item.recommendation.recommendation.status)).toEqual([
      "converted",
      "converted",
    ]);
    expect(result[1]?.task).toEqual(
      expect.objectContaining({
        acceptanceCriteria: [
          "Root agent instructions explain security boundaries.",
          "Instructions identify the validation evidence reviewers need.",
        ],
        findingIds: ["finding_2"],
        taskRecommendationId: "task_recommendation_2",
        title: "Reviewer-edited agent instruction task",
      }),
    );
    expect(store.tasks).toHaveLength(2);
    expect(store.findings.map((finding) => finding.taskIds)).toEqual([
      ["cortex_task_1"],
      ["cortex_task_2"],
    ]);
    expect(store.auditEvents).toHaveLength(4);
    expect(store.auditEvents.map((event) => event.eventType)).toEqual([
      "repo_readiness_cortex_tasks.created_from_recommendation",
      "repo_readiness_task_recommendations.converted",
      "repo_readiness_cortex_tasks.created_from_recommendation",
      "repo_readiness_task_recommendations.converted",
    ]);
    expectNoUnsafeRecommendationMaterial({ audit: store.auditEvents, result, stored: store });
  });

  test("rejects duplicate bulk recommendation approvals before creating tasks", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [createRecommendationRow()],
    });
    const service = await createService({ store });

    await expect(
      service.approveTaskRecommendations({
        recommendations: [
          { taskRecommendationId: "task_recommendation_1" },
          { taskRecommendationId: " task_recommendation_1 " },
        ],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.approveTaskRecommendationWithAudit).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(0);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects unsafe approval edits before creating tasks", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [createRecommendationRow()],
    });
    const service = await createService({ store });

    await expect(
      service.approveTaskRecommendation({
        acceptanceCriteria: ["diff --git a/app.ts b/app.ts"],
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.approveTaskRecommendationWithAudit).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(0);
    expect(store.auditEvents).toEqual([]);
  });

  test("returns an existing converted Cortex Task idempotently on repeated approval", async () => {
    const existingTask: StoredCortexTask = {
      acceptanceCriteria: ["Existing criteria remains unchanged."],
      approvalStatus: "not_requested",
      contractVersion: CONTRACT_VERSION,
      createdAt: now,
      executionMode: "setup_pr",
      externalLinks: [],
      findingIds: ["finding_1"],
      id: "cortex_task_existing",
      latestRunId: null,
      metadata: {
        sourceLabel: "task_recommendation",
      },
      objective: "Existing objective.",
      originExternalId: "task_recommendation_1",
      originExternalSystem: null,
      originType: "task_recommendation",
      prArtifactIds: [],
      repoId: "github_repository_1",
      riskLevel: "medium",
      runIds: [],
      status: "draft",
      suggestedValidation: [],
      taskPacketId: null,
      taskRecommendationId: "task_recommendation_1",
      title: "Existing task",
      updatedAt: now,
      workspaceId: "workspace_1",
    };
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [
        createRecommendationRow({
          cortexTaskId: "cortex_task_existing",
          status: "converted",
        }),
      ],
      tasks: [existingTask],
    });
    const service = await createService({ store });

    await expect(
      service.approveTaskRecommendation({
        taskRecommendationId: "task_recommendation_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      recommendation: expect.objectContaining({
        recommendation: expect.objectContaining({
          cortexTaskId: "cortex_task_existing",
          status: "converted",
        }),
      }),
      task: expect.objectContaining({
        taskId: "cortex_task_existing",
        status: "draft",
      }),
    });
    expect(store.approveTaskRecommendationWithAudit).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(1);
    expect(store.auditEvents).toEqual([]);
  });

  test("Drizzle approval conversion update is conditional on the current lifecycle status", async () => {
    const { createDrizzleTaskRecommendationStore } = await importTaskRecommendations();
    const updateWherePredicates: unknown[] = [];
    const deleteTables: unknown[] = [];
    const existingRecommendation = createRecommendationRow({ status: "open" });
    const currentRecommendation = createRecommendationRow({
      status: "ignored",
      updatedAt: later,
    });
    let taskRecommendationSelectCount = 0;
    const createdTask = createTaskRowFromInsert({
      acceptanceCriteria: ["Convert only while the recommendation is still open."],
      approvalStatus: "not_requested",
      contractVersion: CONTRACT_VERSION,
      createdAt: later,
      executionMode: "setup_pr",
      externalLinks: [],
      findingIds: ["finding_1"],
      id: "cortex_task_1",
      latestRunId: null,
      metadata: {},
      objective: "Convert safely.",
      originExternalId: "task_recommendation_1",
      originExternalSystem: null,
      originType: "task_recommendation",
      prArtifactIds: [],
      repoId: "github_repository_1",
      riskLevel: "medium",
      runIds: [],
      status: "draft",
      suggestedValidation: [],
      taskPacketId: null,
      taskRecommendationId: "task_recommendation_1",
      title: "Convert safely",
      updatedAt: later,
      workspaceId: "workspace_1",
    });
    const tx = {
      delete: vi.fn((table: unknown) => ({
        where: vi.fn(() => {
          deleteTables.push(table);
        }),
      })),
      insert: vi.fn((table: unknown) => ({
        values: vi.fn((value: unknown) => {
          if (table === schema.cortexTasks) {
            return {
              onConflictDoNothing: vi.fn(() => ({
                returning: vi.fn(async () => [createTaskRowFromInsert(value as CortexTaskInsert)]),
              })),
            };
          }

          return undefined;
        }),
      })),
      select: vi.fn(() => ({
        from: vi.fn((table: unknown) => ({
          where: vi.fn(() => ({
            limit: vi.fn(async () => {
              if (table === schema.taskRecommendations) {
                taskRecommendationSelectCount += 1;

                return taskRecommendationSelectCount === 1
                  ? [existingRecommendation]
                  : [currentRecommendation];
              }

              if (table === schema.cortexTasks) {
                return [createdTask];
              }

              return [];
            }),
          })),
        })),
      })),
      update: vi.fn((table: unknown) => ({
        set: vi.fn(() => ({
          where: vi.fn((condition: unknown) => {
            if (table === schema.taskRecommendations) {
              updateWherePredicates.push(condition);
            }

            return {
              returning: vi.fn(async () => []),
            };
          }),
        })),
      })),
    };
    const db = {
      transaction: vi.fn(async (callback: (transaction: typeof tx) => Promise<unknown>) =>
        callback(tx),
      ),
    };
    const store = createDrizzleTaskRecommendationStore(db as never);

    await expect(
      store.approveTaskRecommendationWithAudit({
        auditEvents: [],
        task: createdTask,
        taskId: "cortex_task_1",
        taskRecommendationId: "task_recommendation_1",
        updatedAt: later,
        workspaceId: "workspace_1",
      }),
    ).resolves.toBeNull();

    expect(deleteTables).toEqual([schema.cortexTasks]);
    expect(updateWherePredicates).toHaveLength(1);
    expect(renderSqlConditionText(updateWherePredicates[0])).toMatch(/\bstatus\b/i);
    expect(containsInspectableText(updateWherePredicates[0], "open")).toBe(true);
    expect(containsInspectableText(updateWherePredicates[0], "approved")).toBe(true);
  });

  test.each(["ignored", "deferred"] as const)(
    "blocks approval of %s recommendations without creating tasks",
    async (status) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        recommendations: [createRecommendationRow({ status })],
      });
      const service = await createService({ store });

      await expect(
        service.approveTaskRecommendation({
          taskRecommendationId: "task_recommendation_1",
          workspaceId: "workspace_1",
        }),
      ).rejects.toMatchObject({ code: "validation_error" });
      expect(store.approveTaskRecommendationWithAudit).not.toHaveBeenCalled();
      expect(store.tasks).toHaveLength(0);
      expect(store.auditEvents).toEqual([]);
    },
  );

  test.each([
    [
      "unsafe metadata key",
      validRecommendation({
        metadata: { sourceCode: "placeholder" },
      }),
    ],
    ["raw diff text", validRecommendation({ objective: "diff --git a/app.ts b/app.ts" })],
    ["source-like text", validRecommendation({ acceptanceCriteria: ["const leaked = true;"] })],
    ["raw command text", validRecommendation({ title: "Run pnpm test before storing." })],
    [
      "absolute local path",
      validRecommendation({
        metadata: {
          note: "Scanner referenced /Users/rory/private/repo/src/app.ts",
        },
      }),
    ],
    ["real env path", validRecommendation({ objective: "Review apps/web/.env.local" })],
    [
      "secret text",
      validRecommendation({
        objective: `Token ${"ghp_"}${"a".repeat(24)}`,
      }),
    ],
    [
      "raw output label",
      validRecommendation({
        metadata: { label: "raw stdout: failed command output" },
      }),
    ],
  ])("rejects %s before persistence", async (_name, recommendation) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.persistTaskRecommendation({
        recommendation,
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.upsertTaskRecommendationWithAuditAndScanUpdate).not.toHaveBeenCalled();
  });

  test("rejects unsafe stored recommendations before returning list output", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      recommendations: [
        createRecommendationRow({
          metadata: {
            nested: {
              sourceCode: "const leaked = true;",
            },
          } as TaskRecommendation["metadata"],
        }),
      ],
    });
    const service = await createService({ store });

    await expect(
      service.listTaskRecommendations({
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
  });
});

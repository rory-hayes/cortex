import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type CortexTask } from "@control-plane/shared";

import type { LinearIssueCandidateImportStore } from "./import-candidates";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importImportCandidates = async () => import("./import-candidates");

type StoredLinearIssueCandidate = {
  bodySummary: string;
  commentsSummary: string;
  createdAt: Date;
  id: string;
  identifier: string;
  labels: string[];
  lastSyncedAt: Date;
  linearConnectionId: string;
  linearIssueId: string;
  linearUpdatedAt: Date;
  linearWorkspaceId: string;
  projectId: string | null;
  projectName: string | null;
  redactionApplied: boolean;
  status: string;
  title: string;
  updatedAt: Date;
  url: string | null;
  workspaceId: string;
};

type StoredRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
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

type StoredExternalLink = {
  cortexTaskId: string;
  externalId: string | null;
  externalStatus: string;
  id: string;
  metadata: Record<string, unknown>;
  provider: "linear";
  repoId: string;
  resourceType: "linear_issue";
  syncedAt: Date | null;
  title: string;
  url: string;
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

const now = new Date("2026-05-26T12:00:00.000Z");
const syncedAt = new Date("2026-05-26T11:45:00.000Z");

const candidate = (
  overrides: Partial<StoredLinearIssueCandidate> = {},
): StoredLinearIssueCandidate => ({
  bodySummary: "Improve the retry copy on the queue detail page.",
  commentsSummary: "Keep human approval before local runner execution.",
  createdAt: syncedAt,
  id: "linear_issue_candidate_1",
  identifier: "ENG-159",
  labels: ["Ready for AI"],
  lastSyncedAt: syncedAt,
  linearConnectionId: "linear_connection_1",
  linearIssueId: "linear_issue_159",
  linearUpdatedAt: syncedAt,
  linearWorkspaceId: "linear_workspace_1",
  projectId: "linear_project_1",
  projectName: "Control Plane",
  redactionApplied: false,
  status: "Todo",
  title: "Tune retry copy",
  updatedAt: syncedAt,
  url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
  workspaceId: "workspace_1",
  ...overrides,
});

const repository = (overrides: Partial<StoredRepository> = {}): StoredRepository => ({
  id: "github_repository_1",
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  workspaceId: "workspace_1",
  ...overrides,
});

const toTask = (
  input: {
    externalLink: StoredExternalLink;
    task: Omit<StoredCortexTask, "createdAt" | "updatedAt"> & {
      createdAt?: Date;
      updatedAt?: Date;
    };
  },
  createdAt = now,
): StoredCortexTask => ({
  ...input.task,
  createdAt: input.task.createdAt ?? createdAt,
  updatedAt: input.task.updatedAt ?? createdAt,
});

const createStore = (
  options: {
    candidates?: StoredLinearIssueCandidate[];
    externalLinks?: StoredExternalLink[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const approvals: unknown[] = [];
  const auditEvents: StoredAuditEvent[] = [];
  const candidates = [...(options.candidates ?? [candidate()])];
  const externalLinks = [...(options.externalLinks ?? [])];
  const queuedJobs: unknown[] = [];
  const runs: unknown[] = [];
  const taskPackets: unknown[] = [];
  const tasks = [...(options.tasks ?? [])];
  const repositories = [...(options.repositories ?? [repository()])];

  return {
    approvals,
    auditEvents,
    candidates,
    externalLinks,
    findCortexTaskByExternalLink: vi.fn(
      async (input: {
        externalId: string;
        provider: "linear";
        resourceType: "linear_issue";
        workspaceId: string;
      }) => {
        const link = externalLinks.find(
          (item) =>
            item.workspaceId === input.workspaceId &&
            item.provider === input.provider &&
            item.resourceType === input.resourceType &&
            item.externalId === input.externalId,
        );

        return link === undefined
          ? null
          : (tasks.find((task) => task.id === link.cortexTaskId) ?? null);
      },
    ),
    findGithubRepository: vi.fn(
      async (input: { repoId: string; workspaceId: string }) =>
        repositories.find(
          (repo) => repo.id === input.repoId && repo.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findLinearIssueCandidate: vi.fn(
      async (input: { linearIssueCandidateId: string; workspaceId: string }) =>
        candidates.find(
          (item) =>
            item.id === input.linearIssueCandidateId && item.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    importLinearIssueCandidateWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        externalLink: StoredExternalLink;
        task: Omit<StoredCortexTask, "createdAt" | "updatedAt"> & {
          createdAt?: Date;
          updatedAt?: Date;
        };
      }) => {
        const task = toTask(input, input.auditEvent.createdAt);

        tasks.push(task);
        externalLinks.push(input.externalLink);
        auditEvents.push(input.auditEvent);

        return task;
      },
    ),
    queuedJobs,
    repositories,
    runs,
    taskPackets,
    tasks,
  };
};

const createService = async (input: {
  now?: () => Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createLinearIssueCandidateImportService } = await importImportCandidates();

  return createLinearIssueCandidateImportService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createExternalLinkId: () => `external_link_${input.store.externalLinks.length + 1}`,
    createTaskId: () => `cortex_task_${input.store.tasks.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: input.now ?? (() => now),
    store: input.store as LinearIssueCandidateImportStore,
  });
};

const importInput = {
  linearIssueCandidateId: "linear_issue_candidate_1",
  repoId: "github_repository_1",
  workspaceId: "workspace_1",
};

const expectNoRunnerMutations = (store: ReturnType<typeof createStore>) => {
  expect(store.approvals).toEqual([]);
  expect(store.queuedJobs).toEqual([]);
  expect(store.runs).toEqual([]);
  expect(store.taskPackets).toEqual([]);
};

const expectNoUnsafeImportMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys: string[] = [];

  const collectKeys = (candidateValue: unknown) => {
    if (typeof candidateValue !== "object" || candidateValue === null) {
      return;
    }

    if (Array.isArray(candidateValue)) {
      candidateValue.forEach(collectKeys);

      return;
    }

    Object.entries(candidateValue).forEach(([key, childValue]) => {
      keys.push(key.toLowerCase().replace(/[^a-z0-9]/g, ""));
      collectKeys(childValue);
    });
  };

  collectKeys(value);

  [
    "approval",
    "diff",
    "jobid",
    "localpath",
    "patch",
    "rawoutput",
    "runid",
    "sourcecode",
    "stderr",
    "stdout",
    "taskpacket",
    "validationcommands",
  ].forEach((unsafeKey) => {
    expect(keys).not.toContain(unsafeKey);
  });
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain("/Users/rory/private");
  expect(serialized).not.toContain("lin_api_secret");
  expect(serialized).not.toContain("raw output");
};

describe("Linear issue candidate import service", () => {
  test("requires authenticated workspace membership before importing", async () => {
    const unauthenticatedStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const unauthenticated = await createService({
      store: unauthenticatedStore,
      userId: null,
    });

    await expect(unauthenticated.importLinearIssueCandidate(importInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(unauthenticatedStore.findLinearIssueCandidate).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMember = await createService({ store: nonMemberStore });

    await expect(nonMember.importLinearIssueCandidate(importInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(nonMemberStore.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(nonMemberStore.findLinearIssueCandidate).not.toHaveBeenCalled();
  });

  test.each([
    { linearIssueCandidateId: "", repoId: "github_repository_1", workspaceId: "workspace_1" },
    { linearIssueCandidateId: "linear_issue_candidate_1", repoId: "", workspaceId: "workspace_1" },
    {
      linearIssueCandidateId: "linear_issue_candidate_1",
      repoId: "github_repository_1",
      workspaceId: "",
    },
    {
      linearIssueCandidateId: "linear_issue_candidate_1",
      repoId: "github_repository_1",
      workspaceId: "workspace_1\n",
    },
  ])("requires explicit safe IDs before store lookup %#", async (input) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(service.importLinearIssueCandidate(input)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.findLinearIssueCandidate).not.toHaveBeenCalled();
  });

  test("imports only ready Linear candidates into one draft Cortex Task with a canonical Linear link", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.importLinearIssueCandidate(importInput);

    expect(result).toEqual({
      approvalStatus: "not_requested",
      externalLinkCount: 1,
      repoId: "github_repository_1",
      status: "draft",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(store.tasks).toHaveLength(1);
    expect(store.tasks[0]).toMatchObject({
      acceptanceCriteria: expect.arrayContaining([
        "Review the imported Linear issue metadata before requesting runner execution.",
      ]),
      approvalStatus: "not_requested",
      contractVersion: CONTRACT_VERSION,
      executionMode: "planning_only",
      externalLinks: [
        {
          externalId: "linear_workspace_1:linear_issue_159",
          provider: "linear",
          resourceType: "linear_issue",
          status: "Todo",
          syncedAt: "2026-05-26T11:45:00.000Z",
          title: "ENG-159 Tune retry copy",
          url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
        },
      ],
      findingIds: [],
      latestRunId: null,
      originExternalId: "linear_workspace_1:linear_issue_159",
      originExternalSystem: "linear",
      originType: "external_import",
      prArtifactIds: [],
      repoId: "github_repository_1",
      riskLevel: "medium",
      runIds: [],
      status: "draft",
      suggestedValidation: [],
      taskPacketId: null,
      taskRecommendationId: null,
      title: "ENG-159 Tune retry copy",
      workspaceId: "workspace_1",
    });
    expect(store.tasks[0]?.objective).toContain("Improve the retry copy");
    expect(store.tasks[0]?.objective).toContain("Keep human approval");
    expect(store.externalLinks).toEqual([
      expect.objectContaining({
        cortexTaskId: "cortex_task_1",
        externalId: "linear_workspace_1:linear_issue_159",
        provider: "linear",
        resourceType: "linear_issue",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoRunnerMutations(store);
    expectNoUnsafeImportMaterial(result);
    expectNoUnsafeImportMaterial(store.tasks[0]);
  });

  test("rejects non-ready Linear candidates and missing target repositories", async () => {
    const notReadyStore = createStore({
      candidates: [candidate({ labels: ["bug"], status: "Backlog" })],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const notReady = await createService({ store: notReadyStore });

    await expect(notReady.importLinearIssueCandidate(importInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(notReadyStore.importLinearIssueCandidateWithAudit).not.toHaveBeenCalled();

    const missingRepoStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [],
    });
    const missingRepo = await createService({ store: missingRepoStore });

    await expect(missingRepo.importLinearIssueCandidate(importInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(missingRepoStore.importLinearIssueCandidateWithAudit).not.toHaveBeenCalled();
  });

  test("returns an existing Cortex Task idempotently for repeated imports", async () => {
    const existingTask = toTask({
      externalLink: {
        cortexTaskId: "cortex_task_existing",
        externalId: "linear_workspace_1:linear_issue_159",
        externalStatus: "Todo",
        id: "external_link_existing",
        metadata: {},
        provider: "linear",
        repoId: "github_repository_1",
        resourceType: "linear_issue",
        syncedAt,
        title: "ENG-159 Tune retry copy",
        url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
        workspaceId: "workspace_1",
      },
      task: {
        acceptanceCriteria: ["Existing imported task."],
        approvalStatus: "not_requested",
        contractVersion: CONTRACT_VERSION,
        executionMode: "planning_only",
        externalLinks: [],
        findingIds: [],
        id: "cortex_task_existing",
        latestRunId: null,
        metadata: {},
        objective: "Existing imported task.",
        originExternalId: "linear_workspace_1:linear_issue_159",
        originExternalSystem: "linear",
        originType: "external_import",
        prArtifactIds: [],
        repoId: "github_repository_1",
        riskLevel: "medium",
        runIds: [],
        status: "draft",
        suggestedValidation: [],
        taskPacketId: null,
        taskRecommendationId: null,
        title: "Existing imported task",
        workspaceId: "workspace_1",
      },
    });
    const store = createStore({
      externalLinks: [
        {
          cortexTaskId: "cortex_task_existing",
          externalId: "linear_workspace_1:linear_issue_159",
          externalStatus: "Todo",
          id: "external_link_existing",
          metadata: {},
          provider: "linear",
          repoId: "github_repository_1",
          resourceType: "linear_issue",
          syncedAt,
          title: "ENG-159 Tune retry copy",
          url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [existingTask],
    });
    const service = await createService({ store });

    await expect(service.importLinearIssueCandidate(importInput)).resolves.toEqual({
      approvalStatus: "not_requested",
      externalLinkCount: 1,
      repoId: "github_repository_1",
      status: "draft",
      taskId: "cortex_task_existing",
      workspaceId: "workspace_1",
    });
    expect(store.importLinearIssueCandidateWithAudit).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(1);
    expect(store.auditEvents).toHaveLength(0);
    expectNoRunnerMutations(store);
  });

  test("returns an existing imported task idempotently after it leaves draft state", async () => {
    const externalLink = {
      cortexTaskId: "cortex_task_existing",
      externalId: "linear_workspace_1:linear_issue_159",
      externalStatus: "Todo",
      id: "external_link_existing",
      metadata: {},
      provider: "linear" as const,
      repoId: "github_repository_1",
      resourceType: "linear_issue" as const,
      syncedAt,
      title: "ENG-159 Tune retry copy",
      url: "https://linear.app/control-plane/issue/ENG-159/tune-retry-copy",
      workspaceId: "workspace_1",
    };
    const existingTask = toTask({
      externalLink,
      task: {
        acceptanceCriteria: ["Existing imported task."],
        approvalStatus: "approved",
        contractVersion: CONTRACT_VERSION,
        executionMode: "planning_only",
        externalLinks: [],
        findingIds: [],
        id: "cortex_task_existing",
        latestRunId: null,
        metadata: {},
        objective: "Existing imported task.",
        originExternalId: "linear_workspace_1:linear_issue_159",
        originExternalSystem: "linear",
        originType: "external_import",
        prArtifactIds: [],
        repoId: "github_repository_1",
        riskLevel: "medium",
        runIds: [],
        status: "queued",
        suggestedValidation: [],
        taskPacketId: null,
        taskRecommendationId: null,
        title: "Existing imported task",
        workspaceId: "workspace_1",
      },
    });
    const store = createStore({
      externalLinks: [externalLink],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [existingTask],
    });
    const service = await createService({ store });

    await expect(service.importLinearIssueCandidate(importInput)).resolves.toEqual({
      approvalStatus: "approved",
      externalLinkCount: 1,
      repoId: "github_repository_1",
      status: "queued",
      taskId: "cortex_task_existing",
      workspaceId: "workspace_1",
    });
    expect(store.importLinearIssueCandidateWithAudit).not.toHaveBeenCalled();
    expect(store.tasks).toHaveLength(1);
    expect(store.auditEvents).toHaveLength(0);
    expectNoRunnerMutations(store);
  });

  test("uses conservative draft text when candidate summaries are redacted or empty", async () => {
    const store = createStore({
      candidates: [
        candidate({
          bodySummary: "[redacted]",
          commentsSummary: "",
          redactionApplied: true,
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await service.importLinearIssueCandidate(importInput);

    expect(store.tasks[0]?.objective).toBe(
      "Create a draft Cortex Task from the imported Linear issue metadata. Review scope, repository ownership, and acceptance criteria before requesting any runner execution.",
    );
    expect(store.tasks[0]?.acceptanceCriteria).toEqual([
      "Review the imported Linear issue metadata before requesting runner execution.",
      "Confirm the selected GitHub repository is the correct source owner.",
      "Keep the task in draft until a human requests approval.",
    ]);
  });

  test("audit metadata contains only IDs, counts, statuses, lengths, provider labels, and booleans", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await service.importLinearIssueCandidate(importInput);

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "linear.issue_candidate_imported",
        message: "Linear issue candidate imported as a Cortex Task draft.",
        metadata: {
          acceptanceCriteriaCount: 3,
          approvalStatus: "not_requested",
          bodySummaryLength: 48,
          commentsSummaryLength: 50,
          executionMode: "planning_only",
          externalId: "linear_workspace_1:linear_issue_159",
          externalLinkCount: 1,
          externalLinkProviders: ["linear"],
          importedExistingTask: false,
          issueStatus: "Todo",
          labelCount: 1,
          linearIssueCandidateId: "linear_issue_candidate_1",
          redactionApplied: false,
          repoId: "github_repository_1",
          status: "draft",
          taskId: "cortex_task_1",
          titleLength: 23,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeImportMaterial(store.auditEvents);
  });
});

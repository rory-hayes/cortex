import { describe, expect, test, vi } from "vitest";

import type { LinearGraphQLClient, LinearIssueSyncMetadata } from "@control-plane/linear";
import { CONTRACT_VERSION, type CortexTask } from "@control-plane/shared";

import type { LinearTaskSyncStore } from "./task-sync";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importTaskSync = async () => import("./task-sync");

type StoredLinearOAuthConnection = {
  accessTokenCiphertext: string | null;
  accessTokenKeyId: string | null;
  connectedAt: Date;
  expiresAt: Date | null;
  id: string;
  linearWorkspaceId: string;
  linearWorkspaceName: string;
  revokedAt: Date | null;
  scopes: string[];
  workspaceId: string;
};

type StoredRepository = {
  defaultBranch: string;
  htmlUrl: string | null;
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
  taskId?: string;
  workspaceId: string;
};

const now = new Date("2026-05-26T16:00:00.000Z");
const accessToken = "linear-access-token-plaintext";
const ciphertext = "v1.linear-access-token-ciphertext";
const keyId = "linear-oauth-test-key-id";

const connection = (
  overrides: Partial<StoredLinearOAuthConnection> = {},
): StoredLinearOAuthConnection => ({
  accessTokenCiphertext: ciphertext,
  accessTokenKeyId: keyId,
  connectedAt: new Date("2026-05-26T12:00:00.000Z"),
  expiresAt: new Date("2026-06-26T12:00:00.000Z"),
  id: "linear_connection_1",
  linearWorkspaceId: "linear_workspace_1",
  linearWorkspaceName: "Linear Platform",
  revokedAt: null,
  scopes: ["read", "write"],
  workspaceId: "workspace_1",
  ...overrides,
});

const repository = (overrides: Partial<StoredRepository> = {}): StoredRepository => ({
  defaultBranch: "main",
  htmlUrl: "https://github.com/rory/control-plane",
  id: "github_repository_1",
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  workspaceId: "workspace_1",
  ...overrides,
});

const task = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => ({
  acceptanceCriteria: [
    "Show the sync action only after a human approves the task.",
    "Keep runner execution separate from Linear sync.",
  ],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-05-26T12:00:00.000Z"),
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_1"],
  id: "cortex_task_1",
  latestRunId: null,
  metadata: {
    sourceLabel: "repo_readiness_scan",
  },
  objective: "Add a metadata-only Linear sync action for approved scan tasks.",
  originExternalId: null,
  originExternalSystem: null,
  originType: "finding",
  prArtifactIds: [],
  repoId: "github_repository_1",
  riskLevel: "medium",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    {
      label: "Typecheck",
      required: true,
      validationId: "typecheck",
    },
  ],
  taskPacketId: null,
  taskRecommendationId: null,
  title: "Sync approved task to Linear",
  updatedAt: new Date("2026-05-26T12:30:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const linearIssue = (
  overrides: Partial<LinearIssueSyncMetadata> = {},
): LinearIssueSyncMetadata => ({
  identifier: "ENG-222",
  issueId: "linear_issue_222",
  status: "Todo",
  title: "Sync approved task to Linear",
  url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
  ...overrides,
});

const createStore = (
  options: {
    connections?: StoredLinearOAuthConnection[];
    externalLinks?: StoredExternalLink[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const approvals: unknown[] = [];
  const auditEvents: StoredAuditEvent[] = [];
  const connections = [...(options.connections ?? [connection()])];
  const externalLinks = [...(options.externalLinks ?? [])];
  const jobs: unknown[] = [];
  const prArtifacts: unknown[] = [];
  const repositories = [...(options.repositories ?? [repository()])];
  const runnerAssignments: unknown[] = [];
  const runs: unknown[] = [];
  const taskPackets: unknown[] = [];
  const tasks = [...(options.tasks ?? [task()])];
  const taskLocks = new Map<string, Promise<void>>();
  const withTaskLock = async <T>(key: string, callback: () => Promise<T>): Promise<T> => {
    const previousLock = taskLocks.get(key) ?? Promise.resolve();
    let releaseLock!: () => void;
    const currentLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    const queuedLock = previousLock.then(() => currentLock);

    taskLocks.set(key, queuedLock);
    await previousLock;

    try {
      return await callback();
    } finally {
      releaseLock();

      if (taskLocks.get(key) === queuedLock) {
        taskLocks.delete(key);
      }
    }
  };

  return {
    approvals,
    auditEvents,
    connections,
    externalLinks,
    createCortexTaskLinearExternalLinkWithAudit: vi.fn(
      async (input: {
        createAuditEvent: (eventInput: {
          externalLinkCount: number;
          issue: LinearIssueSyncMetadata;
          link: CortexTask["externalLinks"][number];
          task: StoredCortexTask;
        }) => StoredAuditEvent;
        createExternalLink: (issue: LinearIssueSyncMetadata) => CortexTask["externalLinks"][number];
        createExternalLinkId: () => string;
        createIssue: (record: {
          externalLink: StoredExternalLink | null;
          repository: StoredRepository | null;
          task: StoredCortexTask;
        }) => Promise<LinearIssueSyncMetadata>;
        taskId: string;
        updatedAt: Date;
        workspaceId: string;
      }) =>
        withTaskLock(`${input.workspaceId}:${input.taskId}`, async () => {
          const storedTask = tasks.find(
            (item) => item.id === input.taskId && item.workspaceId === input.workspaceId,
          );

          if (storedTask === undefined) {
            return null;
          }

          const storedRepository =
            repositories.find(
              (item) =>
                item.id === storedTask.repoId && item.workspaceId === storedTask.workspaceId,
            ) ?? null;
          const existingLink =
            externalLinks.find(
              (item) =>
                item.cortexTaskId === storedTask.id &&
                item.workspaceId === storedTask.workspaceId &&
                item.provider === "linear" &&
                item.resourceType === "linear_issue",
            ) ?? null;

          if (existingLink !== null) {
            return {
              action: "existing" as const,
              externalLink: existingLink,
              externalLinkCount: 1,
              issue: {
                identifier: existingLink.title.split(" ")[0] ?? existingLink.externalId ?? "ENG",
                issueId: existingLink.externalId?.split(":").at(-1) ?? "linear_issue_existing",
                status: existingLink.externalStatus,
                title: existingLink.title,
                url: existingLink.url,
              },
              task: storedTask,
            };
          }

          const issue = await input.createIssue({
            externalLink: null,
            repository: storedRepository,
            task: storedTask,
          });
          const link = input.createExternalLink(issue);
          const taskExternalLinks = [
            ...storedTask.externalLinks.filter(
              (item) => !(item.provider === "linear" && item.resourceType === "linear_issue"),
            ),
            link,
          ];
          const externalLink: StoredExternalLink = {
            cortexTaskId: storedTask.id,
            externalId: link.externalId ?? null,
            externalStatus: link.status,
            id: input.createExternalLinkId(),
            metadata: {},
            provider: "linear",
            repoId: storedTask.repoId,
            resourceType: "linear_issue",
            syncedAt: link.syncedAt === undefined ? null : new Date(link.syncedAt),
            title: link.title,
            url: link.url,
            workspaceId: storedTask.workspaceId,
          };
          const externalLinkCount = taskExternalLinks.filter(
            (item) => item.provider === "linear" && item.resourceType === "linear_issue",
          ).length;

          storedTask.externalLinks = taskExternalLinks;
          storedTask.updatedAt = input.updatedAt;
          externalLinks.push(externalLink);
          auditEvents.push(
            input.createAuditEvent({
              externalLinkCount,
              issue,
              link,
              task: storedTask,
            }),
          );

          return {
            action: "created" as const,
            externalLink,
            externalLinkCount,
            issue,
            task: storedTask,
          };
        }),
    ),
    findActiveLinearConnectionForSync: vi.fn(
      async (input: { linearConnectionId: string; now: Date; workspaceId: string }) =>
        connections.find(
          (item) =>
            item.id === input.linearConnectionId &&
            item.workspaceId === input.workspaceId &&
            item.revokedAt === null &&
            (item.expiresAt === null || item.expiresAt > input.now),
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
    getApprovedScanCortexTaskForLinearSync: vi.fn(
      async (input: { taskId: string; workspaceId: string }) => {
        const foundTask =
          tasks.find(
            (item) => item.id === input.taskId && item.workspaceId === input.workspaceId,
          ) ?? null;

        if (foundTask === null) {
          return null;
        }

        const repo =
          repositories.find(
            (item) => item.id === foundTask.repoId && item.workspaceId === foundTask.workspaceId,
          ) ?? null;
        const link =
          externalLinks.find(
            (item) =>
              item.cortexTaskId === foundTask.id &&
              item.workspaceId === foundTask.workspaceId &&
              item.provider === "linear" &&
              item.resourceType === "linear_issue",
          ) ?? null;

        return { externalLink: link, repository: repo, task: foundTask };
      },
    ),
    jobs,
    listActiveLinearConnections: vi.fn(async (input: { now: Date; workspaceId: string }) =>
      connections.filter(
        (item) =>
          item.workspaceId === input.workspaceId &&
          item.revokedAt === null &&
          (item.expiresAt === null || item.expiresAt > input.now),
      ),
    ),
    listApprovedScanCortexTasksForLinearSync: vi.fn(async (input: { workspaceId: string }) =>
      tasks
        .filter((item) => item.workspaceId === input.workspaceId)
        .map((item) => ({
          externalLink:
            externalLinks.find(
              (link) =>
                link.workspaceId === item.workspaceId &&
                link.cortexTaskId === item.id &&
                link.provider === "linear" &&
                link.resourceType === "linear_issue",
            ) ?? null,
          repository:
            repositories.find(
              (repo) => repo.id === item.repoId && repo.workspaceId === item.workspaceId,
            ) ?? null,
          task: item,
        })),
    ),
    prArtifacts,
    runnerAssignments,
    runs,
    taskPackets,
    tasks,
    upsertCortexTaskLinearExternalLinkWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        externalLink: StoredExternalLink;
        taskExternalLinks: CortexTask["externalLinks"];
        taskId: string;
        updatedAt: Date;
        workspaceId: string;
      }) => {
        const storedTask = tasks.find(
          (item) => item.id === input.taskId && item.workspaceId === input.workspaceId,
        );

        if (storedTask === undefined) {
          return null;
        }

        storedTask.externalLinks = input.taskExternalLinks;
        storedTask.updatedAt = input.updatedAt;

        const existingLink = externalLinks.find(
          (item) =>
            item.workspaceId === input.externalLink.workspaceId &&
            item.provider === "linear" &&
            item.resourceType === "linear_issue" &&
            item.externalId === input.externalLink.externalId,
        );

        if (existingLink === undefined) {
          externalLinks.push(input.externalLink);
        } else {
          Object.assign(existingLink, input.externalLink);
        }

        auditEvents.push(input.auditEvent);

        return { externalLink: input.externalLink, task: storedTask };
      },
    ),
    upsertCortexTaskLinearExternalLinkStatusWithAudit: vi.fn(
      async (input: {
        auditEvent: StoredAuditEvent;
        externalLink: StoredExternalLink;
        taskExternalLinks: CortexTask["externalLinks"];
        taskId: string;
        updatedAt: Date;
        workspaceId: string;
      }) => {
        const storedTask = tasks.find(
          (item) => item.id === input.taskId && item.workspaceId === input.workspaceId,
        );

        if (storedTask === undefined) {
          return null;
        }

        storedTask.externalLinks = input.taskExternalLinks;
        storedTask.updatedAt = input.updatedAt;

        const existingLink = externalLinks.find(
          (item) =>
            item.workspaceId === input.externalLink.workspaceId &&
            item.provider === "linear" &&
            item.resourceType === "linear_issue" &&
            item.externalId === input.externalLink.externalId,
        );

        if (existingLink === undefined) {
          externalLinks.push(input.externalLink);
        } else {
          existingLink.externalStatus = input.externalLink.externalStatus;
          existingLink.syncedAt = input.externalLink.syncedAt;
        }

        auditEvents.push(input.auditEvent);

        return { externalLink: existingLink ?? input.externalLink, task: storedTask };
      },
    ),
  };
};

const createLinearClient = (issue: LinearIssueSyncMetadata = linearIssue()) => ({
  createIssue: vi.fn<LinearGraphQLClient["createIssue"]>(async () => issue),
  listProjects: vi.fn<LinearGraphQLClient["listProjects"]>(async () => [
    { id: "linear_project_1", name: "Control Plane" },
  ]),
  listTeams: vi.fn<LinearGraphQLClient["listTeams"]>(async () => [
    { id: "linear_team_1", key: "ENG", name: "Engineering" },
  ]),
  listWorkflowStates: vi.fn<LinearGraphQLClient["listWorkflowStates"]>(async () => [
    { id: "linear_state_todo", name: "Todo", teamId: "linear_team_1", type: "unstarted" },
  ]),
  updateIssueState: vi.fn<LinearGraphQLClient["updateIssueState"]>(async () => issue),
});

const expectNoLinearClientCalls = (client: ReturnType<typeof createLinearClient>) => {
  expect(client.createIssue).not.toHaveBeenCalled();
  expect(client.listProjects).not.toHaveBeenCalled();
  expect(client.listTeams).not.toHaveBeenCalled();
  expect(client.listWorkflowStates).not.toHaveBeenCalled();
  expect(client.updateIssueState).not.toHaveBeenCalled();
};

const createService = async (input: {
  cortexAppBaseUrl?: string;
  client?: ReturnType<typeof createLinearClient>;
  issue?: LinearIssueSyncMetadata;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createLinearTaskSyncService } = await importTaskSync();
  const client = input.client ?? createLinearClient(input.issue);
  const unsealer = {
    unsealCredential: vi.fn(async () => accessToken),
  };

  return {
    client,
    service: createLinearTaskSyncService({
      clientFactory: () => client as unknown as LinearGraphQLClient,
      createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
      createExternalLinkId: () => `external_link_${input.store.externalLinks.length + 1}`,
      ...(input.cortexAppBaseUrl === undefined ? {} : { cortexAppBaseUrl: input.cortexAppBaseUrl }),
      getAuthContext: async () => ({
        userId: input.userId === undefined ? "user_1" : input.userId,
      }),
      now: () => now,
      store: input.store as LinearTaskSyncStore,
      unsealer,
    }),
    unsealer,
  };
};

const syncInput = {
  linearConnectionId: "linear_connection_1",
  projectId: "linear_project_1",
  statusId: "linear_state_todo",
  taskId: "cortex_task_1",
  teamId: "linear_team_1",
  workspaceId: "workspace_1",
};

const expectNoUnsafeSyncMaterial = (value: unknown) => {
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
        /^(?:accessToken|ciphertext|content|diff|job|localPath|patch|privateKey|rawOutput|rawSource|run|secret|source|stderr|stdout|taskPacket|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain(accessToken);
  expect(serialized).not.toContain(ciphertext);
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain(".env");
  expect(serialized).not.toContain("stdout:");
  expect(serialized).not.toContain("stderr:");
  expect(serialized).not.toContain("raw output");
  expect(serialized).not.toContain("/Users/rory/private");
  expect(unsafeKeys).toEqual([]);
};

const expectNoRunnerMutations = (store: ReturnType<typeof createStore>) => {
  expect(store.approvals).toEqual([]);
  expect(store.jobs).toEqual([]);
  expect(store.prArtifacts).toEqual([]);
  expect(store.runnerAssignments).toEqual([]);
  expect(store.runs).toEqual([]);
  expect(store.taskPackets).toEqual([]);
};

describe("Linear Cortex Task sync service", () => {
  test("requires authenticated workspace membership before listing or syncing", async () => {
    const unauthenticatedStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const unauthenticated = await createService({
      store: unauthenticatedStore,
      userId: null,
    });

    await expect(
      unauthenticated.service.listLinearTaskSyncPageData({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(unauthenticated.service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(unauthenticatedStore.listApprovedScanCortexTasksForLinearSync).not.toHaveBeenCalled();
    expect(unauthenticated.client.createIssue).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMember = await createService({ store: nonMemberStore });

    await expect(nonMember.service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(nonMemberStore.getApprovedScanCortexTaskForLinearSync).not.toHaveBeenCalled();
  });

  test("requires active unexpired OAuth connection before unsealing and API calls", async () => {
    const store = createStore({
      connections: [
        connection({ id: "linear_connection_revoked", revokedAt: now }),
        connection({
          expiresAt: new Date("2026-05-26T15:59:59.000Z"),
          id: "linear_connection_expired",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { client, service, unsealer } = await createService({ store });

    await expect(service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    await expect(
      service.syncCortexTaskToLinear({
        ...syncInput,
        linearConnectionId: "linear_connection_expired",
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(unsealer.unsealCredential).not.toHaveBeenCalled();
    expect(client.createIssue).not.toHaveBeenCalled();
  });

  test("rejects team, project, and status ids that do not belong to the selected Linear connection", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const staleOptionClient = createLinearClient();

    staleOptionClient.listTeams.mockResolvedValue([
      { id: "other_linear_team", key: "OPS", name: "Operations" },
    ]);
    staleOptionClient.listProjects.mockResolvedValue([
      { id: "other_linear_project", name: "Operations" },
    ]);
    staleOptionClient.listWorkflowStates.mockResolvedValue([
      { id: "other_linear_state", name: "Backlog", teamId: "other_linear_team" },
    ]);

    const { service } = await createService({
      client: staleOptionClient,
      store,
    });

    await expect(service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(staleOptionClient.listTeams).toHaveBeenCalled();
    expect(staleOptionClient.listProjects).toHaveBeenCalled();
    expect(staleOptionClient.listWorkflowStates).toHaveBeenCalledWith({
      teamId: "linear_team_1",
    });
    expect(staleOptionClient.createIssue).not.toHaveBeenCalled();
    expect(staleOptionClient.updateIssueState).not.toHaveBeenCalled();
    expect(store.upsertCortexTaskLinearExternalLinkWithAudit).not.toHaveBeenCalled();
  });

  test("lists active connections and only approved scan-generated Cortex Tasks", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        task(),
        task({
          id: "cortex_task_recommendation",
          findingIds: [],
          originType: "task_recommendation",
          taskRecommendationId: "task_recommendation_1",
        }),
        task({ id: "cortex_task_draft", status: "draft" }),
        task({ id: "cortex_task_manual", originType: "manual" }),
        task({ id: "cortex_task_import", originType: "external_import" }),
        task({ id: "cortex_task_rejected", approvalStatus: "rejected", status: "rejected" }),
        task({ id: "cortex_task_deferred", approvalStatus: "deferred", status: "deferred" }),
      ],
    });
    const { service } = await createService({ store });

    const data = await service.listLinearTaskSyncPageData({ workspaceId: "workspace_1" });

    expect(data.connections).toEqual([
      {
        id: "linear_connection_1",
        linearWorkspaceId: "linear_workspace_1",
        linearWorkspaceName: "Linear Platform",
      },
    ]);
    expect(data.tasks.map((item) => item.taskId)).toEqual([
      "cortex_task_1",
      "cortex_task_recommendation",
    ]);
    expect(data.teams).toEqual([{ id: "linear_team_1", key: "ENG", name: "Engineering" }]);
    expect(data.projects).toEqual([{ id: "linear_project_1", name: "Control Plane" }]);
    expect(data.workflowStates).toEqual([
      { id: "linear_state_todo", name: "Todo", teamId: "linear_team_1", type: "unstarted" },
    ]);
    expectNoUnsafeSyncMaterial(data);
  });

  test.each([
    ["draft status", task({ status: "draft" })],
    ["manual origin", task({ originType: "manual" })],
    ["external import origin", task({ originType: "external_import" })],
    ["rejected task", task({ approvalStatus: "rejected", status: "rejected" })],
    ["deferred task", task({ approvalStatus: "deferred", status: "deferred" })],
    ["unapproved approval status", task({ approvalStatus: "pending" })],
  ])("rejects ineligible Cortex Tasks before calling Linear: %s", async (_name, storedTask) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [storedTask],
    });
    const { client, service } = await createService({ store });

    await expect(service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(client.createIssue).not.toHaveBeenCalled();
    expect(store.upsertCortexTaskLinearExternalLinkWithAudit).not.toHaveBeenCalled();
  });

  test("creates a Linear issue from safe task fields and stores one canonical Linear link", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { client, service, unsealer } = await createService({
      cortexAppBaseUrl: "https://cortex.example",
      store,
    });

    const result = await service.syncCortexTaskToLinear(syncInput);

    expect(unsealer.unsealCredential).toHaveBeenCalledWith({
      credential: {
        ciphertext,
        keyId,
      },
      purpose: "access",
    });
    expect(client.createIssue).toHaveBeenCalledWith({
      description: expect.stringContaining("Cortex Task: Sync approved task to Linear"),
      projectId: "linear_project_1",
      stateId: "linear_state_todo",
      teamId: "linear_team_1",
      title: "Sync approved task to Linear",
    });
    const issueBody = client.createIssue.mock.calls[0]?.[0].description ?? "";
    expect(issueBody).toContain("Objective: Add a metadata-only Linear sync action");
    expect(issueBody).toContain("Acceptance criteria:");
    expect(issueBody).toContain("- Show the sync action only after a human approves the task.");
    expect(issueBody).toContain("Risk: medium");
    expect(issueBody).toContain("Execution mode: setup_pr");
    expect(issueBody).toContain("Repository: rory/control-plane");
    expect(issueBody).toContain("Default branch: main");
    expect(issueBody).toContain("Finding count: 1");
    expect(issueBody).toContain("Suggested validation: Typecheck");
    expect(issueBody).toContain(
      "Cortex URL: https://cortex.example/dashboard/tasks/sync-linear?taskId=cortex_task_1",
    );
    expect(issueBody).not.toContain("Finding IDs:");
    expect(issueBody).not.toContain("Task recommendation ID:");
    expect(result).toEqual({
      action: "created",
      externalLinkCount: 1,
      issueIdentifier: "ENG-222",
      issueId: "linear_issue_222",
      linearConnectionId: "linear_connection_1",
      status: "Todo",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(store.tasks[0]?.externalLinks).toEqual([
      {
        externalId: "linear_workspace_1:linear_issue_222",
        provider: "linear",
        resourceType: "linear_issue",
        status: "Todo",
        syncedAt: now.toISOString(),
        title: "ENG-222 Sync approved task to Linear",
        url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
      },
    ]);
    expect(store.externalLinks).toEqual([
      expect.objectContaining({
        cortexTaskId: "cortex_task_1",
        externalId: "linear_workspace_1:linear_issue_222",
        externalStatus: "Todo",
        provider: "linear",
        resourceType: "linear_issue",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "linear.cortex_task_synced",
        message: "Cortex Task synced to Linear.",
        metadata: {
          action: "created",
          acceptanceCriteriaCount: 2,
          executionMode: "setup_pr",
          externalId: "linear_workspace_1:linear_issue_222",
          externalLinkCount: 1,
          externalLinkProviders: ["linear"],
          findingCount: 1,
          issueIdentifier: "ENG-222",
          linearConnectionId: "linear_connection_1",
          linearIssueId: "linear_issue_222",
          linearWorkspaceId: "linear_workspace_1",
          repoId: "github_repository_1",
          riskLevel: "medium",
          status: "Todo",
          syncedAt: now.toISOString(),
          taskId: "cortex_task_1",
          taskRecommendationId: null,
        },
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoRunnerMutations(store);
    expectNoUnsafeSyncMaterial({
      auditEvents: store.auditEvents,
      externalLinks: store.externalLinks,
      issueBody,
      result,
      task: store.tasks[0],
    });
  });

  test("rejects Linear issue creation without a canonical issue URL before persisting a link", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const issueWithoutUrl = linearIssue();
    delete (issueWithoutUrl as { url?: string }).url;
    const { client, service } = await createService({
      client: createLinearClient(issueWithoutUrl),
      store,
    });

    await expect(service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(store.externalLinks).toEqual([]);
    expect(store.tasks[0]?.externalLinks).toEqual([]);
    expect(store.auditEvents).toEqual([]);
    expectNoRunnerMutations(store);
  });

  test("deduplicates concurrent Linear sync submissions for the same unsynced Cortex Task", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const client = createLinearClient();
    let firstCreateStarted!: () => void;
    let releaseFirstCreate!: () => void;
    const firstCreateStartedPromise = new Promise<void>((resolve) => {
      firstCreateStarted = resolve;
    });
    const releaseFirstCreatePromise = new Promise<void>((resolve) => {
      releaseFirstCreate = resolve;
    });
    const issues = [
      linearIssue(),
      linearIssue({
        identifier: "ENG-333",
        issueId: "linear_issue_333",
        title: "Duplicate Linear issue",
        url: "https://linear.app/control-plane/issue/ENG-333/duplicate-linear-issue",
      }),
    ];

    client.createIssue.mockImplementation(async () => {
      const issue = issues.shift();

      if (issue === undefined) {
        throw new Error("Unexpected duplicate Linear issue creation.");
      }

      if (issue.issueId === "linear_issue_222") {
        firstCreateStarted();
        await releaseFirstCreatePromise;
      }

      return issue;
    });

    const { service } = await createService({
      client,
      store,
    });

    const firstSync = service.syncCortexTaskToLinear(syncInput);
    await firstCreateStartedPromise;
    const secondSync = service.syncCortexTaskToLinear(syncInput);
    await new Promise((resolve) => setTimeout(resolve, 0));

    releaseFirstCreate();
    const results = await Promise.all([firstSync, secondSync]);

    expect(client.createIssue).toHaveBeenCalledTimes(1);
    expect(results).toEqual([
      {
        action: "created",
        externalLinkCount: 1,
        issueIdentifier: "ENG-222",
        issueId: "linear_issue_222",
        linearConnectionId: "linear_connection_1",
        status: "Todo",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      {
        action: "updated",
        externalLinkCount: 1,
        issueIdentifier: "ENG-222",
        issueId: "linear_issue_222",
        linearConnectionId: "linear_connection_1",
        status: "Todo",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.externalLinks).toHaveLength(1);
    expect(store.externalLinks[0]).toMatchObject({
      cortexTaskId: "cortex_task_1",
      externalId: "linear_workspace_1:linear_issue_222",
      provider: "linear",
      resourceType: "linear_issue",
      workspaceId: "workspace_1",
    });
    expect(store.tasks[0]?.externalLinks).toHaveLength(1);
    expect(store.tasks[0]?.externalLinks[0]?.externalId).toBe(
      "linear_workspace_1:linear_issue_222",
    );
    expect(store.createCortexTaskLinearExternalLinkWithAudit).toHaveBeenCalledTimes(2);
    expect(store.upsertCortexTaskLinearExternalLinkWithAudit).toHaveBeenCalledTimes(0);
    expect(store.upsertCortexTaskLinearExternalLinkStatusWithAudit).toHaveBeenCalledTimes(0);
    expectNoRunnerMutations(store);
  });

  test("re-sync updates the existing Linear issue status instead of creating duplicates", async () => {
    const existingLink: StoredExternalLink = {
      cortexTaskId: "cortex_task_1",
      externalId: "linear_workspace_1:linear_issue_222",
      externalStatus: "Todo",
      id: "external_link_existing",
      metadata: {},
      provider: "linear",
      repoId: "github_repository_1",
      resourceType: "linear_issue",
      syncedAt: new Date("2026-05-26T15:00:00.000Z"),
      title: "ENG-222 Sync approved task to Linear",
      url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
      workspaceId: "workspace_1",
    };
    const store = createStore({
      externalLinks: [existingLink],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        task({
          externalLinks: [
            {
              externalId: "linear_workspace_1:linear_issue_222",
              provider: "linear",
              resourceType: "linear_issue",
              status: "Todo",
              syncedAt: "2026-05-26T15:00:00.000Z",
              title: "ENG-222 Sync approved task to Linear",
              url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
            },
          ],
        }),
      ],
    });
    const client = createLinearClient(
      linearIssue({
        status: "Done",
        title: "Renamed title from Linear response",
        url: "https://linear.app/control-plane/issue/ENG-222/renamed-by-linear",
      }),
    );

    client.listWorkflowStates.mockResolvedValue([
      { id: "linear_state_todo", name: "Todo", teamId: "linear_team_1", type: "unstarted" },
      { id: "linear_state_done", name: "Done", teamId: "linear_team_1", type: "completed" },
    ]);

    const { service } = await createService({
      client,
      store,
    });

    await expect(
      service.syncCortexTaskToLinear({
        ...syncInput,
        statusId: "linear_state_done",
      }),
    ).resolves.toMatchObject({
      action: "updated",
      externalLinkCount: 1,
      issueIdentifier: "ENG-222",
      status: "Done",
    });
    expect(client.createIssue).not.toHaveBeenCalled();
    expect(client.updateIssueState).toHaveBeenCalledWith({
      issueId: "linear_issue_222",
      stateId: "linear_state_done",
    });
    expect(store.upsertCortexTaskLinearExternalLinkWithAudit).not.toHaveBeenCalled();
    expect(store.upsertCortexTaskLinearExternalLinkStatusWithAudit).toHaveBeenCalledTimes(1);
    expect(store.externalLinks).toHaveLength(1);
    expect(store.tasks[0]?.externalLinks).toHaveLength(1);
    expect(store.externalLinks[0]).toMatchObject({
      externalId: "linear_workspace_1:linear_issue_222",
      externalStatus: "Done",
      metadata: {},
      repoId: "github_repository_1",
      title: "ENG-222 Sync approved task to Linear",
      url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
    });
    expect(store.externalLinks[0]?.syncedAt).toEqual(now);
    expect(store.tasks[0]?.externalLinks[0]).toEqual({
      externalId: "linear_workspace_1:linear_issue_222",
      provider: "linear",
      resourceType: "linear_issue",
      status: "Done",
      syncedAt: now.toISOString(),
      title: "ENG-222 Sync approved task to Linear",
      url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
    });
    expect(store.auditEvents[0]?.metadata).toEqual(
      expect.objectContaining({
        action: "updated",
        externalLinkCount: 1,
        status: "Done",
      }),
    );
    expectNoRunnerMutations(store);
  });

  test.each([
    ["unsafe title", task({ title: "diff --git a/app.ts b/app.ts" })],
    ["unsafe objective", task({ objective: "```ts\nconst leaked = true;\n```" })],
    ["unsafe acceptance criteria", task({ acceptanceCriteria: ["Do not edit .env"] })],
    ["unsafe metadata", task({ metadata: { rawOutput: "stdout: hidden output" } })],
    [
      "unsafe repository metadata",
      task(),
      repository({ repositoryFullName: "/Users/rory/private/repo" }),
    ],
    [
      "unsafe credential marker",
      task({ objective: "Use lin_api_placeholder_material while syncing." }),
    ],
    [
      "invalid Cortex Task contract",
      task({ contractVersion: "2026-01-01.invalid" as StoredCortexTask["contractVersion"] }),
    ],
  ])(
    "rejects unsafe task or body material before calling Linear: %s",
    async (_name, storedTask, storedRepository = repository()) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        repositories: [storedRepository],
        tasks: [storedTask],
      });
      const { client, service, unsealer } = await createService({ store });

      await expect(service.syncCortexTaskToLinear(syncInput)).rejects.toMatchObject({
        code: "validation_error",
      });
      expect(unsealer.unsealCredential).not.toHaveBeenCalled();
      expectNoLinearClientCalls(client);
      expect(store.upsertCortexTaskLinearExternalLinkWithAudit).not.toHaveBeenCalled();
    },
  );

  test("rejects unsafe task with existing Linear link before calling Linear", async () => {
    const existingLink: StoredExternalLink = {
      cortexTaskId: "cortex_task_1",
      externalId: "linear_workspace_1:linear_issue_222",
      externalStatus: "Todo",
      id: "external_link_existing",
      metadata: {},
      provider: "linear",
      repoId: "github_repository_1",
      resourceType: "linear_issue",
      syncedAt: new Date("2026-05-26T15:00:00.000Z"),
      title: "ENG-222 Sync approved task to Linear",
      url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
      workspaceId: "workspace_1",
    };
    const store = createStore({
      externalLinks: [existingLink],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        task({
          externalLinks: [
            {
              externalId: "linear_workspace_1:linear_issue_222",
              provider: "linear",
              resourceType: "linear_issue",
              status: "Todo",
              syncedAt: "2026-05-26T15:00:00.000Z",
              title: "ENG-222 Sync approved task to Linear",
              url: "https://linear.app/control-plane/issue/ENG-222/sync-approved-task-to-linear",
            },
          ],
          objective: "```ts\nconst leaked = true;\n```",
        }),
      ],
    });
    const { client, service, unsealer } = await createService({ store });

    await expect(
      service.syncCortexTaskToLinear({
        ...syncInput,
        statusId: "linear_state_done",
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(unsealer.unsealCredential).not.toHaveBeenCalled();
    expectNoLinearClientCalls(client);
    expect(store.upsertCortexTaskLinearExternalLinkStatusWithAudit).not.toHaveBeenCalled();
  });
});

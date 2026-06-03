import { describe, expect, test, vi } from "vitest";

import type { GitHubAppClient, GitHubIssueMetadata } from "@control-plane/github";
import { CONTRACT_VERSION, type CortexTask } from "@control-plane/shared";

import type { GitHubIssueSyncStore } from "./issues";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importIssues = async () => import("./issues");

type StoredRepository = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubInstallationId: string;
  id: string;
  installationPermissions: Record<string, string>;
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
  provider: "github";
  repoId: string;
  resourceType: "github_issue";
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

const now = new Date("2026-05-27T16:00:00.000Z");

const repository = (overrides: Partial<StoredRepository> = {}): StoredRepository => ({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  githubInstallationId: "42",
  id: "github_repository_1",
  installationPermissions: {
    contents: "read",
    issues: "write",
    metadata: "read",
  },
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  workspaceId: "workspace_1",
  ...overrides,
});

const task = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => ({
  acceptanceCriteria: [
    "Created issue links back to the Cortex Task.",
    "Duplicate GitHub Issue pushes are prevented.",
  ],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-05-27T12:00:00.000Z"),
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_1"],
  id: "cortex_task_1",
  latestRunId: null,
  metadata: {
    sourceLabel: "repo_readiness_scan",
  },
  objective: "Sync approved Cortex Task metadata to GitHub Issues.",
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
  title: "Sync approved task to GitHub Issues",
  updatedAt: new Date("2026-05-27T12:30:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const githubIssue = (overrides: Partial<GitHubIssueMetadata> = {}): GitHubIssueMetadata => ({
  createdAt: "2026-05-27T16:01:00.000Z",
  htmlUrl: "https://github.com/rory/control-plane/issues/31",
  id: 601,
  number: 31,
  state: "open",
  title: "Sync approved task to GitHub Issues",
  updatedAt: "2026-05-27T16:01:00.000Z",
  ...overrides,
});

const createStore = (
  options: {
    externalLinks?: StoredExternalLink[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredRepository[];
    tasks?: StoredCortexTask[];
  } = {},
) => {
  const approvals: unknown[] = [];
  const auditEvents: StoredAuditEvent[] = [];
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
    externalLinks,
    createCortexTaskGitHubIssueExternalLinkWithAudit: vi.fn(
      async (input: {
        createAuditEvent: (eventInput: {
          externalLinkCount: number;
          issue: GitHubIssueMetadata;
          link: CortexTask["externalLinks"][number];
          task: StoredCortexTask;
        }) => StoredAuditEvent;
        createExternalLink: (issue: GitHubIssueMetadata) => CortexTask["externalLinks"][number];
        createExternalLinkId: () => string;
        createIssue: (record: {
          externalLink: StoredExternalLink | null;
          repository: StoredRepository | null;
          task: StoredCortexTask;
        }) => Promise<GitHubIssueMetadata>;
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
                item.provider === "github" &&
                item.resourceType === "github_issue",
            ) ?? null;

          if (existingLink !== null) {
            return {
              action: "existing" as const,
              externalLink: existingLink,
              externalLinkCount: 1,
              issue: {
                htmlUrl: existingLink.url,
                id: Number(existingLink.externalId?.split(":").at(-1) ?? 601),
                number: Number(existingLink.title.match(/#(?<number>\d+)/u)?.groups?.number ?? 31),
                state: existingLink.externalStatus as GitHubIssueMetadata["state"],
                title: existingLink.title.replace(/^#\d+\s+/u, ""),
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
              (item) => !(item.provider === "github" && item.resourceType === "github_issue"),
            ),
            link,
          ];
          const externalLink: StoredExternalLink = {
            cortexTaskId: storedTask.id,
            externalId: link.externalId ?? null,
            externalStatus: link.status,
            id: input.createExternalLinkId(),
            metadata: {},
            provider: "github",
            repoId: storedTask.repoId,
            resourceType: "github_issue",
            syncedAt: link.syncedAt === undefined ? null : new Date(link.syncedAt),
            title: link.title,
            url: link.url,
            workspaceId: storedTask.workspaceId,
          };
          const externalLinkCount = taskExternalLinks.filter(
            (item) => item.provider === "github" && item.resourceType === "github_issue",
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
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    getApprovedScanCortexTaskForGitHubIssueSync: vi.fn(
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
              item.provider === "github" &&
              item.resourceType === "github_issue",
          ) ?? null;

        return { externalLink: link, repository: repo, task: foundTask };
      },
    ),
    jobs,
    listApprovedScanCortexTasksForGitHubIssueSync: vi.fn(async (input: { workspaceId: string }) =>
      tasks
        .filter((item) => item.workspaceId === input.workspaceId)
        .map((item) => ({
          externalLink:
            externalLinks.find(
              (link) =>
                link.workspaceId === item.workspaceId &&
                link.cortexTaskId === item.id &&
                link.provider === "github" &&
                link.resourceType === "github_issue",
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
  };
};

const createGitHubClient = (issue: GitHubIssueMetadata = githubIssue()) => ({
  createIssue: vi.fn<GitHubAppClient["createIssue"]>(async () => issue),
});

const createService = async (input: {
  cortexAppBaseUrl?: string;
  githubClient?: ReturnType<typeof createGitHubClient>;
  issue?: GitHubIssueMetadata;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createGitHubIssueSyncService } = await importIssues();
  const githubClient = input.githubClient ?? createGitHubClient(input.issue);

  return {
    githubClient,
    service: createGitHubIssueSyncService({
      createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
      createExternalLinkId: () => `external_link_${input.store.externalLinks.length + 1}`,
      ...(input.cortexAppBaseUrl === undefined ? {} : { cortexAppBaseUrl: input.cortexAppBaseUrl }),
      getAuthContext: async () => ({
        userId: input.userId === undefined ? "user_1" : input.userId,
      }),
      githubClient: githubClient as unknown as GitHubAppClient,
      now: () => now,
      store: input.store as GitHubIssueSyncStore,
    }),
  };
};

const syncInput = {
  taskId: "cortex_task_1",
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

describe("GitHub Issues Cortex Task sync service", () => {
  test("requires authenticated workspace membership before listing or syncing", async () => {
    const unauthenticatedStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const unauthenticated = await createService({
      store: unauthenticatedStore,
      userId: null,
    });

    await expect(
      unauthenticated.service.listGitHubIssueSyncPageData({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      unauthenticated.service.syncCortexTaskToGitHubIssue(syncInput),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(unauthenticated.githubClient.createIssue).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMember = await createService({ store: nonMemberStore });

    await expect(nonMember.service.syncCortexTaskToGitHubIssue(syncInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(nonMemberStore.getApprovedScanCortexTaskForGitHubIssueSync).not.toHaveBeenCalled();
  });

  test("lists only approved scan-generated Cortex Tasks with GitHub Issues permission", async () => {
    const existingLink: StoredExternalLink = {
      cortexTaskId: "cortex_task_2",
      externalId: "github_repository_1:602",
      externalStatus: "open",
      id: "external_link_existing",
      metadata: {},
      provider: "github",
      repoId: "github_repository_1",
      resourceType: "github_issue",
      syncedAt: new Date("2026-05-27T15:45:00.000Z"),
      title: "#32 Existing GitHub issue",
      url: "https://github.com/rory/control-plane/issues/32",
      workspaceId: "workspace_1",
    };
    const store = createStore({
      externalLinks: [existingLink],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        task(),
        task({
          externalLinks: [
            {
              externalId: "github_repository_1:602",
              provider: "github",
              resourceType: "github_issue",
              status: "open",
              syncedAt: "2026-05-27T15:45:00.000Z",
              title: "#32 Existing GitHub issue",
              url: "https://github.com/rory/control-plane/issues/32",
            },
          ],
          id: "cortex_task_2",
          originType: "task_recommendation",
          taskRecommendationId: "task_recommendation_1",
        }),
        task({ id: "cortex_task_draft", status: "draft" }),
        task({ id: "cortex_task_manual", originType: "manual" }),
        task({ id: "cortex_task_rejected", approvalStatus: "rejected", status: "rejected" }),
      ],
    });
    const { service } = await createService({ store });

    const data = await service.listGitHubIssueSyncPageData({ workspaceId: "workspace_1" });

    expect(data.tasks).toEqual([
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
          title: "#32 Existing GitHub issue",
          url: "https://github.com/rory/control-plane/issues/32",
        },
        executionMode: "setup_pr",
        originType: "task_recommendation",
        repoId: "github_repository_1",
        repositoryFullName: "rory/control-plane",
        riskLevel: "medium",
        status: "approved",
        taskId: "cortex_task_2",
        title: "Sync approved task to GitHub Issues",
      },
    ]);
    expect(data.workspaceId).toBe("workspace_1");
    expectNoUnsafeSyncMaterial(data);
  });

  test("creates a GitHub issue from safe task fields and stores one canonical GitHub link", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const { githubClient, service } = await createService({
      cortexAppBaseUrl: "https://cortex.example",
      store,
    });

    const result = await service.syncCortexTaskToGitHubIssue(syncInput);

    expect(githubClient.createIssue).toHaveBeenCalledWith({
      body: expect.stringContaining("Cortex Task: Sync approved task to GitHub Issues"),
      installationId: 42,
      owner: "rory",
      repo: "control-plane",
      title: "Sync approved task to GitHub Issues",
    });
    const issueCall = githubClient.createIssue.mock.calls.at(0);
    const issueBody = (issueCall?.[0] as { body: string } | undefined)?.body ?? "";
    expect(issueBody).toContain("Objective: Sync approved Cortex Task metadata to GitHub Issues.");
    expect(issueBody).toContain("Acceptance criteria:");
    expect(issueBody).toContain("- Created issue links back to the Cortex Task.");
    expect(issueBody).toContain("Risk: medium");
    expect(issueBody).toContain("Execution mode: setup_pr");
    expect(issueBody).toContain("Repository: rory/control-plane");
    expect(issueBody).toContain("Suggested validation: Typecheck");
    expect(issueBody).toContain(
      "Cortex URL: https://cortex.example/dashboard/tasks/sync-github-issues?taskId=cortex_task_1",
    );
    expect(issueBody).not.toContain("Finding IDs:");
    expect(result).toEqual({
      action: "created",
      externalLinkCount: 1,
      issueId: "601",
      issueNumber: 31,
      status: "open",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(store.tasks[0]?.externalLinks).toEqual([
      {
        externalId: "github_repository_1:601",
        provider: "github",
        resourceType: "github_issue",
        status: "open",
        syncedAt: now.toISOString(),
        title: "#31 Sync approved task to GitHub Issues",
        url: "https://github.com/rory/control-plane/issues/31",
      },
    ]);
    expect(store.externalLinks).toEqual([
      expect.objectContaining({
        cortexTaskId: "cortex_task_1",
        externalId: "github_repository_1:601",
        externalStatus: "open",
        provider: "github",
        resourceType: "github_issue",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "github.issue.cortex_task_synced",
        message: "Cortex Task synced to GitHub Issues.",
        metadata: {
          action: "created",
          acceptanceCriteriaCount: 2,
          executionMode: "setup_pr",
          externalId: "github_repository_1:601",
          externalLinkCount: 1,
          externalLinkProviders: ["github"],
          findingCount: 1,
          githubInstallationId: "42",
          issueId: "601",
          issueNumber: 31,
          repoId: "github_repository_1",
          repositoryFullName: "rory/control-plane",
          riskLevel: "medium",
          status: "open",
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

  test("prevents duplicate GitHub issue pushes for an already-synced Cortex Task", async () => {
    const existingLink: StoredExternalLink = {
      cortexTaskId: "cortex_task_1",
      externalId: "github_repository_1:601",
      externalStatus: "open",
      id: "external_link_existing",
      metadata: {},
      provider: "github",
      repoId: "github_repository_1",
      resourceType: "github_issue",
      syncedAt: new Date("2026-05-27T15:45:00.000Z"),
      title: "#31 Sync approved task to GitHub Issues",
      url: "https://github.com/rory/control-plane/issues/31",
      workspaceId: "workspace_1",
    };
    const store = createStore({
      externalLinks: [existingLink],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      tasks: [
        task({
          externalLinks: [
            {
              externalId: "github_repository_1:601",
              provider: "github",
              resourceType: "github_issue",
              status: "open",
              syncedAt: "2026-05-27T15:45:00.000Z",
              title: "#31 Sync approved task to GitHub Issues",
              url: "https://github.com/rory/control-plane/issues/31",
            },
          ],
        }),
      ],
    });
    const { githubClient, service } = await createService({ store });

    await expect(service.syncCortexTaskToGitHubIssue(syncInput)).resolves.toEqual({
      action: "existing",
      externalLinkCount: 1,
      issueId: "601",
      issueNumber: 31,
      status: "open",
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expect(githubClient.createIssue).not.toHaveBeenCalled();
    expect(store.externalLinks).toHaveLength(1);
    expect(store.tasks[0]?.externalLinks).toHaveLength(1);
    expect(store.auditEvents).toEqual([]);
    expectNoRunnerMutations(store);
  });

  test.each([
    [
      "missing issues permission",
      task(),
      repository({ installationPermissions: { metadata: "read" } }),
    ],
    ["archived repository", task(), repository({ archived: true })],
    ["disabled repository", task(), repository({ disabled: true })],
    ["draft status", task({ status: "draft" }), repository()],
    ["manual origin", task({ originType: "manual" }), repository()],
    ["unsafe objective", task({ objective: "```ts\nconst leaked = true;\n```" }), repository()],
    [
      "unsafe acceptance criteria",
      task({ acceptanceCriteria: ["Do not edit .env"] }),
      repository(),
    ],
    ["unsafe metadata", task({ metadata: { rawOutput: "stdout: hidden output" } }), repository()],
    [
      "invalid Cortex Task contract",
      task({ contractVersion: "2026-01-01.invalid" as StoredCortexTask["contractVersion"] }),
      repository(),
    ],
  ])(
    "rejects unsafe or ineligible GitHub issue sync before calling GitHub: %s",
    async (_name, storedTask, storedRepository) => {
      const store = createStore({
        memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
        repositories: [storedRepository],
        tasks: [storedTask],
      });
      const { githubClient, service } = await createService({ store });

      await expect(service.syncCortexTaskToGitHubIssue(syncInput)).rejects.toMatchObject({
        code: "validation_error",
      });
      expect(githubClient.createIssue).not.toHaveBeenCalled();
    },
  );
});

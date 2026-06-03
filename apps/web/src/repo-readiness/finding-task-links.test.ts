import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION, type CortexTask, type Finding } from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

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

type StoredFinding = {
  category: Finding["category"];
  confidence: number;
  contractVersion: Finding["contractVersion"];
  createdAt: Date;
  dedupeKey: string;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  taskIds: string[];
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type FindingTaskLinkStore = {
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<{ id: string; role: string } | null>;
  listCortexTasksForFinding: (input: {
    findingId: string;
    workspaceId: string;
  }) => Promise<StoredCortexTask[]>;
  listFindingsForCortexTask: (input: {
    taskId: string;
    workspaceId: string;
  }) => Promise<StoredFinding[]>;
};

const importFindingTaskLinks = async () =>
  (await import("./finding-task-links")) as {
    createFindingTaskLinkService: (input: {
      getAuthContext?: () => Promise<{ userId: string | null }>;
      store: FindingTaskLinkStore;
    }) => {
      listCortexTasksForFinding: (input: {
        findingId: string;
        workspaceId: string;
      }) => Promise<CortexTask[]>;
      listFindingsForCortexTask: (input: {
        taskId: string;
        workspaceId: string;
      }) => Promise<Finding[]>;
    };
  };

const now = new Date("2026-05-26T10:00:00.000Z");
const later = new Date("2026-05-26T10:05:00.000Z");

const createTaskRow = (overrides: Partial<StoredCortexTask> = {}): StoredCortexTask => ({
  acceptanceCriteria: ["The linked finding remains reviewable from safe metadata."],
  approvalStatus: "not_requested",
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  executionMode: "setup_pr",
  externalLinks: [],
  findingIds: ["finding_1"],
  id: "cortex_task_1",
  latestRunId: null,
  metadata: {
    sourceLabel: "finding_link",
  },
  objective: "Create a setup task for linked finding metadata.",
  originExternalId: null,
  originExternalSystem: null,
  originType: "finding",
  prArtifactIds: [],
  repoId: "github_repository_1",
  riskLevel: "medium",
  runIds: [],
  status: "draft",
  suggestedValidation: [],
  taskPacketId: null,
  taskRecommendationId: null,
  title: "Linked setup task",
  updatedAt: later,
  workspaceId: "workspace_1",
  ...overrides,
});

const createFindingRow = (overrides: Partial<StoredFinding> = {}): StoredFinding => ({
  category: "validation",
  confidence: 0.9,
  contractVersion: CONTRACT_VERSION,
  createdAt: now,
  dedupeKey: "fd_0".padEnd(67, "0"),
  deterministicRuleId: "validation.commands.missing",
  evidence: [
    {
      metadata: {
        pathCount: 1,
      },
      paths: ["docs/validation.md"],
      summary: "Validation setup is incomplete.",
    },
  ],
  id: "finding_1",
  recommendation: "Create a setup task for validation metadata.",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  severity: "medium",
  source: "deterministic_rule",
  status: "open",
  summary: "Validation command metadata is missing.",
  taskIds: ["cortex_task_1"],
  title: "Validation metadata missing",
  updatedAt: later,
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  options: {
    findings?: StoredFinding[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    tasks?: StoredCortexTask[];
  } = {},
): FindingTaskLinkStore => {
  const findings = options.findings ?? [
    createFindingRow(),
    createFindingRow({
      id: "finding_other_workspace",
      taskIds: ["cortex_task_other_workspace"],
      workspaceId: "workspace_2",
    }),
  ];
  const tasks = options.tasks ?? [
    createTaskRow(),
    createTaskRow({
      id: "cortex_task_other_workspace",
      findingIds: ["finding_other_workspace"],
      workspaceId: "workspace_2",
    }),
  ];
  const links = [
    {
      cortexTaskId: "cortex_task_1",
      findingId: "finding_1",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    },
    {
      cortexTaskId: "cortex_task_other_workspace",
      findingId: "finding_other_workspace",
      repoId: "github_repository_1",
      workspaceId: "workspace_2",
    },
  ];

  return {
    findWorkspaceMembership: vi.fn<FindingTaskLinkStore["findWorkspaceMembership"]>(
      async (input) =>
        options.memberships?.some(
          (membership) =>
            membership.userId === input.userId && membership.workspaceId === input.workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    listCortexTasksForFinding: vi.fn<FindingTaskLinkStore["listCortexTasksForFinding"]>(
      async (input) =>
        links
          .filter(
            (link) => link.workspaceId === input.workspaceId && link.findingId === input.findingId,
          )
          .map((link) =>
            tasks.find(
              (task) =>
                task.workspaceId === link.workspaceId &&
                task.repoId === link.repoId &&
                task.id === link.cortexTaskId,
            ),
          )
          .filter((task): task is StoredCortexTask => task !== undefined),
    ),
    listFindingsForCortexTask: vi.fn<FindingTaskLinkStore["listFindingsForCortexTask"]>(
      async (input) =>
        links
          .filter(
            (link) => link.workspaceId === input.workspaceId && link.cortexTaskId === input.taskId,
          )
          .map((link) =>
            findings.find(
              (finding) =>
                finding.workspaceId === link.workspaceId &&
                finding.repoId === link.repoId &&
                finding.id === link.findingId,
            ),
          )
          .filter((finding): finding is StoredFinding => finding !== undefined),
    ),
  };
};

const createService = async (input: { store: FindingTaskLinkStore; userId?: string | null }) => {
  const { createFindingTaskLinkService } = await importFindingTaskLinks();

  return createFindingTaskLinkService({
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    store: input.store,
  });
};

const expectNoUnsafeLinkMaterial = (value: unknown) => {
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
  expect(unsafeKeys).toEqual([]);
};

describe("finding-task link service", () => {
  test("lists Cortex Tasks linked to a finding only inside the requested workspace", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.listCortexTasksForFinding({
      findingId: " finding_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual([
      expect.objectContaining({
        findingIds: ["finding_1"],
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.listCortexTasksForFinding).toHaveBeenCalledWith({
      findingId: "finding_1",
      workspaceId: "workspace_1",
    });
    expectNoUnsafeLinkMaterial(result);
  });

  test("lists findings linked to a Cortex Task only inside the requested workspace", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.listFindingsForCortexTask({
      taskId: " cortex_task_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual([
      expect.objectContaining({
        findingId: "finding_1",
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expect(store.listFindingsForCortexTask).toHaveBeenCalledWith({
      taskId: "cortex_task_1",
      workspaceId: "workspace_1",
    });
    expectNoUnsafeLinkMaterial(result);
  });

  test("rejects non-members and invalid ids before relationship lookups", async () => {
    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });

    await expect(
      nonMemberService.listCortexTasksForFinding({
        findingId: "finding_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.listCortexTasksForFinding).not.toHaveBeenCalled();

    const memberStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const memberService = await createService({ store: memberStore });

    await expect(
      memberService.listFindingsForCortexTask({
        taskId: "../task",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(memberStore.listFindingsForCortexTask).not.toHaveBeenCalled();
  });
});

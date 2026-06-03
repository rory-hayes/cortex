import { describe, expect, test, vi } from "vitest";

import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
  TaskPacketSourceType,
  ValidationResultStatus,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importTaskWorkflow = async () => import("./workflow");

type StoredTaskWorkflowRow = {
  approvedAt: Date | null;
  createdAt: Date;
  id: string;
  latestRunCreatedAt: Date | null;
  latestRunId: string | null;
  latestRunLastEventAt: Date | null;
  latestRunMode: TaskPacketMode | null;
  latestRunPrNumber: number | null;
  latestRunPrStatus: PrArtifactStatus | null;
  latestRunRiskFindings: RiskFinding[] | null;
  latestRunRunnerDisplayName: string | null;
  latestRunRunnerId: string | null;
  latestRunState: RunState | null;
  latestRunUpdatedAt: Date | null;
  mode: TaskPacketMode;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  sourceType: TaskPacketSourceType;
  status: "approved" | "draft";
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredValidationResult = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

const packageLockRisk = (): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
});

const createTaskRow = (overrides: Partial<StoredTaskWorkflowRow> = {}): StoredTaskWorkflowRow => ({
  approvedAt: null,
  createdAt: new Date("2026-05-23T10:00:00.000Z"),
  id: "task_1",
  latestRunCreatedAt: null,
  latestRunId: null,
  latestRunLastEventAt: null,
  latestRunMode: null,
  latestRunPrNumber: null,
  latestRunPrStatus: null,
  latestRunRiskFindings: null,
  latestRunRunnerDisplayName: null,
  latestRunRunnerId: null,
  latestRunState: null,
  latestRunUpdatedAt: null,
  mode: "execute",
  repoMappingId: "repo_mapping_1",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  sourceType: "manual",
  status: "draft",
  title: "Review workflow polish",
  updatedAt: new Date("2026-05-23T10:05:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    rows?: StoredTaskWorkflowRow[];
    validationResults?: StoredValidationResult[];
  } = {},
) => ({
  findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
    input.memberships?.some(
      (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
    )
      ? { id: "membership_1", role: "member" }
      : null,
  ),
  listWorkspaceTaskWorkflowRows: vi.fn(async () => input.rows ?? []),
  listWorkspaceTaskWorkflowValidationResults: vi.fn(async () => input.validationResults ?? []),
});

const collectObjectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));

    return keys;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    keys.push(key);
    collectObjectKeys(childValue, keys);
  });

  return keys;
};

const expectNoUnsafeTaskWorkflowMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys = collectObjectKeys(value).map((key) => key.toLowerCase());

  expect(keys).not.toEqual(
    expect.arrayContaining([
      "acceptancecriteria",
      "command",
      "contextfilepaths",
      "diff",
      "localpath",
      "objective",
      "patch",
      "policysnapshot",
      "rawlogs",
      "rawoutput",
      "sourcecode",
      "taskpacket",
      "validationcommands",
    ]),
  );
  expect(serialized).not.toContain("Acceptance criteria raw text");
  expect(serialized).not.toContain("Implement by reading private source");
  expect(serialized).not.toContain("apps/private/context.ts");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane");
  expect(serialized).not.toContain("pnpm test -- --reporter=verbose");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1 +1 @@");
  expect(serialized).not.toContain("const leaked = process.env.SECRET");
  expect(serialized).not.toContain("raw runner log line");
};

describe("task workflow list service", () => {
  test("requires workspace membership before loading task workflow rows", async () => {
    const { createTaskWorkflowService } = await importTaskWorkflow();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      rows: [createTaskRow()],
    });
    const service = createTaskWorkflowService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspaceTaskWorkflow({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.listWorkspaceTaskWorkflowRows).not.toHaveBeenCalled();
  });

  test("buckets draft, queued, running, blocked or failed, awaiting approval, and PR-ready tasks", async () => {
    const { createTaskWorkflowService } = await importTaskWorkflow();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      rows: [
        createTaskRow({ id: "task_draft", status: "draft" }),
        createTaskRow({
          approvedAt: new Date("2026-05-23T10:10:00.000Z"),
          id: "task_queued",
          status: "approved",
        }),
        createTaskRow({
          approvedAt: new Date("2026-05-23T10:10:00.000Z"),
          id: "task_running",
          latestRunId: "run_running",
          latestRunMode: "execute",
          latestRunState: "codex_running",
          latestRunUpdatedAt: new Date("2026-05-23T10:15:00.000Z"),
          status: "approved",
        }),
        createTaskRow({
          approvedAt: new Date("2026-05-23T10:10:00.000Z"),
          id: "task_blocked",
          latestRunId: "run_blocked",
          latestRunMode: "execute",
          latestRunRiskFindings: [packageLockRisk()],
          latestRunState: "blocked",
          latestRunUpdatedAt: new Date("2026-05-23T10:20:00.000Z"),
          status: "approved",
        }),
        createTaskRow({
          approvedAt: new Date("2026-05-23T10:10:00.000Z"),
          id: "task_approval",
          latestRunId: "run_approval",
          latestRunMode: "execute",
          latestRunState: "awaiting_approval",
          latestRunUpdatedAt: new Date("2026-05-23T10:25:00.000Z"),
          status: "approved",
        }),
        createTaskRow({
          approvedAt: new Date("2026-05-23T10:10:00.000Z"),
          id: "task_pr",
          latestRunId: "run_pr",
          latestRunMode: "execute",
          latestRunPrNumber: 42,
          latestRunPrStatus: "open",
          latestRunState: "awaiting_approval",
          latestRunUpdatedAt: new Date("2026-05-23T10:30:00.000Z"),
          status: "approved",
        }),
      ],
      validationResults: [
        { runId: "run_pr", status: "passed", workspaceId: "workspace_1" },
        { runId: "run_blocked", status: "failed", workspaceId: "workspace_1" },
      ],
    });
    const service = createTaskWorkflowService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceTaskWorkflow({ workspaceId: " workspace_1 " });

    expect(result.summary).toEqual({
      awaitingApproval: 1,
      blockedOrFailed: 1,
      drafts: 1,
      prReady: 1,
      queued: 1,
      running: 1,
    });
    expect(result.tasks.map((task) => [task.id, task.workflow.bucket])).toEqual([
      ["task_draft", "draft"],
      ["task_queued", "queued"],
      ["task_running", "running"],
      ["task_blocked", "blocked_failed"],
      ["task_approval", "awaiting_approval"],
      ["task_pr", "pr_ready"],
    ]);
    expect(result.tasks.find((task) => task.id === "task_draft")).toMatchObject({
      workflow: {
        bucket: "draft",
        label: "Ready to approve",
      },
    });
    expect(result.tasks.find((task) => task.id === "task_queued")).toMatchObject({
      workflow: {
        bucket: "queued",
        label: "Queued for runner",
      },
    });
    expect(result.tasks.find((task) => task.id === "task_pr")).toMatchObject({
      latestRun: {
        id: "run_pr",
        pr: {
          number: 42,
          status: "open",
        },
        validationStatusCounts: [{ count: 1, status: "passed" }],
      },
    });
    expectNoUnsafeTaskWorkflowMaterial(result);
  });

  test("returns safe workflow rows without task packet body, context paths, commands, logs, diffs, or local paths", async () => {
    const { createTaskWorkflowService } = await importTaskWorkflow();
    const unsafeRow = {
      ...createTaskRow({
        id: "task_unsafe",
        latestRunId: "run_unsafe",
        latestRunMode: "execute",
        latestRunState: "queued",
        latestRunUpdatedAt: new Date("2026-05-23T10:20:00.000Z"),
        status: "approved",
      }),
      acceptanceCriteria: ["Acceptance criteria raw text"],
      contextFilePaths: ["apps/private/context.ts"],
      diff: "diff --git a/app.ts b/app.ts",
      localPath: "/Users/rory/repos/control-plane",
      objective: "Implement by reading private source",
      patch: "@@ -1 +1 @@",
      policySnapshot: { protectedPaths: ["apps/private/**"] },
      rawLogs: "raw runner log line",
      sourceCode: "const leaked = process.env.SECRET",
      taskPacket: { objective: "Implement by reading private source" },
      validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
    } as unknown as StoredTaskWorkflowRow;
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      rows: [unsafeRow],
    });
    const service = createTaskWorkflowService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceTaskWorkflow({ workspaceId: "workspace_1" });

    expect(result.tasks).toEqual([
      expect.objectContaining({
        id: "task_unsafe",
        latestRun: expect.objectContaining({
          id: "run_unsafe",
        }),
        title: "Review workflow polish",
      }),
    ]);
    expectNoUnsafeTaskWorkflowMaterial(result);
  });
});

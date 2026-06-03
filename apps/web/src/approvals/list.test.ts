import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
  ValidationResultStatus,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importApprovalList = async () => import("./list");

const readApprovalListSource = () => readFile(new URL("./list.ts", import.meta.url), "utf8");

type StoredApprovalRun = {
  dryRunBlockerCount: number | null;
  dryRunStatus: "failed" | "passed" | "warning" | null;
  dryRunWarningCount: number | null;
  id: string;
  lastEventAt: Date | null;
  mode: TaskPacketMode;
  prChangedFilePaths: string[] | null;
  prNumber: number | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
  prTitle: string | null;
  prUrl: string | null;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: RiskFinding[];
  runnerDisplayName: string | null;
  runnerId: string | null;
  state: RunState;
  taskId: string;
  taskTitle: string;
  updatedAt: Date;
  workspaceId: string;
};

type StoredValidationResult = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

type StoredRepairRequest = {
  attempt: number;
  createdAt: Date;
  maxAttempts: number;
  previousRunId: string;
  workspaceId: string;
};

const packageLockRisk = (): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
});

const createApprovalRun = (overrides: Partial<StoredApprovalRun> = {}): StoredApprovalRun => ({
  dryRunBlockerCount: 0,
  dryRunStatus: "passed",
  dryRunWarningCount: 0,
  id: "run_1",
  lastEventAt: new Date("2026-05-23T10:30:00.000Z"),
  mode: "execute",
  prChangedFilePaths: ["apps/web/app/runs/page.tsx"],
  prNumber: 42,
  prRiskFindings: [packageLockRisk()],
  prStatus: "open",
  prTitle: "TASK-167: Polish review screens",
  prUrl: "https://github.com/rory/control-plane/pull/42",
  repoMappingId: "repo_mapping_1",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  riskFindings: [],
  runnerDisplayName: "Mac Studio",
  runnerId: "runner_1",
  state: "awaiting_approval",
  taskId: "task_1",
  taskTitle: "Polish review screens",
  updatedAt: new Date("2026-05-23T10:25:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repairRequests?: StoredRepairRequest[];
    runs?: StoredApprovalRun[];
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
  listWorkspaceApprovalRepairRequests: vi.fn(async () => input.repairRequests ?? []),
  listWorkspaceApprovalRuns: vi.fn(async () => input.runs ?? []),
  listWorkspaceApprovalValidationResults: vi.fn(async () => input.validationResults ?? []),
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

const expectNoUnsafeApprovalListMaterial = (value: unknown) => {
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
      "rawlogs",
      "rawoutput",
      "sourcecode",
      "taskpacket",
      "validationcommands",
    ]),
  );
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1 +1 @@");
  expect(serialized).not.toContain("const leaked = process.env.SECRET");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane");
  expect(serialized).not.toContain("raw runner log line");
};

describe("approval queue list service", () => {
  test("requires a verified workspace membership before loading approval rows", async () => {
    const { createApprovalQueueService } = await importApprovalList();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runs: [createApprovalRun()],
    });
    const service = createApprovalQueueService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspaceApprovals({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.listWorkspaceApprovalRuns).not.toHaveBeenCalled();
  });

  test("returns awaiting approval runs with derived evidence counts and no raw artifacts", async () => {
    const { createApprovalQueueService } = await importApprovalList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createApprovalRun({
          riskFindings: [
            {
              category: "large_diff",
              id: "risk:large_diff",
              message: "Large change.",
              paths: [],
              severity: "warning",
            },
          ],
        }),
        createApprovalRun({
          id: "run_hidden",
          taskTitle: "Hidden run",
          workspaceId: "workspace_2",
        }),
      ],
      validationResults: [
        { runId: "run_1", status: "passed", workspaceId: "workspace_1" },
        { runId: "run_1", status: "skipped", workspaceId: "workspace_1" },
        { runId: "run_hidden", status: "failed", workspaceId: "workspace_2" },
      ],
    });
    const service = createApprovalQueueService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceApprovals({ workspaceId: " workspace_1 " });

    expect(result).toEqual([
      {
        evidence: {
          blockerCount: 0,
          changedFileCount: 1,
          riskCategoryCounts: [
            { category: "large_diff", count: 1 },
            { category: "package_lock", count: 1 },
          ],
          reviewReady: true,
          validationStatusCounts: [
            { count: 1, status: "passed" },
            { count: 1, status: "skipped" },
          ],
          warningCount: 2,
        },
        id: "run_1",
        mode: "execute",
        pr: {
          number: 42,
          status: "open",
          title: "TASK-167: Polish review screens",
          url: "https://github.com/rory/control-plane/pull/42",
        },
        repoMapping: {
          id: "repo_mapping_1",
          repositoryName: "control-plane",
          repositoryOwner: "rory",
        },
        runner: {
          displayName: "Mac Studio",
          id: "runner_1",
        },
        repair: {
          attemptCount: 0,
          latestRequestedAt: null,
          maxAttempts: null,
        },
        state: "awaiting_approval",
        task: {
          id: "task_1",
          title: "Polish review screens",
        },
        updatedAt: new Date("2026-05-23T10:30:00.000Z"),
      },
    ]);
    expect(store.listWorkspaceApprovalRuns).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expectNoUnsafeApprovalListMaterial(result);
  });

  test("Drizzle approval query lists only awaiting approval runs", async () => {
    const source = await readApprovalListSource();

    expect(source).toContain("inArray(schema.runs.state");
    expect(source).toContain('"awaiting_approval"');
    expect(source).not.toContain('"blocked"');
  });

  test("keeps incomplete evidence visible without decision-ready status", async () => {
    const { createApprovalQueueService } = await importApprovalList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createApprovalRun({
          dryRunStatus: null,
          prChangedFilePaths: [],
          prNumber: null,
          prRiskFindings: null,
          prStatus: null,
          prTitle: null,
          prUrl: null,
        }),
      ],
      validationResults: [],
    });
    const service = createApprovalQueueService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceApprovals({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        evidence: expect.objectContaining({
          changedFileCount: 0,
          reviewReady: false,
          validationStatusCounts: [],
        }),
        pr: null,
        repair: {
          attemptCount: 0,
          latestRequestedAt: null,
          maxAttempts: null,
        },
      }),
    ]);
  });

  test("summarizes repair attempt metadata without exposing feedback text", async () => {
    const { createApprovalQueueService } = await importApprovalList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repairRequests: [
        {
          attempt: 1,
          createdAt: new Date("2026-05-23T10:40:00.000Z"),
          maxAttempts: 2,
          previousRunId: "run_1",
          workspaceId: "workspace_1",
        },
        {
          attempt: 2,
          createdAt: new Date("2026-05-23T11:00:00.000Z"),
          maxAttempts: 2,
          previousRunId: "run_1",
          workspaceId: "workspace_1",
        },
        {
          attempt: 1,
          createdAt: new Date("2026-05-23T11:05:00.000Z"),
          maxAttempts: 2,
          previousRunId: "run_hidden",
          workspaceId: "workspace_2",
        },
      ],
      runs: [createApprovalRun()],
      validationResults: [{ runId: "run_1", status: "passed", workspaceId: "workspace_1" }],
    });
    const service = createApprovalQueueService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceApprovals({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        repair: {
          attemptCount: 2,
          latestRequestedAt: new Date("2026-05-23T11:00:00.000Z"),
          maxAttempts: 2,
        },
      }),
    ]);
  });
});

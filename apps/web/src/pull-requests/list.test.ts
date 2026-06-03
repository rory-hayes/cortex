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

const importPullRequestList = async () => import("./list");

type StoredPullRequest = {
  branchName: string;
  changedFilePaths: string[];
  createdAt: Date;
  githubChecksSummary: {
    conclusion: "failing" | "passing" | "pending" | "unknown";
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    skippedCount: number;
    totalCount: number;
  };
  githubReviewState: "approved" | "changes_requested" | "review_required" | "unknown";
  githubSyncedAt: Date | null;
  id: string;
  prNumber: number;
  prStatus: PrArtifactStatus;
  prTitle: string;
  prUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: RiskFinding[];
  runId: string;
  runMode: TaskPacketMode;
  runRiskFindings: RiskFinding[];
  runState: RunState;
  runnerDisplayName: string | null;
  runnerId: string | null;
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

const packageLockRisk = (): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
});

const createPullRequest = (overrides: Partial<StoredPullRequest> = {}): StoredPullRequest => ({
  branchName: "aicp/task-167-polish-review-pages",
  changedFilePaths: ["apps/web/app/runs/page.tsx", "apps/web/components/run-table.tsx"],
  createdAt: new Date("2026-05-23T10:25:00.000Z"),
  githubChecksSummary: {
    conclusion: "passing",
    failedCount: 0,
    passedCount: 2,
    pendingCount: 0,
    skippedCount: 1,
    totalCount: 3,
  },
  githubReviewState: "approved",
  githubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
  id: "pr_artifact_1",
  prNumber: 42,
  prStatus: "open",
  prTitle: "TASK-167: Polish review pages",
  prUrl: "https://github.com/rory/control-plane/pull/42",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  riskFindings: [packageLockRisk()],
  runId: "run_1",
  runMode: "execute",
  runRiskFindings: [],
  runState: "awaiting_approval",
  runnerDisplayName: "Mac Studio",
  runnerId: "runner_1",
  taskId: "task_1",
  taskTitle: "Polish review pages",
  updatedAt: new Date("2026-05-23T10:30:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    pullRequests?: StoredPullRequest[];
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
  listWorkspacePullRequests: vi.fn(async () => input.pullRequests ?? []),
  listWorkspacePullRequestValidationResults: vi.fn(async () => input.validationResults ?? []),
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

const expectNoUnsafePullRequestMaterial = (value: unknown) => {
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

describe("pull request list service", () => {
  test("requires workspace membership before listing stored PR artifacts", async () => {
    const { createPullRequestListService } = await importPullRequestList();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      pullRequests: [createPullRequest()],
    });
    const service = createPullRequestListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspacePullRequests({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.listWorkspacePullRequests).not.toHaveBeenCalled();
  });

  test("returns stored PR artifact metadata with run, branch, changed path, and risk summaries only", async () => {
    const { createPullRequestListService } = await importPullRequestList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      pullRequests: [
        createPullRequest({
          runRiskFindings: [
            {
              category: "large_diff",
              id: "risk:large_diff",
              message: "Large change.",
              paths: [],
              severity: "warning",
            },
          ],
        }),
        createPullRequest({
          id: "pr_hidden",
          runId: "run_hidden",
          workspaceId: "workspace_2",
        }),
      ],
      validationResults: [
        { runId: "run_1", status: "passed", workspaceId: "workspace_1" },
        { runId: "run_1", status: "skipped", workspaceId: "workspace_1" },
        { runId: "run_hidden", status: "failed", workspaceId: "workspace_2" },
      ],
    });
    const service = createPullRequestListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspacePullRequests({ workspaceId: " workspace_1 " });

    expect(result).toEqual([
      {
        branchName: "aicp/task-167-polish-review-pages",
        changedFileCount: 2,
        changedFilePaths: ["apps/web/app/runs/page.tsx", "apps/web/components/run-table.tsx"],
        checks: {
          conclusion: "passing",
          failedCount: 0,
          passedCount: 2,
          pendingCount: 0,
          skippedCount: 1,
          totalCount: 3,
        },
        createdAt: new Date("2026-05-23T10:25:00.000Z"),
        githubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
        id: "pr_artifact_1",
        number: 42,
        repository: {
          name: "control-plane",
          owner: "rory",
        },
        risk: {
          blockerCount: 0,
          categoryCounts: [
            { category: "large_diff", count: 1 },
            { category: "package_lock", count: 1 },
          ],
          warningCount: 2,
        },
        run: {
          id: "run_1",
          mode: "execute",
          state: "awaiting_approval",
        },
        runner: {
          displayName: "Mac Studio",
          id: "runner_1",
        },
        reviewState: "approved",
        status: "open",
        task: {
          id: "task_1",
          title: "Polish review pages",
        },
        title: "TASK-167: Polish review pages",
        updatedAt: new Date("2026-05-23T10:30:00.000Z"),
        url: "https://github.com/rory/control-plane/pull/42",
        validationStatusCounts: [
          { count: 1, status: "passed" },
          { count: 1, status: "skipped" },
        ],
      },
    ]);
    expect(store.listWorkspacePullRequests).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWorkspacePullRequestValidationResults).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expectNoUnsafePullRequestMaterial(result);
  });

  test("hides unsafe PR artifact URLs and text without dropping the stored metadata row", async () => {
    const { createPullRequestListService } = await importPullRequestList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      pullRequests: [
        createPullRequest({
          branchName: "/Users/rory/repos/control-plane",
          prTitle: "const leaked = process.env.SECRET;",
          prUrl: "https://user:password@github.com/rory/control-plane/pull/42",
        }),
      ],
    });
    const service = createPullRequestListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspacePullRequests({ workspaceId: "workspace_1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        branchName: "Branch unavailable",
        title: "Pull request #42",
        url: null,
      }),
    ]);
  });

  test("filters unsafe changed path metadata before exposing PR rows", async () => {
    const { createPullRequestListService } = await importPullRequestList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      pullRequests: [
        createPullRequest({
          changedFilePaths: [
            "apps/web/components/pull-request-table.tsx",
            ".env.local",
            "/Users/rory/repos/control-plane/apps/web/secret.ts",
            "src/index.ts\nexport const leakedValue = true;",
          ],
        }),
      ],
    });
    const service = createPullRequestListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspacePullRequests({ workspaceId: "workspace_1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        checks: {
          conclusion: "passing",
          failedCount: 0,
          passedCount: 2,
          pendingCount: 0,
          skippedCount: 1,
          totalCount: 3,
        },
        githubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
        reviewState: "approved",
        changedFileCount: 1,
        changedFilePaths: ["apps/web/components/pull-request-table.tsx"],
      }),
    ]);
  });

  test("defaults malformed GitHub review, check, and sync metadata to unknown values", async () => {
    const { createPullRequestListService } = await importPullRequestList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      pullRequests: [
        createPullRequest({
          githubChecksSummary: {
            conclusion: "passing",
            failedCount: -1,
            passedCount: Number.NaN,
            pendingCount: 0,
            skippedCount: 0,
            totalCount: -3,
          },
          githubReviewState: "raw" as StoredPullRequest["githubReviewState"],
          githubSyncedAt: new Date("invalid"),
        }),
      ],
    });
    const service = createPullRequestListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspacePullRequests({ workspaceId: "workspace_1" }),
    ).resolves.toEqual([
      expect.objectContaining({
        checks: {
          conclusion: "unknown",
          failedCount: 0,
          passedCount: 0,
          pendingCount: 0,
          skippedCount: 0,
          totalCount: 0,
        },
        githubSyncedAt: null,
        reviewState: "unknown",
      }),
    ]);
  });
});

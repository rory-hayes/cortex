import { describe, expect, test, vi } from "vitest";

import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRunList = async () => import("./list");

type StoredRun = {
  changedPaths: string[];
  createdAt: Date;
  id: string;
  lastEventAt: Date | null;
  prChangedFilePaths: string[] | null;
  mode: TaskPacketMode;
  prNumber: number | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
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
  status: "cancelled" | "failed" | "passed" | "skipped";
  workspaceId: string;
};

const createRun = (overrides: Partial<StoredRun> = {}): StoredRun => ({
  changedPaths: ["apps/web/app/runs/page.tsx"],
  createdAt: new Date("2026-05-23T10:00:00.000Z"),
  id: "run_1",
  lastEventAt: new Date("2026-05-23T10:30:00.000Z"),
  mode: "execute",
  prChangedFilePaths: ["apps/web/components/run-table.tsx", "apps/web/src/runs/list.ts"],
  prNumber: 42,
  prRiskFindings: [
    {
      category: "package_lock",
      id: "risk:package_lock",
      message: "Package lock changed.",
      paths: ["pnpm-lock.yaml"],
      severity: "warning",
    },
  ],
  prStatus: "open",
  prUrl: "https://github.com/rory/control-plane/pull/42",
  riskFindings: [],
  repoMappingId: "repo_mapping_1",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerDisplayName: "Mac Studio",
  runnerId: "runner_1",
  state: "pr_opened",
  taskId: "task_1",
  taskTitle: "Add run list page",
  updatedAt: new Date("2026-05-23T10:15:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    runs?: StoredRun[];
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
  listWorkspaceRuns: vi.fn(async () => input.runs ?? []),
  listWorkspaceRunValidationResults: vi.fn(async () => input.validationResults ?? []),
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

const expectNoUnsafeRunListMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys = collectObjectKeys(value).map((key) => key.toLowerCase());

  expect(keys).not.toEqual(
    expect.arrayContaining([
      "acceptancecriteria",
      "changedpaths",
      "contextfilepaths",
      "credentials",
      "diff",
      "localpath",
      "logs",
      "objective",
      "patch",
      "policysnapshot",
      "rawlogs",
      "rawoutput",
      "riskfindings",
      "snippet",
      "source",
      "sourcecode",
      "taskpacket",
      "validationcommands",
    ]),
  );
  expect(serialized).not.toContain("Implement the page by reading src/private.ts");
  expect(serialized).not.toContain("Acceptance criteria raw text");
  expect(serialized).not.toContain("apps/web/src/private.ts");
  expect(serialized).not.toContain("pnpm test -- --reporter=verbose");
  expect(serialized).not.toContain("src/changed-file.ts");
  expect(serialized).not.toContain("/Users/rory/repos/control-plane");
  expect(serialized).not.toContain("credential_hash_value");
  expect(serialized).not.toContain("diff --git a/app.ts b/app.ts");
  expect(serialized).not.toContain("@@ -1 +1 @@");
  expect(serialized).not.toContain("const leaked = process.env.SECRET");
  expect(serialized).not.toContain("raw runner log line");
};

describe("run list service", () => {
  test("rejects unauthenticated users before row access", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.listWorkspaceRuns).not.toHaveBeenCalled();
  });

  test("rejects authenticated non-members before row access", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceRuns).not.toHaveBeenCalled();
  });

  test("rejects blank workspace ids before row access", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [createRun()],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: "  " })).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.findWorkspaceMembership).not.toHaveBeenCalled();
    expect(store.listWorkspaceRuns).not.toHaveBeenCalled();
  });

  test("returns only runs for the verified workspace when the store returns mixed rows", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createRun({ id: "run_visible", workspaceId: "workspace_1" }),
        createRun({
          id: "run_hidden",
          repositoryName: "other-repo",
          repositoryOwner: "other-owner",
          taskTitle: "Hidden task",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: " workspace_1 " })).resolves.toEqual([
      {
        id: "run_visible",
        mode: "execute",
        pr: {
          number: 42,
          status: "open",
          url: "https://github.com/rory/control-plane/pull/42",
        },
        repoMapping: {
          id: "repo_mapping_1",
          repositoryName: "control-plane",
          repositoryOwner: "rory",
        },
        review: {
          blockerCount: 0,
          changedFileCount: 2,
          prReady: false,
          riskCategoryCounts: [{ category: "package_lock", count: 1 }],
          stateBucket: "running",
          validationStatusCounts: [],
          warningCount: 1,
        },
        runner: {
          displayName: "Mac Studio",
          id: "runner_1",
        },
        state: "pr_opened",
        task: {
          id: "task_1",
          title: "Add run list page",
        },
        updatedAt: new Date("2026-05-23T10:30:00.000Z"),
      },
    ]);
    expect(store.listWorkspaceRuns).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
  });

  test("returns safe metadata only and omits task packets, raw execution fields, paths, logs, and credentials", async () => {
    const { createRunListService } = await importRunList();
    const unsafeStoredRun = {
      ...createRun({
        lastEventAt: null,
        prNumber: null,
        prChangedFilePaths: null,
        prRiskFindings: null,
        prStatus: null,
        prUrl: null,
        riskFindings: [
          {
            category: "protected_path",
            id: "risk:protected_path",
            message: "Protected path changed.",
            paths: ["infra/main.tf"],
            severity: "blocked",
          },
        ],
        runnerDisplayName: null,
        runnerId: null,
        state: "queued",
      }),
      acceptanceCriteria: ["Acceptance criteria raw text"],
      changedPaths: ["src/changed-file.ts"],
      contextFilePaths: ["apps/web/src/private.ts"],
      credentials: "credential_hash_value",
      diff: "diff --git a/app.ts b/app.ts",
      localPath: "/Users/rory/repos/control-plane",
      objective: "Implement the page by reading src/private.ts",
      patch: "@@ -1 +1 @@",
      policySnapshot: { protectedPaths: ["src/private.ts"] },
      rawLogs: "raw runner log line",
      rawRiskFindings: [{ category: "secret" }],
      snippet: "const leaked = process.env.SECRET",
      sourceCode: "const leaked = process.env.SECRET",
      taskPacket: { objective: "Implement the page by reading src/private.ts" },
      validationCommands: [{ command: "pnpm test -- --reporter=verbose" }],
    } as unknown as StoredRun;
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [unsafeStoredRun],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceRuns({ workspaceId: "workspace_1" });

    expect(result).toEqual([
      {
        id: "run_1",
        mode: "execute",
        pr: null,
        repoMapping: {
          id: "repo_mapping_1",
          repositoryName: "control-plane",
          repositoryOwner: "rory",
        },
        review: {
          blockerCount: 1,
          changedFileCount: 1,
          prReady: false,
          riskCategoryCounts: [{ category: "protected_path", count: 1 }],
          stateBucket: "ready",
          validationStatusCounts: [],
          warningCount: 0,
        },
        runner: null,
        state: "queued",
        task: {
          id: "task_1",
          title: "Add run list page",
        },
        updatedAt: new Date("2026-05-23T10:15:00.000Z"),
      },
    ]);
    expectNoUnsafeRunListMaterial(result);
  });

  test("exposes PR links only for http or https URLs without embedded credentials", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createRun({
          id: "run_safe",
          prNumber: 7,
          prStatus: "draft",
          prUrl: "https://github.com/rory/control-plane/pull/7",
        }),
        createRun({
          id: "run_credentials",
          prNumber: 8,
          prStatus: "open",
          prUrl: "https://user:password@github.com/rory/control-plane/pull/8",
        }),
        createRun({
          id: "run_non_http",
          prNumber: 9,
          prStatus: "closed",
          prUrl: "ssh://git@github.com/rory/control-plane/pull/9",
        }),
      ],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        id: "run_safe",
        pr: {
          number: 7,
          status: "draft",
          url: "https://github.com/rory/control-plane/pull/7",
        },
      }),
      expect.objectContaining({
        id: "run_credentials",
        pr: {
          number: 8,
          status: "open",
          url: null,
        },
      }),
      expect.objectContaining({
        id: "run_non_http",
        pr: {
          number: 9,
          status: "closed",
          url: null,
        },
      }),
    ]);
  });

  test("omits PR links with secret-bearing query parameters", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createRun({
          id: "run_token_query",
          prNumber: 10,
          prStatus: "open",
          prUrl: "https://github.com/rory/control-plane/pull/10?token=hunter2",
        }),
        createRun({
          id: "run_secret_query",
          prNumber: 11,
          prStatus: "open",
          prUrl: "https://github.com/rory/control-plane/pull/11?client_secret=hunter2",
        }),
      ],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceRuns({ workspaceId: "workspace_1" });

    expect(result).toEqual([
      expect.objectContaining({
        id: "run_token_query",
        pr: {
          number: 10,
          status: "open",
          url: null,
        },
      }),
      expect.objectContaining({
        id: "run_secret_query",
        pr: {
          number: 11,
          status: "open",
          url: null,
        },
      }),
    ]);
    expect(JSON.stringify(result)).not.toContain("hunter2");
  });

  test("derives review scan metadata from stored changed paths and risk findings only", async () => {
    const { createRunListService } = await importRunList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runs: [
        createRun({
          changedPaths: ["apps/web/app/page.tsx", "packages/shared/src/index.ts"],
          id: "run_ready",
          prChangedFilePaths: ["apps/web/app/page.tsx", "apps/web/components/run-table.tsx"],
          prRiskFindings: [
            {
              category: "package_lock",
              id: "risk:package_lock",
              message: "Package lock changed.",
              paths: ["pnpm-lock.yaml"],
              severity: "warning",
            },
          ],
          riskFindings: [
            {
              category: "large_diff",
              id: "risk:large_diff",
              message: "Large change.",
              paths: [],
              severity: "warning",
            },
          ],
          state: "awaiting_approval",
        }),
      ],
      validationResults: [
        { runId: "run_ready", status: "passed", workspaceId: "workspace_1" },
        { runId: "run_ready", status: "skipped", workspaceId: "workspace_1" },
        { runId: "run_hidden", status: "failed", workspaceId: "workspace_2" },
      ],
    });
    const service = createRunListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRuns({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        id: "run_ready",
        review: {
          blockerCount: 0,
          changedFileCount: 3,
          prReady: true,
          riskCategoryCounts: [
            { category: "large_diff", count: 1 },
            { category: "package_lock", count: 1 },
          ],
          stateBucket: "pr_ready",
          validationStatusCounts: [
            { count: 1, status: "passed" },
            { count: 1, status: "skipped" },
          ],
          warningCount: 2,
        },
      }),
    ]);
    expect(store.listWorkspaceRunValidationResults).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
  });
});

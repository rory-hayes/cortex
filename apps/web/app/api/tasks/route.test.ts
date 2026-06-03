import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION } from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createDrizzleManualTaskStore: vi.fn(),
  createManualTask: vi.fn(),
  createManualTaskService: vi.fn(),
  getDatabase: vi.fn(),
  listManualTasks: vi.fn(),
  toManualTaskData: vi.fn((row: Record<string, unknown>) => ({
    acceptanceCriteria: row.acceptanceCriteria,
    approvedAt: row.approvedAt,
    contextFilePaths: row.contextFilePaths,
    contractVersion: row.contractVersion,
    createdAt: row.createdAt,
    externalId: row.externalId,
    externalUrl: row.externalUrl,
    id: row.id,
    mode: row.mode,
    objective: row.objective,
    repoMappingId: row.repoMappingId,
    requestedByActorId: row.requestedByActorId,
    sourceType: row.sourceType,
    status: row.status,
    title: row.title,
    updatedAt: row.updatedAt,
    workspaceId: row.workspaceId,
  })),
}));

vi.mock("../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../src/tasks/manual-tasks", () => ({
  createDrizzleManualTaskStore: mocks.createDrizzleManualTaskStore,
  createManualTaskService: mocks.createManualTaskService,
  toManualTaskData: mocks.toManualTaskData,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const task = {
  acceptanceCriteria: ["Draft task is stored."],
  approvedAt: null,
  contextFilePaths: ["apps/web/src/tasks/manual-tasks.ts"],
  contractVersion: CONTRACT_VERSION,
  createdAt: new Date("2026-05-23T10:00:00.000Z"),
  externalId: "manual-ticket-1",
  externalUrl: "https://tracker.example/tasks/manual-ticket-1",
  id: "task_1",
  mode: "execute",
  objective: "Create a draft task.",
  policySnapshot: null,
  repoMappingId: "repo_mapping_1",
  requestedByActorId: "user_1",
  sourceType: "manual",
  status: "draft",
  title: "Manual task",
  updatedAt: new Date("2026-05-23T10:00:00.000Z"),
  validationCommands: null,
  workspaceId: "workspace_1",
};

const serializableTask = {
  acceptanceCriteria: task.acceptanceCriteria,
  approvedAt: task.approvedAt,
  contextFilePaths: task.contextFilePaths,
  contractVersion: task.contractVersion,
  createdAt: "2026-05-23T10:00:00.000Z",
  externalId: task.externalId,
  externalUrl: task.externalUrl,
  id: task.id,
  mode: task.mode,
  objective: task.objective,
  repoMappingId: task.repoMappingId,
  requestedByActorId: task.requestedByActorId,
  sourceType: task.sourceType,
  status: task.status,
  title: task.title,
  updatedAt: "2026-05-23T10:00:00.000Z",
  workspaceId: task.workspaceId,
};

const validPostBody = {
  workspaceId: "workspace_1",
  repoMappingId: "repo_mapping_1",
  title: "Manual task",
  objective: "Create a draft task.",
  acceptanceCriteria: ["Draft task is stored."],
  mode: "dryRun",
  source: {
    externalId: "manual-ticket-1",
    url: "https://tracker.example/tasks/manual-ticket-1",
  },
  contextFilePaths: ["apps/web/src/tasks/manual-tasks.ts"],
};

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/tasks", {
      body: JSON.stringify(body),
      method: "POST",
    }),
  );
};

const get = async (search = "") => {
  const { GET } = await importRoute();

  return GET(new Request(`https://control-plane.test/api/tasks${search}`));
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleManualTaskStore.mockReturnValue({ kind: "test-store" });
  mocks.createManualTaskService.mockReturnValue({
    createManualTask: mocks.createManualTask,
    listManualTasks: mocks.listManualTasks,
  });
  mocks.createManualTask.mockResolvedValue(task);
  mocks.listManualTasks.mockResolvedValue([task]);
});

describe("POST /api/tasks", () => {
  test("returns generic 400 for invalid JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://control-plane.test/api/tasks", {
        body: "{",
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(mocks.createManualTask).not.toHaveBeenCalled();
  });

  test("rejects unsafe payloads before service calls without echoing raw input", async () => {
    const unsafeValue = `${"ghp_"}${"a".repeat(32)}`;
    const response = await post({
      ...validPostBody,
      rawOutput: `command output ${unsafeValue}`,
    });
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain(unsafeValue);
    expect(responseText).not.toMatch(/rawOutput|Zod|command output/i);
    expect(mocks.createManualTask).not.toHaveBeenCalled();
  });

  test.each([
    ["file tree", { fileTree: ["src/app.ts"] }, /fileTree|src\/app\.ts/i],
    [
      "dependency graph",
      { dependencyGraph: { "src/app.ts": ["src/db.ts"] } },
      /dependencyGraph|src\/app\.ts|src\/db\.ts/i,
    ],
  ])(
    "rejects unsafe graph payloads before service calls: %s",
    async (_caseName, override, leak) => {
      const response = await post({
        ...validPostBody,
        ...override,
      });
      const responseText = await response.text();

      expect(response.status).toBe(400);
      expect(JSON.parse(responseText)).toEqual({
        error: {
          code: "validation_error",
          message: "Check the submitted fields and try again.",
        },
        ok: false,
      });
      expect(responseText).not.toMatch(leak);
      expect(mocks.createManualTask).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["diff hunk", { objective: "@@ -1,2 +1,3 @@\n+leak" }, /@@ -1,2 \+1,3 @@/],
    [
      "private key",
      { objective: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----" },
      /PRIVATE KEY/,
    ],
    [
      "source-like snippet",
      { objective: "function leak() { return process.env.SECRET; }" },
      /function leak|process\.env\.SECRET/,
    ],
    ["single-line call snippet", { objective: 'console.log("x");' }, /console\.log/],
    ["single-line control-flow snippet", { objective: "if (enabled) { doWork(); }" }, /doWork/],
    ["bearer token", { objective: `Bearer ${"a".repeat(40)}` }, /Bearer [a-z]{40}/],
  ])("rejects unsafe text payloads before service calls: %s", async (_caseName, override, leak) => {
    const response = await post({
      ...validPostBody,
      ...override,
    });
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(leak);
    expect(mocks.createManualTask).not.toHaveBeenCalled();
  });

  test("creates a manual task and returns a no-store success envelope", async () => {
    const response = await post(validPostBody);

    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        task: serializableTask,
      },
      ok: true,
    });
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzleManualTaskStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createManualTask).toHaveBeenCalledWith(validPostBody);
  });

  test("strips task packet policy and validation command internals from created task responses", async () => {
    mocks.createManualTask.mockResolvedValueOnce({
      ...task,
      policySnapshot: {
        protectedPaths: ["apps/web/src/**"],
      },
      validationCommands: [
        {
          command: "pnpm test -- --runInBand",
          id: "test",
          label: "Test",
          required: true,
          timeoutSeconds: 60,
        },
      ],
    });

    const response = await post(validPostBody);
    const responseText = await response.text();

    expect(response.status).toBe(201);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        task: serializableTask,
      },
      ok: true,
    });
    expect(responseText).not.toMatch(/policySnapshot|validationCommands|protectedPaths|pnpm test/);
  });

  test("maps service auth and scope errors to safe envelopes", async () => {
    const { createActionError } = await import("../../../src/server/errors");

    mocks.createManualTask.mockRejectedValueOnce(createActionError("unauthenticated"));
    const unauthenticated = await post(validPostBody);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
      ok: false,
    });

    mocks.createManualTask.mockRejectedValueOnce(createActionError("forbidden"));
    const forbidden = await post(validPostBody);
    expect(forbidden.status).toBe(403);
    await expect(forbidden.json()).resolves.toEqual({
      error: {
        code: "forbidden",
        message: "You do not have access to this workspace.",
      },
      ok: false,
    });
  });

  test("does not log request bodies or task metadata in route source", async () => {
    const source = await readRouteSource();

    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/body.*console|title.*console|objective.*console/i);
  });
});

describe("GET /api/tasks", () => {
  test("requires workspaceId before calling the service", async () => {
    const response = await get();

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(mocks.listManualTasks).not.toHaveBeenCalled();
  });

  test("lists manual tasks with optional repo mapping and bounded limit", async () => {
    const response = await get("?workspaceId=workspace_1&repoMappingId=repo_mapping_1&limit=2");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        tasks: [serializableTask],
      },
      ok: true,
    });
    expect(mocks.listManualTasks).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
      repoMappingId: "repo_mapping_1",
      limit: 2,
    });
  });

  test("lists manual tasks with only workspace scope when optional filters are omitted", async () => {
    const response = await get("?workspaceId=workspace_1");

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        tasks: [serializableTask],
      },
      ok: true,
    });
    expect(mocks.listManualTasks).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
  });

  test("strips task packet policy and validation command internals from list responses", async () => {
    mocks.listManualTasks.mockResolvedValueOnce([
      {
        ...task,
        policySnapshot: {
          sensitivePaths: [".env"],
        },
        validationCommands: [
          {
            command: "pnpm run typecheck",
            id: "typecheck",
            label: "Typecheck",
            required: true,
            timeoutSeconds: 60,
          },
        ],
      },
    ]);

    const response = await get("?workspaceId=workspace_1");
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: {
        tasks: [serializableTask],
      },
      ok: true,
    });
    expect(responseText).not.toMatch(/policySnapshot|validationCommands|sensitivePaths|typecheck/);
  });

  test("rejects invalid limits before calling the service", async () => {
    const response = await get("?workspaceId=workspace_1&limit=not-a-number");

    expect(response.status).toBe(400);
    expect(mocks.listManualTasks).not.toHaveBeenCalled();
  });

  test("maps service errors to safe envelopes", async () => {
    const { createActionError } = await import("../../../src/server/errors");

    mocks.listManualTasks.mockRejectedValueOnce(createActionError("validation_error"));
    const response = await get("?workspaceId=workspace_1&repoMappingId=repo_mapping_hidden");
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("repo_mapping_hidden");
  });
});

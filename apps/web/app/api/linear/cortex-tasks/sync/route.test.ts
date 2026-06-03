import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createDrizzleLinearTaskSyncStore: vi.fn(),
  createLinearTaskSyncService: vi.fn(),
  getDatabase: vi.fn(),
  syncCortexTaskToLinear: vi.fn(),
}));

vi.mock("../../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../../src/linear/task-sync", () => ({
  createDrizzleLinearTaskSyncStore: mocks.createDrizzleLinearTaskSyncStore,
  createLinearTaskSyncService: mocks.createLinearTaskSyncService,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validPostBody = {
  linearConnectionId: "linear_connection_1",
  projectId: "linear_project_1",
  statusId: "linear_state_todo",
  taskId: "cortex_task_1",
  teamId: "linear_team_1",
  workspaceId: "workspace_1",
};

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/linear/cortex-tasks/sync", {
      body: JSON.stringify(body),
      method: "POST",
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleLinearTaskSyncStore.mockReturnValue({ kind: "test-store" });
  mocks.createLinearTaskSyncService.mockReturnValue({
    syncCortexTaskToLinear: mocks.syncCortexTaskToLinear,
  });
  mocks.syncCortexTaskToLinear.mockResolvedValue({
    action: "created",
    externalLinkCount: 1,
    issueIdentifier: "ENG-222",
    issueId: "linear_issue_222",
    linearConnectionId: "linear_connection_1",
    status: "Todo",
    taskId: "cortex_task_1",
    workspaceId: "workspace_1",
  });
});

describe("POST /api/linear/cortex-tasks/sync", () => {
  test("returns generic 400 for invalid JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://control-plane.test/api/linear/cortex-tasks/sync", {
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
    expect(mocks.syncCortexTaskToLinear).not.toHaveBeenCalled();
  });

  test("syncs a Cortex Task to Linear and returns a no-store safe envelope", async () => {
    const response = await post({
      linearConnectionId: " linear_connection_1 ",
      projectId: " linear_project_1 ",
      statusId: " linear_state_todo ",
      taskId: " cortex_task_1 ",
      teamId: " linear_team_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    await expect(response.json()).resolves.toEqual({
      data: {
        action: "created",
        externalLinkCount: 1,
        issueIdentifier: "ENG-222",
        issueId: "linear_issue_222",
        linearConnectionId: "linear_connection_1",
        status: "Todo",
        taskId: "cortex_task_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzleLinearTaskSyncStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(mocks.syncCortexTaskToLinear).toHaveBeenCalledWith(validPostBody);
  });

  test("allows optional project and status ids to be omitted", async () => {
    const response = await post({
      linearConnectionId: "linear_connection_1",
      taskId: "cortex_task_1",
      teamId: "linear_team_1",
      workspaceId: "workspace_1",
    });

    expect(response.status).toBe(200);
    expect(mocks.syncCortexTaskToLinear).toHaveBeenCalledWith({
      linearConnectionId: "linear_connection_1",
      taskId: "cortex_task_1",
      teamId: "linear_team_1",
      workspaceId: "workspace_1",
    });
  });

  test.each([
    { field: "diff", value: "diff --git a/app.ts b/app.ts" },
    { field: "patch", value: "@@ -1 +1 @@" },
    { field: "sourceCode", value: "const leaked = process.env.SECRET;" },
    { field: "rawOutput", value: "FAIL apps/web/src/foo.test.ts" },
    { field: "taskPacket", value: "task packet payload" },
    { field: "runId", value: "run_1" },
    { field: "validationCommands", value: "pnpm test" },
    { field: "localPath", value: "/Users/rory/private/repo" },
    { field: "stdout", value: "stdout: hidden validation output" },
    { field: "stderr", value: "stderr: hidden validation output" },
  ])(
    "rejects unsafe payload field $field without echoing the request body",
    async ({ field, value }) => {
      const response = await post({
        ...validPostBody,
        [field]: value,
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
      expect(responseText).not.toContain(value);
      expect(responseText).not.toMatch(new RegExp(field, "i"));
      expect(mocks.syncCortexTaskToLinear).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["status-id", "linear_state_todo"],
    ["LinearConnectionId", "linear_connection_1"],
    ["raw-source", "const leaked = true;"],
    ["Raw Diff", "diff --git a/app.ts b/app.ts"],
    ["patch_text", "@@ -1 +1 @@"],
    ["codeSnippet", "export const leaked = true;"],
    ["fileContents", "private file body"],
    ["raw-logs", "raw logs: failed command output"],
    ["rawCommandOutput", "command output: failed"],
    ["stdoutSummary", "stdout: hidden validation output"],
    ["stderrSummary", "stderr: hidden validation output"],
    ["private_key", "-----BEGIN PRIVATE KEY-----"],
  ])("rejects hostile or non-canonical field spelling %s generically", async (field, value) => {
    const response = await post({
      linearConnectionId: "linear_connection_1",
      taskId: "cortex_task_1",
      teamId: "linear_team_1",
      workspaceId: "workspace_1",
      [field]: value,
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
    expect(responseText).not.toContain(value);
    expect(mocks.syncCortexTaskToLinear).not.toHaveBeenCalled();
  });

  test("maps service auth and validation errors to safe envelopes", async () => {
    const { createActionError } = await import("../../../../../src/server/errors");

    mocks.syncCortexTaskToLinear.mockRejectedValueOnce(createActionError("unauthenticated"));
    const unauthenticated = await post(validPostBody);
    expect(unauthenticated.status).toBe(401);
    await expect(unauthenticated.json()).resolves.toEqual({
      error: {
        code: "unauthenticated",
        message: "Sign in to continue.",
      },
      ok: false,
    });

    mocks.syncCortexTaskToLinear.mockRejectedValueOnce(createActionError("validation_error"));
    const validationError = await post({
      ...validPostBody,
      taskId: "missing_task",
    });
    const responseText = await validationError.text();
    expect(validationError.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "validation_error",
        message: "Check the submitted fields and try again.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("missing_task");
  });

  test("does not log request bodies or unsafe values in route source", async () => {
    const source = await readRouteSource();

    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/body.*console|taskId.*console|linearConnectionId.*console/i);
    expect(source).not.toMatch(/JSON\.stringify\(body\)/);
    expect(source).not.toMatch(/taskPacket|runId|diff|patch|sourceCode|rawOutput|stdout|stderr/);
  });
});

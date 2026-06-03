import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  HeartbeatResponseSchema,
  type HeartbeatRequest,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateRunnerRequest: vi.fn(),
  createDrizzleRunnerHeartbeatStore: vi.fn(),
  createRunnerHeartbeatService: vi.fn(),
  getDatabase: vi.fn(),
  recordHeartbeat: vi.fn(),
  RunnerHeartbeatRequestError: class RunnerHeartbeatRequestError extends Error {
    readonly code = "invalid_request" as const;

    constructor() {
      super("The heartbeat request is invalid.");
      this.name = "RunnerHeartbeatRequestError";
    }
  },
}));

vi.mock("../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../src/runners/heartbeat", () => ({
  RUNNER_HEARTBEAT_POLL_INTERVAL_SECONDS: 15,
  RunnerHeartbeatRequestError: mocks.RunnerHeartbeatRequestError,
  createDrizzleRunnerHeartbeatStore: mocks.createDrizzleRunnerHeartbeatStore,
  createRunnerHeartbeatService: mocks.createRunnerHeartbeatService,
}));

vi.mock("../../../../src/runner-auth", () => {
  class RunnerAuthenticationError extends Error {
    readonly code = "invalid_runner_auth" as const;

    constructor() {
      super("Invalid runner credentials.");
      this.name = "RunnerAuthenticationError";
    }
  }

  return {
    RunnerAuthenticationError,
    authenticateRunnerRequest: mocks.authenticateRunnerRequest,
    isRunnerAuthenticationError: (error: unknown) => error instanceof RunnerAuthenticationError,
  };
});

const importRoute = async () => import("./route");
const importRunnerAuth = async () => import("../../../../src/runner-auth");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validRequestBody = (overrides: Partial<HeartbeatRequest> = {}): HeartbeatRequest => ({
  capabilities: {
    contractVersion: CONTRACT_VERSION,
    os: {
      arch: "arm64",
      platform: "darwin",
      release: "25.5.0",
    },
    shell: "/bin/zsh",
    tools: {
      git: {
        available: true,
        path: "/usr/bin/git",
        version: "2.49.0",
      },
      node: {
        available: true,
        path: "/opt/homebrew/bin/node",
        version: "24.0.0",
      },
    },
    maxConcurrentJobs: 1,
    reportedAt: "2026-05-22T15:59:30.000Z",
    runnerId: "runner_1",
    supportsCancellation: true,
    supportsDryRun: true,
  },
  contractVersion: CONTRACT_VERSION,
  currentRunId: null,
  runnerId: "runner_1",
  status: "idle",
  timestamp: "2026-05-22T15:59:59.000Z",
  ...overrides,
});

const validHeartbeatResponse = () =>
  HeartbeatResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    pollIntervalSeconds: 15,
    serverTime: "2026-05-22T16:00:00.000Z",
  });

const post = async (
  body: unknown,
  headers: Record<string, string> = {
    authorization: "Bearer runner-secret-credential",
    "x-control-plane-runner-id": "runner_1",
  },
) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/runner/heartbeat", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers,
      method: "POST",
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.authenticateRunnerRequest.mockResolvedValue({
    runnerId: "runner_1",
    workspaceId: "workspace_1",
  });
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleRunnerHeartbeatStore.mockReturnValue({ kind: "test-store" });
  mocks.createRunnerHeartbeatService.mockReturnValue({
    recordHeartbeat: mocks.recordHeartbeat,
  });
  mocks.recordHeartbeat.mockResolvedValue(validHeartbeatResponse());
});

describe("POST /api/runner/heartbeat", () => {
  test("returns 400 invalid_request for invalid JSON", async () => {
    const response = await post("{");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for invalid schema without Zod details or raw values", async () => {
    const response = await post({
      contractVersion: CONTRACT_VERSION,
      rawValue: "ghp_example",
      runnerId: "runner_1",
      status: "busy",
    });
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("ghp_example");
    expect(responseText).not.toMatch(/Zod|capabilities|rawValue|token/i);
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for runner id mismatch without exposing credentials", async () => {
    const response = await post(validRequestBody({ runnerId: "runner_2" }));
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toContain("runner_2 does not match");
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for nested runner id mismatch before heartbeat work", async () => {
    const requestBody = validRequestBody({
      capabilities: {
        ...validRequestBody().capabilities,
        runnerId: "runner_2",
      },
    });

    const response = await post(requestBody);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("runner_2");
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for unsafe schema-valid capability values before heartbeat work", async () => {
    const unsafeValue = "raw stdout: private command output";
    const response = await post(
      validRequestBody({
        capabilities: {
          ...validRequestBody().capabilities,
          shell: unsafeValue,
        },
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toContain(unsafeValue);
    expect(responseText).not.toMatch(/Zod|capabilities|shell|raw stdout|request body/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
  });

  test("returns 401 invalid_runner_credential and skips heartbeat work when auth fails", async () => {
    const { RunnerAuthenticationError } = await importRunnerAuth();
    mocks.authenticateRunnerRequest.mockRejectedValue(new RunnerAuthenticationError());

    const response = await post(validRequestBody());
    const responseText = await response.text();

    expect(response.status).toBe(401);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.recordHeartbeat).not.toHaveBeenCalled();
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_runner_credential",
        message: "Invalid runner credentials.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toMatch(/authorization|bearer|credentialHash|request body/i);
  });

  test("returns 400 invalid_request for safe heartbeat service request errors", async () => {
    mocks.recordHeartbeat.mockRejectedValue(new mocks.RunnerHeartbeatRequestError());

    const response = await post(validRequestBody());
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("The heartbeat request is invalid.");
    expect(responseText).not.toMatch(/Zod|runner-secret-credential|authorization|bearer/i);
  });

  test("returns a schema-valid heartbeat response envelope for a valid request", async () => {
    const requestBody = validRequestBody({ currentRunId: "run_1", status: "busy" });

    const response = await post(requestBody);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: validHeartbeatResponse(),
      ok: true,
    });
    expect(HeartbeatResponseSchema.safeParse(body.data).success).toBe(true);
    expect(mocks.createDrizzleRunnerHeartbeatStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createRunnerHeartbeatService).toHaveBeenCalledWith({
      store: { kind: "test-store" },
    });
    expect(mocks.recordHeartbeat).toHaveBeenCalledWith({
      authenticatedRunnerId: "runner_1",
      payload: requestBody,
      workspaceId: "workspace_1",
    });
  });

  test("returns no-store cache headers", async () => {
    const response = await post(validRequestBody());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("does not log credentials, authorization headers, or request bodies in route source", async () => {
    const source = await readRouteSource();

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/authorization|bearer|credential|request\.text|request\.body/i);
    expect(source).not.toMatch(/\b(?:diff|patch|snippet|sourceCode|rawOutput|stdout|stderr)\b/i);
  });
});

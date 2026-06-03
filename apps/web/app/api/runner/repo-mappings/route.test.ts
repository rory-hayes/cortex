import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION } from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateRunnerRequest: vi.fn(),
  createDrizzleRepoMappingStore: vi.fn(),
  createRunnerRepoMappingService: vi.fn(),
  getDatabase: vi.fn(),
  registerRepoMapping: vi.fn(),
  RunnerRepoMappingRequestError: class RunnerRepoMappingRequestError extends Error {
    readonly code = "invalid_request" as const;

    constructor() {
      super("Invalid runner repo mapping request.");
      this.name = "RunnerRepoMappingRequestError";
    }
  },
}));

vi.mock("../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../src/repo-mappings/repo-mappings", () => ({
  RunnerRepoMappingRequestError: mocks.RunnerRepoMappingRequestError,
  createDrizzleRepoMappingStore: mocks.createDrizzleRepoMappingStore,
  createRunnerRepoMappingService: mocks.createRunnerRepoMappingService,
  isRunnerRepoMappingRequestError: (error: unknown) =>
    error instanceof mocks.RunnerRepoMappingRequestError,
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
const importRepoMappings = async () => import("../../../../src/repo-mappings/repo-mappings");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

type RunnerRepoMappingRequestBody = {
  contractVersion: typeof CONTRACT_VERSION;
  defaultBranch: string;
  localPath: string;
  provider: string;
  remoteUrl: string | null;
  repositoryName: string;
  repositoryOwner: string;
  runnerId: string;
  timestamp: string;
  workspaceId: string;
};

const validRequestBody = (
  overrides: Partial<RunnerRepoMappingRequestBody> = {},
): RunnerRepoMappingRequestBody => ({
  contractVersion: CONTRACT_VERSION,
  defaultBranch: "main",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  timestamp: "2026-05-23T12:59:30.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const validMappingResponse = () => ({
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/repos/control-plane",
  provider: "github",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
});

const post = async (
  body: unknown,
  headers: Record<string, string> = {
    authorization: "Bearer runner-secret-credential",
    "content-type": "application/json",
    "x-control-plane-runner-id": "runner_1",
  },
) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/runner/repo-mappings", {
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
  mocks.createDrizzleRepoMappingStore.mockReturnValue({ kind: "repo-mapping-store" });
  mocks.createRunnerRepoMappingService.mockReturnValue({
    registerRepoMapping: mocks.registerRepoMapping,
  });
  mocks.registerRepoMapping.mockResolvedValue(validMappingResponse());
});

describe("POST /api/runner/repo-mappings", () => {
  test("returns 401 invalid_runner_credential and skips registration when auth fails", async () => {
    const { RunnerAuthenticationError } = await importRunnerAuth();
    mocks.authenticateRunnerRequest.mockRejectedValue(new RunnerAuthenticationError());

    const response = await post(validRequestBody());
    const responseText = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_runner_credential",
        message: "Invalid runner credentials.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(/runner-secret-credential|authorization|bearer/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.registerRepoMapping).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid JSON", "{"],
    [
      "invalid schema",
      {
        contractVersion: CONTRACT_VERSION,
        localPath: "/repos/control-plane",
        runnerId: "runner_1",
        sourceTree: "diff --git a/app.ts b/app.ts",
        workspaceId: "workspace_1",
      },
    ],
  ])("%s returns safe 400 invalid_request", async (_name, body) => {
    const response = await post(body);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(/Zod|sourceTree|diff --git|control-plane|request body/i);
    expect(mocks.registerRepoMapping).not.toHaveBeenCalled();
  });

  test.each([
    ["runner id mismatch", validRequestBody({ runnerId: "runner_2" })],
    ["workspace id mismatch", validRequestBody({ workspaceId: "workspace_2" })],
  ])("%s returns safe 400 invalid_request", async (_name, body) => {
    const response = await post(body);
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(/runner_2|workspace_2|runner-secret-credential|bearer/i);
    expect(mocks.registerRepoMapping).not.toHaveBeenCalled();
  });

  test("service request errors return safe 400 invalid_request", async () => {
    const { RunnerRepoMappingRequestError } = await importRepoMappings();
    mocks.registerRepoMapping.mockRejectedValue(new RunnerRepoMappingRequestError());

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
    expect(responseText).not.toMatch(/Invalid runner repo mapping request|runner-secret/i);
  });

  test("valid authenticated request returns metadata-only mapping data", async () => {
    const requestBody = validRequestBody();

    const response = await post(requestBody);
    const responseText = await response.text();

    expect(response.status).toBe(200);
    expect(JSON.parse(responseText)).toEqual({
      data: validMappingResponse(),
      ok: true,
    });
    expect(mocks.createDrizzleRepoMappingStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createRunnerRepoMappingService).toHaveBeenCalledWith({
      store: { kind: "repo-mapping-store" },
    });
    expect(mocks.registerRepoMapping).toHaveBeenCalledWith({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: requestBody,
    });
    expect(responseText).not.toMatch(/sourceTree|dependencyGraph|diff --git|@@ -|patch|snippet/i);
  });

  test("returns no-store cache headers", async () => {
    const response = await post(validRequestBody());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("route source has no credential, body, source, diff, patch, or log handling", async () => {
    const source = await readRouteSource();

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/\bconsole\./);
    expect(source).not.toMatch(/\blog(?:ger)?\s*\(/i);
    expect(source).not.toMatch(/authorization|bearer|credential|rawBody|bodyText|requestBody/i);
    expect(source).not.toMatch(
      /\b(?:sourceTree|dependencyGraph|diff|patch|snippet|stdout|stderr)\b/i,
    );
  });
});

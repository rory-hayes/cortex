import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  PrArtifactSchema,
  type PrArtifact,
  type SubmitPrArtifactRequest,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RunnerAuthenticationError extends Error {
    constructor() {
      super("Invalid runner credentials.");
      this.name = "RunnerAuthenticationError";
    }
  }

  class RunArtifactSubmissionError extends Error {
    constructor() {
      super("Invalid run artifact submission.");
      this.name = "RunArtifactSubmissionError";
    }
  }

  return {
    RunArtifactSubmissionError,
    RunnerAuthenticationError,
    authenticateRunnerRequest: vi.fn(),
    createDrizzleRunArtifactSubmissionStore: vi.fn(),
    createRunArtifactSubmissionService: vi.fn(),
    getDatabase: vi.fn(),
    submitPrArtifact: vi.fn(),
  };
});

vi.mock("../../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../../src/runner-auth", () => ({
  RunnerAuthenticationError: mocks.RunnerAuthenticationError,
  authenticateRunnerRequest: mocks.authenticateRunnerRequest,
  isRunnerAuthenticationError: (error: unknown) =>
    error instanceof mocks.RunnerAuthenticationError,
}));

vi.mock("../../../../../src/runs/artifacts", () => ({
  RunArtifactSubmissionError: mocks.RunArtifactSubmissionError,
  createDrizzleRunArtifactSubmissionStore: mocks.createDrizzleRunArtifactSubmissionStore,
  createRunArtifactSubmissionService: mocks.createRunArtifactSubmissionService,
  isRunArtifactSubmissionRequestError: (error: unknown) =>
    error instanceof mocks.RunArtifactSubmissionError,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validPrArtifact = (overrides: Partial<PrArtifact> = {}): PrArtifact =>
  PrArtifactSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "pr_artifact_1",
    runId: "run_1",
    repository: {
      owner: "control-plane",
      name: "app",
    },
    branchName: "aicp/task-119",
    prNumber: 42,
    prUrl: "https://github.com/control-plane/app/pull/42",
    prTitle: "TASK-119 artifact endpoints",
    prStatus: "draft",
    changedFilePaths: ["apps/web/src/runs/artifacts.ts"],
    riskFindings: [],
    createdAt: "2026-05-23T09:59:45.000Z",
    ...overrides,
  });

const validRequestBody = (
  overrides: Partial<SubmitPrArtifactRequest> = {},
): SubmitPrArtifactRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  runId: "run_1",
  artifact: validPrArtifact(),
  submittedAt: "2026-05-23T10:00:00.000Z",
  ...overrides,
});

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/runner/runs/pr-artifact", {
      body: typeof body === "string" ? body : JSON.stringify(body),
      headers: {
        authorization: "Bearer runner-secret-credential",
        "x-control-plane-runner-id": "runner_1",
      },
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
  mocks.createDrizzleRunArtifactSubmissionStore.mockReturnValue({ kind: "test-store" });
  mocks.createRunArtifactSubmissionService.mockReturnValue({
    submitPrArtifact: mocks.submitPrArtifact,
  });
  mocks.submitPrArtifact.mockResolvedValue(validPrArtifact());
});

describe("POST /api/runner/runs/pr-artifact", () => {
  test("auth failure returns safe 401 invalid_runner_credential", async () => {
    mocks.authenticateRunnerRequest.mockRejectedValue(new mocks.RunnerAuthenticationError());
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
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(responseText).not.toMatch(/runner-secret-credential|authorization|bearer/i);
  });

  test("invalid JSON returns safe 400 invalid_request", async () => {
    const response = await post("{");

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.submitPrArtifact).not.toHaveBeenCalled();
  });

  test("schema-invalid request returns safe 400 without Zod internals", async () => {
    const response = await post({
      contractVersion: CONTRACT_VERSION,
      runnerId: "runner_1",
      runId: "run_1",
      artifact: {
        ...validPrArtifact(),
        runId: "run_2",
      },
      submittedAt: "2026-05-23T10:00:00.000Z",
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
    expect(responseText).not.toMatch(/Zod|runId|run_2|artifact/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.submitPrArtifact).not.toHaveBeenCalled();
  });

  test.each(["diff", "patch", "sourceCode", "rawOutput"] as const)(
    "unsafe extra payload field %s returns safe 400 before database or service work",
    async (unsafeField) => {
      const response = await post({
        ...validRequestBody(),
        [unsafeField]: "unsafe payload that must not persist",
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
      expect(mocks.getDatabase).not.toHaveBeenCalled();
      expect(mocks.createRunArtifactSubmissionService).not.toHaveBeenCalled();
      expect(mocks.submitPrArtifact).not.toHaveBeenCalled();
      expect(responseText).not.toMatch(
        /diff|patch|sourceCode|rawOutput|unsafe payload|request body|Zod/i,
      );
    },
  );

  test("unsafe schema-valid PR artifact text returns safe 400 before database or service work", async () => {
    const response = await post(
      validRequestBody({
        artifact: validPrArtifact({
          prTitle: "diff --git a/app.ts b/app.ts",
        }),
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
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.createDrizzleRunArtifactSubmissionStore).not.toHaveBeenCalled();
    expect(mocks.createRunArtifactSubmissionService).not.toHaveBeenCalled();
    expect(mocks.submitPrArtifact).not.toHaveBeenCalled();
    expect(responseText).not.toMatch(/diff --git|request body|Zod|runner-secret-credential/i);
  });

  test("runner mismatch returns safe 400 before database or service work", async () => {
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
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.submitPrArtifact).not.toHaveBeenCalled();
    expect(responseText).not.toMatch(/runner_2|runner-secret-credential/i);
  });

  test("valid request creates DB-backed service and returns ok data", async () => {
    const requestBody = validRequestBody();
    const response = await post(requestBody);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: validPrArtifact(),
      ok: true,
    });
    expect(mocks.createDrizzleRunArtifactSubmissionStore).toHaveBeenCalledWith({
      kind: "test-db",
    });
    expect(mocks.createRunArtifactSubmissionService).toHaveBeenCalledWith({
      store: { kind: "test-store" },
    });
    expect(mocks.submitPrArtifact).toHaveBeenCalledWith({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: requestBody,
    });
  });

  test("service-level artifact errors map to generic invalid_request", async () => {
    mocks.submitPrArtifact.mockRejectedValue(new mocks.RunArtifactSubmissionError());
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
    expect(responseText).not.toMatch(/diff --git|request body|Zod|runner-secret-credential/i);
  });

  test("responses disable caching", async () => {
    const response = await post(validRequestBody());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("route source is authenticated and does not log request material", async () => {
    const source = await readRouteSource();

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/authorization|bearer|request body|runnerCredential/i);
  });
});

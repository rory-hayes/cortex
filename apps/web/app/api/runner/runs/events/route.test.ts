import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  RunEventSchema,
  type RunEvent,
  type SubmitRunEventRequest,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => {
  class RunnerAuthenticationError extends Error {
    readonly code = "invalid_runner_auth" as const;

    constructor() {
      super("Invalid runner credentials.");
      this.name = "RunnerAuthenticationError";
    }
  }

  class SubmitRunEventRequestError extends Error {
    readonly code = "invalid_run_event_submission" as const;

    constructor() {
      super("Invalid run event submission.");
      this.name = "SubmitRunEventRequestError";
    }
  }

  class RunEventSubmissionError extends SubmitRunEventRequestError {
    constructor() {
      super();
      this.name = "RunEventSubmissionError";
    }
  }

  return {
    RunnerAuthenticationError,
    RunEventSubmissionError,
    SubmitRunEventRequestError,
    authenticateRunnerRequest: vi.fn(),
    createDrizzleSubmitRunEventStore: vi.fn(),
    createSubmitRunEventService: vi.fn(),
    getDatabase: vi.fn(),
    submitRunEvent: vi.fn(),
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

vi.mock("../../../../../src/runs/events", () => ({
  RunEventSubmissionError: mocks.RunEventSubmissionError,
  SubmitRunEventRequestError: mocks.SubmitRunEventRequestError,
  createDrizzleSubmitRunEventStore: mocks.createDrizzleSubmitRunEventStore,
  createSubmitRunEventService: mocks.createSubmitRunEventService,
  isSubmitRunEventRequestError: (error: unknown) =>
    error instanceof mocks.SubmitRunEventRequestError,
  isRunEventSubmissionError: (error: unknown) => error instanceof mocks.RunEventSubmissionError,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validRequestBody = (
  overrides: Partial<SubmitRunEventRequest> = {},
): SubmitRunEventRequest => ({
  contractVersion: CONTRACT_VERSION,
  runId: "run_1",
  runnerId: "runner_1",
  eventId: "event_1",
  idempotencyKey: "run:run_1:event:worktree_created:1",
  state: "worktree_created",
  severity: "info",
  message: "Worktree created.",
  metadata: {
    branchName: "aicp/task-118",
  },
  createdAt: "2026-05-22T13:59:00.000Z",
  ...overrides,
});

const validRunEvent = (): RunEvent =>
  RunEventSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: "event_1",
    idempotencyKey: "run:run_1:event:worktree_created:1",
    runId: "run_1",
    runnerId: "runner_1",
    state: "worktree_created",
    severity: "info",
    message: "Worktree created.",
    metadata: {
      branchName: "aicp/task-118",
    },
    createdAt: "2026-05-22T13:59:00.000Z",
  });

const post = async (body: unknown) => {
  const { POST } = await importRoute();

  return POST(
    new Request("https://control-plane.test/api/runner/runs/events", {
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
  mocks.createDrizzleSubmitRunEventStore.mockReturnValue({ kind: "test-store" });
  mocks.createSubmitRunEventService.mockReturnValue({
    submitRunEvent: mocks.submitRunEvent,
  });
  mocks.submitRunEvent.mockResolvedValue(validRunEvent());
});

describe("POST /api/runner/runs/events", () => {
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
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toMatch(/authorization|bearer|credentialHash|request body/i);
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
    expect(mocks.submitRunEvent).not.toHaveBeenCalled();
  });

  test.each(["sourceCode", "rawDiff", "patchText", "codeSnippet", "rawOutput"])(
    "unsafe metadata key %s returns generic invalid_request before service work",
    async (unsafeKey) => {
      const response = await post(
        validRequestBody({
          metadata: {
            nested: {
              [unsafeKey]: "unsafe payload that must not persist",
            },
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
      expect(mocks.getDatabase).not.toHaveBeenCalled();
      expect(mocks.submitRunEvent).not.toHaveBeenCalled();
      expect(responseText).not.toContain(unsafeKey);
      expect(responseText).not.toMatch(/Zod|unsafe payload|metadata|nested/i);
    },
  );

  test("schema-valid unsafe event text returns generic invalid_request before service work", async () => {
    const response = await post(
      validRequestBody({
        message: "diff --git a/app.ts b/app.ts\nraw output: unsafe command result",
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
    expect(mocks.createDrizzleSubmitRunEventStore).not.toHaveBeenCalled();
    expect(mocks.createSubmitRunEventService).not.toHaveBeenCalled();
    expect(mocks.submitRunEvent).not.toHaveBeenCalled();
    expect(responseText).not.toMatch(/diff --git|raw output|unsafe command result|Zod/i);
  });

  test("invalid schema returns safe 400 without Zod internals or raw values", async () => {
    const response = await post({
      contractVersion: CONTRACT_VERSION,
      runId: "run_1",
      runnerId: "runner_1",
      eventId: "",
      idempotencyKey: "run:run_1:event:worktree_created:1",
      state: "worktree_created",
      severity: "verbose",
      message: "Worktree created.",
      metadata: {},
      createdAt: "2026-05-22T13:59:00.000Z",
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
    expect(responseText).not.toMatch(/Zod|eventId|severity|verbose|min|enum/i);
    expect(mocks.submitRunEvent).not.toHaveBeenCalled();
  });

  test("valid request calls the event service with authenticated runner context", async () => {
    const requestBody = validRequestBody();
    const response = await post(requestBody);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: validRunEvent(),
      ok: true,
    });
    expect(mocks.createDrizzleSubmitRunEventStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createSubmitRunEventService).toHaveBeenCalledWith({
      store: { kind: "test-store" },
    });
    expect(mocks.submitRunEvent).toHaveBeenCalledWith({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: requestBody,
    });
  });

  test("runner id mismatch returns safe invalid_request before database or service work", async () => {
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
    expect(mocks.createSubmitRunEventService).not.toHaveBeenCalled();
    expect(mocks.submitRunEvent).not.toHaveBeenCalled();
    expect(responseText).not.toMatch(/runner_2|runner-secret-credential|request body/i);
  });

  test("valid responses disable caching", async () => {
    const response = await post(validRequestBody());

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("retry response returns the service's existing event result", async () => {
    const existingEvent = validRunEvent();
    mocks.submitRunEvent.mockResolvedValueOnce(existingEvent);

    const response = await post(validRequestBody());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: existingEvent,
      ok: true,
    });
    expect(mocks.submitRunEvent).toHaveBeenCalledTimes(1);
  });

  test("service-level invalid submissions map to generic invalid_request without leaking request text", async () => {
    mocks.submitRunEvent.mockRejectedValue(new mocks.RunEventSubmissionError());
    const response = await post(
      validRequestBody({
        message: "diff --git a/app.ts b/app.ts\nraw output: unsafe command result",
        metadata: {
          safeSummary: "sourceCode rawOutput labels must not echo",
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
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toMatch(
      /bearer|Zod|diff --git|raw output|sourceCode|rawOutput|unsafe command result|request body/i,
    );
  });

  test("route source is authenticated and does not log request material", async () => {
    const source = await readRouteSource();

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(/authorization|bearer|request body|runnerCredential/i);
  });
});

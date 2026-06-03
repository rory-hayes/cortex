import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  PollJobsResponseSchema,
  type PollJobsRequest,
  type PollJobsResponse,
  type RunnerCapabilities,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateRunnerRequest: vi.fn(),
  createDrizzlePollJobsStore: vi.fn(),
  createPollJobsService: vi.fn(),
  getDatabase: vi.fn(),
  pollJobs: vi.fn(),
}));

vi.mock("../../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../../src/jobs/poll", async () => {
  class PollJobsRequestError extends Error {
    readonly code = "invalid_request" as const;

    constructor() {
      super("Invalid poll jobs request.");
      this.name = "PollJobsRequestError";
    }
  }

  return {
    PollJobsRequestError,
    createDrizzlePollJobsStore: mocks.createDrizzlePollJobsStore,
    createPollJobsService: mocks.createPollJobsService,
    isPollJobsRequestError: (error: unknown) => error instanceof PollJobsRequestError,
  };
});

vi.mock("../../../../../src/runner-auth", () => {
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
const importRunnerAuth = async () => import("../../../../../src/runner-auth");
const importPoll = async () => import("../../../../../src/jobs/poll");
const routeSourcePath = join(dirname(fileURLToPath(import.meta.url)), "route.ts");

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.5.0",
  },
  shell: "/bin/zsh",
  tools: {
    codex: {
      available: true,
      path: "/opt/homebrew/bin/codex",
      version: "0.12.0",
    },
    gh: {
      available: true,
      path: "/opt/homebrew/bin/gh",
      version: "2.72.0",
    },
    git: {
      available: true,
      path: "/usr/bin/git",
      version: "2.49.0",
    },
  },
  maxConcurrentJobs: 1,
  reportedAt: "2026-05-22T12:59:30.000Z",
  supportsCancellation: true,
  supportsDryRun: true,
  ...overrides,
});

const validPollRequest = (overrides: Partial<PollJobsRequest> = {}): PollJobsRequest => ({
  contractVersion: CONTRACT_VERSION,
  runnerId: "runner_1",
  capabilities: validCapabilities(),
  availableConcurrency: 1,
  knownCurrentRunIds: [],
  ...overrides,
});

const validPollResponse = (): PollJobsResponse =>
  PollJobsResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobs: [],
    pollIntervalSeconds: 15,
    serverTime: "2026-05-22T13:00:00.000Z",
  });

const createRequest = (body: unknown, init: RequestInit = {}) =>
  new Request("https://control-plane.test/api/runner/jobs/poll", {
    body: typeof body === "string" ? body : JSON.stringify(body),
    headers: {
      authorization: "Bearer runner-secret-credential",
      "content-type": "application/json",
      "x-control-plane-runner-id": "runner_1",
      ...init.headers,
    },
    method: "POST",
    ...init,
  });

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mocks.authenticateRunnerRequest.mockResolvedValue({
    runnerId: "runner_1",
    workspaceId: "workspace_1",
  });
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzlePollJobsStore.mockReturnValue({ kind: "poll-store" });
  mocks.createPollJobsService.mockReturnValue({ pollJobs: mocks.pollJobs });
  mocks.pollJobs.mockResolvedValue(validPollResponse());
});

describe("POST /api/runner/jobs/poll", () => {
  test("invalid credentials return safe 401 invalid_runner_credential", async () => {
    const { RunnerAuthenticationError } = await importRunnerAuth();
    mocks.authenticateRunnerRequest.mockRejectedValue(new RunnerAuthenticationError());
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest()));
    const responseText = await response.text();

    expect(response.status).toBe(401);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_runner_credential",
        message: "Invalid runner credentials.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toMatch(/authorization|bearer|credentialHash|request body/i);
    expect(mocks.pollJobs).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid JSON", "{"],
    [
      "invalid schema",
      {
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner_1",
        availableConcurrency: -1,
        rawOutput: "do not echo this body",
      },
    ],
  ])("%s returns safe 400 invalid_request", async (_name, body) => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(body));
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(/Zod|availableConcurrency|rawOutput|do not echo/i);
    expect(mocks.pollJobs).not.toHaveBeenCalled();
  });

  test("request runner mismatch returns safe 400 invalid_request", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest({ runnerId: "runner_2" })));
    const responseText = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(responseText).not.toMatch(/runner_2|runner-secret-credential|authorization|bearer/i);
    expect(mocks.pollJobs).not.toHaveBeenCalled();
  });

  test("unsafe schema-valid capability values return safe 400 before polling service work", async () => {
    const { POST } = await importRoute();
    const unsafeValue = "process.env.OPENAI_API_KEY";

    const response = await POST(
      createRequest(
        validPollRequest({
          capabilities: validCapabilities({
            os: {
              ...validCapabilities().os,
              release: unsafeValue,
            },
          }),
        }),
      ),
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
    expect(responseText).not.toMatch(/Zod|capabilities|release|OPENAI_API_KEY|request body/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.pollJobs).not.toHaveBeenCalled();
  });

  test("service request errors return safe 400 invalid_request", async () => {
    const { PollJobsRequestError } = await importPoll();
    mocks.pollJobs.mockRejectedValue(new PollJobsRequestError());
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
  });

  test("valid authenticated request returns schema-valid poll response data", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: validPollResponse(),
      ok: true,
    });
    expect(PollJobsResponseSchema.safeParse(body.data).success).toBe(true);
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzlePollJobsStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createPollJobsService).toHaveBeenCalledWith({
      store: { kind: "poll-store" },
    });
    expect(mocks.pollJobs).toHaveBeenCalledWith({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: validPollRequest(),
    });
  });

  test("response has cache-control no-store", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest()));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("response text does not include credentials, Zod details, raw bodies, source, diffs, patches, or logs", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validPollRequest()));
    const responseText = await response.text();

    expect(responseText).not.toMatch(
      /runner-secret-credential|credentialHash|Zod|request body|rawOutput|source|diff --git|patch|logs?|bearer/i,
    );
  });

  test("route source has no console or credential/body logging", async () => {
    const source = await readFile(routeSourcePath, "utf8");

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/\bconsole\./);
    expect(source).not.toMatch(/\blog(?:ger)?\s*\(/i);
    expect(source).not.toMatch(/authorization|bearer|credential|rawBody|requestBody|bodyText/i);
  });
});

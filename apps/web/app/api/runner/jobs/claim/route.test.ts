import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  ClaimJobResponseSchema,
  CONTRACT_VERSION,
  createClaimJobIdempotencyKey,
  type ClaimJobRequest,
  type ClaimJobResponse,
  type RunnerCapabilities,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateRunnerRequest: vi.fn(),
  claimJob: vi.fn(),
  createClaimJobService: vi.fn(),
  createDrizzleClaimJobStore: vi.fn(),
  getDatabase: vi.fn(),
}));

vi.mock("../../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../../src/jobs/claim", async () => {
  class ClaimJobRequestError extends Error {
    readonly code = "invalid_request" as const;

    constructor() {
      super("Invalid claim job request.");
      this.name = "ClaimJobRequestError";
    }
  }

  return {
    ClaimJobRequestError,
    createClaimJobService: mocks.createClaimJobService,
    createDrizzleClaimJobStore: mocks.createDrizzleClaimJobStore,
    isClaimJobRequestError: (error: unknown) => error instanceof ClaimJobRequestError,
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
const importClaim = async () => import("../../../../../src/jobs/claim");
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
  reportedAt: "2026-05-23T08:59:30.000Z",
  supportsCancellation: true,
  supportsDryRun: true,
  ...overrides,
});

const validClaimRequest = (overrides: Partial<ClaimJobRequest> = {}): ClaimJobRequest => {
  const runnerId = overrides.runnerId ?? "runner_1";
  const jobId = overrides.jobId ?? "job_1";
  const runId = overrides.runId ?? "run_1";

  return {
    contractVersion: CONTRACT_VERSION,
    runnerId,
    jobId,
    runId,
    idempotencyKey: createClaimJobIdempotencyKey({ jobId, runId, runnerId }),
    capabilitiesSnapshot: validCapabilities({ runnerId }),
    ...overrides,
  };
};

const validClaimResponse = (): ClaimJobResponse =>
  ClaimJobResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobId: "job_1",
    runId: "run_1",
    status: "claimed",
    claimedByRunnerId: "runner_1",
    claimExpiresAt: "2026-05-23T09:15:00.000Z",
  });

const createRequest = (body: unknown, init: RequestInit = {}) =>
  new Request("https://control-plane.test/api/runner/jobs/claim", {
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
  mocks.createDrizzleClaimJobStore.mockReturnValue({ kind: "claim-store" });
  mocks.createClaimJobService.mockReturnValue({ claimJob: mocks.claimJob });
  mocks.claimJob.mockResolvedValue(validClaimResponse());
});

describe("POST /api/runner/jobs/claim", () => {
  test("invalid credentials return safe 401 invalid_runner_credential", async () => {
    const { RunnerAuthenticationError } = await importRunnerAuth();
    mocks.authenticateRunnerRequest.mockRejectedValue(new RunnerAuthenticationError());
    const { POST } = await importRoute();

    const response = await POST(createRequest(validClaimRequest()));
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
    expect(mocks.claimJob).not.toHaveBeenCalled();
  });

  test.each([
    ["invalid JSON", "{"],
    [
      "invalid schema",
      {
        contractVersion: CONTRACT_VERSION,
        runnerId: "runner_1",
        jobId: "job_1",
        runId: "run_1",
        idempotencyKey: "not-canonical",
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
    expect(responseText).not.toMatch(/Zod|idempotencyKey|rawOutput|do not echo/i);
    expect(mocks.claimJob).not.toHaveBeenCalled();
  });

  test("request runner mismatch returns safe 400 invalid_request", async () => {
    const { POST } = await importRoute();

    const response = await POST(
      createRequest(
        validClaimRequest({
          runnerId: "runner_2",
          capabilitiesSnapshot: validCapabilities({ runnerId: "runner_2" }),
          idempotencyKey: createClaimJobIdempotencyKey({
            jobId: "job_1",
            runId: "run_1",
            runnerId: "runner_2",
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
    expect(responseText).not.toMatch(/runner_2|runner-secret-credential|authorization|bearer/i);
    expect(mocks.claimJob).not.toHaveBeenCalled();
  });

  test("unsafe schema-valid capability snapshot values return safe 400 before claim service work", async () => {
    const { POST } = await importRoute();
    const unsafeValue = "OPENAI_API_KEY=sk-capability-secret-value";

    const response = await POST(
      createRequest(
        validClaimRequest({
          capabilitiesSnapshot: validCapabilities({
            tools: {
              git: {
                available: true,
                path: unsafeValue,
              },
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
    expect(responseText).not.toMatch(/Zod|capabilitiesSnapshot|OPENAI_API_KEY|request body/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.claimJob).not.toHaveBeenCalled();
  });

  test("service request errors return safe 400 invalid_request", async () => {
    const { ClaimJobRequestError } = await importClaim();
    mocks.claimJob.mockRejectedValue(new ClaimJobRequestError());
    const { POST } = await importRoute();

    const response = await POST(createRequest(validClaimRequest()));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
  });

  test("valid authenticated request returns schema-valid claim response data", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validClaimRequest()));
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: validClaimResponse(),
      ok: true,
    });
    expect(ClaimJobResponseSchema.safeParse(body.data).success).toBe(true);
    expect(mocks.getDatabase).toHaveBeenCalledTimes(1);
    expect(mocks.createDrizzleClaimJobStore).toHaveBeenCalledWith({ kind: "test-db" });
    expect(mocks.createClaimJobService).toHaveBeenCalledWith({
      store: { kind: "claim-store" },
    });
    expect(mocks.claimJob).toHaveBeenCalledWith({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: validClaimRequest(),
    });
  });

  test("response has cache-control no-store", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validClaimRequest()));

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("response text does not include credentials, Zod details, raw bodies, source, diffs, patches, or logs", async () => {
    const { POST } = await importRoute();

    const response = await POST(createRequest(validClaimRequest()));
    const responseText = await response.text();

    expect(responseText).not.toMatch(
      /runner-secret-credential|credentialHash|Zod|request body|rawOutput|source|diff --git|patch|logs?|bearer/i,
    );
  });

  test("route source has no console logging or unsafe payload terminology", async () => {
    const source = await readFile(routeSourcePath, "utf8");

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).not.toMatch(/\bconsole\./);
    expect(source).not.toMatch(/\blog(?:ger)?\s*\(/i);
    expect(source).not.toMatch(
      /authorization|bearer|credential|raw\s*body|rawBody|requestBody|bodyText|source|diff|patch|logs?/i,
    );
  });
});

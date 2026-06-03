import { beforeEach, describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  authenticateRunnerRequest: vi.fn(),
}));

vi.mock("../../../src/runner-auth", () => {
  class RunnerAuthenticationError extends Error {
    readonly code = "invalid_runner_auth" as const;

    constructor() {
      super("Invalid runner credentials.");
      this.name = "RunnerAuthenticationError";
    }
  }

  return {
    authenticateRunnerRequest: mocks.authenticateRunnerRequest,
    isRunnerAuthenticationError: (error: unknown) => error instanceof RunnerAuthenticationError,
    RunnerAuthenticationError,
  };
});

const importRoute = async () => import("./route");
const importRunnerAuth = async () => import("../../../src/runner-auth");

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
});

describe("POST /api/runner", () => {
  test("returns 401 invalid_runner_credential and does not run route work when auth fails", async () => {
    const { RunnerAuthenticationError } = await importRunnerAuth();
    mocks.authenticateRunnerRequest.mockRejectedValue(new RunnerAuthenticationError());
    const { POST } = await importRoute();

    const response = await POST(
      new Request("https://control-plane.test/api/runner", {
        headers: {
          authorization: "Bearer runner-secret-credential",
          "x-control-plane-runner-id": "runner_1",
        },
        method: "POST",
      }),
    );
    const responseText = await response.text();

    expect(mocks.authenticateRunnerRequest).toHaveBeenCalledTimes(1);
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
  });

  test("valid runner auth reaches the placeholder route after context resolution", async () => {
    mocks.authenticateRunnerRequest.mockResolvedValue({
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    const { POST } = await importRoute();

    const response = await POST(
      new Request("https://control-plane.test/api/runner", {
        headers: {
          authorization: "Bearer runner-secret-credential",
          "x-control-plane-runner-id": "runner_1",
        },
        method: "POST",
      }),
    );

    expect(mocks.authenticateRunnerRequest).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_implemented",
        message: "Runner API conventions are present, but this endpoint is not implemented yet.",
      },
      ok: false,
    });
  });
});

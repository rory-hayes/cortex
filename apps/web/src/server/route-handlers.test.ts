import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));

const importRouteHandlers = async () => import("./route-handlers");
const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

describe("runner route handler conventions", () => {
  test("maps runner route errors to safe JSON responses", async () => {
    const { createRouteError, createRunnerRouteHandler } = await importRouteHandlers();
    const handler = createRunnerRouteHandler(async () => {
      throw createRouteError(
        "not_implemented",
        "Runner API conventions are present, but runner protocol endpoints are deferred.",
      );
    });

    const response = await handler(new Request("https://control-plane.test/api/runner"));

    expect(response.status).toBe(501);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "not_implemented",
        message: "Runner API conventions are present, but this endpoint is not implemented yet.",
      },
      ok: false,
    });
  });

  test("maps public runner request errors without exposing private details", async () => {
    const { createRouteError, createRunnerRouteHandler } = await importRouteHandlers();
    const invalidRequestHandler = createRunnerRouteHandler(async () => {
      throw createRouteError("invalid_request", "PAIR-SECRET-VALUE failed Zod validation.");
    });
    const invalidRunnerCredentialHandler = createRunnerRouteHandler(async () => {
      throw createRouteError("invalid_runner_credential", "runner runner_1 credential revoked.");
    });
    const invalidPairingCodeHandler = createRunnerRouteHandler(async () => {
      throw createRouteError("invalid_pairing_code", "RUNNER-LINK credential hash mismatch.");
    });

    const invalidRequestResponse = await invalidRequestHandler(
      new Request("https://control-plane.test/api/runner/link"),
    );
    const invalidRunnerCredentialResponse = await invalidRunnerCredentialHandler(
      new Request("https://control-plane.test/api/runner/heartbeat"),
    );
    const invalidPairingCodeResponse = await invalidPairingCodeHandler(
      new Request("https://control-plane.test/api/runner/link"),
    );

    expect(invalidRequestResponse.status).toBe(400);
    await expect(invalidRequestResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(invalidRunnerCredentialResponse.status).toBe(401);
    await expect(invalidRunnerCredentialResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_runner_credential",
        message: "Invalid runner credentials.",
      },
      ok: false,
    });
    expect(invalidPairingCodeResponse.status).toBe(401);
    await expect(invalidPairingCodeResponse.json()).resolves.toEqual({
      error: {
        code: "invalid_pairing_code",
        message: "The pairing code is invalid or expired.",
      },
      ok: false,
    });
  });

  test("keeps the runner API placeholder routed through authenticated helpers without protocol behavior", async () => {
    const source = await readAppFile("../../app/api/runner/route.ts");

    expect(source).toContain("createAuthenticatedRunnerRouteHandler");
    expect(source).toContain("createRouteError");
    expect(source).not.toMatch(/pollJobs|claimJob|submitRunEvent|heartbeat|CancellationRequest/);
  });

  test("authenticated runner routes pass safe runner context to handlers", async () => {
    const { createAuthenticatedRunnerRouteHandler } = await importRouteHandlers();
    const authenticateRunner = vi.fn(async () => ({
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    }));
    const handler = createAuthenticatedRunnerRouteHandler(
      async (_request, context) => ({
        runnerId: context.runnerId,
        workspaceId: context.workspaceId,
      }),
      {
        authenticateRunner,
      },
    );

    const response = await handler(new Request("https://control-plane.test/api/runner/heartbeat"));

    expect(authenticateRunner).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      data: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      ok: true,
    });
  });

  test("authenticated runner routes map invalid credentials to a safe 401 envelope", async () => {
    const { RunnerAuthenticationError } = await import("../runner-auth");
    const { createAuthenticatedRunnerRouteHandler } = await importRouteHandlers();
    const innerHandler = vi.fn(async () => ({
      unreachable: true,
    }));
    const handler = createAuthenticatedRunnerRouteHandler(innerHandler, {
      authenticateRunner: async () => {
        throw new RunnerAuthenticationError();
      },
    });

    const response = await handler(
      new Request("https://control-plane.test/api/runner/heartbeat", {
        headers: {
          authorization: "Bearer runner-secret-credential",
          "x-control-plane-runner-id": "runner_1",
        },
        method: "POST",
      }),
    );
    const responseText = await response.text();

    expect(response.status).toBe(401);
    expect(innerHandler).not.toHaveBeenCalled();
    expect(JSON.parse(responseText)).toEqual({
      error: {
        code: "invalid_runner_credential",
        message: "Invalid runner credentials.",
      },
      ok: false,
    });
    expect(responseText).not.toContain("runner-secret-credential");
    expect(responseText).not.toMatch(/bearer|authorization|credentialHash|Zod/i);
  });

  test("runner credential failures stay externally indistinguishable", async () => {
    const { createRouteError, createRunnerRouteHandler } = await importRouteHandlers();
    const privateDetails = [
      "missing Authorization header",
      "malformed bearer header",
      "unknown runner runner_1",
      "credential hash mismatch",
      "runner runner_1 revoked",
    ];

    for (const detail of privateDetails) {
      const handler = createRunnerRouteHandler(async () => {
        throw createRouteError("invalid_runner_credential", detail);
      });
      const response = await handler(new Request("https://control-plane.test/api/runner"));
      const responseText = await response.text();

      expect(response.status).toBe(401);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(JSON.parse(responseText)).toEqual({
        error: {
          code: "invalid_runner_credential",
          message: "Invalid runner credentials.",
        },
        ok: false,
      });
      expect(responseText).not.toContain(detail);
      expect(responseText).not.toMatch(/missing|malformed|unknown|mismatch|revoked|hash/i);
    }
  });

  test("keeps the runner link endpoint on the unauthenticated wrapper", async () => {
    const source = await readAppFile("../../app/api/runner/link/route.ts");

    expect(source).toContain("createRunnerRouteHandler");
    expect(source).not.toContain("createAuthenticatedRunnerRouteHandler");
  });
});

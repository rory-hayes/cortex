import {
  CONTRACT_VERSION,
  HeartbeatResponseSchema,
  RUNNER_PROTOCOL_ENDPOINTS,
  type HeartbeatResponse,
} from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import { postRunnerProtocolRequest } from "./client.js";

const runnerCredential = "runner-credential-secret";

describe("runner protocol client", () => {
  test("normalizes app origins and API bases to runner protocol endpoints", async () => {
    for (const [baseUrl, expectedUrl] of [
      ["http://localhost:3000", "http://localhost:3000/api/runner/heartbeat"],
      ["http://localhost:3000/", "http://localhost:3000/api/runner/heartbeat"],
      ["http://localhost:3000/api", "http://localhost:3000/api/runner/heartbeat"],
      ["http://localhost:3000/api/", "http://localhost:3000/api/runner/heartbeat"],
      ["https://control-plane.test", "https://control-plane.test/api/runner/heartbeat"],
      ["https://control-plane.test/api", "https://control-plane.test/api/runner/heartbeat"],
    ] as const) {
      const fetch = vi.fn(async () => jsonResponse({ ok: true, data: heartbeatResponse() }));

      await postRunnerProtocolRequest({
        baseUrl,
        endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
        fetch,
        request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
        responseSchema: HeartbeatResponseSchema,
        runnerCredential,
        runnerId: "runner_1",
      });

      expect(fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: "POST",
          redirect: "manual",
        }),
      );
    }
  });

  test("rejects unsupported, credentialed, query, fragment, and nonlocal HTTP base URLs", async () => {
    for (const baseUrl of [
      "ftp://localhost:3000/api",
      "http://user:pass@localhost:3000/api",
      "http://localhost:3000/api?token=secret",
      "http://localhost:3000/api#fragment",
      "http://control-plane.test/api",
      "not a url",
    ]) {
      const fetch = vi.fn();

      await expect(
        postRunnerProtocolRequest({
          baseUrl,
          endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
          fetch,
          request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
          responseSchema: HeartbeatResponseSchema,
          runnerCredential,
          runnerId: "runner_1",
        }),
      ).rejects.toMatchObject({
        category: "usage",
        message:
          "Runner API base URL must be an http localhost URL or https URL without embedded credentials.",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  test("posts JSON with runner authentication headers and parses ok response envelopes", async () => {
    const fetch = vi.fn(async () => jsonResponse({ ok: true, data: heartbeatResponse() }));
    const request = { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" };

    const result = await postRunnerProtocolRequest({
      baseUrl: "https://control-plane.test/api",
      endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
      fetch,
      request,
      responseSchema: HeartbeatResponseSchema,
      runnerCredential,
      runnerId: "runner_1",
    });

    expect(result).toEqual(heartbeatResponse());
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      "https://control-plane.test/api/runner/heartbeat",
      expect.objectContaining({
        body: JSON.stringify(request),
        headers: {
          authorization: `Bearer ${runnerCredential}`,
          "content-type": "application/json",
          "x-control-plane-runner-id": "runner_1",
        },
        method: "POST",
        redirect: "manual",
      }),
    );
  });

  test("maps ok false envelopes and invalid response bodies to safe errors", async () => {
    const cases = [
      {
        fetch: vi.fn(async () =>
          jsonResponse({
            error: {
              code: "invalid_runner_credential",
              message: `Bearer ${runnerCredential}`,
            },
            ok: false,
          }),
        ),
        message: "Runner protocol request was rejected.",
      },
      {
        fetch: vi.fn(async () => ({
          json: async () => {
            throw new Error(`invalid JSON for ${runnerCredential}`);
          },
          ok: true,
          status: 200,
        })),
        message: "Runner protocol response was invalid.",
      },
      {
        fetch: vi.fn(async () =>
          jsonResponse({
            data: {
              contractVersion: CONTRACT_VERSION,
              runnerCredential,
            },
            ok: true,
          }),
        ),
        message: "Runner protocol response was invalid.",
      },
    ];

    for (const testCase of cases) {
      let caughtError: unknown;

      try {
        await postRunnerProtocolRequest({
          baseUrl: "https://control-plane.test/api",
          endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
          fetch: testCase.fetch,
          request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
          responseSchema: HeartbeatResponseSchema,
          runnerCredential,
          runnerId: "runner_1",
        });
      } catch (error) {
        caughtError = error;
      }

      expect(caughtError).toMatchObject({
        category: "command_execution",
        message: testCase.message,
      });

      const serialized = JSON.stringify(caughtError);

      expect(serialized).not.toContain(runnerCredential);
      expect(serialized).not.toMatch(/bearer/i);
    }
  });

  test("retries network, 408, 429, and 5xx failures but not 400 or 401 responses", async () => {
    const networkThenOk = vi
      .fn()
      .mockRejectedValueOnce(new Error(`network ${runnerCredential}`))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: heartbeatResponse() }));
    const statusThenOk = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 408))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 429))
      .mockResolvedValueOnce(jsonResponse({ ok: false }, 503))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: heartbeatResponse() }));
    const badRequest = vi.fn(async () => jsonResponse({ ok: false }, 400));
    const unauthorized = vi.fn(async () => jsonResponse({ ok: false }, 401));

    await expect(
      postRunnerProtocolRequest({
        baseUrl: "https://control-plane.test/api",
        endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
        fetch: networkThenOk,
        maxAttempts: 2,
        request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
        responseSchema: HeartbeatResponseSchema,
        runnerCredential,
        runnerId: "runner_1",
      }),
    ).resolves.toEqual(heartbeatResponse());
    expect(networkThenOk).toHaveBeenCalledTimes(2);

    await expect(
      postRunnerProtocolRequest({
        baseUrl: "https://control-plane.test/api",
        endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
        fetch: statusThenOk,
        maxAttempts: 4,
        request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
        responseSchema: HeartbeatResponseSchema,
        runnerCredential,
        runnerId: "runner_1",
      }),
    ).resolves.toEqual(heartbeatResponse());
    expect(statusThenOk).toHaveBeenCalledTimes(4);

    await expect(
      postRunnerProtocolRequest({
        baseUrl: "https://control-plane.test/api",
        endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
        fetch: badRequest,
        request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
        responseSchema: HeartbeatResponseSchema,
        runnerCredential,
        runnerId: "runner_1",
      }),
    ).rejects.toMatchObject({
      message: "Runner protocol request was rejected.",
    });
    expect(badRequest).toHaveBeenCalledTimes(1);

    await expect(
      postRunnerProtocolRequest({
        baseUrl: "https://control-plane.test/api",
        endpoint: RUNNER_PROTOCOL_ENDPOINTS.heartbeat,
        fetch: unauthorized,
        request: { contractVersion: CONTRACT_VERSION, runnerId: "runner_1" },
        responseSchema: HeartbeatResponseSchema,
        runnerCredential,
        runnerId: "runner_1",
      }),
    ).rejects.toMatchObject({
      message: "Runner protocol request was rejected.",
    });
    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});

const heartbeatResponse = (): HeartbeatResponse => ({
  contractVersion: CONTRACT_VERSION,
  pollIntervalSeconds: 15,
  serverTime: "2026-05-22T16:00:00.000Z",
});

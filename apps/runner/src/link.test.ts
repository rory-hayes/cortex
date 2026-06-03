import {
  CONTRACT_VERSION,
  RUNNER_PROTOCOL_ENDPOINTS,
  type LinkRunnerResponse,
  type RunnerCapabilities,
} from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import { runRunnerLink, type RunnerLinkSafeSummary } from "./link.js";

const pairingCode = "PAIR-SECRET-VALUE";
const runnerCredential = "runner-credential-secret";

describe("runner link client", () => {
  test("posts a schema-valid link request, stores the credential, and returns safe metadata", async () => {
    const capabilities = runnerCapabilities();
    const fetch = vi.fn(async () => jsonResponse({ ok: true, data: linkResponse() }));
    const detectCapabilities = vi.fn(async () => capabilities);
    const storeCredential = vi.fn(async (): Promise<RunnerLinkSafeSummary> => safeSummary());

    const result = await runRunnerLink(
      {
        baseUrl: "http://localhost:3000/api",
        code: pairingCode,
      },
      {
        detectCapabilities,
        fetch,
        now: () => new Date("2026-05-22T13:00:00.000Z"),
        storeCredential,
      },
    );

    expect(detectCapabilities).toHaveBeenCalledWith({
      now: expect.any(Function),
    });
    expect(fetch).toHaveBeenCalledWith(
      `http://localhost:3000/api${RUNNER_PROTOCOL_ENDPOINTS.linkRunner}`,
      expect.objectContaining({
        headers: {
          "content-type": "application/json",
        },
        method: "POST",
      }),
    );
    const requestInit = (
      fetch.mock.calls[0] as
        | [string, { body: string; headers: Record<string, string>; method: string }]
        | undefined
    )?.[1];
    expect(requestInit).toBeDefined();
    expect(JSON.parse(requestInit?.body ?? "{}")).toEqual({
      capabilities,
      contractVersion: CONTRACT_VERSION,
      pairingCode,
      requestedAt: "2026-05-22T13:00:00.000Z",
    });
    expect(storeCredential).toHaveBeenCalledWith({
      credential: linkResponse(),
      now: expect.any(Function),
    });
    expect(storeCredential).toHaveBeenCalledTimes(1);
    expect(result).toEqual(safeSummary());
    expect(JSON.stringify(result)).not.toContain(pairingCode);
    expect(JSON.stringify(result)).not.toContain(runnerCredential);
  });

  test("normalizes app origins and API bases to the runner link API route", async () => {
    for (const [baseUrl, expectedUrl] of [
      ["http://localhost:3000", "http://localhost:3000/api/runner/link"],
      ["http://localhost:3000/", "http://localhost:3000/api/runner/link"],
      ["http://localhost:3000/api", "http://localhost:3000/api/runner/link"],
      ["http://localhost:3000/api/", "http://localhost:3000/api/runner/link"],
      ["https://control-plane.test", "https://control-plane.test/api/runner/link"],
      ["https://control-plane.test/api", "https://control-plane.test/api/runner/link"],
    ] as const) {
      const fetch = vi.fn(async () => jsonResponse({ ok: true, data: linkResponse() }));

      await runRunnerLink(
        {
          baseUrl,
          code: pairingCode,
        },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
          storeCredential: async () => safeSummary(),
        },
      );

      expect(fetch).toHaveBeenCalledWith(
        expectedUrl,
        expect.objectContaining({
          method: "POST",
          redirect: "manual",
        }),
      );
    }
  });

  test("rejects blank pairing codes locally without echoing the code", async () => {
    await expect(
      runRunnerLink(
        {
          baseUrl: "http://localhost:3000/api",
          code: "   ",
        },
        {
          fetch: vi.fn(),
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "Pairing code is required.",
    });
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
        runRunnerLink(
          {
            baseUrl,
            code: pairingCode,
          },
          {
            fetch,
          },
        ),
      ).rejects.toMatchObject({
        category: "usage",
        message:
          "Runner API base URL must be an http localhost URL or https URL without embedded credentials.",
      });
      expect(fetch).not.toHaveBeenCalled();
    }
  });

  test("accepts local plain HTTP loopback hosts", async () => {
    for (const baseUrl of [
      "http://localhost:3000/api",
      "http://127.0.0.1:3000/api",
      "http://127.12.34.56:3000/api",
      "http://[::1]:3000/api",
    ]) {
      const fetch = vi.fn(async () => jsonResponse({ ok: true, data: linkResponse() }));

      await expect(
        runRunnerLink(
          {
            baseUrl,
            code: pairingCode,
          },
          {
            detectCapabilities: async () => runnerCapabilities(),
            fetch,
            storeCredential: async () => safeSummary(),
          },
        ),
      ).resolves.toEqual(safeSummary());
    }
  });

  test("maps invalid or expired pairing code responses to a safe runner error", async () => {
    const fetch = vi.fn(async () =>
      jsonResponse(
        {
          error: {
            code: "invalid_pairing_code",
            message: "The pairing code is invalid or expired.",
          },
          ok: false,
        },
        401,
      ),
    );

    await expect(
      runRunnerLink(
        {
          baseUrl: "http://localhost:3000/api",
          code: pairingCode,
        },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch,
        },
      ),
    ).rejects.toMatchObject({
      category: "usage",
      message: "The pairing code is invalid or expired.",
    });
  });

  test("handles network failure, invalid JSON, and invalid response schema without leaking secrets", async () => {
    const cases = [
      {
        fetch: vi.fn(async () => {
          throw new Error(`network failed for ${pairingCode} ${runnerCredential}`);
        }),
        message: "Runner link request failed.",
      },
      {
        fetch: vi.fn(async () => ({
          json: async () => {
            throw new Error(`invalid JSON ${pairingCode} ${runnerCredential}`);
          },
          ok: true,
          status: 200,
        })),
        message: "Runner link response was invalid.",
      },
      {
        fetch: vi.fn(async () => jsonResponse({ ok: true, data: { runnerCredential } })),
        message: "Runner link response was invalid.",
      },
    ];

    for (const testCase of cases) {
      await expect(
        runRunnerLink(
          {
            baseUrl: "http://localhost:3000/api",
            code: pairingCode,
          },
          {
            detectCapabilities: async () => runnerCapabilities(),
            fetch: testCase.fetch,
          },
        ),
      ).rejects.toMatchObject({
        message: testCase.message,
      });

      await runRunnerLink(
        {
          baseUrl: "http://localhost:3000/api",
          code: pairingCode,
        },
        {
          detectCapabilities: async () => runnerCapabilities(),
          fetch: testCase.fetch,
        },
      ).catch((error: unknown) => {
        const serialized = JSON.stringify(error);

        expect(serialized).not.toContain(pairingCode);
        expect(serialized).not.toContain(runnerCredential);
      });
    }
  });

  test("wraps credential-store failures without leaking the pairing code or credential", async () => {
    await runRunnerLink(
      {
        baseUrl: "http://localhost:3000/api",
        code: pairingCode,
      },
      {
        detectCapabilities: async () => runnerCapabilities(),
        fetch: vi.fn(async () => jsonResponse({ ok: true, data: linkResponse() })),
        storeCredential: vi.fn(async () => {
          throw new Error(`${runnerCredential} ${pairingCode}`);
        }),
      },
    ).catch((error: unknown) => {
      expect(error).toMatchObject({
        category: "command_execution",
        message: "Runner credential could not be stored.",
      });

      const serialized = JSON.stringify(error);

      expect(serialized).not.toContain(pairingCode);
      expect(serialized).not.toContain(runnerCredential);
    });
  });
});

const jsonResponse = (body: unknown, status = 200) => ({
  json: async () => body,
  ok: status >= 200 && status < 300,
  status,
});

const runnerCapabilities = (): RunnerCapabilities => ({
  contractVersion: CONTRACT_VERSION,
  maxConcurrentJobs: 1,
  os: {
    arch: "arm64",
    platform: "darwin",
    release: "25.0.0",
  },
  reportedAt: "2026-05-22T13:00:00.000Z",
  shell: "/bin/zsh",
  supportsCancellation: false,
  supportsDryRun: true,
  tools: {
    codex: { available: true, version: "1.2.3" },
    gh: { available: true, version: "2.72.0" },
    git: { available: true, version: "2.49.0" },
    node: { available: true, version: "24.0.0" },
    npm: { available: false },
    pnpm: { available: true, version: "9.15.9" },
    python: { available: false },
    yarn: { available: false },
  },
});

const linkResponse = (): LinkRunnerResponse => ({
  contractVersion: CONTRACT_VERSION,
  linkedAt: "2026-05-22T13:01:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "http://localhost:3000/api",
  runnerCredential,
  runnerId: "runner_1",
  workspaceId: "workspace_1",
});

const safeSummary = (): RunnerLinkSafeSummary => ({
  contractVersion: CONTRACT_VERSION,
  credentialStored: true,
  linkedAt: "2026-05-22T13:01:00.000Z",
  pollIntervalSeconds: 15,
  pollingBaseUrl: "http://localhost:3000/api",
  runnerId: "runner_1",
  storedAt: "2026-05-22T13:02:00.000Z",
  workspaceId: "workspace_1",
});

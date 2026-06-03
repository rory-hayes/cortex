import { readFile } from "node:fs/promises";

import { beforeEach, describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  LinkRunnerResponseSchema,
  type LinkRunnerRequest,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));

const mocks = vi.hoisted(() => ({
  createDrizzleRunnerLinkStore: vi.fn(),
  createRunnerLinkService: vi.fn(),
  getDatabase: vi.fn(),
  linkRunner: vi.fn(),
}));

vi.mock("../../../../src/db", () => ({
  getDatabase: mocks.getDatabase,
}));

vi.mock("../../../../src/runner-auth", () => ({
  RUNNER_LINK_POLL_INTERVAL_SECONDS: 15,
  createDrizzleRunnerLinkStore: mocks.createDrizzleRunnerLinkStore,
  createRunnerLinkService: mocks.createRunnerLinkService,
}));

const importRoute = async () => import("./route");
const readRouteSource = () => readFile(new URL("./route.ts", import.meta.url), "utf8");

const validRequestBody = (overrides: Partial<LinkRunnerRequest> = {}): LinkRunnerRequest => ({
  contractVersion: CONTRACT_VERSION,
  pairingCode: "PAIR-123456",
  capabilities: {
    contractVersion: CONTRACT_VERSION,
    runnerId: "runner_from_request",
    os: {
      platform: "darwin",
      release: "25.5.0",
      arch: "arm64",
    },
    shell: "/bin/zsh",
    tools: {
      git: {
        available: true,
        version: "2.49.0",
        path: "/usr/bin/git",
      },
      node: {
        available: true,
        version: "24.0.0",
        path: "/opt/homebrew/bin/node",
      },
    },
    maxConcurrentJobs: 1,
    supportsDryRun: true,
    supportsCancellation: true,
    reportedAt: "2026-05-22T12:59:30.000Z",
  },
  requestedAt: "2026-05-22T13:00:00.000Z",
  ...overrides,
});

const validLinkResponse = () =>
  LinkRunnerResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    runnerId: "runner_server",
    workspaceId: "workspace_1",
    runnerCredential: "runner-secret-credential",
    pollingBaseUrl: "https://control-plane.test/api",
    pollIntervalSeconds: 15,
    linkedAt: "2026-05-22T13:00:01.000Z",
  });

const post = async (body: unknown, url = "https://control-plane.test/api/runner/link") => {
  const { POST } = await importRoute();

  return POST(
    new Request(url, {
      body: JSON.stringify(body),
      method: "POST",
    }),
  );
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getDatabase.mockReturnValue({ db: { kind: "test-db" } });
  mocks.createDrizzleRunnerLinkStore.mockReturnValue({ kind: "test-store" });
  mocks.createRunnerLinkService.mockReturnValue({ linkRunner: mocks.linkRunner });
  mocks.linkRunner.mockResolvedValue({
    response: validLinkResponse(),
    status: "linked",
  });
});

describe("POST /api/runner/link", () => {
  test("returns 400 invalid_request for invalid JSON", async () => {
    const { POST } = await importRoute();
    const response = await POST(
      new Request("https://control-plane.test/api/runner/link", {
        body: "{",
        method: "POST",
      }),
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "invalid_request",
        message: "The request is invalid.",
      },
      ok: false,
    });
    expect(mocks.linkRunner).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for invalid schema without Zod details or raw values", async () => {
    const response = await post({
      contractVersion: CONTRACT_VERSION,
      pairingCode: "PAIR-SECRET-VALUE",
      capabilities: {
        contractVersion: CONTRACT_VERSION,
        shell: "",
      },
      requestedAt: "2026-05-22T13:00:00.000Z",
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
    expect(responseText).not.toContain("PAIR-SECRET-VALUE");
    expect(responseText).not.toMatch(/Zod|capabilities|shell|min/i);
    expect(mocks.linkRunner).not.toHaveBeenCalled();
  });

  test("returns 400 invalid_request for unsafe schema-valid capability values before service work", async () => {
    const unsafeValue = "diff --git a/src/private.ts b/src/private.ts";
    const response = await post(
      validRequestBody({
        capabilities: {
          ...validRequestBody().capabilities,
          tools: {
            git: {
              available: true,
              version: unsafeValue,
            },
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
    expect(responseText).not.toContain(unsafeValue);
    expect(responseText).not.toMatch(/Zod|capabilities|tools|version|diff --git|request body/i);
    expect(mocks.getDatabase).not.toHaveBeenCalled();
    expect(mocks.linkRunner).not.toHaveBeenCalled();
  });

  test("returns one generic 401 invalid_pairing_code for expired, used, unknown, and blank codes", async () => {
    mocks.linkRunner.mockResolvedValue({ status: "invalid_pairing_code" });

    for (const pairingCode of ["EXPIRED-CODE", "USED-CODE", "UNKNOWN-CODE", ""]) {
      const response = await post(validRequestBody({ pairingCode }));

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({
        error: {
          code: "invalid_pairing_code",
          message: "The pairing code is invalid or expired.",
        },
        ok: false,
      });
    }
  });

  test("returns schema-valid envelope data for a valid link request", async () => {
    const response = await post(validRequestBody());
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body).toEqual({
      data: validLinkResponse(),
      ok: true,
    });
    expect(LinkRunnerResponseSchema.safeParse(body.data).success).toBe(true);
  });

  test("returns no-store cache headers", async () => {
    const response = await post(validRequestBody());

    expect(response.headers.get("cache-control")).toBe("no-store");
  });

  test("derives pollingBaseUrl from the request origin as the API base", async () => {
    await post(validRequestBody(), "https://control-plane.test/api/runner/link?ignored=true");

    expect(mocks.linkRunner).toHaveBeenCalledWith({
      capabilities: validRequestBody().capabilities,
      pairingCode: "PAIR-123456",
      pollingBaseUrl: "https://control-plane.test/api",
    });
  });

  test("does not log credentials or request material in route source", async () => {
    const source = await readRouteSource();

    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/);
    expect(source).not.toMatch(
      /runnerCredential.*console|credential.*console|pairingCode.*console/i,
    );
  });

  test("remains pairing-code based rather than runner-credential authenticated", async () => {
    const response = await post(validRequestBody());
    const source = await readRouteSource();

    expect(response.status).toBe(200);
    expect(mocks.linkRunner).toHaveBeenCalledTimes(1);
    expect(source).toContain("createRunnerRouteHandler");
    expect(source).not.toMatch(
      /createAuthenticatedRunnerRouteHandler|authenticateRunnerRequest|authorization|bearer/i,
    );
  });
});

import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  RunnerCapabilitiesSchema,
  type RunnerCapabilities,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRunnerList = async () => import("./list");

const reportedAt = "2026-05-22T12:59:30.000Z";

const validCapabilities = (overrides: Partial<RunnerCapabilities> = {}): RunnerCapabilities =>
  RunnerCapabilitiesSchema.parse({
    contractVersion: CONTRACT_VERSION,
    os: {
      arch: "arm64",
      platform: "darwin",
      release: "25.5.0",
    },
    shell: "/bin/zsh",
    tools: {
      codex: {
        available: false,
        path: "/opt/private/bin/codex",
      },
      git: {
        available: true,
        path: "/usr/bin/git",
        version: "2.49.0",
      },
      node: {
        available: true,
        path: "/opt/homebrew/bin/node",
        version: "24.0.0",
      },
      pnpm: {
        available: true,
        path: "/opt/homebrew/bin/pnpm",
        version: "10.11.0",
      },
    },
    maxConcurrentJobs: 2,
    reportedAt,
    supportsCancellation: false,
    supportsDryRun: true,
    ...overrides,
  });

type StoredRunner = {
  capabilities: RunnerCapabilities;
  displayName: string;
  id: string;
  lastHeartbeatAt: Date | null;
  linkedAt: Date;
  revokedAt: Date | null;
  status: "busy" | "idle" | "offline";
  workspaceId: string;
};

const createRunner = (overrides: Partial<StoredRunner> = {}): StoredRunner => ({
  capabilities: validCapabilities(),
  displayName: "Mac Studio",
  id: "runner_1",
  lastHeartbeatAt: new Date("2026-05-22T13:00:00.000Z"),
  linkedAt: new Date("2026-05-22T12:58:00.000Z"),
  revokedAt: null,
  status: "idle",
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  input: {
    memberships?: Array<{ userId: string; workspaceId: string }>;
    runners?: StoredRunner[];
  } = {},
) => ({
  findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
    input.memberships?.some(
      (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
    )
      ? { id: "membership_1", role: "member" }
      : null,
  ),
  listWorkspaceRunners: vi.fn(async () => input.runners ?? []),
});

const expectNoUnsafeRunnerMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);

      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      if (
        /^(credential|credentialHash|credential_hash|hash|pairing|raw|request|secret|shell|token|tools|path|version|reportedAt)$/i.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("runner-secret-credential");
  expect(serialized).not.toContain("credential_hash_value");
  expect(serialized).not.toContain("RUNNER-LINK-CODE");
  expect(serialized).not.toContain("runner-token");
  expect(serialized).not.toContain("/bin/zsh");
  expect(serialized).not.toContain("/usr/bin/git");
  expect(serialized).not.toContain("/opt/homebrew/bin/node");
  expect(serialized).not.toContain("/opt/homebrew/bin/pnpm");
  expect(serialized).not.toContain("/opt/private/bin/codex");
  expect(unsafeKeys).toEqual([]);
};

describe("runner list service", () => {
  test("blocks unauthenticated users before returning runner rows", async () => {
    const { createRunnerListService } = await importRunnerList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: null }),
      store,
    });

    await expect(
      service.listWorkspaceRunners({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.listWorkspaceRunners).not.toHaveBeenCalled();
  });

  test("blocks authenticated non-members before returning runner rows", async () => {
    const { createRunnerListService } = await importRunnerList();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
      runners: [createRunner()],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(
      service.listWorkspaceRunners({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.listWorkspaceRunners).not.toHaveBeenCalled();
  });

  test("returns only runners for the requested workspace to authenticated members", async () => {
    const { createRunnerListService } = await importRunnerList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [
        createRunner({ id: "runner_1", workspaceId: "workspace_1" }),
        createRunner({
          displayName: "Hidden runner",
          id: "runner_2",
          workspaceId: "workspace_2",
        }),
      ],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRunners({ workspaceId: "workspace_1" })).resolves.toEqual([
      {
        capabilitiesSummary: {
          availableTools: ["git", "node", "pnpm"],
          maxConcurrentJobs: 2,
          supportsCancellation: false,
          supportsDryRun: true,
          toolAvailability: [
            { available: true, name: "git" },
            { available: false, name: "gh" },
            { available: false, name: "codex" },
            { available: true, name: "node" },
            { available: false, name: "npm" },
            { available: true, name: "pnpm" },
            { available: false, name: "yarn" },
            { available: false, name: "python" },
          ],
        },
        displayName: "Mac Studio",
        id: "runner_1",
        isRevoked: false,
        lastHeartbeatAt: new Date("2026-05-22T13:00:00.000Z"),
        linkedAt: new Date("2026-05-22T12:58:00.000Z"),
        revokedAt: null,
        status: "idle",
      },
    ]);
    expect(store.findWorkspaceMembership).toHaveBeenCalledWith({
      userId: "user_1",
      workspaceId: "workspace_1",
    });
    expect(store.listWorkspaceRunners).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
  });

  test("returns safe UI data without credentials, secret-like keys, tool paths, or raw capability internals", async () => {
    const { createRunnerListService } = await importRunnerList();
    const runnerWithUnsafeStoreFields = {
      ...createRunner(),
      credentialHash: "credential_hash_value",
      pairingCode: "RUNNER-LINK-CODE",
      rawCredential: "runner-secret-credential",
      token: "runner-token",
    } as unknown as StoredRunner;
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [runnerWithUnsafeStoreFields],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    const result = await service.listWorkspaceRunners({ workspaceId: "workspace_1" });

    expect(result[0]?.capabilitiesSummary).toEqual({
      availableTools: ["git", "node", "pnpm"],
      maxConcurrentJobs: 2,
      supportsCancellation: false,
      supportsDryRun: true,
      toolAvailability: [
        { available: true, name: "git" },
        { available: false, name: "gh" },
        { available: false, name: "codex" },
        { available: true, name: "node" },
        { available: false, name: "npm" },
        { available: true, name: "pnpm" },
        { available: false, name: "yarn" },
        { available: false, name: "python" },
      ],
    });
    expect(result[0]).toMatchObject({
      lastHeartbeatAt: new Date("2026-05-22T13:00:00.000Z"),
      linkedAt: new Date("2026-05-22T12:58:00.000Z"),
      revokedAt: null,
      status: "idle",
    });
    expectNoUnsafeRunnerMaterial(result);
  });

  test("includes revokedAt and computed revoked status for safe UI rendering", async () => {
    const { createRunnerListService } = await importRunnerList();
    const revokedAt = new Date("2026-05-22T13:30:00.000Z");
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [
        createRunner({
          id: "runner_revoked",
          revokedAt,
          status: "idle",
        }),
      ],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRunners({ workspaceId: "workspace_1" })).resolves.toEqual([
      expect.objectContaining({
        id: "runner_revoked",
        isRevoked: true,
        revokedAt,
        status: "revoked",
      }),
    ]);
  });

  test("returns an empty list for authenticated members when no runners are paired", async () => {
    const { createRunnerListService } = await importRunnerList();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      runners: [],
    });
    const service = createRunnerListService({
      getAuthContext: async () => ({ userId: "user_1" }),
      store,
    });

    await expect(service.listWorkspaceRunners({ workspaceId: "workspace_1" })).resolves.toEqual([]);
  });
});

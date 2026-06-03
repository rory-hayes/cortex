import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importInstallations = async () => import("./installations");

type StoredGitHubAppInstallation = {
  accountHtmlUrl: string | null;
  accountId: string;
  accountLogin: string;
  accountType: string;
  createdAt: Date;
  githubInstallationId: string;
  id: string;
  installationHtmlUrl: string | null;
  lastSyncedAt: Date;
  permissions: Record<string, string>;
  repositorySelection: "all" | "selected";
  suspendedAt: Date | null;
  updatedAt: Date;
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

const now = new Date("2026-05-24T15:00:00.000Z");
const suspendedAt = new Date("2026-05-25T15:00:00.000Z");

const createInstallation = (
  overrides: Partial<StoredGitHubAppInstallation> = {},
): StoredGitHubAppInstallation => ({
  accountHtmlUrl: "https://github.com/control-plane",
  accountId: "9876543210",
  accountLogin: "control-plane",
  accountType: "Organization",
  createdAt: now,
  githubInstallationId: "1234567890",
  id: "github_installation_1",
  installationHtmlUrl: "https://github.com/apps/control-plane/installations/1234567890",
  lastSyncedAt: now,
  permissions: {
    contents: "read",
    metadata: "read",
  },
  repositorySelection: "selected",
  suspendedAt: null,
  updatedAt: now,
  workspaceId: "workspace_1",
  ...overrides,
});

const validPersistInput = {
  installation: {
    account: {
      htmlUrl: " https://github.com/control-plane ",
      id: 9_876_543_210,
      login: " control-plane ",
      type: " Organization ",
    },
    htmlUrl: " https://github.com/apps/control-plane/installations/1234567890 ",
    id: 1_234_567_890,
    permissions: {
      pull_requests: "write",
      metadata: "read",
      issues: "read",
    },
    repositorySelection: " selected ",
    suspendedAt: null,
  },
  workspaceId: " workspace_1 ",
};

const createStore = (
  options: {
    installations?: StoredGitHubAppInstallation[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
  } = {},
) => {
  const installations = [...(options.installations ?? [])];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    installations,
    listGitHubInstallations: vi.fn(async (input: { workspaceId: string }) =>
      installations.filter((installation) => installation.workspaceId === input.workspaceId),
    ),
    upsertGitHubInstallationWithAudit: vi.fn(
      async (input: {
        auditEventFor: (row: StoredGitHubAppInstallation) => StoredAuditEvent;
        installation: StoredGitHubAppInstallation;
      }): Promise<StoredGitHubAppInstallation> => {
        const existing = installations.find(
          (candidate) =>
            candidate.workspaceId === input.installation.workspaceId &&
            candidate.githubInstallationId === input.installation.githubInstallationId,
        );

        if (existing === undefined) {
          installations.push(input.installation);
          auditEvents.push(input.auditEventFor(input.installation));

          return input.installation;
        }

        Object.assign(existing, {
          accountHtmlUrl: input.installation.accountHtmlUrl,
          accountId: input.installation.accountId,
          accountLogin: input.installation.accountLogin,
          accountType: input.installation.accountType,
          installationHtmlUrl: input.installation.installationHtmlUrl,
          lastSyncedAt: input.installation.lastSyncedAt,
          permissions: input.installation.permissions,
          repositorySelection: input.installation.repositorySelection,
          suspendedAt: input.installation.suspendedAt,
          updatedAt: input.installation.updatedAt,
        });
        auditEvents.push(input.auditEventFor(existing));

        return existing;
      },
    ),
  };
};

const createService = async (
  store: ReturnType<typeof createStore>,
  userId: string | null = "user_1",
) => {
  const { createGitHubInstallationService } = await importInstallations();

  return createGitHubInstallationService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    createInstallationId: () => `github_installation_${store.installations.length + 1}`,
    getAuthContext: async () => ({ userId }),
    now: () => now,
    store,
  });
};

const expectNoUnsafeInstallationMaterial = (value: unknown) => {
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
        /^(?:accessToken|code|credential|diff|patch|privateKey|rawPayload|secret|source|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("ghp_installationsecret");
  expect(serialized).not.toContain("raw_payload");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("-----BEGIN");
  expect(unsafeKeys).toEqual([]);
};

describe("GitHub App installation service", () => {
  test("rejects unauthenticated users before persisting or listing installations", async () => {
    const store = createStore();
    const service = await createService(store, null);

    await expect(service.persistGitHubInstallation(validPersistInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      service.listGitHubInstallations({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.upsertGitHubInstallationWithAudit).not.toHaveBeenCalled();
    expect(store.listGitHubInstallations).not.toHaveBeenCalled();
  });

  test("rejects non-members before persisting or listing workspace installations", async () => {
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    await expect(service.persistGitHubInstallation(validPersistInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service.listGitHubInstallations({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.upsertGitHubInstallationWithAudit).not.toHaveBeenCalled();
    expect(store.listGitHubInstallations).not.toHaveBeenCalled();
  });

  test("persists a valid installation with normalized string ids and sorted permissions", async () => {
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const service = await createService(store);

    const result = await service.persistGitHubInstallation(validPersistInput);

    expect(store.installations).toEqual([
      {
        ...createInstallation({
          permissions: {
            issues: "read",
            metadata: "read",
            pull_requests: "write",
          },
        }),
      },
    ]);
    expect(Object.keys(store.installations[0]?.permissions ?? {})).toEqual([
      "issues",
      "metadata",
      "pull_requests",
    ]);
    expect(result).toEqual(store.installations[0]);
    expect(result.githubInstallationId).toBe("1234567890");
    expect(result.accountId).toBe("9876543210");
    expectNoUnsafeInstallationMaterial({ result, stored: store.installations });
  });

  test("upserts the same workspace and installation id without creating duplicates", async () => {
    const existing = createInstallation({
      id: "github_installation_existing",
      permissions: { metadata: "read" },
    });
    const store = createStore({
      installations: [existing],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    const result = await service.persistGitHubInstallation({
      ...validPersistInput,
      installation: {
        ...validPersistInput.installation,
        permissions: { contents: "read", metadata: "read" },
        repositorySelection: "all",
        suspendedAt: suspendedAt.toISOString(),
      },
    });

    expect(store.installations).toHaveLength(1);
    expect(result).toMatchObject({
      id: "github_installation_existing",
      permissions: { contents: "read", metadata: "read" },
      repositorySelection: "all",
      suspendedAt,
    });
    expect(store.auditEvents[0]?.metadata).toMatchObject({
      installationId: "github_installation_existing",
    });
  });

  test("lists only installations for the caller workspace", async () => {
    const store = createStore({
      installations: [
        createInstallation(),
        createInstallation({
          githubInstallationId: "222",
          id: "github_installation_2",
          workspaceId: "workspace_2",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    await expect(
      service.listGitHubInstallations({ workspaceId: " workspace_1 " }),
    ).resolves.toEqual([createInstallation()]);
  });

  test("returns safe installation metadata only", async () => {
    const installation = createInstallation();
    const store = createStore({
      installations: [installation],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    const result = await service.listGitHubInstallations({ workspaceId: "workspace_1" });

    expect(result).toEqual([installation]);
    expectNoUnsafeInstallationMaterial(result);
  });

  test("rejects unsafe text, control characters, and secret-like permission fields", async () => {
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const service = await createService(store);

    await expect(
      service.persistGitHubInstallation({
        ...validPersistInput,
        installation: {
          ...validPersistInput.installation,
          account: {
            ...validPersistInput.installation.account,
            login: "control\u0000plane",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    await expect(
      service.persistGitHubInstallation({
        ...validPersistInput,
        installation: {
          ...validPersistInput.installation,
          permissions: {
            access_token: "read",
          },
        },
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.upsertGitHubInstallationWithAudit).not.toHaveBeenCalled();
  });

  test("writes audit metadata with ids, counts, and status only", async () => {
    const store = createStore({ memberships: [{ userId: "user_1", workspaceId: "workspace_1" }] });
    const service = await createService(store);

    await service.persistGitHubInstallation(validPersistInput);

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        createdAt: now,
        eventType: "github_app_installation.synced",
        id: "audit_1",
        metadata: {
          accountId: "9876543210",
          githubInstallationId: "1234567890",
          installationId: "github_installation_1",
          permissionCount: 3,
          repositorySelection: "selected",
          suspended: false,
        },
        workspaceId: "workspace_1",
      }),
    ]);

    const serializedAudit = JSON.stringify(store.auditEvents);
    expect(serializedAudit).not.toContain("control-plane");
    expect(serializedAudit).not.toContain("github.com");
    expect(serializedAudit).not.toContain("pull_requests");
    expectNoUnsafeInstallationMaterial(store.auditEvents);
  });

  test("keeps the installation module server-only and free of client component directives", async () => {
    const source = await readFile(new URL("./installations.ts", import.meta.url), "utf8");

    expect(source.trimStart()).toMatch(/^import "server-only";/u);
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("'use client'");
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/u);
  });
});

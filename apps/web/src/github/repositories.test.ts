import { readFile } from "node:fs/promises";

import { describe, expect, test, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRepositories = async () => import("./repositories");

type StoredGitHubInstallation = {
  githubInstallationId: string;
  id: string;
  workspaceId: string;
};

type StoredGitHubRepository = {
  archived: boolean;
  createdAt: Date;
  defaultBranch: string;
  disabled: boolean;
  githubAppInstallationId: string;
  githubInstallationId: string;
  htmlUrl: string | null;
  id: string;
  isPrivate: boolean;
  lastSyncedAt: Date;
  repositoryExternalId: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  updatedAt: Date;
  visibility: string | null;
  workspaceId: string;
};

type StoredRepoMapping = {
  archivedAt: Date | null;
  githubInstallationId: string | null;
  id: string;
  remoteUrl: string | null;
  repositoryExternalId: string | null;
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

const now = new Date("2026-05-24T16:15:00.000Z");
const later = new Date("2026-05-24T17:15:00.000Z");

const createInstallation = (
  overrides: Partial<StoredGitHubInstallation> = {},
): StoredGitHubInstallation => ({
  githubInstallationId: "42",
  id: "github_app_installation_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const repositoryInput = (overrides: Record<string, unknown> = {}) => ({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  fullName: "acme/control-plane",
  htmlUrl: "https://github.example.test/acme/control-plane",
  id: 9001,
  name: "control-plane",
  owner: "acme",
  private: true,
  visibility: "private",
  ...overrides,
});

const createStore = (
  options: {
    installations?: StoredGitHubInstallation[];
    mappings?: StoredRepoMapping[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredGitHubRepository[];
  } = {},
) => {
  const installations = [...(options.installations ?? [createInstallation()])];
  const repositories = [...(options.repositories ?? [])];
  const mappings = [...(options.mappings ?? [])];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    findGitHubAppInstallation: vi.fn(
      async (input: { githubInstallationId: string; workspaceId?: string }) =>
        installations.find(
          (installation) =>
            installation.githubInstallationId === input.githubInstallationId &&
            (input.workspaceId === undefined || installation.workspaceId === input.workspaceId),
        ) ?? null,
    ),
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      options.memberships?.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    insertAuditEvent: vi.fn(async (event: StoredAuditEvent) => {
      auditEvents.push(event);
    }),
    listActiveRepoMappingsForGitHubSync: vi.fn(async (input: { workspaceId: string }) =>
      mappings.filter(
        (mapping) => mapping.workspaceId === input.workspaceId && mapping.archivedAt === null,
      ),
    ),
    listGitHubRepositories: vi.fn(async (input: { workspaceId: string }) =>
      repositories.filter((repository) => repository.workspaceId === input.workspaceId),
    ),
    mappings,
    repositories,
    updateRepoMappingGitHubRepositoryLink: vi.fn(
      async (input: {
        githubInstallationId: string;
        repoMappingId: string;
        repositoryExternalId: string;
        updatedAt: Date;
        workspaceId: string;
      }) => {
        const mapping = mappings.find(
          (candidate) =>
            candidate.id === input.repoMappingId &&
            candidate.workspaceId === input.workspaceId &&
            candidate.archivedAt === null,
        );

        if (mapping !== undefined) {
          mapping.githubInstallationId = input.githubInstallationId;
          mapping.repositoryExternalId = input.repositoryExternalId;
        }
      },
    ),
    upsertGitHubRepository: vi.fn(
      async (input: {
        createRepositoryId: () => string;
        repository: Omit<StoredGitHubRepository, "createdAt" | "id" | "updatedAt"> & {
          createdAt?: Date;
          id?: string;
          updatedAt: Date;
        };
      }) => {
        const existing = repositories.find(
          (candidate) =>
            candidate.workspaceId === input.repository.workspaceId &&
            candidate.githubInstallationId === input.repository.githubInstallationId &&
            candidate.repositoryExternalId === input.repository.repositoryExternalId,
        );

        if (existing === undefined) {
          const inserted = {
            ...input.repository,
            createdAt: input.repository.createdAt ?? input.repository.updatedAt,
            id: input.repository.id ?? input.createRepositoryId(),
          } satisfies StoredGitHubRepository;

          repositories.push(inserted);

          return inserted;
        }

        Object.assign(existing, {
          archived: input.repository.archived,
          defaultBranch: input.repository.defaultBranch,
          disabled: input.repository.disabled,
          htmlUrl: input.repository.htmlUrl,
          isPrivate: input.repository.isPrivate,
          lastSyncedAt: input.repository.lastSyncedAt,
          repositoryFullName: input.repository.repositoryFullName,
          repositoryName: input.repository.repositoryName,
          repositoryOwner: input.repository.repositoryOwner,
          updatedAt: input.repository.updatedAt,
          visibility: input.repository.visibility,
        });

        return existing;
      },
    ),
  };
};

const createService = async (
  store: ReturnType<typeof createStore>,
  userId: string | null = "user_1",
  currentTime = now,
) => {
  const { createGitHubRepositoryService } = await importRepositories();

  return createGitHubRepositoryService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    createRepositoryId: () => `github_repository_${store.repositories.length + 1}`,
    getAuthContext: async () => ({ userId }),
    now: () => currentTime,
    store,
  });
};

const expectNoUnsafeRepositoryMaterial = (value: unknown) => {
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
        /^(?:body|code|content|diff|log|output|patch|rawPayload|raw_payload|secret|source|stderr|stdout|token)$/iu.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("ghp_payloadTokenMustNotLeaveRoute");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("Do not expose this file");
  expect(serialized).not.toContain("contents_url");
  expect(unsafeKeys).toEqual([]);
};

describe("GitHub repository metadata service", () => {
  test("rejects unauthenticated users and non-members before list or sync", async () => {
    const unauthenticatedStore = createStore();
    const unauthenticatedService = await createService(unauthenticatedStore, null);

    await expect(
      unauthenticatedService.listGitHubRepositories({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    await expect(
      unauthenticatedService.syncGitHubRepositoriesForInstallation({
        githubInstallationId: 42,
        repositories: [repositoryInput()],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(unauthenticatedStore.upsertGitHubRepository).not.toHaveBeenCalled();
    expect(unauthenticatedStore.listGitHubRepositories).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMemberService = await createService(nonMemberStore);

    await expect(
      nonMemberService.listGitHubRepositories({ workspaceId: "workspace_1" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      nonMemberService.syncGitHubRepositoriesForInstallation({
        githubInstallationId: 42,
        repositories: [repositoryInput()],
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.upsertGitHubRepository).not.toHaveBeenCalled();
    expect(nonMemberStore.listGitHubRepositories).not.toHaveBeenCalled();
  });

  test("persists safe repository metadata for a stored installation", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    const result = await service.syncGitHubRepositoriesForInstallation({
      githubInstallationId: "42",
      repositories: [
        repositoryInput({
          contents_url: "https://api.github.example.test/repos/acme/control-plane/contents/{+path}",
          raw_payload: "Do not expose this file",
          token: "ghp_payloadTokenMustNotLeaveRoute",
        }),
      ],
      workspaceId: " workspace_1 ",
    });

    expect(result.syncedRepositoryCount).toBe(1);
    expect(result.matchedRepoMappingCount).toBe(0);
    expect(store.repositories).toEqual([
      {
        archived: false,
        createdAt: now,
        defaultBranch: "main",
        disabled: false,
        githubAppInstallationId: "github_app_installation_1",
        githubInstallationId: "42",
        htmlUrl: "https://github.example.test/acme/control-plane",
        id: "github_repository_1",
        isPrivate: true,
        lastSyncedAt: now,
        repositoryExternalId: "9001",
        repositoryFullName: "acme/control-plane",
        repositoryName: "control-plane",
        repositoryOwner: "acme",
        updatedAt: now,
        visibility: "private",
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "github_repositories.synced",
        id: "audit_1",
        metadata: {
          githubAppInstallationId: "github_app_installation_1",
          githubInstallationId: "42",
          matchedRepoMappingCount: 0,
          repositoryCount: 1,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeRepositoryMaterial({
      result,
      stored: store.repositories,
      audit: store.auditEvents,
    });
  });

  test("upserts the same repository without duplicates and updates later metadata", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    await service.syncGitHubRepositoriesForInstallation({
      githubInstallationId: 42,
      repositories: [repositoryInput()],
      workspaceId: "workspace_1",
    });
    const laterService = await createService(store, "user_1", later);
    const result = await laterService.syncGitHubRepositoriesForInstallation({
      githubInstallationId: 42,
      repositories: [
        repositoryInput({
          defaultBranch: "trunk",
          private: false,
          visibility: "public",
        }),
      ],
      workspaceId: "workspace_1",
    });

    expect(result.syncedRepositoryCount).toBe(1);
    expect(store.repositories).toHaveLength(1);
    expect(store.repositories[0]).toMatchObject({
      defaultBranch: "trunk",
      id: "github_repository_1",
      isPrivate: false,
      lastSyncedAt: later,
      updatedAt: later,
      visibility: "public",
    });
  });

  test("matches active repo mappings by normalized GitHub remotes only", async () => {
    const mappings: StoredRepoMapping[] = [
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "mapping_https",
        remoteUrl: "https://github.com/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "mapping_scp",
        remoteUrl: "git@github.com:acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "mapping_ssh",
        remoteUrl: "ssh://git@github.com/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
    ];
    const store = createStore({
      mappings,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    const result = await service.syncGitHubRepositoriesForInstallation({
      githubInstallationId: 42,
      repositories: [repositoryInput()],
      workspaceId: "workspace_1",
    });

    expect(result.matchedRepoMappingCount).toBe(3);
    expect(mappings).toEqual(
      mappings.map((mapping) => ({
        ...mapping,
        githubInstallationId: "42",
        repositoryExternalId: "9001",
      })),
    );
  });

  test("does not match credentialed, archived, other-workspace, or non-GitHub remotes", async () => {
    const mappings: StoredRepoMapping[] = [
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "credentialed",
        remoteUrl: "https://user:pass@github.com/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
      {
        archivedAt: now,
        githubInstallationId: null,
        id: "archived",
        remoteUrl: "https://github.com/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "other_workspace",
        remoteUrl: "https://github.com/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_2",
      },
      {
        archivedAt: null,
        githubInstallationId: null,
        id: "non_github",
        remoteUrl: "https://git.example.test/acme/control-plane.git",
        repositoryExternalId: null,
        workspaceId: "workspace_1",
      },
    ];
    const store = createStore({
      mappings,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService(store);

    const result = await service.syncGitHubRepositoriesForInstallation({
      githubInstallationId: 42,
      repositories: [repositoryInput()],
      workspaceId: "workspace_1",
    });

    expect(result.matchedRepoMappingCount).toBe(0);
    expect(mappings.every((mapping) => mapping.githubInstallationId === null)).toBe(true);
    expect(mappings.every((mapping) => mapping.repositoryExternalId === null)).toBe(true);
  });

  test("lists safe repository metadata with matched local mapping status", async () => {
    const store = createStore({
      mappings: [
        {
          archivedAt: null,
          githubInstallationId: "42",
          id: "repo_mapping_1",
          remoteUrl: "https://github.com/acme/control-plane.git",
          repositoryExternalId: "9001",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [
        {
          archived: false,
          createdAt: now,
          defaultBranch: "main",
          disabled: false,
          githubAppInstallationId: "github_app_installation_1",
          githubInstallationId: "42",
          htmlUrl: "https://github.example.test/acme/control-plane",
          id: "github_repository_1",
          isPrivate: true,
          lastSyncedAt: now,
          repositoryExternalId: "9001",
          repositoryFullName: "acme/control-plane",
          repositoryName: "control-plane",
          repositoryOwner: "acme",
          updatedAt: now,
          visibility: "private",
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService(store);

    const repositories = await service.listGitHubRepositories({ workspaceId: "workspace_1" });

    expect(repositories).toEqual([
      {
        archived: false,
        createdAt: now,
        defaultBranch: "main",
        disabled: false,
        githubAppInstallationId: "github_app_installation_1",
        githubInstallationId: "42",
        htmlUrl: "https://github.example.test/acme/control-plane",
        id: "github_repository_1",
        isPrivate: true,
        lastSyncedAt: now,
        matchedRepoMappingId: "repo_mapping_1",
        repositoryExternalId: "9001",
        repositoryFullName: "acme/control-plane",
        repositoryName: "control-plane",
        repositoryOwner: "acme",
        updatedAt: now,
        visibility: "private",
        workspaceId: "workspace_1",
      },
    ]);
    expectNoUnsafeRepositoryMaterial(repositories);
  });

  test("does not list stale linked repo mappings as matched without a normalized remote match", async () => {
    const store = createStore({
      mappings: [
        {
          archivedAt: null,
          githubInstallationId: "42",
          id: "stale_linked_remote",
          remoteUrl: "https://github.com/acme/old-control-plane.git",
          repositoryExternalId: "9001",
          workspaceId: "workspace_1",
        },
        {
          archivedAt: null,
          githubInstallationId: "42",
          id: "credentialed_linked_remote",
          remoteUrl: "https://user:pass@github.com/acme/control-plane.git",
          repositoryExternalId: "9001",
          workspaceId: "workspace_1",
        },
        {
          archivedAt: null,
          githubInstallationId: "42",
          id: "non_github_linked_remote",
          remoteUrl: "https://git.example.test/acme/control-plane.git",
          repositoryExternalId: "9001",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [
        {
          archived: false,
          createdAt: now,
          defaultBranch: "main",
          disabled: false,
          githubAppInstallationId: "github_app_installation_1",
          githubInstallationId: "42",
          htmlUrl: "https://github.example.test/acme/control-plane",
          id: "github_repository_1",
          isPrivate: true,
          lastSyncedAt: now,
          repositoryExternalId: "9001",
          repositoryFullName: "acme/control-plane",
          repositoryName: "control-plane",
          repositoryOwner: "acme",
          updatedAt: now,
          visibility: "private",
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService(store);

    const repositories = await service.listGitHubRepositories({ workspaceId: "workspace_1" });

    expect(repositories).toHaveLength(1);
    expect(repositories[0]?.matchedRepoMappingId).toBeNull();
  });

  test("accepts webhook sync for stored installations but ignores unknown installations", async () => {
    const store = createStore({ installations: [] });
    const { createGitHubRepositoryService } = await importRepositories();
    const service = createGitHubRepositoryService({
      store,
    });

    await expect(
      service.syncGitHubRepositoriesForWebhook({
        githubInstallationId: 42,
        repositories: [repositoryInput()],
      }),
    ).resolves.toEqual({
      matchedRepoMappingCount: 0,
      skipped: true,
      syncedRepositoryCount: 0,
    });
    expect(store.upsertGitHubRepository).not.toHaveBeenCalled();
    expect(store.repositories).toEqual([]);
  });

  test("keeps the repository sync module server-only and free of source inspection", async () => {
    const source = await readFile(new URL("./repositories.ts", import.meta.url), "utf8");

    expect(source.trimStart()).toMatch(/^import "server-only";/u);
    expect(source).not.toContain('"use client"');
    expect(source).not.toContain("'use client'");
    expect(source).not.toMatch(/(?:exec|spawn|readFile|readdir|createReadStream|git\s+)/u);
    expect(source).not.toMatch(/console\.(?:log|info|warn|error|debug)/u);
    expectNoUnsafeRepositoryMaterial(source);
  });
});

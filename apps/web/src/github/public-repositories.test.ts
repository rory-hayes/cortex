import { describe, expect, test, vi } from "vitest";

import type { PublicGitHubRepositoryStore } from "./public-repositories";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importPublicRepositories = async () => import("./public-repositories");

type StoredInstallation = {
  accountHtmlUrl: string | null;
  accountId: string;
  accountLogin: string;
  accountType: string;
  githubInstallationId: string;
  id: string;
  installationHtmlUrl: string | null;
  lastSyncedAt: Date;
  permissions: Record<string, string>;
  repositorySelection: "selected";
  updatedAt: Date;
  workspaceId: string;
};

type StoredRepository = {
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

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

const now = new Date("2026-06-04T12:00:00.000Z");

const createStore = (memberships = [{ userId: "user_1", workspaceId: "workspace_1" }]) => {
  const installations: StoredInstallation[] = [];
  const repositories: StoredRepository[] = [];
  const auditEvents: StoredAuditEvent[] = [];

  return {
    auditEvents,
    findWorkspaceMembership: vi.fn(async (input: { userId: string; workspaceId: string }) =>
      memberships.some(
        (membership) =>
          membership.userId === input.userId && membership.workspaceId === input.workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    installations,
    repositories,
    upsertPublicGitHubRepositorySource: vi.fn(
      async (input: {
        createAuditEvent: (repository: StoredRepository) => StoredAuditEvent;
        installation: StoredInstallation;
        repository: Omit<StoredRepository, "id">;
        createRepositoryId: () => string;
      }) => {
        const repository = {
          ...input.repository,
          createdAt: input.repository.createdAt ?? input.repository.updatedAt,
          id: input.createRepositoryId(),
        };

        installations.push(input.installation);
        repositories.push(repository);
        auditEvents.push(input.createAuditEvent(repository));

        return repository;
      },
    ),
  };
};

const publicMetadata = () => ({
  archived: false,
  default_branch: "main",
  disabled: false,
  full_name: "rory-hayes/payslip-peeks-and-probes",
  html_url: "https://github.com/rory-hayes/payslip-peeks-and-probes",
  id: 1214393190,
  name: "payslip-peeks-and-probes",
  owner: {
    html_url: "https://github.com/rory-hayes",
    id: 7_001,
    login: "rory-hayes",
    type: "User",
  },
  private: false,
  visibility: "public",
});

const expectNoUnsafePublicRepositoryMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toMatch(
    /diff --git|rawOutput|sourceCode|patchText|secret|token|stdout|stderr|\.env|\/Users\//iu,
  );
};

describe("public GitHub repository registration", () => {
  test("parses only canonical public GitHub repository URLs", async () => {
    const { parsePublicGitHubRepositoryUrl } = await importPublicRepositories();

    expect(
      parsePublicGitHubRepositoryUrl(
        " https://github.com/rory-hayes/payslip-peeks-and-probes.git ",
      ),
    ).toEqual({
      name: "payslip-peeks-and-probes",
      owner: "rory-hayes",
    });
    expect(
      parsePublicGitHubRepositoryUrl("git@github.com:rory-hayes/payslip-peeks-and-probes.git"),
    ).toEqual({
      name: "payslip-peeks-and-probes",
      owner: "rory-hayes",
    });

    for (const value of [
      "https://example.com/rory-hayes/payslip-peeks-and-probes",
      "https://user:pass@github.com/rory-hayes/payslip-peeks-and-probes",
      "https://github.com/rory-hayes/payslip-peeks-and-probes?token=ghp_leak",
      "https://github.com/rory-hayes/../secret",
      "diff --git a/app.ts b/app.ts",
    ]) {
      expect(() => parsePublicGitHubRepositoryUrl(value)).toThrowError(
        expect.objectContaining({ code: "validation_error" }),
      );
    }
  });

  test("registers safe public repository metadata for a workspace member", async () => {
    const { createPublicGitHubRepositoryService } = await importPublicRepositories();
    const store = createStore();
    const fetchRepositoryMetadata = vi.fn(async () => publicMetadata());
    const service = createPublicGitHubRepositoryService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createRepositoryId: () => `github_repository_${store.repositories.length + 1}`,
      fetchRepositoryMetadata,
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store: store as unknown as PublicGitHubRepositoryStore,
    });

    const result = await service.registerPublicGitHubRepository({
      repositoryUrl: "https://github.com/rory-hayes/payslip-peeks-and-probes.git",
      workspaceId: " workspace_1 ",
    });

    expect(fetchRepositoryMetadata).toHaveBeenCalledWith({
      name: "payslip-peeks-and-probes",
      owner: "rory-hayes",
    });
    expect(result).toEqual({
      githubInstallationId: "public:1214393190",
      repoId: "github_repository_1",
      repositoryFullName: "rory-hayes/payslip-peeks-and-probes",
      workspaceId: "workspace_1",
    });
    expect(store.installations).toEqual([
      {
        accountHtmlUrl: "https://github.com/rory-hayes",
        accountId: "7001",
        accountLogin: "rory-hayes",
        accountType: "User",
        githubInstallationId: "public:1214393190",
        id: "github_app_installation_public:workspace_1:1214393190",
        installationHtmlUrl: null,
        lastSyncedAt: now,
        permissions: {
          contents: "read",
          metadata: "read",
        },
        repositorySelection: "selected",
        updatedAt: now,
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.repositories).toEqual([
      {
        archived: false,
        createdAt: now,
        defaultBranch: "main",
        disabled: false,
        githubAppInstallationId: "github_app_installation_public:workspace_1:1214393190",
        githubInstallationId: "public:1214393190",
        htmlUrl: "https://github.com/rory-hayes/payslip-peeks-and-probes",
        id: "github_repository_1",
        isPrivate: false,
        lastSyncedAt: now,
        repositoryExternalId: "1214393190",
        repositoryFullName: "rory-hayes/payslip-peeks-and-probes",
        repositoryName: "payslip-peeks-and-probes",
        repositoryOwner: "rory-hayes",
        updatedAt: now,
        visibility: "public",
        workspaceId: "workspace_1",
      },
    ]);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "github_repositories.public_registered",
        id: "audit_1",
        metadata: {
          githubInstallationId: "public:1214393190",
          repoId: "github_repository_1",
          repositoryFullName: "rory-hayes/payslip-peeks-and-probes",
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafePublicRepositoryMaterial({
      auditEvents: store.auditEvents,
      repositories: store.repositories,
      result,
    });
  });

  test("rejects private repositories before storing metadata", async () => {
    const { createPublicGitHubRepositoryService } = await importPublicRepositories();
    const store = createStore();
    const service = createPublicGitHubRepositoryService({
      fetchRepositoryMetadata: vi.fn(async () => ({
        ...publicMetadata(),
        private: true,
        visibility: "private",
      })),
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => now,
      store: store as unknown as PublicGitHubRepositoryStore,
    });

    await expect(
      service.registerPublicGitHubRepository({
        repositoryUrl: "https://github.com/rory-hayes/payslip-peeks-and-probes",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.upsertPublicGitHubRepositorySource).not.toHaveBeenCalled();
    expect(store.repositories).toEqual([]);
  });
});

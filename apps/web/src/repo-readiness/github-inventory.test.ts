import { Buffer } from "node:buffer";

import { RepoScanDocumentSummarySchema, RepoScanInventorySchema } from "@control-plane/shared";
import { describe, expect, test, vi } from "vitest";

import type { GitHubAppRequest, GitHubAppRequestFunction } from "@control-plane/github";
import type { GitHubRepositoryInventoryBuilder } from "./github-inventory";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importGitHubInventory = async () => import("./github-inventory");

type StoredRepository = {
  archived: boolean;
  defaultBranch: string;
  disabled: boolean;
  githubAppInstallationId: string;
  githubInstallationId: string;
  id: string;
  isPrivate: boolean;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

type StoredInstallation = {
  githubInstallationId: string;
  id: string;
  permissions: Record<string, string>;
  suspendedAt: Date | null;
  workspaceId: string;
};

const createRepository = (overrides: Partial<StoredRepository> = {}): StoredRepository => ({
  archived: false,
  defaultBranch: "main",
  disabled: false,
  githubAppInstallationId: "github_app_installation_1",
  githubInstallationId: "12345",
  id: "github_repository_1",
  isPrivate: false,
  repositoryName: "control-plane",
  repositoryOwner: "acme",
  workspaceId: "workspace_1",
  ...overrides,
});

const createInstallation = (overrides: Partial<StoredInstallation> = {}): StoredInstallation => ({
  githubInstallationId: "12345",
  id: "github_app_installation_1",
  permissions: {
    contents: "read",
    metadata: "read",
  },
  suspendedAt: null,
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  options: {
    installations?: StoredInstallation[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    repositories?: StoredRepository[];
  } = {},
) => {
  const repositories = [...(options.repositories ?? [createRepository()])];
  const installations = [...(options.installations ?? [createInstallation()])];

  return {
    findGitHubAppInstallationForInventory: vi.fn(
      async (input: { githubAppInstallationId: string; workspaceId: string }) =>
        installations.find(
          (installation) =>
            installation.id === input.githubAppInstallationId &&
            installation.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    findGitHubRepositoryForInventory: vi.fn(
      async (input: { repoId: string; workspaceId: string }) =>
        repositories.find(
          (repository) =>
            repository.id === input.repoId && repository.workspaceId === input.workspaceId,
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
    installations,
    repositories,
  };
};

const createRequest = (
  tree: unknown = {
    truncated: false,
    tree: [
      { path: "src", mode: "040000", type: "tree", sha: "src-sha" },
      { path: "tests", mode: "040000", type: "tree", sha: "tests-sha" },
      { path: "package.json", mode: "100644", type: "blob", size: 500, sha: "package-sha" },
      { path: "pnpm-lock.yaml", mode: "100644", type: "blob", size: 1_000, sha: "lock-sha" },
      { path: "src/app.ts", mode: "100644", type: "blob", size: 100, sha: "source-sha" },
      { path: "tests/app.test.ts", mode: "100644", type: "blob", size: 100, sha: "test-sha" },
    ],
  },
): { request: GitHubAppRequestFunction; requests: GitHubAppRequest[] } => {
  const requests: GitHubAppRequest[] = [];
  const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
    requests.push(transportRequest);

    if (transportRequest.path.includes("/git/trees/")) {
      return tree;
    }

    if (transportRequest.path.includes("/contents/package.json")) {
      return {
        encoding: "base64",
        size: 20,
        type: "file",
        content: Buffer.from("{}").toString("base64"),
      };
    }

    throw new Error("Unexpected GitHub request with ghp_webpayloadshouldnotleak");
  });

  return { request, requests };
};

const createService = async (input: {
  buildInventory?: GitHubRepositoryInventoryBuilder;
  request?: GitHubAppRequestFunction;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
  publicRequest?: GitHubAppRequestFunction;
}) => {
  const { createGitHubRepositoryInventoryService } = await importGitHubInventory();

  return createGitHubRepositoryInventoryService({
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    ...(input.buildInventory === undefined ? {} : { buildInventory: input.buildInventory }),
    ...(input.publicRequest === undefined ? {} : { publicRequest: input.publicRequest }),
    request: input.request ?? createRequest().request,
    store: input.store,
  });
};

const safeRepoScanInventory = (overrides: Record<string, unknown> = {}) =>
  RepoScanInventorySchema.parse({
    agentInstructionSummary: {
      completenessStatus: "missing",
      hasAgentInstructions: false,
      instructionFileCount: 0,
      missingSectionLabels: ["agent instructions"],
      readStatus: "missing",
    },
    ciProviderLabels: [],
    documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
    documentSummaries: [],
    languageSummaries: [{ fileCount: 1, name: "Markdown" }],
    omittedFileCount: 0,
    packageManagerLabels: [],
    policySummary: {
      dryRunCheckCount: 0,
      hasPolicyFile: false,
      protectedPathCount: 0,
      sensitivePathCount: 0,
      validationCommandCount: 0,
    },
    productClaritySummary: {
      clarityStatus: "missing",
      goalContextStatus: "not_provided",
      hasProductDocs: false,
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
    },
    repoHygieneSummary: {
      contributionDocCount: 0,
      hasContributionDocs: false,
      hasRootGitignore: false,
      hygieneStatus: "unknown",
      issueLabels: [],
      issueTemplateCount: 0,
      jsLockfileCount: 0,
      monorepoSignalCount: 0,
      monorepoStructureStatus: "unknown",
      packageManagerCount: 0,
      packageManagerStatus: "unknown",
      workspaceConfigCount: 0,
    },
    scannedFileCount: 1,
    totalDirectoryCount: 0,
    totalFileCount: 1,
    ...overrides,
  });

const expectNoUnsafeWebMaterial = (value: unknown) => {
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
        /^(?:content|contents|diff|filePaths|localPath|patch|paths|rawOutput|secret|snippet|source|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(unsafeKeys).toEqual([]);
  expect(serialized).not.toContain("src/app.ts");
  expect(serialized).not.toContain("tests/app.test.ts");
  expect(serialized).not.toContain(".env.local");
  expect(serialized).not.toContain("id_rsa");
  expect(serialized).not.toContain("-----BEGIN PRIVATE KEY-----");
  expect(serialized).not.toContain("ghp_webpayloadshouldnotleak");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("export const");
  expect(serialized).not.toContain("raw GitHub");
};

describe("GitHub repository inventory facade", () => {
  test("blocks unauthenticated users and non-members before GitHub requests", async () => {
    const { request } = createRequest();
    const unauthenticatedStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const unauthenticatedService = await createService({
      request,
      store: unauthenticatedStore,
      userId: null,
    });

    await expect(
      unauthenticatedService.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "unauthenticated" });
    expect(unauthenticatedStore.findGitHubRepositoryForInventory).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();

    const nonMemberStore = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const nonMemberService = await createService({ request, store: nonMemberStore });

    await expect(
      nonMemberService.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.findGitHubRepositoryForInventory).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test("blocks missing and cross-workspace repositories before GitHub requests", async () => {
    const { request } = createRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [createRepository({ workspaceId: "workspace_2" })],
    });
    const service = await createService({ request, store });

    await expect(
      service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.findGitHubAppInstallationForInventory).not.toHaveBeenCalled();
    expect(request).not.toHaveBeenCalled();
  });

  test("requires scan-only GitHub App permissions before GitHub requests", async () => {
    const { request } = createRequest();
    const store = createStore({
      installations: [
        createInstallation({
          permissions: {
            metadata: "read",
          },
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ request, store });

    await expect(
      service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(request).not.toHaveBeenCalled();

    store.installations[0] = createInstallation({
      permissions: {
        administration: "read",
        contents: "read",
        metadata: "read",
      },
    });
    await expect(
      service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(request).not.toHaveBeenCalled();
  });

  test("blocks archived and disabled repositories with only generic validation errors", async () => {
    const { request } = createRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [createRepository({ archived: true })],
    });
    const service = await createService({ request, store });

    try {
      await service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      });
      throw new Error("Expected archived repository to be blocked.");
    } catch (error) {
      expect(error).toMatchObject({ code: "validation_error" });
      expect(String(error)).not.toContain("archived");
      expect(String(error)).not.toContain("github_repository_1");
    }
    expect(request).not.toHaveBeenCalled();

    store.repositories[0] = createRepository({ disabled: true });
    await expect(
      service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(request).not.toHaveBeenCalled();
  });

  test("returns schema-valid inventory and safe service metadata on success", async () => {
    const { request, requests } = createRequest();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ request, store });

    const result = await service.buildRepositoryInventory({
      repoId: " github_repository_1 ",
      workspaceId: " workspace_1 ",
    });

    expect(RepoScanInventorySchema.safeParse(result.repoScanInventory).success).toBe(true);
    expect(result).toEqual({
      repoId: "github_repository_1",
      repoScanInventory: expect.objectContaining({
        packageManagerLabels: ["pnpm"],
        scannedFileCount: 4,
        totalDirectoryCount: 2,
        totalFileCount: 4,
      }),
      repository: {
        defaultBranch: "main",
        name: "control-plane",
        owner: "acme",
      },
      serviceMetadata: {
        allowlistedFileReadCount: 1,
        githubInstallationId: "12345",
        hasTestDirectories: true,
        policyReadStatus: "missing",
        skippedOversizedFileCount: 0,
        treeTruncated: false,
      },
      workspaceId: "workspace_1",
    });
    expect(requests[0]).toMatchObject({
      installationId: 12345,
      operation: "getRepositoryTree",
      path: "/repos/acme/control-plane/git/trees/main",
    });
    expectNoUnsafeWebMaterial(result);
  });

  test("uses public GitHub requests for public repository sources without App credentials", async () => {
    const { request: appRequest } = createRequest();
    const publicRequests: GitHubAppRequest[] = [];
    const publicRequest = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      publicRequests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" },
            { path: "package.json", mode: "100644", type: "blob", size: 20, sha: "package-sha" },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/README.md")) {
        return {
          content: Buffer.from("Readiness docs describe product workflow and validation.").toString(
            "base64",
          ),
          encoding: "base64",
          size: 320,
          type: "file",
        };
      }

      if (transportRequest.path.includes("/contents/package.json")) {
        return {
          content: Buffer.from("{}").toString("base64"),
          encoding: "base64",
          size: 20,
          type: "file",
        };
      }

      throw new Error("Unexpected public request with ghp_publicPayloadShouldNotLeak");
    });
    const store = createStore({
      installations: [
        createInstallation({
          githubInstallationId: "public:1214393190",
          id: "github_app_installation_public:workspace_1:1214393190",
        }),
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      repositories: [
        createRepository({
          githubAppInstallationId: "github_app_installation_public:workspace_1:1214393190",
          githubInstallationId: "public:1214393190",
          repositoryName: "payslip-peeks-and-probes",
          repositoryOwner: "rory-hayes",
        }),
      ],
    });
    const service = await createService({
      publicRequest,
      request: appRequest,
      store,
    });

    const result = await service.buildRepositoryInventory({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });

    expect(appRequest).not.toHaveBeenCalled();
    expect(publicRequests[0]).toMatchObject({
      installationId: 1,
      operation: "getRepositoryTree",
      path: "/repos/rory-hayes/payslip-peeks-and-probes/git/trees/main",
    });
    expect(result).toMatchObject({
      repoId: "github_repository_1",
      repository: {
        name: "payslip-peeks-and-probes",
        owner: "rory-hayes",
      },
      serviceMetadata: {
        githubInstallationId: "public:1214393190",
      },
      workspaceId: "workspace_1",
    });
    expectNoUnsafeWebMaterial(result);
  });

  test("returns schema-valid document summaries from inventory builders", async () => {
    const buildInventory = vi.fn<GitHubRepositoryInventoryBuilder>(async () => ({
      allowlistedFileReadSummary: {
        attemptedFileCount: 1,
        readFileCount: 1,
        skippedOversizedFileCount: 0,
        unreadableFileCount: 0,
      },
      policyReadStatus: "missing",
      repository: {
        defaultBranch: "main",
        name: "control-plane",
        owner: "acme",
      },
      repoScanInventory: safeRepoScanInventory({
        documentSummaries: [
          {
            documentByteCount: 512,
            inputCharacterCount: 420,
            kind: "readme",
            label: "README",
            redactedCharacterCount: 400,
            redactionApplied: true,
            summary: "README indicates product scope, security, validation, and workflow context.",
            topicLabels: ["product_scope", "security", "validation", "workflow"],
          },
        ],
      }),
      treeSummary: {
        hasTestDirectories: false,
        processedEntryCount: 1,
        skippedEntryCount: 0,
        truncated: false,
      },
    }));
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ buildInventory, store });

    const result = await service.buildRepositoryInventory({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });

    expect(result.repoScanInventory.documentSummaries).toHaveLength(1);
    expect(
      RepoScanDocumentSummarySchema.safeParse(result.repoScanInventory.documentSummaries[0])
        .success,
    ).toBe(true);
    expectNoUnsafeWebMaterial(result);
  });

  test("rejects unsafe document summary output before service return", async () => {
    const buildInventory = vi.fn<GitHubRepositoryInventoryBuilder>(async () => ({
      allowlistedFileReadSummary: {
        attemptedFileCount: 1,
        readFileCount: 1,
        skippedOversizedFileCount: 0,
        unreadableFileCount: 0,
      },
      policyReadStatus: "missing",
      repository: {
        defaultBranch: "main",
        name: "control-plane",
        owner: "acme",
      },
      repoScanInventory: {
        ...safeRepoScanInventory(),
        documentSummaries: [
          {
            documentByteCount: 512,
            inputCharacterCount: 420,
            kind: "readme",
            label: "README",
            rawOutput: "raw GitHub output with ghp_webpayloadshouldnotleak",
            redactedCharacterCount: 400,
            redactionApplied: false,
            summary: "raw output: private provider response",
            topicLabels: ["product_scope"],
          },
        ],
      },
      treeSummary: {
        hasTestDirectories: false,
        processedEntryCount: 1,
        skippedEntryCount: 0,
        truncated: false,
      },
    }));
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ buildInventory, store });

    try {
      await service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      });
      throw new Error("Expected unsafe document summary to be rejected.");
    } catch (error) {
      expect(error).toMatchObject({ code: "validation_error" });
      expect(String(error)).not.toContain("raw GitHub output");
      expect(String(error)).not.toContain("ghp_webpayloadshouldnotleak");
      expect(String(error)).not.toContain("private provider response");
    }
  });

  test("does not expose disallowed tree paths or raw content in successful inventory results", async () => {
    const disallowedContentPaths = new Set([
      ".env.local",
      ".ssh/id_rsa",
      "README.png",
      "apps/web/page.tsx",
      "packages/shared/src/index.ts",
      "src/app.ts",
      "tests/app.test.ts",
    ]);
    const requests: GitHubAppRequest[] = [];
    const request = vi.fn<GitHubAppRequestFunction>(async (transportRequest) => {
      requests.push(transportRequest);

      if (transportRequest.path.includes("/git/trees/")) {
        return {
          truncated: false,
          tree: [
            { path: ".ssh", mode: "040000", type: "tree", sha: "ssh-sha" },
            { path: "apps", mode: "040000", type: "tree", sha: "apps-sha" },
            { path: "packages", mode: "040000", type: "tree", sha: "packages-sha" },
            { path: "src", mode: "040000", type: "tree", sha: "src-sha" },
            { path: "tests", mode: "040000", type: "tree", sha: "tests-sha" },
            { path: "README.md", mode: "100644", type: "blob", size: 320, sha: "readme-sha" },
            { path: "package.json", mode: "100644", type: "blob", size: 20, sha: "package-sha" },
            { path: ".env.local", mode: "100644", type: "blob", size: 24, sha: "env-sha" },
            { path: ".ssh/id_rsa", mode: "100644", type: "blob", size: 64, sha: "key-sha" },
            { path: "README.png", mode: "100644", type: "blob", size: 320, sha: "png-sha" },
            { path: "src/app.ts", mode: "100644", type: "blob", size: 100, sha: "source-sha" },
            { path: "apps/web/page.tsx", mode: "100644", type: "blob", size: 100, sha: "app-sha" },
            {
              path: "packages/shared/src/index.ts",
              mode: "100644",
              type: "blob",
              size: 100,
              sha: "package-sha",
            },
            { path: "tests/app.test.ts", mode: "100644", type: "blob", size: 100, sha: "test-sha" },
          ],
        };
      }

      if (transportRequest.path.includes("/contents/")) {
        const decodedPath = decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? "");

        if (disallowedContentPaths.has(decodedPath)) {
          throw new Error(
            `Disallowed content request for ${decodedPath}: -----BEGIN PRIVATE KEY----- ghp_webpayloadshouldnotleak`,
          );
        }

        if (decodedPath === "README.md") {
          return {
            content: Buffer.from("export const hidden = process.env.SECRET;").toString("base64"),
            encoding: "base64",
            size: 320,
            type: "file",
          };
        }

        if (decodedPath === "package.json") {
          return {
            content: Buffer.from("{}").toString("base64"),
            encoding: "base64",
            size: 20,
            type: "file",
          };
        }

        throw new Error("Unexpected safe file request.");
      }

      throw new Error("Unexpected GitHub request.");
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ request, store });

    const result = await service.buildRepositoryInventory({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });
    const requestedContentPaths = requests
      .filter((transportRequest) => transportRequest.path.includes("/contents/"))
      .map((transportRequest) =>
        decodeURIComponent(transportRequest.path.split("/contents/")[1] ?? ""),
      )
      .toSorted((left, right) => left.localeCompare(right));

    expect(requestedContentPaths).toEqual(
      ["README.md", "package.json"].toSorted((left, right) => left.localeCompare(right)),
    );
    expectNoUnsafeWebMaterial(result);
  });

  test("maps GitHub request failures to generic validation errors without leaking payloads", async () => {
    const request = vi.fn<GitHubAppRequestFunction>(async () => {
      throw new Error("raw GitHub payload with ghp_webpayloadshouldnotleak and diff --git");
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ request, store });

    await expect(
      service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });

    try {
      await service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      });
    } catch (error) {
      expect(String(error)).not.toContain("ghp_webpayloadshouldnotleak");
      expect(String(error)).not.toContain("diff --git");
      expect(String(error)).not.toContain("raw GitHub");
    }
  });

  test("maps unsafe builder failures to generic validation errors without leaking payloads", async () => {
    const buildInventory = vi.fn<GitHubRepositoryInventoryBuilder>(async () => {
      throw new Error(
        "builder failure with diff --git, ghp_webpayloadshouldnotleak, and -----BEGIN PRIVATE KEY-----",
      );
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ buildInventory, store });

    try {
      await service.buildRepositoryInventory({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      });
      throw new Error("Expected inventory builder to fail.");
    } catch (error) {
      expect(error).toMatchObject({ code: "validation_error" });
      expect(String(error)).not.toContain("diff --git");
      expect(String(error)).not.toContain("ghp_webpayloadshouldnotleak");
      expect(String(error)).not.toContain("PRIVATE KEY");
      expect(String(error)).not.toContain("builder failure");
    }
    expect(buildInventory).toHaveBeenCalledOnce();
  });
});

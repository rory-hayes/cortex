import { describe, expect, test, vi } from "vitest";

import { CONTRACT_VERSION } from "@control-plane/shared";

import type {
  RepoMappingArchiveUpdate,
  RepoMappingCreateInsert,
  RepoMappingRow,
  RepoMappingStore,
} from "./repo-mappings";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importRepoMappings = async () => import("./repo-mappings");

type TestStore = RepoMappingStore & {
  auditEvents: Array<Record<string, unknown>>;
  rows: RepoMappingRow[];
};

const now = new Date("2026-05-22T15:00:00.000Z");

const baseMappingInput = {
  defaultBranch: "main",
  localPath: "/repos/control-plane",
  remoteUrl: "https://github.com/rory/control-plane.git",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  runnerId: "runner_1",
  workspaceId: "workspace_1",
};
const baseRunnerMappingRequest = {
  contractVersion: CONTRACT_VERSION,
  defaultBranch: baseMappingInput.defaultBranch,
  localPath: baseMappingInput.localPath,
  provider: "github",
  remoteUrl: baseMappingInput.remoteUrl,
  repositoryName: baseMappingInput.repositoryName,
  repositoryOwner: baseMappingInput.repositoryOwner,
  runnerId: baseMappingInput.runnerId,
  timestamp: "2026-05-23T12:59:30.000Z",
  workspaceId: baseMappingInput.workspaceId,
};
const credentialRemoteUrl = `https://${"user"}:${"pass"}@github.com/rory/control-plane.git`;
const usernameCredentialRemoteUrl = `https://${"user"}@github.com/rory/control-plane.git`;
const githubTokenLikePath = `/repos/${"ghp_"}${"a".repeat(32)}`;
const openAiTokenLikeBranch = `${"sk-"}${"a".repeat(26)}`;
const sourceLikeRepositoryName = ["const", "leak", "=", ["process", "env", "TOKEN"].join(".")].join(
  " ",
);
const validationCommand = {
  command: "pnpm test",
  id: "test",
  label: "Test",
  required: true,
  timeoutSeconds: 60,
} satisfies NonNullable<RepoMappingRow["validationCommands"]>[number];
const optionalValidationCommand = {
  command: "pnpm exec vitest run apps/web/app/repo-mapping-ui.test.ts",
  id: "repo-ui",
  label: "Repository UI",
  required: false,
  timeoutSeconds: 120,
} satisfies NonNullable<RepoMappingRow["validationCommands"]>[number];
const policySnapshot = {
  allowUntrackedFiles: false,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: ["repo_path_exists", "validation_commands_configured"],
  maxChangedFiles: 20,
  protectedBranches: ["main", "release/*"],
  protectedPaths: ["infra/**", ".github/workflows/**"],
  sensitivePaths: [".env", ".env.*", "secrets/**"],
  validationCommands: [validationCommand, optionalValidationCommand],
  warningPaths: {
    auth: ["apps/web/src/auth/**", "apps/web/src/server/auth.ts"],
    billing: ["apps/web/src/billing/**"],
    infrastructure: ["infra/**"],
    migrations: ["packages/db/migrations/**"],
    packageLocks: ["pnpm-lock.yaml"],
  },
} satisfies NonNullable<RepoMappingRow["policySnapshot"]>;

const createStore = (
  input: {
    membership?: boolean;
    rows?: RepoMappingRow[];
    runnerWorkspaceId?: string;
  } = {},
): TestStore => {
  const store: TestStore = {
    auditEvents: [],
    rows: [...(input.rows ?? [])],
    archiveRepoMappingWithAudit: async (update: RepoMappingArchiveUpdate) => {
      const row = store.rows.find(
        (candidate) =>
          candidate.id === update.repoMappingId &&
          candidate.workspaceId === update.workspaceId &&
          candidate.archivedAt === null,
      );

      if (row === undefined) {
        return null;
      }

      store.auditEvents.push(update.auditEvent);
      row.archivedAt = update.archivedAt;
      row.updatedAt = update.archivedAt;

      return row;
    },
    createRepoMappingWithAudit: async (insert: RepoMappingCreateInsert) => {
      store.auditEvents.push(insert.auditEvent);

      const row: RepoMappingRow = {
        archivedAt: null,
        createdAt: now,
        defaultBranch: insert.defaultBranch,
        githubInstallationId: insert.githubInstallationId,
        id: insert.id,
        localPath: insert.localPath,
        policySnapshot: null,
        provider: insert.provider,
        remoteUrl: insert.remoteUrl,
        repositoryExternalId: insert.repositoryExternalId,
        repositoryName: insert.repositoryName,
        repositoryOwner: insert.repositoryOwner,
        runnerId: insert.runnerId,
        updatedAt: now,
        validationCommands: null,
        workspaceId: insert.workspaceId,
      };

      store.rows.push(row);

      return row;
    },
    findRunnerInWorkspace: async ({ runnerId, workspaceId }) =>
      runnerId === "runner_1" && (input.runnerWorkspaceId ?? "workspace_1") === workspaceId
        ? { id: runnerId, workspaceId }
        : null,
    findWorkspaceMembership: async ({ userId, workspaceId }) =>
      input.membership === false || userId !== "user_1" || workspaceId !== "workspace_1"
        ? null
        : { id: "membership_1", role: "member" },
    listActiveRepoMappings: async ({ workspaceId }) =>
      store.rows.filter((row) => row.workspaceId === workspaceId && row.archivedAt === null),
  };

  return store;
};

const createService = async (store: TestStore, userId: string | null = "user_1") => {
  const { createRepoMappingService } = await importRepoMappings();

  return createRepoMappingService({
    createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
    createRepoMappingId: () => `repo_mapping_${store.rows.length + 1}`,
    getAuthContext: async () => ({ userId }),
    now: () => now,
    store,
  });
};

const expectNoUnsafeRepoMappingMaterial = (value: unknown) => {
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
        /^(policySnapshot|validationCommands|command|diff|patch|snippet|source|secret|token|raw)$/i.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("pnpm test");
  expect(serialized).not.toContain("pnpm exec vitest");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("@@ -1,2 +1,2 @@");
  expect(serialized).not.toContain("sk-");
  expect(unsafeKeys).toEqual([]);
};

describe("repo mapping service", () => {
  test("rejects create, list, and delete for unauthenticated users", async () => {
    const store = createStore();
    const service = await createService(store, null);

    await expect(service.createRepoMapping(baseMappingInput)).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(service.listRepoMappings({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "unauthenticated",
    });
    await expect(
      service.deleteRepoMapping({
        repoMappingId: "repo_mapping_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "unauthenticated",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects workspace access for non-members", async () => {
    const store = createStore({ membership: false });
    const service = await createService(store);

    await expect(service.createRepoMapping(baseMappingInput)).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(service.listRepoMappings({ workspaceId: "workspace_1" })).rejects.toMatchObject({
      code: "forbidden",
    });
    await expect(
      service.deleteRepoMapping({
        repoMappingId: "repo_mapping_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
  });

  test("creates mappings only for runners in the requested workspace", async () => {
    const store = createStore({ runnerWorkspaceId: "workspace_other" });
    const service = await createService(store);

    await expect(service.createRepoMapping(baseMappingInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("creates a runner-scoped mapping and writes safe audit metadata", async () => {
    const store = createStore();
    const service = await createService(store);

    const mapping = await service.createRepoMapping({
      ...baseMappingInput,
      provider: "github",
      repositoryExternalId: "repo_external_1",
    });

    expect(mapping).toEqual({
      archivedAt: null,
      createdAt: now,
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_1",
      localPath: "/repos/control-plane",
      provider: "github",
      policySummary: {
        maxChangedFiles: null,
        protectedPathCount: 0,
        sensitivePathCount: 0,
        untrackedFiles: "not_reported",
        warningPathCount: 0,
      },
      policyStatus: "not_reported",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryExternalId: "repo_external_1",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: now,
      validationCommandCount: 0,
      validationSummary: {
        labels: [],
        optionalCount: 0,
        requiredCount: 0,
      },
      workspaceId: "workspace_1",
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      actorId: "user_1",
      eventType: "repo_mapping.created",
      id: "audit_1",
      metadata: {
        defaultBranchLength: 4,
        localPathLength: 20,
        repoMappingId: "repo_mapping_1",
        remoteUrlLength: 41,
        repositoryNameLength: 13,
        repositoryOwnerLength: 4,
        runnerId: "runner_1",
      },
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("/repos/control-plane");
    expect(auditPayload).not.toContain("https://github.com/rory");
    expect(auditPayload).not.toContain("github.com");
    expect(auditPayload).not.toContain("control-plane");
    expect(auditPayload).not.toContain("rory");
  });

  test("lists only active mappings in the requested workspace", async () => {
    const activeMapping = {
      archivedAt: null,
      createdAt: now,
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_active",
      localPath: "/repos/control-plane",
      policySnapshot: null,
      provider: "github",
      remoteUrl: null,
      repositoryExternalId: null,
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: now,
      validationCommands: null,
      workspaceId: "workspace_1",
    } satisfies RepoMappingRow;
    const store = createStore({
      rows: [
        activeMapping,
        { ...activeMapping, archivedAt: now, id: "repo_mapping_archived" },
        { ...activeMapping, id: "repo_mapping_other", workspaceId: "workspace_other" },
      ],
    });
    const service = await createService(store);

    await expect(service.listRepoMappings({ workspaceId: "workspace_1" })).resolves.toEqual([
      {
        archivedAt: null,
        createdAt: now,
        defaultBranch: "main",
        githubInstallationId: null,
        id: "repo_mapping_active",
        localPath: "/repos/control-plane",
        provider: "github",
        policySummary: {
          maxChangedFiles: null,
          protectedPathCount: 0,
          sensitivePathCount: 0,
          untrackedFiles: "not_reported",
          warningPathCount: 0,
        },
        policyStatus: "not_reported",
        remoteUrl: null,
        repositoryExternalId: null,
        repositoryName: "control-plane",
        repositoryOwner: "rory",
        runnerId: "runner_1",
        updatedAt: now,
        validationCommandCount: 0,
        validationSummary: {
          labels: [],
          optionalCount: 0,
          requiredCount: 0,
        },
        workspaceId: "workspace_1",
      },
    ]);
  });

  test("lists safe derived policy metadata without raw policy payloads", async () => {
    const baseMapping = {
      archivedAt: null,
      createdAt: now,
      defaultBranch: "main",
      githubInstallationId: null,
      id: "repo_mapping_ready",
      localPath: "/repos/control-plane",
      policySnapshot,
      provider: "github",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryExternalId: null,
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      updatedAt: now,
      validationCommands: [validationCommand],
      workspaceId: "workspace_1",
    } satisfies RepoMappingRow;
    const store = createStore({
      rows: [
        {
          ...baseMapping,
          validationCommands: [validationCommand, optionalValidationCommand],
        },
        {
          ...baseMapping,
          id: "repo_mapping_missing_validation",
          validationCommands: [],
        },
        {
          ...baseMapping,
          id: "repo_mapping_not_reported",
          policySnapshot: null,
          validationCommands: [validationCommand],
        },
      ],
    });
    const service = await createService(store);

    const mappings = await service.listRepoMappings({ workspaceId: "workspace_1" });

    expect(
      mappings.map(
        ({ id, policyStatus, policySummary, validationCommandCount, validationSummary }) => ({
          id,
          policySummary,
          policyStatus,
          validationCommandCount,
          validationSummary,
        }),
      ),
    ).toEqual([
      {
        id: "repo_mapping_ready",
        policySummary: {
          maxChangedFiles: 20,
          protectedPathCount: 2,
          sensitivePathCount: 3,
          untrackedFiles: "blocked",
          warningPathCount: 6,
        },
        policyStatus: "ready",
        validationCommandCount: 2,
        validationSummary: {
          labels: ["Test", "Repository UI"],
          optionalCount: 1,
          requiredCount: 1,
        },
      },
      {
        id: "repo_mapping_missing_validation",
        policySummary: {
          maxChangedFiles: 20,
          protectedPathCount: 2,
          sensitivePathCount: 3,
          untrackedFiles: "blocked",
          warningPathCount: 6,
        },
        policyStatus: "missing_validation",
        validationCommandCount: 0,
        validationSummary: {
          labels: [],
          optionalCount: 0,
          requiredCount: 0,
        },
      },
      {
        id: "repo_mapping_not_reported",
        policySummary: {
          maxChangedFiles: null,
          protectedPathCount: 0,
          sensitivePathCount: 0,
          untrackedFiles: "not_reported",
          warningPathCount: 0,
        },
        policyStatus: "not_reported",
        validationCommandCount: 1,
        validationSummary: {
          labels: ["Test"],
          optionalCount: 0,
          requiredCount: 1,
        },
      },
    ]);
    expect(mappings).toHaveLength(3);
    for (const mapping of mappings) {
      expect(mapping).not.toHaveProperty("policySnapshot");
      expect(mapping).not.toHaveProperty("validationCommands");
    }
    expectNoUnsafeRepoMappingMaterial(mappings);
  });

  test("treats optional-only validation as missing required validation", async () => {
    const store = createStore({
      rows: [
        {
          archivedAt: null,
          createdAt: now,
          defaultBranch: "main",
          githubInstallationId: null,
          id: "repo_mapping_optional_only",
          localPath: "/repos/control-plane",
          policySnapshot,
          provider: "github",
          remoteUrl: "https://github.com/rory/control-plane.git",
          repositoryExternalId: null,
          repositoryName: "control-plane",
          repositoryOwner: "rory",
          runnerId: "runner_1",
          updatedAt: now,
          validationCommands: [optionalValidationCommand],
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService(store);

    const mappings = await service.listRepoMappings({ workspaceId: "workspace_1" });

    expect(mappings).toHaveLength(1);
    expect(mappings[0]).toMatchObject({
      id: "repo_mapping_optional_only",
      policyStatus: "missing_validation",
      validationCommandCount: 1,
      validationSummary: {
        labels: ["Repository UI"],
        optionalCount: 1,
        requiredCount: 0,
      },
    });
    expectNoUnsafeRepoMappingMaterial(mappings);
  });

  test("archives a mapping and hides it from future lists", async () => {
    const store = createStore({
      rows: [
        {
          archivedAt: null,
          createdAt: now,
          defaultBranch: "main",
          githubInstallationId: null,
          id: "repo_mapping_1",
          localPath: "/repos/control-plane",
          policySnapshot: null,
          provider: "github",
          remoteUrl: null,
          repositoryExternalId: null,
          repositoryName: "control-plane",
          repositoryOwner: "rory",
          runnerId: "runner_1",
          updatedAt: now,
          validationCommands: null,
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService(store);

    await expect(
      service.deleteRepoMapping({
        repoMappingId: "repo_mapping_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual({
      archivedAt: now,
      id: "repo_mapping_1",
      workspaceId: "workspace_1",
    });
    await expect(service.listRepoMappings({ workspaceId: "workspace_1" })).resolves.toEqual([]);
    expect(JSON.stringify(store.auditEvents)).not.toContain("/repos/control-plane");
  });

  test("does not archive mappings outside the caller workspace", async () => {
    const store = createStore({
      rows: [
        {
          archivedAt: null,
          createdAt: now,
          defaultBranch: "main",
          githubInstallationId: null,
          id: "repo_mapping_other",
          localPath: "/repos/other",
          policySnapshot: null,
          provider: "github",
          remoteUrl: null,
          repositoryExternalId: null,
          repositoryName: "other",
          repositoryOwner: "rory",
          runnerId: "runner_1",
          updatedAt: now,
          validationCommands: null,
          workspaceId: "workspace_other",
        },
      ],
    });
    const service = await createService(store);

    await expect(
      service.deleteRepoMapping({
        repoMappingId: "repo_mapping_other",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "forbidden",
    });
    expect(store.rows[0]?.archivedAt).toBeNull();
    expect(store.auditEvents).toEqual([]);
  });

  test.each([
    ["blank local path", { localPath: " " }],
    ["overlong local path", { localPath: `/repos/${"a".repeat(1_025)}` }],
    ["control characters in local path", { localPath: "/repos/control-plane\nleak" }],
    ["diff text in local path", { localPath: "/repos/diff --git a/app.ts b/app.ts" }],
    ["patch hunk in local path", { localPath: "/repos/@@ -1,2 +1,2 @@" }],
    ["source snippet in local path", { localPath: "/repos/function leak() { return true; }" }],
    ["provider token in local path", { localPath: githubTokenLikePath }],
    ["blank repository owner", { repositoryOwner: " " }],
    ["overlong repository name", { repositoryName: "a".repeat(241) }],
    ["source-like repository name", { repositoryName: sourceLikeRepositoryName }],
    ["secret-like default branch", { defaultBranch: openAiTokenLikeBranch }],
    ["credential remote URL", { remoteUrl: credentialRemoteUrl }],
    ["username credential remote URL", { remoteUrl: usernameCredentialRemoteUrl }],
    ["token remote URL", { remoteUrl: `https://github.com/rory/${openAiTokenLikeBranch}` }],
    ["source-like remote URL", { remoteUrl: "https://github.com/rory/function leak() {}" }],
  ])("rejects unsafe mapping input: %s", async (_caseName, overrides) => {
    const store = createStore();
    const service = await createService(store);

    await expect(
      service.createRepoMapping({
        ...baseMappingInput,
        ...overrides,
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });
});

describe("runner repo mapping service", () => {
  test("registers runner-authenticated mapping metadata without requiring user membership", async () => {
    const store = createStore({ membership: false });
    const { createRunnerRepoMappingService } = await importRepoMappings();
    const service = createRunnerRepoMappingService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createRepoMappingId: () => `repo_mapping_${store.rows.length + 1}`,
      now: () => now,
      store,
    });

    const mapping = await service.registerRepoMapping({
      context: {
        runnerId: "runner_1",
        workspaceId: "workspace_1",
      },
      request: baseRunnerMappingRequest,
    });

    expect(mapping).toEqual({
      defaultBranch: "main",
      id: "repo_mapping_1",
      localPath: "/repos/control-plane",
      provider: "github",
      remoteUrl: "https://github.com/rory/control-plane.git",
      repositoryName: "control-plane",
      repositoryOwner: "rory",
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(store.rows).toHaveLength(1);
    expect(store.rows[0]).toMatchObject({
      defaultBranch: "main",
      localPath: "/repos/control-plane",
      policySnapshot: null,
      remoteUrl: "https://github.com/rory/control-plane.git",
      runnerId: "runner_1",
      validationCommands: null,
      workspaceId: "workspace_1",
    });
    expect(store.auditEvents).toHaveLength(1);
    expect(store.auditEvents[0]).toMatchObject({
      eventType: "repo_mapping.created_by_runner",
      id: "audit_1",
      metadata: {
        defaultBranchLength: 4,
        localPathLength: 20,
        repoMappingId: "repo_mapping_1",
        remoteUrlLength: 41,
        repositoryNameLength: 13,
        repositoryOwnerLength: 4,
      },
      runnerId: "runner_1",
      workspaceId: "workspace_1",
    });
    expect(store.auditEvents[0]).not.toHaveProperty("actorId");
    const auditPayload = JSON.stringify(store.auditEvents);
    expect(auditPayload).not.toContain("/repos/control-plane");
    expect(auditPayload).not.toContain("https://github.com/rory");
    expect(auditPayload).not.toContain("github.com");
    expect(auditPayload).not.toContain("control-plane");
    expect(auditPayload).not.toContain("rory");
    expectNoUnsafeRepoMappingMaterial(mapping);
  });

  test.each([
    ["runner mismatch", { runnerId: "runner_2" }],
    ["workspace mismatch", { workspaceId: "workspace_2" }],
    ["unsafe local path", { localPath: "/repos/diff --git a/app.ts b/app.ts" }],
  ])("rejects invalid runner registration: %s", async (_caseName, overrides) => {
    const store = createStore();
    const { createRunnerRepoMappingService } = await importRepoMappings();
    const service = createRunnerRepoMappingService({
      store,
    });

    await expect(
      service.registerRepoMapping({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: {
          ...baseRunnerMappingRequest,
          ...overrides,
        },
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });

  test("rejects registration when the authenticated runner record is not usable", async () => {
    const store = createStore({ runnerWorkspaceId: "workspace_other" });
    const { createRunnerRepoMappingService } = await importRepoMappings();
    const service = createRunnerRepoMappingService({
      store,
    });

    await expect(
      service.registerRepoMapping({
        context: {
          runnerId: "runner_1",
          workspaceId: "workspace_1",
        },
        request: baseRunnerMappingRequest,
      }),
    ).rejects.toMatchObject({
      code: "invalid_request",
    });
    expect(store.rows).toEqual([]);
    expect(store.auditEvents).toEqual([]);
  });
});

import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  CORTEX_TASK_APPROVAL_STATUSES,
  CORTEX_TASK_STATUSES,
  DRY_RUN_CHECKS,
  TaskPacketSchema,
  type CortexTask,
  type RepoPolicy,
  type ValidationCommand,
} from "@control-plane/shared";

import {
  buildCortexTaskPacket,
  type BuildCortexTaskPacketInput,
  type CortexTaskPacketGitHubRepository,
  type CortexTaskPacketRepoMapping,
} from "./build-cortex-task-packet";

vi.mock("server-only", () => ({}));

const now = new Date("2026-05-23T10:30:00.000Z");

const requiredValidationCommand = {
  command: "pnpm test",
  id: "test",
  label: "Tests",
  required: true,
  timeoutSeconds: 300,
} satisfies ValidationCommand;

const optionalValidationCommand = {
  command: "pnpm run lint",
  id: "lint",
  label: "Lint",
  required: false,
  timeoutSeconds: 120,
} satisfies ValidationCommand;

const policySnapshot = {
  allowUntrackedFiles: false,
  contractVersion: CONTRACT_VERSION,
  dryRunChecks: [...DRY_RUN_CHECKS],
  maxChangedFiles: 25,
  protectedBranches: ["main"],
  protectedPaths: ["packages/shared/**"],
  sensitivePaths: [".env", ".env.*"],
  validationCommands: [optionalValidationCommand],
  warningPaths: {
    auth: ["apps/web/src/server/auth.ts"],
    billing: ["apps/web/src/billing/**"],
    infrastructure: [".github/**"],
    migrations: ["packages/db/migrations/**"],
    packageLocks: ["pnpm-lock.yaml"],
  },
} satisfies RepoPolicy;

const baseCortexTask = (overrides: Partial<CortexTask> = {}): CortexTask => ({
  acceptanceCriteria: [
    "Runner task packet validates against the shared schema.",
    "Risk metadata stays metadata-only.",
  ],
  approvalStatus: "approved",
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-23T09:45:00.000Z",
  executionMode: "local_runner",
  externalLinks: [],
  findingIds: ["finding_1", "finding_2"],
  metadata: {},
  objective: "Build a runner-safe task packet from the approved Cortex Task.",
  origin: {
    type: "finding",
  },
  prArtifactIds: [],
  repoId: "github_repo_1",
  riskLevel: "medium",
  runIds: [],
  status: "approved",
  suggestedValidation: [
    { label: "Tests", required: true, validationId: "test" },
    { label: "Lint", required: false, validationId: "lint" },
  ],
  taskId: "cortex_task_1",
  title: "Cortex task packet builder",
  updatedAt: "2026-05-23T09:50:00.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const baseRepoMapping = (
  overrides: Partial<CortexTaskPacketRepoMapping> = {},
): CortexTaskPacketRepoMapping => ({
  archivedAt: null,
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/Users/rory/src/control-plane",
  policySnapshot,
  repositoryName: "control-plane",
  repositoryOwner: "rory-hayes",
  validationCommands: [requiredValidationCommand, optionalValidationCommand],
  workspaceId: "workspace_1",
  ...overrides,
});

const baseGitHubRepository = (
  overrides: Partial<CortexTaskPacketGitHubRepository> = {},
): CortexTaskPacketGitHubRepository => ({
  archived: false,
  disabled: false,
  id: "github_repo_1",
  repositoryFullName: "rory-hayes/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory-hayes",
  workspaceId: "workspace_1",
  ...overrides,
});

const buildPacket = (overrides: Partial<BuildCortexTaskPacketInput> = {}) =>
  buildCortexTaskPacket({
    githubRepository: baseGitHubRepository(),
    now,
    packetId: "packet_cortex_1",
    repoMapping: baseRepoMapping(),
    runId: "run_cortex_1",
    task: baseCortexTask(),
    ...overrides,
  });

const expectValidationError = (operation: () => unknown) => {
  expect(operation).toThrow(expect.objectContaining({ code: "validation_error" }));
};

const collectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectKeys(item, keys);
    }

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    keys.push(key);
    collectKeys(childValue, keys);
  }

  return keys;
};

const normalizeKey = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, "");

describe("buildCortexTaskPacket", () => {
  test("builds a schema-valid metadata-only TaskPacket from an approved local-runner Cortex Task", () => {
    const packet = buildPacket();

    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchObject({
      acceptanceCriteria: [
        "Runner task packet validates against the shared schema.",
        "Risk metadata stays metadata-only.",
      ],
      context: {
        files: [],
        notes: expect.arrayContaining([
          "Cortex task id: cortex_task_1.",
          "Risk level: medium.",
          "Origin type: finding.",
          "Finding count: 2.",
          "Suggested validation labels: Tests (required), Lint (optional).",
        ]),
      },
      contractVersion: CONTRACT_VERSION,
      createdAt: "2026-05-23T10:30:00.000Z",
      id: "packet_cortex_1",
      mode: "execute",
      objective: "Build a runner-safe task packet from the approved Cortex Task.",
      repo: {
        defaultBranch: "main",
        localPath: "/Users/rory/src/control-plane",
        targetBranch: "aicp/cortex-task-cortex_task_1-run_cortex_1",
      },
      repositoryId: "rory-hayes/control-plane",
      runId: "run_cortex_1",
      source: {
        title: "Cortex task packet builder",
        type: "manual",
      },
      validation: {
        commands: [requiredValidationCommand, optionalValidationCommand],
      },
      workspaceId: "workspace_1",
    });
    expect(packet.policy).toEqual({
      ...policySnapshot,
      validationCommands: [requiredValidationCommand, optionalValidationCommand],
    });
    expect(packet.context.files).toEqual([]);
    expect(packet.repo).not.toHaveProperty("worktreePath");
    expect(JSON.stringify(packet)).not.toContain('"riskLevel"');
    expect(JSON.stringify(packet)).not.toContain('"executionMode"');
  });

  test("keeps Cortex context notes to safe metadata and excludes task prose, local paths, and commands", () => {
    const packet = buildPacket();
    const notes = packet.context.notes.join("\n");

    expect(notes).toContain("Risk level: medium.");
    expect(notes).toContain("Origin type: finding.");
    expect(notes).toContain("Finding count: 2.");
    expect(notes).toContain("Suggested validation labels: Tests (required), Lint (optional).");
    expect(notes).not.toContain(packet.objective);
    expect(notes).not.toContain(packet.acceptanceCriteria[0]);
    expect(notes).not.toContain(packet.repo.localPath);
    expect(notes).not.toContain(requiredValidationCommand.command);
    expect(notes).not.toContain(optionalValidationCommand.command);
    expect(notes).not.toContain("local_runner");
  });

  test.each(
    CORTEX_TASK_STATUSES.filter((status) => status !== "approved").map((status) => [status]),
  )("rejects Cortex Task status %s", (status) => {
    expectValidationError(() => buildPacket({ task: baseCortexTask({ status }) }));
  });

  test.each(
    CORTEX_TASK_APPROVAL_STATUSES.filter((approvalStatus) => approvalStatus !== "approved").map(
      (approvalStatus) => [approvalStatus],
    ),
  )("rejects Cortex Task approvalStatus %s", (approvalStatus) => {
    expectValidationError(() => buildPacket({ task: baseCortexTask({ approvalStatus }) }));
  });

  test("rejects blocked-risk Cortex Tasks", () => {
    expectValidationError(() => buildPacket({ task: baseCortexTask({ riskLevel: "blocked" }) }));
  });

  test("requires extra approval evidence for high-risk Cortex Tasks", () => {
    expectValidationError(() => buildPacket({ task: baseCortexTask({ riskLevel: "high" }) }));
    expectValidationError(() =>
      buildPacket({
        requiredApprovalExists: true,
        task: baseCortexTask({ approvalStatus: "pending", riskLevel: "high" }),
      }),
    );

    const packet = buildPacket({
      requiredApprovalExists: true,
      task: baseCortexTask({ riskLevel: "high" }),
    });

    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet.context.notes).toContain("Risk level: high.");
  });

  test.each(["planning_only", "setup_pr"] as const)("rejects %s execution mode", (mode) => {
    expectValidationError(() => buildPacket({ task: baseCortexTask({ executionMode: mode }) }));
  });

  test("accepts only local_runner execution mode", () => {
    const packet = buildPacket({
      task: baseCortexTask({ executionMode: "local_runner" }),
    });

    expect(packet.mode).toBe("execute");
    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
  });

  test.each([
    ["archived mapping", { repoMapping: baseRepoMapping({ archivedAt: now }) }],
    [
      "mapping workspace mismatch",
      { repoMapping: baseRepoMapping({ workspaceId: "workspace_2" }) },
    ],
    [
      "GitHub repository workspace mismatch",
      { githubRepository: baseGitHubRepository({ workspaceId: "workspace_2" }) },
    ],
    ["Cortex Task repository mismatch", { task: baseCortexTask({ repoId: "github_repo_2" }) }],
    [
      "repo mapping owner mismatch",
      { repoMapping: baseRepoMapping({ repositoryOwner: "other-owner" }) },
    ],
    [
      "repo mapping name mismatch",
      { repoMapping: baseRepoMapping({ repositoryName: "other-repo" }) },
    ],
    ["missing local path", { repoMapping: baseRepoMapping({ localPath: null }) }],
    ["missing default branch", { repoMapping: baseRepoMapping({ defaultBranch: "" }) }],
    ["missing policy snapshot", { repoMapping: baseRepoMapping({ policySnapshot: null }) }],
    [
      "invalid policy snapshot",
      {
        repoMapping: baseRepoMapping({ policySnapshot: { ...policySnapshot, maxChangedFiles: 0 } }),
      },
    ],
    [
      "unsafe GitHub owner metadata",
      { githubRepository: baseGitHubRepository({ repositoryOwner: "bad/owner" }) },
    ],
    [
      "GitHub full name mismatch",
      {
        githubRepository: baseGitHubRepository({
          repositoryFullName: "rory-hayes/other-repo",
        }),
      },
    ],
  ])("fails closed for %s", (_caseName, overrides) => {
    expectValidationError(() => buildPacket(overrides));
  });

  test.each([
    ["missing validation commands", null],
    ["empty validation commands", []],
    ["optional-only validation commands", [optionalValidationCommand]],
    [
      "invalid validation command",
      [{ ...requiredValidationCommand, command: "", timeoutSeconds: 0 }],
    ],
    [
      "absolute validation cwd outside repo",
      [{ ...requiredValidationCommand, cwd: "/tmp/outside-repo" }],
    ],
    ["env-like validation cwd", [{ ...requiredValidationCommand, cwd: ".env.local" }]],
  ])("fails closed for %s", (_caseName, validationCommands) => {
    expectValidationError(() =>
      buildPacket({
        repoMapping: baseRepoMapping({ validationCommands }),
      }),
    );
  });

  test.each([
    ["finding", baseCortexTask({ origin: { type: "finding" } })],
    [
      "task recommendation",
      baseCortexTask({
        findingIds: [],
        origin: { type: "task_recommendation" },
        taskRecommendationId: "recommendation_1",
      }),
    ],
    ["manual", baseCortexTask({ findingIds: [], origin: { type: "manual" } })],
  ])("maps %s Cortex Tasks to manual TaskPacket sources", (_caseName, task) => {
    const packet = buildPacket({ task });

    expect(packet.source.type).toBe("manual");
    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
  });

  test("maps Linear external-import Cortex Tasks to linear TaskPacket sources using canonical links", () => {
    const packet = buildPacket({
      task: baseCortexTask({
        externalLinks: [
          {
            externalId: "LIN-123",
            provider: "linear",
            resourceType: "linear_issue",
            status: "Ready",
            title: "Linear issue LIN-123",
            url: "https://linear.app/example/issue/LIN-123/task-packet-builder",
          },
        ],
        findingIds: [],
        origin: {
          externalId: "LIN-123",
          externalSystem: "linear",
          type: "external_import",
        },
      }),
    });

    expect(packet.source).toEqual({
      externalId: "LIN-123",
      title: "Cortex task packet builder",
      type: "linear",
      url: "https://linear.app/example/issue/LIN-123/task-packet-builder",
    });
    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
  });

  test("maps Linear external imports using origin external IDs when no canonical link exists", () => {
    const packet = buildPacket({
      task: baseCortexTask({
        externalLinks: [],
        findingIds: [],
        origin: {
          externalId: "LIN-456",
          externalSystem: "linear",
          type: "external_import",
        },
      }),
    });

    expect(packet.source).toEqual({
      externalId: "LIN-456",
      title: "Cortex task packet builder",
      type: "linear",
    });
    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
  });

  test.each([
    ["path segment", "https://linear.app/example/issue/github_pat_12345678901234567890/task"],
    [
      "non-secret query value",
      "https://linear.app/example/issue/LIN-789/task?id=github_pat_12345678901234567890",
    ],
  ])(
    "rejects token-like Linear external link URL %s before copying source metadata",
    (_caseName, url) => {
      expectValidationError(() =>
        buildPacket({
          task: baseCortexTask({
            externalLinks: [
              {
                externalId: "LIN-789",
                provider: "linear",
                resourceType: "linear_issue",
                status: "Ready",
                title: "Linear issue LIN-789",
                url,
              },
            ],
            findingIds: [],
            origin: {
              externalId: "LIN-789",
              externalSystem: "linear",
              type: "external_import",
            },
          }),
        }),
      );
    },
  );

  test.each([
    [
      "absolute protected path",
      {
        ...policySnapshot,
        protectedPaths: ["/tmp/outside-repo"],
      },
    ],
    [
      "source-like warning path",
      {
        ...policySnapshot,
        warningPaths: {
          ...policySnapshot.warningPaths,
          infrastructure: ["diff --git a/app.ts b/app.ts"],
        },
      },
    ],
    [
      "raw-output warning path",
      {
        ...policySnapshot,
        warningPaths: {
          ...policySnapshot.warningPaths,
          migrations: ["stdout: full unredacted command output"],
        },
      },
    ],
  ])("rejects policy snapshots containing %s metadata", (_caseName, unsafePolicySnapshot) => {
    expectValidationError(() =>
      buildPacket({
        repoMapping: baseRepoMapping({
          policySnapshot: unsafePolicySnapshot,
        }),
      }),
    );
  });

  test.each([
    ["diff key", { metadata: { diff: "metadata" } }],
    ["patch key", { metadata: { patch: "metadata" } }],
    ["sourceCode key", { metadata: { sourceCode: "metadata" } }],
    ["snippet key", { metadata: { snippet: "metadata" } }],
    ["stdout key", { metadata: { stdout: "metadata" } }],
    ["stderr key", { metadata: { stderr: "metadata" } }],
    ["raw source text", { objective: "export const unsafe = true;" }],
    ["diff text", { acceptanceCriteria: ["diff --git a/app.ts b/app.ts"] }],
    ["patch text", { title: "*** Begin Patch\n*** Update File: app.ts" }],
    ["stdout text", { metadata: { summary: "stdout: full unredacted command output" } }],
    ["env path text", { metadata: { note: "check .env.local before running" } }],
    [
      "private key text",
      { objective: "-----BEGIN PRIVATE KEY-----\nsecret\n-----END PRIVATE KEY-----" },
    ],
    ["token-like text", { metadata: { note: "github_pat_12345678901234567890" } }],
    ["absolute path text", { objective: "Use /tmp/outside-repo for context." }],
  ])("rejects unsafe Cortex Task payload containing %s", (_caseName, overrides) => {
    expectValidationError(() =>
      buildPacket({ task: baseCortexTask(overrides as Partial<CortexTask>) }),
    );
  });

  test("does not serialize raw source, patches, secrets, outside local paths, or command output", () => {
    const packet = buildPacket();
    const serialized = JSON.stringify(packet);
    const unsafeKeySet = new Set([
      "content",
      "diff",
      "patch",
      "rawoutput",
      "secret",
      "snippet",
      "sourcecode",
      "stderr",
      "stdout",
      "token",
    ]);

    expect(
      collectKeys(JSON.parse(serialized))
        .map(normalizeKey)
        .filter((key) => unsafeKeySet.has(key)),
    ).toEqual([]);
    expect(packet.context.files).toEqual([]);
    expect(serialized).not.toContain("export const");
    expect(serialized).not.toContain("diff --git");
    expect(serialized).not.toContain("*** Begin Patch");
    expect(serialized).not.toContain("github_pat_");
    expect(serialized).not.toContain("/tmp/outside-repo");
    expect(serialized).not.toContain("stdout:");
    expect(serialized).not.toContain("stderr:");
  });

  test("throws generic validation errors without echoing task, path, policy, or command values", () => {
    const operation = () =>
      buildPacket({
        repoMapping: baseRepoMapping({
          localPath: "/private/repos/sensitive-control-plane",
          validationCommands: [
            {
              ...requiredValidationCommand,
              command: "pnpm run contains-secret-command",
              timeoutSeconds: 0,
            },
          ],
        }),
        task: baseCortexTask({
          acceptanceCriteria: ["Sensitive acceptance text that must not leak"],
          objective: "Sensitive objective text that must not leak",
        }),
      });

    expect(operation).toThrow(expect.objectContaining({ code: "validation_error" }));

    try {
      operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("Sensitive objective");
      expect(message).not.toContain("Sensitive acceptance");
      expect(message).not.toContain("sensitive-control-plane");
      expect(message).not.toContain("contains-secret-command");
      expect(message).not.toContain("protectedPaths");
    }
  });
});

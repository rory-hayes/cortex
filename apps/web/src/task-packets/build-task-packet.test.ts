import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DRY_RUN_CHECKS,
  RepoPolicySchema,
  TaskPacketSchema,
  type RepoPolicy,
  type ValidationCommand,
} from "@control-plane/shared";

import {
  buildManualTaskPacket,
  type ManualTaskPacketRepoMapping,
  type ManualTaskPacketTask,
} from "./build-task-packet";

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

const baseTask = (overrides: Partial<ManualTaskPacketTask> = {}): ManualTaskPacketTask => ({
  acceptanceCriteria: ["Packet validates against the shared schema.", "Context stays path-only."],
  contextFilePaths: ["apps/web/src/tasks/manual-tasks.ts", "packages/shared/src/task-packet.ts"],
  contractVersion: CONTRACT_VERSION,
  externalId: "manual-ticket-127",
  externalUrl: "https://tracker.example/tasks/manual-ticket-127",
  id: "TASK 127: Builder",
  mode: "execute",
  objective: "Build a metadata-only task packet.",
  repoMappingId: "repo_mapping_1",
  sourceType: "manual",
  status: "draft",
  title: "Task packet builder",
  workspaceId: "workspace_1",
  ...overrides,
});

const baseRepoMapping = (
  overrides: Partial<ManualTaskPacketRepoMapping> = {},
): ManualTaskPacketRepoMapping => ({
  archivedAt: null,
  defaultBranch: "main",
  id: "repo_mapping_1",
  localPath: "/Users/rory/src/control-plane",
  policySnapshot,
  validationCommands: [requiredValidationCommand, optionalValidationCommand],
  workspaceId: "workspace_1",
  ...overrides,
});

const buildPacket = (overrides: Partial<Parameters<typeof buildManualTaskPacket>[0]> = {}) =>
  buildManualTaskPacket({
    now,
    packetId: "packet_127",
    repoMapping: baseRepoMapping(),
    runId: "Run 127 / Packet!",
    task: baseTask(),
    ...overrides,
  });

const unsafePacketKeys = new Set([
  "content",
  "diff",
  "patch",
  "snippet",
  "sourcecode",
  "stderr",
  "stdout",
]);

const collectUnsafeKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUnsafeKeys(item, keys);
    }

    return keys;
  }

  for (const [key, childValue] of Object.entries(value)) {
    if (unsafePacketKeys.has(key.toLowerCase())) {
      keys.push(key);
    }
    collectUnsafeKeys(childValue, keys);
  }

  return keys;
};

const expectValidationError = (operation: () => unknown) => {
  expect(operation).toThrow(expect.objectContaining({ code: "validation_error" }));
};

describe("buildManualTaskPacket", () => {
  test("builds a schema-valid metadata-only TaskPacket from a manual draft and active repo mapping", () => {
    const packet = buildPacket();

    expect(TaskPacketSchema.safeParse(packet).success).toBe(true);
    expect(packet).toMatchObject({
      acceptanceCriteria: [
        "Packet validates against the shared schema.",
        "Context stays path-only.",
      ],
      context: {
        files: ["apps/web/src/tasks/manual-tasks.ts", "packages/shared/src/task-packet.ts"],
        notes: ["Context files are path references only."],
      },
      contractVersion: CONTRACT_VERSION,
      createdAt: "2026-05-23T10:30:00.000Z",
      id: "packet_127",
      mode: "execute",
      objective: "Build a metadata-only task packet.",
      repo: {
        defaultBranch: "main",
        localPath: "/Users/rory/src/control-plane",
        targetBranch: "aicp/manual-task-task-127-builder-run-127-packet",
      },
      repositoryId: "repo_mapping_1",
      runId: "Run 127 / Packet!",
      source: {
        externalId: "manual-ticket-127",
        title: "Task packet builder",
        type: "manual",
        url: "https://tracker.example/tasks/manual-ticket-127",
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
    expect(packet.repo).not.toHaveProperty("worktreePath");
  });

  test("uses conservative policy defaults when the active repo mapping has no policy snapshot", () => {
    const packet = buildPacket({
      repoMapping: baseRepoMapping({ policySnapshot: null }),
    });

    expect(RepoPolicySchema.safeParse(packet.policy).success).toBe(true);
    expect(packet.policy).toEqual({
      allowUntrackedFiles: false,
      contractVersion: CONTRACT_VERSION,
      dryRunChecks: [...DRY_RUN_CHECKS],
      maxChangedFiles: 20,
      protectedBranches: ["main"],
      protectedPaths: [],
      sensitivePaths: [".env", ".env.*", "local.env", "*.local.env"],
      validationCommands: [requiredValidationCommand, optionalValidationCommand],
      warningPaths: {
        auth: ["**/auth/**", "**/authentication/**", "**/oauth/**"],
        billing: [
          "**/billing/**",
          "**/payments/**",
          "**/payment/**",
          "**/stripe/**",
          "**/checkout/**",
          "**/subscription/**",
          "**/subscriptions/**",
        ],
        infrastructure: [
          ".github/workflows/**",
          ".github/actions/**",
          "infra/**",
          "infrastructure/**",
          "terraform/**",
          "pulumi/**",
          "k8s/**",
          "kubernetes/**",
          "helm/**",
          "charts/**",
          "deploy/**",
          "deployments/**",
          "cloudformation/**",
          "cdk/**",
          "**/Dockerfile",
          "**/docker-compose.yml",
          "**/docker-compose.yaml",
          "**/serverless.yml",
          "**/serverless.yaml",
          "**/*.tf",
          "netlify.toml",
          "vercel.json",
          "render.yaml",
          "fly.toml",
          "wrangler.toml",
        ],
        migrations: [
          "**/migrations/**",
          "**/migration/**",
          "prisma/migrations/**",
          "supabase/migrations/**",
          "db/migrations/**",
          "database/migrations/**",
        ],
        packageLocks: [
          "**/package-lock.json",
          "**/npm-shrinkwrap.json",
          "**/pnpm-lock.yaml",
          "**/yarn.lock",
          "**/bun.lock",
          "**/bun.lockb",
        ],
      },
    });
  });

  test.each([
    ["missing validation commands", null],
    ["empty validation commands", []],
    ["optional-only validation commands", [optionalValidationCommand]],
    [
      "invalid validation command",
      [{ ...requiredValidationCommand, command: "", timeoutSeconds: 0 }],
    ],
  ])("fails closed for %s", (_caseName, validationCommands) => {
    expectValidationError(() =>
      buildPacket({
        repoMapping: baseRepoMapping({
          validationCommands:
            validationCommands as ManualTaskPacketRepoMapping["validationCommands"],
        }),
      }),
    );
  });

  test.each([
    ["archived mapping", baseRepoMapping({ archivedAt: new Date("2026-05-23T10:45:00Z") })],
    ["workspace mismatch", baseRepoMapping({ workspaceId: "workspace_2" })],
    ["repo mapping mismatch", baseRepoMapping({ id: "repo_mapping_2" })],
    ["missing local path", baseRepoMapping({ localPath: null })],
    ["missing default branch", baseRepoMapping({ defaultBranch: "" })],
    [
      "invalid policy snapshot",
      baseRepoMapping({ policySnapshot: { ...policySnapshot, maxChangedFiles: 0 } }),
    ],
  ])("fails closed for a %s", (_caseName, repoMapping) => {
    expectValidationError(() => buildPacket({ repoMapping }));
  });

  test.each([
    ["non-draft task", baseTask({ status: "approved" })],
    ["non-manual source", baseTask({ sourceType: "linear" })],
    ["repair mode", baseTask({ mode: "repair" })],
    ["workspace mismatch", baseTask({ workspaceId: "workspace_2" })],
    ["repo mapping mismatch", baseTask({ repoMappingId: "repo_mapping_2" })],
  ])("fails closed for a %s", (_caseName, task) => {
    expectValidationError(() => buildPacket({ task }));
  });

  test("does not serialize raw payload keys or file contents into the packet", () => {
    const packet = buildPacket({
      task: baseTask({
        contextFilePaths: ["src/server.ts", "README.md"],
      }),
    });
    const serializedPacket = JSON.parse(JSON.stringify(packet)) as unknown;

    expect(collectUnsafeKeys(serializedPacket)).toEqual([]);
    expect(packet.context.files).toEqual(["src/server.ts", "README.md"]);
    expect(packet.context.files.every((filePath) => typeof filePath === "string")).toBe(true);
    expect(JSON.stringify(packet)).not.toContain("export const");
    expect(JSON.stringify(packet)).not.toContain("diff --git");
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
        task: baseTask({
          contextFilePaths: ["apps/private/sensitive-file.ts"],
          objective: "Sensitive objective text that must not leak",
        }),
      });

    expect(operation).toThrow(expect.objectContaining({ code: "validation_error" }));

    try {
      operation();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).not.toContain("Sensitive objective");
      expect(message).not.toContain("sensitive-control-plane");
      expect(message).not.toContain("sensitive-file.ts");
      expect(message).not.toContain("contains-secret-command");
    }
  });
});

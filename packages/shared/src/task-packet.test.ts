import { describe, expect, it } from "vitest";
import type {
  TaskPacket as SharedTaskPacket,
  TaskPacketMode as SharedTaskPacketMode,
  TaskPacketSourceType as SharedTaskPacketSourceType,
} from "@control-plane/shared";

const CONTRACT_VERSION = "2026-05-10.v1";

const TASK_PACKET_MODES = ["dryRun", "execute", "repair"] as const;
const TASK_PACKET_SOURCE_TYPES = ["manual", "linear", "repair"] as const;
const DOCUMENTED_DRY_RUN_CHECKS = [
  "repo_path_exists",
  "git_repository",
  "repo_clean",
  "current_branch_not_protected",
  "repo_policy_exists_and_parses",
  "validation_commands_configured",
  "required_tools_available",
  "branch_name_available",
  "worktree_path_available",
  "protected_and_sensitive_paths_configured",
  "runner_capabilities_satisfied",
] as const;

type TaskPacketMode = (typeof TASK_PACKET_MODES)[number];
type TaskPacketSourceType = (typeof TASK_PACKET_SOURCE_TYPES)[number];
type DryRunCheck = (typeof DOCUMENTED_DRY_RUN_CHECKS)[number];

type ValidationCommand = {
  id: string;
  label: string;
  command: string;
  cwd?: string;
  timeoutSeconds: number;
  required: boolean;
};

type RepoPolicyWarningPaths = {
  packageLocks: string[];
  migrations: string[];
  infrastructure: string[];
  auth: string[];
  billing: string[];
};

type RepoPolicy = {
  contractVersion: typeof CONTRACT_VERSION;
  protectedBranches: string[];
  protectedPaths: string[];
  sensitivePaths: string[];
  warningPaths: RepoPolicyWarningPaths;
  validationCommands: ValidationCommand[];
  maxChangedFiles: number;
  maxDiffLines?: number;
  allowUntrackedFiles: boolean;
  dryRunChecks: DryRunCheck[];
};

type TaskPacket = {
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  workspaceId?: string;
  repositoryId: string;
  runId: string;
  mode: TaskPacketMode;
  objective: string;
  acceptanceCriteria: string[];
  source: {
    type: TaskPacketSourceType;
    externalId?: string;
    title: string;
    url?: string;
  };
  repo: {
    localPath: string;
    defaultBranch: string;
    targetBranch: string;
    worktreePath?: string;
  };
  context: {
    files: string[];
    notes: string[];
  };
  policy: RepoPolicy;
  validation: {
    commands: ValidationCommand[];
  };
  repair?: {
    attempt: number;
    maxAttempts: number;
    feedback: string;
    previousRunId: string;
  };
  createdAt: string;
};

type TaskPacketModule = {
  TASK_PACKET_MODES: readonly TaskPacketMode[];
  TaskPacketModeSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  TASK_PACKET_SOURCE_TYPES: readonly TaskPacketSourceType[];
  TaskPacketSourceTypeSchema: {
    safeParse: (value: unknown) => { success: boolean };
  };
  TaskPacketSchema: {
    parse: (value: unknown) => TaskPacket;
    safeParse: (value: unknown) => { success: boolean };
  };
};

const loadTaskPacketModule = async () => (await import("./task-packet.js")) as TaskPacketModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<TaskPacketModule>;

const validCommand = (overrides: Partial<ValidationCommand> = {}): ValidationCommand => ({
  id: "test",
  label: "Run tests",
  command: "pnpm test",
  timeoutSeconds: 120,
  required: true,
  ...overrides,
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main"],
  protectedPaths: ["SECURITY_MODEL.md", ".github/workflows/**"],
  sensitivePaths: [".env", ".env.*", "secrets/**"],
  warningPaths: {
    packageLocks: ["pnpm-lock.yaml", "package-lock.json", "yarn.lock"],
    migrations: ["db/migrations/**"],
    infrastructure: [".github/**", "infra/**"],
    auth: ["apps/web/src/auth/**"],
    billing: ["apps/web/src/billing/**"],
  },
  validationCommands: [validCommand()],
  maxChangedFiles: 25,
  maxDiffLines: 1_000,
  allowUntrackedFiles: false,
  dryRunChecks: [...DOCUMENTED_DRY_RUN_CHECKS.slice(0, 3)],
  ...overrides,
});

const validTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  contractVersion: CONTRACT_VERSION,
  id: "task-packet-1",
  workspaceId: "workspace-1",
  repositoryId: "repo-1",
  runId: "run-1",
  mode: "execute",
  objective: "Implement the shared TaskPacket contract.",
  acceptanceCriteria: ["TaskPacket validates at runtime.", "Embedded source is rejected."],
  source: {
    type: "manual",
    externalId: "manual-1",
    title: "Implement TaskPacket schema",
    url: "https://example.test/tasks/task-packet",
  },
  repo: {
    localPath: "/repos/control-plane",
    defaultBranch: "main",
    targetBranch: "codex/TASK-015-implement-taskpacket-schema",
    worktreePath: "/tmp/control-plane-task-015",
  },
  context: {
    files: ["DATA_MODEL.md", "packages/shared/src/index.ts"],
    notes: ["Use path references only."],
  },
  policy: validPolicy(),
  validation: {
    commands: [validCommand()],
  },
  createdAt: "2026-05-14T19:45:30.494Z",
  ...overrides,
});

const validRepairPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket =>
  validTaskPacket({
    mode: "repair",
    source: {
      type: "repair",
      title: "Repair TaskPacket validation",
    },
    repair: {
      attempt: 1,
      maxAttempts: 2,
      feedback: "Keep context files as paths only.",
      previousRunId: "run-previous",
    },
    ...overrides,
  });

const assertEntrypointTypeExports = (value: {
  packet: SharedTaskPacket;
  mode: SharedTaskPacketMode;
  sourceType: SharedTaskPacketSourceType;
}) => value;

describe("TaskPacket", () => {
  it("exports the documented task packet modes in canonical order", async () => {
    const { TASK_PACKET_MODES: exportedModes, TaskPacketModeSchema } = await loadTaskPacketModule();

    expect(exportedModes).toEqual(TASK_PACKET_MODES);
    for (const mode of TASK_PACKET_MODES) {
      expect(TaskPacketModeSchema.safeParse(mode).success).toBe(true);
    }
    expect(TaskPacketModeSchema.safeParse("plan").success).toBe(false);
  });

  it("exports the documented source types in canonical order", async () => {
    const { TASK_PACKET_SOURCE_TYPES: exportedSourceTypes, TaskPacketSourceTypeSchema } =
      await loadTaskPacketModule();

    expect(exportedSourceTypes).toEqual(TASK_PACKET_SOURCE_TYPES);
    for (const sourceType of TASK_PACKET_SOURCE_TYPES) {
      expect(TaskPacketSourceTypeSchema.safeParse(sourceType).success).toBe(true);
    }
    expect(TaskPacketSourceTypeSchema.safeParse("jira").success).toBe(false);
  });

  it("validates a manual execute packet matching the documented data model", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(TaskPacketSchema.safeParse(validTaskPacket()).success).toBe(true);
  });

  it("normalizes missing policy path arrays so dry-run readiness can report them", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();
    const packetInput: Record<string, unknown> & {
      policy: Record<string, unknown>;
    } = {
      ...validTaskPacket(),
      policy: {
        ...validTaskPacket().policy,
      },
    };
    delete packetInput.policy.protectedPaths;
    delete packetInput.policy.sensitivePaths;

    const parsedPacket = TaskPacketSchema.parse(packetInput);

    expect(parsedPacket.policy.protectedPaths).toEqual([]);
    expect(parsedPacket.policy.sensitivePaths).toEqual([]);
  });

  it("validates dryRun and execute task packets", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(TaskPacketSchema.safeParse(validTaskPacket({ mode: "dryRun" })).success).toBe(true);
    expect(TaskPacketSchema.safeParse(validTaskPacket({ mode: "execute" })).success).toBe(true);
  });

  it("validates repair packets with repair source metadata and bounded attempts", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(TaskPacketSchema.safeParse(validRepairPacket()).success).toBe(true);
  });

  it("rejects unknown modes and source types", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(
      TaskPacketSchema.safeParse(validTaskPacket({ mode: "plan" as TaskPacketMode })).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          source: {
            type: "jira" as TaskPacketSourceType,
            title: "Imported Jira issue",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects missing or wrong contract versions", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(
      TaskPacketSchema.safeParse({ ...validTaskPacket(), contractVersion: undefined }).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse({
        ...validTaskPacket(),
        contractVersion: "2026-05-10.v2",
      }).success,
    ).toBe(false);
  });

  it("rejects empty required strings in identifiers, branches, paths, source titles, and repair feedback", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(TaskPacketSchema.safeParse(validTaskPacket({ id: "" })).success).toBe(false);
    expect(TaskPacketSchema.safeParse(validTaskPacket({ repositoryId: "" })).success).toBe(false);
    expect(TaskPacketSchema.safeParse(validTaskPacket({ runId: "" })).success).toBe(false);
    expect(TaskPacketSchema.safeParse(validTaskPacket({ objective: "" })).success).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          repo: {
            ...validTaskPacket().repo,
            defaultBranch: "",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          repo: {
            ...validTaskPacket().repo,
            targetBranch: "",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          repo: {
            ...validTaskPacket().repo,
            localPath: "",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          repo: {
            ...validTaskPacket().repo,
            worktreePath: "",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          context: {
            ...validTaskPacket().context,
            files: [""],
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          source: {
            ...validTaskPacket().source,
            title: "",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validRepairPacket({
          repair: {
            attempt: 1,
            maxAttempts: 2,
            feedback: "",
            previousRunId: "run-previous",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects non-string context files and object-style file entries with embedded content", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          context: {
            files: [42 as never],
            notes: ["Use path references only."],
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          context: {
            files: [{ path: "src/index.ts", content: "export const secret = true;" } as never],
            notes: ["Use path references only."],
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects embedded source-like fields and arbitrary payload objects through strict schemas", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    const sourceLikePackets = [
      { ...validTaskPacket(), diff: "diff --git a/src/index.ts b/src/index.ts" },
      { ...validTaskPacket(), patch: "@@ -1 +1 @@" },
      { ...validTaskPacket(), sourceCode: "export const value = 1;" },
      { ...validTaskPacket(), metadata: { sourceCode: "export const value = 1;" } },
      { ...validTaskPacket(), payload: { patch: "@@ -1 +1 @@" } },
      {
        ...validTaskPacket(),
        context: {
          ...validTaskPacket().context,
          content: "export const value = 1;",
        },
      },
      {
        ...validTaskPacket(),
        context: {
          ...validTaskPacket().context,
          snippets: ["export const value = 1;"],
        },
      },
      {
        ...validTaskPacket(),
        source: {
          ...validTaskPacket().source,
          body: "The full issue body with source-like content.",
        },
      },
    ];

    for (const packet of sourceLikePackets) {
      expect(TaskPacketSchema.safeParse(packet).success).toBe(false);
    }
  });

  it("enforces repair-only repair blocks and repair attempt bounds", async () => {
    const { TaskPacketSchema } = await loadTaskPacketModule();

    const repairPacketWithoutRepair = validRepairPacket();
    delete repairPacketWithoutRepair.repair;

    expect(TaskPacketSchema.safeParse(repairPacketWithoutRepair).success).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          mode: "execute",
          repair: {
            attempt: 1,
            maxAttempts: 2,
            feedback: "Please repair validation.",
            previousRunId: "run-previous",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validRepairPacket({
          repair: {
            attempt: 3,
            maxAttempts: 2,
            feedback: "Please repair validation.",
            previousRunId: "run-previous",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validRepairPacket({
          source: {
            type: "manual",
            title: "Manual repair request",
          },
        }),
      ).success,
    ).toBe(false);
    expect(
      TaskPacketSchema.safeParse(
        validTaskPacket({
          mode: "execute",
          source: {
            type: "repair",
            title: "Repair source outside repair mode",
          },
        }),
      ).success,
    ).toBe(false);
  });

  it("exports task packet schemas, constants, and inferred types from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();
    const packet: SharedTaskPacket = validTaskPacket();
    const mode: SharedTaskPacketMode = "execute";
    const sourceType: SharedTaskPacketSourceType = "manual";

    expect(shared.TASK_PACKET_MODES).toEqual(TASK_PACKET_MODES);
    expect(shared.TaskPacketModeSchema?.safeParse(mode).success).toBe(true);
    expect(shared.TASK_PACKET_SOURCE_TYPES).toEqual(TASK_PACKET_SOURCE_TYPES);
    expect(shared.TaskPacketSourceTypeSchema?.safeParse(sourceType).success).toBe(true);
    expect(shared.TaskPacketSchema?.safeParse(packet).success).toBe(true);
    expect(assertEntrypointTypeExports({ packet, mode, sourceType }).mode).toBe("execute");
  });
});

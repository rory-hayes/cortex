import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { CONTRACT_VERSION, type TaskPacket } from "@control-plane/shared";
import { describe, expect, it, vi } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "./command.js";
import {
  PrepareRepairWorktreeError,
  prepareRepairWorktree,
  repairExecutionMetadata,
  type PrepareRepairWorktreeCommandRunner,
} from "./repair.js";

describe("runner repair helpers", () => {
  it("ignores non-repair packets when reading repair metadata", () => {
    expect(repairExecutionMetadata(taskPacket({ mode: "execute" }))).toBeUndefined();
  });

  it("blocks repair packets with missing metadata before any git command", async () => {
    const commandRunner = vi.fn<PrepareRepairWorktreeCommandRunner>();
    const packet = {
      ...repairTaskPacket(),
      repair: undefined,
    } as unknown as TaskPacket;

    await expect(
      prepareRepairWorktree({
        repoPath: "/repo",
        taskPacket: packet,
        commandRunner,
        worktreeRoot: "/runner/worktrees",
      }),
    ).rejects.toMatchObject({
      code: "invalid_repair_packet",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("blocks repair attempts above the configured limit before any git command", async () => {
    const commandRunner = vi.fn<PrepareRepairWorktreeCommandRunner>();
    const packet = repairTaskPacket({
      repair: {
        attempt: 3,
        feedback: "Retry with safe metadata only.",
        maxAttempts: 2,
        previousRunId: "run-original",
      },
    });

    await expect(
      prepareRepairWorktree({
        repoPath: "/repo",
        taskPacket: packet,
        commandRunner,
        worktreeRoot: "/runner/worktrees",
      }),
    ).rejects.toMatchObject({
      code: "attempt_limit_exceeded",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("blocks repair attempts above the manual repair cap even when packet maxAttempts is higher", async () => {
    const commandRunner = vi.fn<PrepareRepairWorktreeCommandRunner>();
    const packet = repairTaskPacket({
      repair: {
        attempt: 99,
        feedback: "Retry with safe metadata only.",
        maxAttempts: 99,
        previousRunId: "run-original",
      },
    });

    await expect(
      prepareRepairWorktree({
        repoPath: "/repo",
        taskPacket: packet,
        commandRunner,
        worktreeRoot: "/runner/worktrees",
      }),
    ).rejects.toMatchObject({
      code: "attempt_limit_exceeded",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("creates a repair worktree from the existing target branch without creating a new branch from default", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runner-repair-helper-"));
    const repoPath = join(workspace, "repo");
    const worktreePath = join(workspace, "worktrees", "run-repair");
    const packet = repairTaskPacket({
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-existing-pr-branch",
        worktreePath,
      },
    });
    const calls: RunCommandOptions[] = [];
    const commandRunner = commandRunnerForRepair({
      calls,
      targetBranch: packet.repo.targetBranch,
    });

    const result = await prepareRepairWorktree({
      repoPath,
      taskPacket: packet,
      commandRunner,
      worktreeRoot: join(workspace, "worktrees"),
      lstat: async () => {
        throw Object.assign(new Error("missing"), { code: "ENOENT" });
      },
      mkdir: async () => undefined,
      realpath: async (path) => path,
    });

    const worktreeAdd = calls.find((call) => call.args?.[0] === "worktree");
    expect(worktreeAdd?.args).toEqual(["worktree", "add", worktreePath, packet.repo.targetBranch]);
    expect(worktreeAdd?.args).not.toContain("-b");
    expect(worktreeAdd?.args).not.toContain(packet.repo.defaultBranch);
    expect(result).toMatchObject({
      runId: packet.runId,
      branchName: packet.repo.targetBranch,
      baseBranch: packet.repo.defaultBranch,
      worktreePath,
      metadata: {
        repair: true,
        repairAttempt: 1,
        worktreeCreated: true,
        reusedExistingWorktree: false,
      },
    });
  });

  it("reuses an existing clean worktree already checked out on the target branch", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runner-repair-helper-"));
    const repoPath = join(workspace, "repo");
    const worktreePath = join(workspace, "worktrees", "run-repair");
    await mkdir(worktreePath, { recursive: true });
    const packet = repairTaskPacket({
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-existing-clean-worktree",
        worktreePath,
      },
    });
    const calls: RunCommandOptions[] = [];
    const commandRunner = commandRunnerForRepair({
      calls,
      targetBranch: packet.repo.targetBranch,
    });

    const result = await prepareRepairWorktree({
      repoPath,
      taskPacket: packet,
      commandRunner,
      worktreeRoot: join(workspace, "worktrees"),
      realpath: async (path) => path,
    });

    expect(calls.some((call) => call.args?.[0] === "worktree")).toBe(false);
    expect(result.metadata).toMatchObject({
      repair: true,
      repairAttempt: 1,
      worktreeCreated: false,
      reusedExistingWorktree: true,
    });
  });

  it("blocks repair worktree paths outside the configured runner worktree root", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runner-repair-helper-"));
    const repoPath = join(workspace, "repo");
    const worktreeRoot = join(workspace, "worktrees");
    const packet = repairTaskPacket({
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-outside-worktree-root",
        worktreePath: join(workspace, "external", "run-repair"),
      },
    });
    const commandRunner = commandRunnerForRepair({
      targetBranch: packet.repo.targetBranch,
    });

    await expect(
      prepareRepairWorktree({
        repoPath,
        taskPacket: packet,
        commandRunner,
        lstat: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
        mkdir: async () => undefined,
        worktreeRoot,
        realpath: async (path) => path,
      }),
    ).rejects.toMatchObject({
      code: "invalid_worktree_path",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it("blocks mapped repository paths before reusing a clean checkout as the repair worktree", async () => {
    const workspace = await mkdtemp(join(tmpdir(), "runner-repair-helper-"));
    const repoPath = join(workspace, "repo");
    const packet = repairTaskPacket({
      repo: {
        localPath: repoPath,
        defaultBranch: "main",
        targetBranch: "aicp/task-147-mapped-repo-path",
        worktreePath: repoPath,
      },
    });
    const commandRunner = commandRunnerForRepair({
      targetBranch: packet.repo.targetBranch,
    });

    await expect(
      prepareRepairWorktree({
        repoPath,
        taskPacket: packet,
        commandRunner,
        lstat: async () => ({}),
        worktreeRoot: join(workspace, "worktrees"),
        realpath: async (path) => path,
      }),
    ).rejects.toMatchObject({
      code: "invalid_worktree_path",
    });
    expect(commandRunner).not.toHaveBeenCalled();
  });

  it.each([
    {
      name: "default branch",
      protectedBranches: ["main"],
      targetBranch: "main",
    },
    {
      name: "protected branch pattern",
      protectedBranches: ["release/*"],
      targetBranch: "release/1.0",
    },
  ])(
    "blocks repair on the $name before any git command",
    async ({ protectedBranches, targetBranch }) => {
      const workspace = await mkdtemp(join(tmpdir(), "runner-repair-helper-"));
      const packet = repairTaskPacket({
        policy: {
          ...repairTaskPacket().policy,
          protectedBranches,
        },
        repo: {
          localPath: join(workspace, "repo"),
          defaultBranch: "main",
          targetBranch,
          worktreePath: join(workspace, "worktrees", "run-repair"),
        },
      });
      const commandRunner = commandRunnerForRepair({ targetBranch });

      await expect(
        prepareRepairWorktree({
          repoPath: packet.repo.localPath,
          taskPacket: packet,
          commandRunner,
          lstat: async () => ({}),
          worktreeRoot: join(workspace, "worktrees"),
          realpath: async (path) => path,
        }),
      ).rejects.toMatchObject({
        code: "protected_branch",
      });
      expect(commandRunner).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: "dirty mapped repository checkout",
      expectedCode: "dirty_repo",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          repoStatusOutput: " M src/private.ts\0",
          targetBranch: "aicp/task-147-fail-closed",
        }),
      }),
    },
    {
      name: "dirty repair worktree",
      expectedCode: "dirty_worktree",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          targetBranch: "aicp/task-147-fail-closed",
          worktreeStatusOutput: " M src/private.ts\0",
        }),
      }),
    },
    {
      name: "branch mismatch",
      expectedCode: "branch_mismatch",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          branchOutput: "main\n",
          targetBranch: "aicp/task-147-fail-closed",
        }),
      }),
    },
    {
      name: "unavailable branch",
      expectedCode: "unavailable_branch",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          showRefExitCode: 1,
          targetBranch: "aicp/task-147-fail-closed",
        }),
        lstat: async () => {
          throw Object.assign(new Error("missing"), { code: "ENOENT" });
        },
      }),
    },
    {
      name: "untrusted git output",
      expectedCode: "untrusted_git_output",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          redactedBranchOutput: true,
          targetBranch: "aicp/task-147-fail-closed",
        }),
      }),
    },
    {
      name: "unsafe worktree path",
      expectedCode: "invalid_worktree_path",
      setup: () => ({
        commandRunner: commandRunnerForRepair({
          targetBranch: "aicp/task-147-fail-closed",
        }),
        packetOverrides: {
          repo: {
            localPath: "/repo",
            defaultBranch: "main",
            targetBranch: "aicp/task-147-fail-closed",
            worktreePath: "relative/worktree",
          },
        } satisfies Partial<TaskPacket>,
      }),
    },
  ])("fails closed for $name without exposing raw git output", async ({ expectedCode, setup }) => {
    const configured: {
      commandRunner: PrepareRepairWorktreeCommandRunner;
      lstat?: (path: string) => Promise<unknown>;
      packetOverrides?: Partial<TaskPacket>;
    } = setup();
    const packet = repairTaskPacket({
      repo: {
        localPath: "/repo",
        defaultBranch: "main",
        targetBranch: "aicp/task-147-fail-closed",
        worktreePath: "/runner/worktrees/run-repair",
      },
      ...(configured.packetOverrides ?? {}),
    });

    await expect(
      prepareRepairWorktree({
        repoPath: packet.repo.localPath,
        taskPacket: packet,
        commandRunner: configured.commandRunner,
        worktreeRoot: "/runner/worktrees",
        ...(configured.lstat === undefined ? {} : { lstat: configured.lstat }),
        mkdir: async () => undefined,
        realpath: async (path) => path,
      }),
    ).rejects.toSatisfy((error: unknown) => {
      expect(error).toBeInstanceOf(PrepareRepairWorktreeError);
      expect(error).toMatchObject({ code: expectedCode });
      expect(JSON.stringify(error)).not.toContain("src/private.ts");
      expect(JSON.stringify(error)).not.toContain("raw stdout");
      expect(JSON.stringify(error)).not.toContain("diff --git");

      return true;
    });
  });
});

const commandRunnerForRepair = ({
  branchOutput,
  calls = [],
  redactedBranchOutput = false,
  repoStatusOutput = "",
  showRefExitCode = 0,
  targetBranch,
  worktreeStatusOutput = "",
}: {
  branchOutput?: string;
  calls?: RunCommandOptions[];
  redactedBranchOutput?: boolean;
  repoStatusOutput?: string;
  showRefExitCode?: number;
  targetBranch: string;
  worktreeStatusOutput?: string;
}): PrepareRepairWorktreeCommandRunner =>
  vi.fn(async (options) => {
    calls.push(options);

    if (options.args?.[0] === "check-ref-format") {
      return commandResult(options, { exitCode: 0, stdoutSummary: targetBranch });
    }

    if (options.args?.[0] === "show-ref") {
      return commandResult(options, { exitCode: showRefExitCode });
    }

    if (options.args?.[0] === "worktree") {
      return commandResult(options, { exitCode: 0 });
    }

    if (options.args?.[0] === "symbolic-ref") {
      return commandResult(options, {
        exitCode: 0,
        redactionApplied: redactedBranchOutput,
        stdoutSummary: branchOutput ?? `${targetBranch}\n`,
      });
    }

    if (options.args?.[0] === "status") {
      const statusCallCount = calls.filter((call) => call.args?.[0] === "status").length;

      return commandResult(options, {
        exitCode: 0,
        stdoutSummary: statusCallCount === 1 ? repoStatusOutput : worktreeStatusOutput,
      });
    }

    throw new Error(`Unexpected git command ${options.args?.join(" ")}`);
  });

const commandResult = (
  options: RunCommandOptions,
  overrides: Partial<CommandExecutionResult> = {},
): CommandExecutionResult => ({
  command: {
    executable: options.command,
    args: [...(options.args ?? [])],
  },
  cwd: options.cwd,
  durationMs: 1,
  exitCode: 0,
  redactionApplied: false,
  stderrSummary: "",
  stdoutSummary: "",
  ...overrides,
});

const repairTaskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  ...taskPacket({
    mode: "repair",
    repair: {
      attempt: 1,
      feedback: "Retry with safe metadata only.",
      maxAttempts: 2,
      previousRunId: "run-original",
    },
    repo: {
      localPath: "/repo",
      defaultBranch: "main",
      targetBranch: "aicp/task-147-repair",
      worktreePath: "/runner/worktrees/run-repair",
    },
    runId: "run-repair",
    source: {
      externalId: "repair-1",
      title: "Repair prior run",
      type: "repair",
    },
  }),
  ...overrides,
});

const taskPacket = (overrides: Partial<TaskPacket> = {}): TaskPacket => ({
  acceptanceCriteria: ["Validation passes."],
  context: {
    files: ["src/app.ts"],
    notes: ["Use safe local metadata only."],
  },
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-24T09:00:00.000Z",
  id: "TASK-147",
  mode: "execute",
  objective: "Update the local task branch.",
  policy: {
    allowUntrackedFiles: true,
    contractVersion: CONTRACT_VERSION,
    dryRunChecks: ["repo_path_exists", "git_repository", "repo_clean"],
    maxChangedFiles: 25,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: [".env", ".env.*"],
    validationCommands: [
      {
        command: "pnpm test",
        id: "test",
        label: "Tests",
        required: true,
        timeoutSeconds: 120,
      },
    ],
    warningPaths: {
      auth: [],
      billing: [],
      infrastructure: [],
      migrations: [],
      packageLocks: ["pnpm-lock.yaml"],
    },
  },
  repo: {
    defaultBranch: "main",
    localPath: "/repo",
    targetBranch: "aicp/task-147",
    worktreePath: "/runner/worktrees/run-147",
  },
  repositoryId: "acme/control-plane",
  runId: "run-147",
  source: {
    externalId: "manual-147",
    title: "Add repair support",
    type: "manual",
  },
  validation: {
    commands: [
      {
        command: "pnpm test",
        id: "test",
        label: "Tests",
        required: true,
        timeoutSeconds: 120,
      },
    ],
  },
  workspaceId: "workspace-1",
  ...overrides,
});

import { DryRunCheckResultSchema, RiskFindingSchema } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "../command.js";
import {
  checkWorktreeReadiness,
  type CheckWorktreeReadinessCommandRunner,
  type CheckWorktreeReadinessOptions,
  type CheckWorktreeReadinessResult,
  type CheckWorktreeReadinessTaskRepo,
} from "./check-worktree-readiness.js";
import {
  checkWorktreeReadiness as checkWorktreeReadinessFromEntrypoint,
  type CheckWorktreeReadinessOptions as CheckWorktreeReadinessOptionsFromEntrypoint,
  type CheckWorktreeReadinessResult as CheckWorktreeReadinessResultFromEntrypoint,
  type CheckWorktreeReadinessTaskRepo as CheckWorktreeReadinessTaskRepoFromEntrypoint,
} from "../index.js";

const REPO_PATH = "/private/tmp/control-plane/repo";
const TASK_REPO_PATH = "/private/tmp/control-plane/repo/.";
const RESOLVED_REPO_PATH = "/private/tmp/control-plane/resolved-repo";
const WORKTREE_PATH =
  "/private/tmp/control-plane/.codex-runner-worktrees/TASK-045-add-worktree-readiness-check";
const TARGET_BRANCH = "codex/TASK-045-add-worktree-readiness-check";

const UNSAFE_TEXT = [
  REPO_PATH,
  TASK_REPO_PATH,
  RESOLVED_REPO_PATH,
  WORKTREE_PATH,
  "stdoutSummary",
  "stderrSummary",
  "SECRET_TOKEN=do-not-print",
  "GITHUB_TOKEN=ghp_worktreesecret1234567890",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
  "function leakedSource() { return token; }",
] as const;

describe("worktree readiness dry-run check", () => {
  it("passes when target branch is valid and worktree path is available", async () => {
    const commandRunner = commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]);
    const lstat = lstatMissing();

    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner,
      lstat,
      realpath: realpathMatchingRepo(),
    });

    expect(result).toEqual({
      checks: [
        {
          id: "branch_name_available",
          label: "Branch name available",
          status: "passed",
          message: "Target branch name is valid and not already present locally.",
          metadata: {
            repoMappingMatches: true,
            branchNameConfigured: true,
            branchNameSafe: true,
            branchFormatVerified: true,
            branchNameAvailable: true,
            localBranchExists: false,
            verificationStatus: "passed",
            gitCheckRefExitCode: 0,
            gitShowRefExitCode: 1,
          },
        },
        {
          id: "worktree_path_available",
          label: "Worktree path available",
          status: "passed",
          message: "Worktree target path is available.",
          metadata: {
            repoMappingMatches: true,
            worktreePathConfigured: true,
            worktreePathAvailable: true,
            inspectionStatus: "available",
          },
        },
      ],
      blockers: [],
      warnings: [],
    });
    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["check-ref-format", "--branch", TARGET_BRANCH],
        cwd: REPO_PATH,
        summaryLimit: 1,
      },
      {
        command: "git",
        args: ["show-ref", "--verify", "--quiet", `refs/heads/${TARGET_BRANCH}`],
        cwd: REPO_PATH,
        summaryLimit: 1,
      },
    ]);
    expect(lstat.calls).toEqual([WORKTREE_PATH]);
    expect(DryRunCheckResultSchema.safeParse(result.checks[0]).success).toBe(true);
    expect(DryRunCheckResultSchema.safeParse(result.checks[1]).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it.each([
    "codex/TASK-063-add-suspected-secret-detector",
    "codex/TASK-178-add-token-storage-documentation-and-checks",
    "codex/TASK-999-add-password-policy-check",
  ])(
    "allows ordinary task branch slug words that are not secret values: %s",
    async (targetBranch) => {
      const commandRunner = commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]);

      const result = await checkWorktreeReadiness(REPO_PATH, taskRepo({ targetBranch }), {
        commandRunner,
        lstat: lstatMissing(),
        realpath: realpathMatchingRepo(),
      });

      expect(result.checks[0]).toEqual({
        id: "branch_name_available",
        label: "Branch name available",
        status: "passed",
        message: "Target branch name is valid and not already present locally.",
        metadata: {
          repoMappingMatches: true,
          branchNameConfigured: true,
          branchNameSafe: true,
          branchFormatVerified: true,
          branchNameAvailable: true,
          localBranchExists: false,
          verificationStatus: "passed",
          gitCheckRefExitCode: 0,
          gitShowRefExitCode: 1,
        },
      });
      expect(commandRunner.calls).toEqual([
        {
          command: "git",
          args: ["check-ref-format", "--branch", targetBranch],
          cwd: REPO_PATH,
          summaryLimit: 1,
        },
        {
          command: "git",
          args: ["show-ref", "--verify", "--quiet", `refs/heads/${targetBranch}`],
          cwd: REPO_PATH,
          summaryLimit: 1,
        },
      ]);
      expect(result.blockers).toEqual([]);
      expectSafeSerializedResult(result);
    },
  );

  it.each([
    "../main",
    "-danger",
    "feature with spaces",
    "feature/{source}",
    "codex/TASK-001-token=abc123456789",
    "codex/TASK-001-GITHUB_TOKEN=ghp_worktreesecret1234567890",
  ])("blocks invalid or suspicious branch names: %s", async (targetBranch) => {
    const commandRunner = commandRunnerFromResults([]);

    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo({ targetBranch }), {
      commandRunner,
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Target branch name is invalid or unsafe.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: false,
        branchFormatVerified: false,
        branchNameAvailable: false,
        localBranchExists: false,
        verificationStatus: "invalid",
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker("target_branch", "Target branch name is invalid or unsafe."),
    );
    expect(commandRunner.calls).toEqual([]);
    expectSafeSerializedResult(result);
  });

  it("blocks when the target branch already exists locally", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 0 }]),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Target branch already exists locally.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: true,
        branchNameAvailable: false,
        localBranchExists: true,
        verificationStatus: "exists",
        gitCheckRefExitCode: 0,
        gitShowRefExitCode: 0,
      },
    });
    expect(result.blockers).toContainEqual({
      id: "risk:duplicate_assignment:target_branch",
      severity: "blocked",
      category: "duplicate_assignment",
      message: "Target branch already exists locally.",
      paths: [],
    });
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
  });

  it("blocks without command output when git branch format verification throws", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: throwingCommandRunner("SECRET_TOKEN=do-not-print"),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Unable to verify target branch readiness.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: false,
        branchNameAvailable: false,
        localBranchExists: false,
        verificationStatus: "unverified",
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker(
        "target_branch_verification",
        "Unable to verify target branch readiness.",
      ),
    );
    expectSafeSerializedResult(result);
  });

  it("blocks without command output when git branch format verification is redacted", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: commandRunnerFromResults([
        {
          exitCode: 0,
          stdoutSummary: "SECRET_TOKEN=do-not-print",
          redactionApplied: true,
        },
      ]),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Unable to verify target branch readiness.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: false,
        branchNameAvailable: false,
        localBranchExists: false,
        verificationStatus: "unverified",
        gitCheckRefExitCode: 0,
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker(
        "target_branch_verification",
        "Unable to verify target branch readiness.",
      ),
    );
    expectSafeSerializedResult(result);
  });

  it("blocks without command output when git branch availability verification is inconclusive", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: commandRunnerFromResults([
        { exitCode: 0 },
        {
          exitCode: 2,
          stdoutSummary: "diff --git a/file.ts b/file.ts",
          stderrSummary: "SECRET_TOKEN=do-not-print",
        },
      ]),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Unable to verify target branch readiness.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: false,
        branchNameAvailable: false,
        localBranchExists: false,
        verificationStatus: "unverified",
        gitCheckRefExitCode: 0,
        gitShowRefExitCode: 2,
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker(
        "target_branch_verification",
        "Unable to verify target branch readiness.",
      ),
    );
    expectSafeSerializedResult(result);
  });

  it("blocks without command output when git branch availability verification is redacted", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: commandRunnerFromResults([
        { exitCode: 0 },
        {
          exitCode: 1,
          stderrSummary: "GITHUB_TOKEN=ghp_worktreesecret1234567890",
          redactionApplied: true,
        },
      ]),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[0]).toEqual({
      id: "branch_name_available",
      label: "Branch name available",
      status: "failed",
      message: "Unable to verify target branch readiness.",
      metadata: {
        repoMappingMatches: true,
        branchNameConfigured: true,
        branchNameSafe: true,
        branchFormatVerified: false,
        branchNameAvailable: false,
        localBranchExists: false,
        verificationStatus: "unverified",
        gitCheckRefExitCode: 0,
        gitShowRefExitCode: 1,
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker(
        "target_branch_verification",
        "Unable to verify target branch readiness.",
      ),
    );
    expectSafeSerializedResult(result);
  });

  it("blocks when the worktree path is occupied", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner: commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]),
      lstat: lstatOccupied(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[1]).toEqual({
      id: "worktree_path_available",
      label: "Worktree path available",
      status: "failed",
      message: "Worktree target path is already occupied.",
      metadata: {
        repoMappingMatches: true,
        worktreePathConfigured: true,
        worktreePathAvailable: false,
        inspectionStatus: "occupied",
      },
    });
    expect(result.blockers).toContainEqual({
      id: "risk:stale_lock:worktree_path",
      severity: "blocked",
      category: "stale_lock",
      message: "Worktree target path is already occupied.",
      paths: [],
    });
    expectSafeSerializedResult(result);
  });

  it("blocks conservatively when the task packet omits repo.worktreePath", async () => {
    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo({ worktreePath: undefined }), {
      commandRunner: commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]),
      lstat: lstatMissing(),
      realpath: realpathMatchingRepo(),
    });

    expect(result.checks[1]).toEqual({
      id: "worktree_path_available",
      label: "Worktree path available",
      status: "failed",
      message: "Task packet is missing a worktree target path.",
      metadata: {
        repoMappingMatches: true,
        worktreePathConfigured: false,
        worktreePathAvailable: false,
        inspectionStatus: "missing",
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker("worktree_path", "Task packet is missing a worktree target path."),
    );
    expectSafeSerializedResult(result);
  });

  it("blocks relative worktree paths without inspecting a cwd-relative target", async () => {
    const lstat = lstatMissing();

    const result = await checkWorktreeReadiness(
      REPO_PATH,
      taskRepo({ worktreePath: ".codex-runner-worktrees/TASK-045" }),
      {
        commandRunner: commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]),
        lstat,
        realpath: realpathMatchingRepo(),
      },
    );

    expect(result.checks[1]).toEqual({
      id: "worktree_path_available",
      label: "Worktree path available",
      status: "failed",
      message: "Task packet worktree path must be absolute.",
      metadata: {
        repoMappingMatches: true,
        worktreePathConfigured: true,
        worktreePathAvailable: false,
        inspectionStatus: "invalid",
      },
    });
    expect(result.blockers).toContainEqual(
      missingMappingBlocker("worktree_path", "Task packet worktree path must be absolute."),
    );
    expect(lstat.calls).toEqual([]);
    expectSafeSerializedResult(result);
  });

  it("blocks when task packet repo.localPath does not match the validated repo root", async () => {
    const commandRunner = commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]);
    const lstat = lstatMissing();

    const result = await checkWorktreeReadiness(REPO_PATH, taskRepo(), {
      commandRunner,
      lstat,
      realpath: realpathMismatchedRepo(),
    });

    expect(result).toEqual({
      checks: [
        {
          id: "branch_name_available",
          label: "Branch name available",
          status: "failed",
          message: "Task packet repo mapping does not match the validated repository.",
          metadata: {
            repoMappingMatches: false,
            branchNameConfigured: true,
            branchNameSafe: false,
            branchFormatVerified: false,
            branchNameAvailable: false,
            localBranchExists: false,
            verificationStatus: "mapping_mismatch",
          },
        },
        {
          id: "worktree_path_available",
          label: "Worktree path available",
          status: "failed",
          message: "Task packet repo mapping does not match the validated repository.",
          metadata: {
            repoMappingMatches: false,
            worktreePathConfigured: true,
            worktreePathAvailable: false,
            inspectionStatus: "mapping_mismatch",
          },
        },
      ],
      blockers: [
        missingMappingBlocker(
          "repo_local_path",
          "Task packet repo mapping does not match the validated repository.",
        ),
      ],
      warnings: [],
    });
    expect(commandRunner.calls).toEqual([]);
    expect(lstat.calls).toEqual([]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
    expectSafeSerializedResult(result);
  });

  it("keeps serialized readiness metadata free of source-like text, command output, secrets, diffs, patches, and absolute local paths", async () => {
    const result = await checkWorktreeReadiness(
      REPO_PATH,
      taskRepo({
        worktreePath: WORKTREE_PATH,
      }),
      {
        commandRunner: commandRunnerFromResults([
          {
            exitCode: 0,
            stdoutSummary: `${UNSAFE_TEXT[6]}\n${UNSAFE_TEXT[8]}`,
            stderrSummary: `${UNSAFE_TEXT[7]}\n${UNSAFE_TEXT[9]}`,
          },
          {
            exitCode: 1,
            stdoutSummary: UNSAFE_TEXT[10],
            stderrSummary: WORKTREE_PATH,
          },
        ]),
        lstat: lstatMissing(),
        realpath: realpathMatchingRepo(),
      },
    );

    expectSafeSerializedResult(result);
  });

  it("exports the worktree readiness check from the runner entrypoint", async () => {
    const options: CheckWorktreeReadinessOptionsFromEntrypoint =
      {} satisfies CheckWorktreeReadinessOptions;
    const task: CheckWorktreeReadinessTaskRepoFromEntrypoint = taskRepo();

    const result: CheckWorktreeReadinessResultFromEntrypoint = await checkWorktreeReadiness(
      REPO_PATH,
      task,
      {
        commandRunner: commandRunnerFromResults([{ exitCode: 0 }, { exitCode: 1 }]),
        lstat: lstatMissing(),
        realpath: realpathMatchingRepo(),
      },
    );
    const localResult: CheckWorktreeReadinessResult = result;
    const localTask: CheckWorktreeReadinessTaskRepo = task;

    expect(options).toEqual({});
    expect(localTask.targetBranch).toBe(TARGET_BRANCH);
    expect(localResult.checks.map((check) => check.id)).toEqual([
      "branch_name_available",
      "worktree_path_available",
    ]);
    expect(checkWorktreeReadinessFromEntrypoint).toBe(checkWorktreeReadiness);
  });
});

type CommandResultOptions = {
  exitCode: number;
  stdoutSummary?: string;
  stderrSummary?: string;
  redactionApplied?: boolean;
};

type RecordingCommandRunner = CheckWorktreeReadinessCommandRunner & {
  calls: {
    command: string;
    args: string[];
    cwd: string;
    summaryLimit: number | undefined;
  }[];
};

type RecordingLstat = NonNullable<CheckWorktreeReadinessOptions["lstat"]> & {
  calls: string[];
};

const commandRunnerFromResults = (results: CommandResultOptions[]): RecordingCommandRunner => {
  const calls: RecordingCommandRunner["calls"] = [];
  const runner = (async (options: RunCommandOptions): Promise<CommandExecutionResult> => {
    calls.push({
      command: options.command,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      summaryLimit: options.summaryLimit,
    });

    const result = results.shift();

    if (result === undefined) {
      throw new Error("Unexpected command invocation.");
    }

    return commandResult(options, result);
  }) as RecordingCommandRunner;

  runner.calls = calls;
  return runner;
};

const throwingCommandRunner = (message: string): RecordingCommandRunner => {
  const calls: RecordingCommandRunner["calls"] = [];
  const runner = (async (options: RunCommandOptions): Promise<CommandExecutionResult> => {
    calls.push({
      command: options.command,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      summaryLimit: options.summaryLimit,
    });

    throw new Error(message);
  }) as RecordingCommandRunner;

  runner.calls = calls;
  return runner;
};

const commandResult = (
  options: RunCommandOptions,
  overrides: CommandResultOptions,
): CommandExecutionResult => ({
  command: {
    executable: options.command,
    args: [...(options.args ?? [])],
  },
  cwd: options.cwd,
  exitCode: overrides.exitCode,
  durationMs: 1,
  stdoutSummary: overrides.stdoutSummary ?? "",
  stderrSummary: overrides.stderrSummary ?? "",
  redactionApplied: overrides.redactionApplied ?? false,
});

const lstatMissing = (): RecordingLstat => {
  const calls: string[] = [];
  const lstat = (async (path: string): Promise<unknown> => {
    calls.push(path);
    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  }) as RecordingLstat;

  lstat.calls = calls;
  return lstat;
};

const lstatOccupied = (): RecordingLstat => {
  const calls: string[] = [];
  const lstat = (async (path: string): Promise<unknown> => {
    calls.push(path);
    return {};
  }) as RecordingLstat;

  lstat.calls = calls;
  return lstat;
};

const realpathMatchingRepo =
  (): NonNullable<CheckWorktreeReadinessOptions["realpath"]> =>
  async (path: string): Promise<string> => {
    if (path === REPO_PATH || path === TASK_REPO_PATH) {
      return RESOLVED_REPO_PATH;
    }

    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };

const realpathMismatchedRepo =
  (): NonNullable<CheckWorktreeReadinessOptions["realpath"]> =>
  async (path: string): Promise<string> => {
    if (path === REPO_PATH) {
      return RESOLVED_REPO_PATH;
    }

    if (path === TASK_REPO_PATH) {
      return "/private/tmp/control-plane/other-resolved-repo";
    }

    throw Object.assign(new Error("missing"), { code: "ENOENT" });
  };

const taskRepo = (
  overrides: Partial<CheckWorktreeReadinessTaskRepo> = {},
): CheckWorktreeReadinessTaskRepo => ({
  localPath: TASK_REPO_PATH,
  defaultBranch: "main",
  targetBranch: TARGET_BRANCH,
  worktreePath: WORKTREE_PATH,
  ...overrides,
});

const missingMappingBlocker = (suffix: string, message: string) => ({
  id: `risk:missing_mapping:${suffix}`,
  severity: "blocked",
  category: "missing_mapping",
  message,
  paths: [],
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafe of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafe);
  }

  expect(serialized).not.toContain("source");
  expect(serialized).not.toContain("snippet");
  expect(serialized).not.toContain("stdoutSummary");
  expect(serialized).not.toContain("stderrSummary");
};

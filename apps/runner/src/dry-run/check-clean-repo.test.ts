import { DryRunCheckResultSchema, RiskFindingSchema } from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "../command.js";
import {
  checkCleanRepo,
  type CheckCleanRepoCommandRunner,
  type CheckCleanRepoOptions,
} from "./check-clean-repo.js";
import {
  checkCleanRepo as checkCleanRepoFromEntrypoint,
  type CheckCleanRepoOptions as CheckCleanRepoOptionsFromEntrypoint,
} from "../index.js";

const REPO_PATH = "/repos/control-plane";

const UNSAFE_COMMAND_OUTPUT = [
  "stdoutSummary",
  "stderrSummary",
  "SECRET_TOKEN=do-not-print",
  "GITHUB_TOKEN=ghp_dirtyreposecret1234567890",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
  " M src/private.ts",
] as const;

describe("git clean-state dry-run check", () => {
  it("passes when git status porcelain output is empty", async () => {
    const commandRunner = commandRunnerFromResult({ stdoutSummary: "" });

    const result = await checkCleanRepo(REPO_PATH, { commandRunner });

    expect(result).toEqual({
      check: {
        id: "repo_clean",
        label: "Git clean state",
        status: "passed",
        message: "Repository has no staged, unstaged, or untracked changes.",
        metadata: {
          stagedCount: 0,
          unstagedCount: 0,
          untrackedCount: 0,
          dirtyEntryCount: 0,
          safePathCount: 0,
          omittedPathCount: 0,
          paths: [],
        },
      },
      blockers: [],
      warnings: [],
    });
    expect(DryRunCheckResultSchema.safeParse(result.check).success).toBe(true);
  });

  it.each([
    {
      label: "staged",
      stdoutSummary: "A  src/new-file.ts\0",
      counts: { stagedCount: 1, unstagedCount: 0, untrackedCount: 0 },
      paths: ["src/new-file.ts"],
    },
    {
      label: "unstaged tracked",
      stdoutSummary: " M src/existing-file.ts\0",
      counts: { stagedCount: 0, unstagedCount: 1, untrackedCount: 0 },
      paths: ["src/existing-file.ts"],
    },
    {
      label: "untracked",
      stdoutSummary: "?? scratch.txt\0",
      counts: { stagedCount: 0, unstagedCount: 0, untrackedCount: 1 },
      paths: ["scratch.txt"],
    },
  ])("blocks when the repo has $label changes", async ({ stdoutSummary, counts, paths }) => {
    const result = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({ stdoutSummary }),
    });

    expect(result.check.status).toBe("failed");
    expect(result.check.id).toBe("repo_clean");
    expect(result.check.metadata).toMatchObject({
      ...counts,
      dirtyEntryCount: 1,
      safePathCount: 1,
      omittedPathCount: 0,
      paths,
    });
    expect(result.blockers).toEqual([
      {
        id: "risk:dirty_repo",
        severity: "blocked",
        category: "dirty_repo",
        message: "Repository has uncommitted changes and must be clean before runner execution.",
        paths,
      },
    ]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
  });

  it("counts mixed staged, unstaged, and untracked entries with deterministic sorted paths", async () => {
    const result = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          " M src/unstaged-file.ts\0A  src/staged-file.ts\0?? scratch.txt\0MM src/both.ts\0",
      }),
    });

    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toEqual({
      stagedCount: 2,
      unstagedCount: 2,
      untrackedCount: 1,
      dirtyEntryCount: 4,
      safePathCount: 4,
      omittedPathCount: 0,
      paths: ["scratch.txt", "src/both.ts", "src/staged-file.ts", "src/unstaged-file.ts"],
    });
    expect(result.blockers[0]?.paths).toEqual([
      "scratch.txt",
      "src/both.ts",
      "src/staged-file.ts",
      "src/unstaged-file.ts",
    ]);
  });

  it("runs git status with direct argv in the target repo", async () => {
    const commandRunner = commandRunnerFromResult({ stdoutSummary: "" });

    await checkCleanRepo(REPO_PATH, { commandRunner });

    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd: REPO_PATH,
        summaryLimit: 1_000_000,
      },
    ]);
  });

  it("fails closed with a dirty-repo blocker when git status fails without leaking output", async () => {
    const result = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({
        exitCode: 128,
        stdoutSummary: `${UNSAFE_COMMAND_OUTPUT[2]}\n${UNSAFE_COMMAND_OUTPUT[4]}\n${UNSAFE_COMMAND_OUTPUT[6]}`,
        stderrSummary: `${UNSAFE_COMMAND_OUTPUT[3]}\n${UNSAFE_COMMAND_OUTPUT[5]}`,
      }),
    });

    expect(result.check).toMatchObject({
      id: "repo_clean",
      status: "failed",
      metadata: {
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        dirtyEntryCount: 0,
        safePathCount: 0,
        omittedPathCount: 0,
        paths: [],
        gitExitCode: 128,
      },
    });
    expect(result.blockers).toEqual([
      {
        id: "risk:dirty_repo",
        severity: "blocked",
        category: "dirty_repo",
        message: "Unable to verify repository clean state before execution.",
        paths: [],
      },
    ]);
    expectSafeSerializedResult(result);
  });

  it("fails closed when porcelain output is malformed or appears truncated", async () => {
    const malformed = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({ stdoutSummary: " M src/file.ts" }),
    });
    const truncated = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({ stdoutSummary: " M src/file.ts\0\n[truncated]" }),
    });

    for (const result of [malformed, truncated]) {
      expect(result.check.status).toBe("failed");
      expect(result.check.metadata).toMatchObject({
        stagedCount: 0,
        unstagedCount: 0,
        untrackedCount: 0,
        dirtyEntryCount: 0,
        safePathCount: 0,
        omittedPathCount: 0,
        paths: [],
      });
      expect(result.blockers[0]).toMatchObject({
        severity: "blocked",
        category: "dirty_repo",
        paths: [],
      });
    }
  });

  it("omits unsafe paths from metadata while preserving dirty counts and blocker state", async () => {
    const result = await checkCleanRepo(REPO_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "A  /absolute.ts\0 M ../escape.ts\0?? src/has\u0007bell.ts\0?? function leakedSource() { return token; }\0?? secrets/API_KEY.txt\0",
      }),
    });

    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toEqual({
      stagedCount: 1,
      unstagedCount: 1,
      untrackedCount: 3,
      dirtyEntryCount: 5,
      safePathCount: 0,
      omittedPathCount: 5,
      paths: [],
    });
    expect(result.blockers).toEqual([
      {
        id: "risk:dirty_repo",
        severity: "blocked",
        category: "dirty_repo",
        message: "Repository has uncommitted changes and must be clean before runner execution.",
        paths: [],
      },
    ]);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("/absolute.ts");
    expect(serialized).not.toContain("../escape.ts");
    expect(serialized).not.toContain("has\\u0007bell");
    expect(serialized).not.toContain("function leakedSource");
    expect(serialized).not.toContain("API_KEY");
  });

  it("exports the clean repo check from the runner entrypoint", () => {
    const options: CheckCleanRepoOptionsFromEntrypoint = {} satisfies CheckCleanRepoOptions;

    expect(options).toEqual({});
    expect(checkCleanRepoFromEntrypoint).toBe(checkCleanRepo);
  });
});

type CommandResultOptions = {
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
};

type RecordingCommandRunner = CheckCleanRepoCommandRunner & {
  calls: {
    command: string;
    args: string[];
    cwd: string;
    summaryLimit: number | undefined;
  }[];
};

const commandRunnerFromResult = (result: CommandResultOptions): RecordingCommandRunner => {
  const calls: RecordingCommandRunner["calls"] = [];
  const runner = (async (options: RunCommandOptions): Promise<CommandExecutionResult> => {
    calls.push({
      command: options.command,
      args: [...(options.args ?? [])],
      cwd: options.cwd,
      summaryLimit: options.summaryLimit,
    });

    return commandResult(options, {
      exitCode: result.exitCode ?? 0,
      stdoutSummary: result.stdoutSummary ?? "",
      stderrSummary: result.stderrSummary ?? "",
    });
  }) as RecordingCommandRunner;

  runner.calls = calls;
  return runner;
};

const commandResult = (
  options: RunCommandOptions,
  overrides: Required<CommandResultOptions>,
): CommandExecutionResult => ({
  command: {
    executable: options.command,
    args: [...(options.args ?? [])],
  },
  cwd: options.cwd,
  exitCode: overrides.exitCode,
  durationMs: 1,
  stdoutSummary: overrides.stdoutSummary,
  stderrSummary: overrides.stderrSummary,
  redactionApplied: false,
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafeText of UNSAFE_COMMAND_OUTPUT) {
    expect(serialized).not.toContain(unsafeText);
  }
};

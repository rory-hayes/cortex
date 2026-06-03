import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  RiskFindingSchema,
  type RepoPolicy,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "../command.js";
import {
  evaluateChangeSizeGate,
  type ChangeSizeGateCommandRunner,
  type ChangeSizeGateResult,
} from "./change-size.js";
import {
  evaluateChangeSizeGate as evaluateChangeSizeGateFromEntrypoint,
  type ChangeSizeGateResult as ChangeSizeGateResultFromEntrypoint,
} from "../index.js";
import type { ChangedFilesResult } from "./changed-files.js";

const WORKTREE_PATH = "/repos/control-plane/.worktrees/task-066";

const UNSAFE_TEXT = [
  "diff --git a/private.ts b/private.ts",
  "@@ -1,1 +1,1 @@",
  "patch",
  "source",
  "code",
  "content",
  "stdoutSummary",
  "stderrSummary",
  "command output line",
  "SECRET_TOKEN=do-not-print",
  "ghp_changesizesecret123",
  "sk-changesizesecret123",
] as const;

describe("change-size gate", () => {
  it("passes file-count evaluation exactly at policy.maxChangedFiles", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 2 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts", "src/b.ts"] }),
      commandRunner: commandRunnerFromResults([{ stdoutSummary: "" }]),
    });

    expect(result.counts).toEqual({
      changedFileCount: 2,
      omittedPathCount: 0,
      evaluatedFileCount: 2,
      trackedDiffLineCount: 0,
      untrackedDiffLineCount: 0,
      diffLineCount: 0,
    });
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when changed files plus omitted paths exceed policy.maxChangedFiles", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 2 }),
      changedFiles: changedFilesResult({
        paths: ["src/a.ts", "src/b.ts"],
        omittedPathCount: 1,
      }),
      commandRunner: commandRunnerFromResults([{ stdoutSummary: "" }]),
    });

    expect(result.counts.evaluatedFileCount).toBe(3);
    expect(result.warnings).toEqual([
      {
        id: "risk:large_diff:file_count",
        severity: "warning",
        category: "large_diff",
        message: "Changed file count exceeds repository policy threshold.",
        paths: [],
      },
    ]);
    expect(RiskFindingSchema.parse(result.warnings[0])).toEqual(result.warnings[0]);
  });

  it("runs tracked diff shortstat through direct argv and parses insertions plus deletions", async () => {
    const commandRunner = commandRunnerFromResults([
      { stdoutSummary: " 2 files changed, 10 insertions(+), 5 deletions(-)\n" },
    ]);

    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 20 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts", "src/b.ts"] }),
      commandRunner,
    });

    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["diff", "--shortstat", "HEAD", "--"],
        cwd: WORKTREE_PATH,
        summaryLimit: 8192,
      },
    ]);
    expect(result.counts.trackedDiffLineCount).toBe(15);
    expect(result.counts.diffLineCount).toBe(15);
    expect(result.warnings).toEqual([]);
  });

  it("counts empty shortstat output as zero changed lines", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 1 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts"] }),
      commandRunner: commandRunnerFromResults([{ stdoutSummary: "" }]),
    });

    expect(result.counts.diffLineCount).toBe(0);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("fails closed on malformed or truncated tracked shortstat output", async () => {
    const malformed = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 10 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts"] }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: ` 1 file changed, ${UNSAFE_TEXT[0]}\n` },
      ]),
    });

    const truncated = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 10 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts"] }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: " 1 file changed, 3 insertions(+)\n[truncated]" },
      ]),
    });

    for (const result of [malformed, truncated]) {
      expect(result.blockers).toEqual([
        {
          id: "risk:large_diff:evaluation_failed",
          severity: "blocked",
          category: "large_diff",
          message: "Change size could not be evaluated.",
          paths: [],
        },
      ]);
      expect(result.warnings).toEqual([]);
      expect(RiskFindingSchema.parse(result.blockers[0])).toEqual(result.blockers[0]);
      expectSafeSerializedValue(result);
    }
  });

  it("counts untracked file additions with no-index shortstat and accepts exit code 1", async () => {
    const commandRunner = commandRunnerFromResults([
      { stdoutSummary: "" },
      { exitCode: 1, stdoutSummary: " 1 file changed, 4 insertions(+), 2 deletions(-)\n" },
      { exitCode: 0, stdoutSummary: "" },
    ]);

    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 10 }),
      changedFiles: changedFilesResult({
        paths: ["docs/new.md", "docs/empty.md"],
        untrackedPaths: ["docs/new.md", "docs/empty.md"],
      }),
      commandRunner,
    });

    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["diff", "--shortstat", "HEAD", "--"],
        cwd: WORKTREE_PATH,
        summaryLimit: 8192,
      },
      {
        command: "git",
        args: ["diff", "--shortstat", "--no-index", "--", "/dev/null", "docs/empty.md"],
        cwd: WORKTREE_PATH,
        summaryLimit: 8192,
      },
      {
        command: "git",
        args: ["diff", "--shortstat", "--no-index", "--", "/dev/null", "docs/new.md"],
        cwd: WORKTREE_PATH,
        summaryLimit: 8192,
      },
    ]);
    expect(result.counts.untrackedDiffLineCount).toBe(6);
    expect(result.counts.diffLineCount).toBe(6);
    expect(result.blockers).toEqual([]);
  });

  it("rejects unexpected untracked no-index exits safely", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 10 }),
      changedFiles: changedFilesResult({
        paths: ["docs/new.md"],
        untrackedPaths: ["docs/new.md"],
      }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: "" },
        {
          exitCode: 128,
          stdoutSummary: UNSAFE_TEXT.join("\n"),
          stderrSummary: UNSAFE_TEXT.join("\n"),
        },
      ]),
    });

    expect(result.blockers).toEqual([
      {
        id: "risk:large_diff:evaluation_failed",
        severity: "blocked",
        category: "large_diff",
        message: "Change size could not be evaluated.",
        paths: [],
      },
    ]);
    expectSafeSerializedValue(result);
  });

  it("fails closed when untracked no-index exits with differences but no shortstat", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 10 }),
      changedFiles: changedFilesResult({
        paths: ["docs/missing.md"],
        untrackedPaths: ["docs/missing.md"],
      }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: "" },
        {
          exitCode: 1,
          stdoutSummary: "",
          stderrSummary: "error: Could not access 'docs/missing.md'",
        },
      ]),
    });

    expect(result.blockers).toEqual([
      {
        id: "risk:large_diff:evaluation_failed",
        severity: "blocked",
        category: "large_diff",
        message: "Change size could not be evaluated.",
        paths: [],
      },
    ]);
    expect(result.warnings).toEqual([]);
    expect(RiskFindingSchema.parse(result.blockers[0])).toEqual(result.blockers[0]);
    expectSafeSerializedValue(result);
  });

  it("reports diff counts without a diff-line threshold finding when maxDiffLines is absent", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: undefined }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts"] }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: " 1 file changed, 99 insertions(+), 1 deletion(-)\n" },
      ]),
    });

    expect(result.counts.diffLineCount).toBe(100);
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
  });

  it("warns when diffLineCount exceeds policy.maxDiffLines", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 5, maxDiffLines: 7 }),
      changedFiles: changedFilesResult({ paths: ["src/a.ts"] }),
      commandRunner: commandRunnerFromResults([
        { stdoutSummary: " 1 file changed, 5 insertions(+), 3 deletions(-)\n" },
      ]),
    });

    expect(result.counts.diffLineCount).toBe(8);
    expect(result.warnings).toEqual([
      {
        id: "risk:large_diff:diff_lines",
        severity: "warning",
        category: "large_diff",
        message: "Changed diff line count exceeds repository policy threshold.",
        paths: [],
      },
    ]);
    expect(RiskFindingSchema.parse(result.warnings[0])).toEqual(result.warnings[0]);
  });

  it("does not serialize raw diffs, patches, source-like keys, command output, or secret text", async () => {
    const result = await evaluateChangeSizeGate({
      worktreePath: WORKTREE_PATH,
      policy: validPolicy({ maxChangedFiles: 1, maxDiffLines: 1 }),
      changedFiles: changedFilesResult({
        paths: ["src/a.ts"],
        omittedPathCount: 2,
      }),
      commandRunner: commandRunnerFromResults([
        {
          stdoutSummary: " 1 file changed, 3 insertions(+), 2 deletions(-)\n",
          stderrSummary: UNSAFE_TEXT.join("\n"),
        },
      ]),
    });

    expect(result.warnings).toHaveLength(2);
    for (const finding of [...result.blockers, ...result.warnings]) {
      expect(RiskFindingSchema.parse(finding)).toEqual(finding);
    }
    expectSafeSerializedValue(result);
  });

  it("exports the gate from the runner entrypoint", () => {
    const result: ChangeSizeGateResultFromEntrypoint = {
      counts: {
        changedFileCount: 0,
        omittedPathCount: 0,
        evaluatedFileCount: 0,
        trackedDiffLineCount: 0,
        untrackedDiffLineCount: 0,
        diffLineCount: 0,
      },
      blockers: [],
      warnings: [],
    } satisfies ChangeSizeGateResult;

    expect(result.counts.diffLineCount).toBe(0);
    expect(evaluateChangeSizeGateFromEntrypoint).toBe(evaluateChangeSizeGate);
  });
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy =>
  RepoPolicySchema.parse({
    contractVersion: CONTRACT_VERSION,
    protectedBranches: ["main"],
    protectedPaths: ["SECURITY_MODEL.md"],
    sensitivePaths: ["secrets/**"],
    warningPaths: {
      packageLocks: ["pnpm-lock.yaml"],
      migrations: ["migrations/**"],
      infrastructure: [".github/**"],
      auth: ["src/auth/**"],
      billing: ["src/billing/**"],
    },
    validationCommands: [
      {
        id: "test",
        label: "Tests",
        command: "pnpm test",
        timeoutSeconds: 60,
        required: true,
      },
    ],
    maxChangedFiles: 50,
    allowUntrackedFiles: false,
    dryRunChecks: ["protected_and_sensitive_paths_configured"],
    ...overrides,
  });

const changedFilesResult = (options: {
  paths: string[];
  untrackedPaths?: string[];
  omittedPathCount?: number;
}): ChangedFilesResult => {
  const untrackedPaths = options.untrackedPaths ?? [];
  const trackedPaths = options.paths.filter((path) => !untrackedPaths.includes(path));

  return {
    paths: [...options.paths],
    addedPaths: [...trackedPaths],
    modifiedPaths: [],
    deletedPaths: [],
    untrackedPaths,
    counts: {
      changedFileCount: options.paths.length,
      addedCount: trackedPaths.length,
      modifiedCount: 0,
      deletedCount: 0,
      untrackedCount: untrackedPaths.length,
      omittedPathCount: options.omittedPathCount ?? 0,
    },
  };
};

type CommandResultOptions = {
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
};

type RecordingCommandRunner = ChangeSizeGateCommandRunner & {
  calls: {
    command: string;
    args: string[];
    cwd: string;
    summaryLimit: number | undefined;
  }[];
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

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};

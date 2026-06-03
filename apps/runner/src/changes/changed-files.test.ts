import { describe, expect, it } from "vitest";

import type { CommandExecutionResult, RunCommandOptions } from "../command.js";
import {
  ChangedFilesScannerError,
  scanChangedFiles,
  type ChangedFilesCommandRunner,
  type ChangedFilesResult,
  type ChangedFileStatus,
} from "./changed-files.js";
import {
  scanChangedFiles as scanChangedFilesFromEntrypoint,
  type ChangedFilesResult as ChangedFilesResultFromEntrypoint,
  type ChangedFileStatus as ChangedFileStatusFromEntrypoint,
} from "../index.js";

const WORKTREE_PATH = "/repos/control-plane/.worktrees/task-061";

const UNSAFE_TEXT = [
  "stdoutSummary",
  "stderrSummary",
  "diff --git a/private.ts b/private.ts",
  "@@ -1,1 +1,1 @@",
  "patch contains private implementation",
  "SECRET_TOKEN=do-not-print",
  "ghp_changedfilescannersecret123",
  "sk-changedfilescannersecret123",
  "source",
  "code",
  "content",
] as const;

describe("changed-file scanner", () => {
  it("reports added, modified, deleted, and untracked paths from one scan", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "?? docs/untracked.md\0D  src/deleted.ts\0 M src/modified.ts\0A  src/added.ts\0UU src/conflict.ts\0T  src/type-change.ts\0",
      }),
    });

    expect(result).toEqual({
      paths: [
        "docs/untracked.md",
        "src/added.ts",
        "src/conflict.ts",
        "src/deleted.ts",
        "src/modified.ts",
        "src/type-change.ts",
      ],
      addedPaths: ["src/added.ts"],
      modifiedPaths: ["src/conflict.ts", "src/modified.ts", "src/type-change.ts"],
      deletedPaths: ["src/deleted.ts"],
      untrackedPaths: ["docs/untracked.md"],
      counts: {
        changedFileCount: 6,
        addedCount: 1,
        modifiedCount: 3,
        deletedCount: 1,
        untrackedCount: 1,
        omittedPathCount: 0,
      },
    });
  });

  it("runs git status through direct argv in the worktree", async () => {
    const commandRunner = commandRunnerFromResult({ stdoutSummary: "" });

    await scanChangedFiles(WORKTREE_PATH, { commandRunner });

    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
        cwd: WORKTREE_PATH,
        summaryLimit: 1_000_000,
      },
    ]);
  });

  it("deduplicates and sorts emitted path arrays and counts deterministically", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          " M zeta.ts\0A  alpha.ts\0?? scratch.txt\0D  old.ts\0 M zeta.ts\0A  alpha.ts\0",
      }),
    });

    expect(result.paths).toEqual(["alpha.ts", "old.ts", "scratch.txt", "zeta.ts"]);
    expect(result.addedPaths).toEqual(["alpha.ts"]);
    expect(result.modifiedPaths).toEqual(["zeta.ts"]);
    expect(result.deletedPaths).toEqual(["old.ts"]);
    expect(result.untrackedPaths).toEqual(["scratch.txt"]);
    expect(result.counts).toEqual({
      changedFileCount: 4,
      addedCount: 1,
      modifiedCount: 1,
      deletedCount: 1,
      untrackedCount: 1,
      omittedPathCount: 0,
    });
  });

  it("returns empty arrays and zero counts when git status output is empty", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({ stdoutSummary: "" }),
    });

    expect(result).toEqual({
      paths: [],
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      untrackedPaths: [],
      counts: {
        changedFileCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 0,
      },
    });
  });

  it("throws a safe scanner error with only gitExitCode when git status fails", async () => {
    await expect(
      scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({
          exitCode: 128,
          stdoutSummary: `${UNSAFE_TEXT[2]}\n${UNSAFE_TEXT[5]}`,
          stderrSummary: `${UNSAFE_TEXT[3]}\n${UNSAFE_TEXT[6]}`,
        }),
      }),
    ).rejects.toMatchObject({
      name: "ChangedFilesScannerError",
      gitExitCode: 128,
    });

    try {
      await scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({
          exitCode: 128,
          stdoutSummary: UNSAFE_TEXT.join("\n"),
          stderrSummary: UNSAFE_TEXT.join("\n"),
        }),
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ChangedFilesScannerError);
      expect(Object.keys(error as object)).toEqual(["gitExitCode"]);
      expectSafeSerializedValue(error);
    }
  });

  it("fails closed on malformed or truncated porcelain output", async () => {
    await expect(
      scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({ stdoutSummary: " M src/file.ts" }),
      }),
    ).rejects.toBeInstanceOf(ChangedFilesScannerError);

    await expect(
      scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({
          stdoutSummary: " M src/file.ts\0\n[truncated]",
        }),
      }),
    ).rejects.toBeInstanceOf(ChangedFilesScannerError);

    await expect(
      scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({
          stdoutSummary: "R  src/new-name.ts\0",
        }),
      }),
    ).rejects.toBeInstanceOf(ChangedFilesScannerError);
  });

  it("fails closed on unclassified porcelain status pairs", async () => {
    await expect(
      scanChangedFiles(WORKTREE_PATH, {
        commandRunner: commandRunnerFromResult({
          stdoutSummary: "!! ignored-by-unexpected-status.txt\0",
        }),
      }),
    ).rejects.toBeInstanceOf(ChangedFilesScannerError);
  });

  it("omits unsafe path text while incrementing omittedPathCount", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "A  /absolute.ts\0 M ../escape.ts\0D  src/has\u0007bell.ts\0?? function leakedSource() { return token; }\0?? secrets/API_KEY.txt\0?? src/source.ts\0?? src/code.ts\0?? docs/content.md\0?? safe/path.md\0",
      }),
    });

    expect(result).toEqual({
      paths: ["safe/path.md"],
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      untrackedPaths: ["safe/path.md"],
      counts: {
        changedFileCount: 1,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 1,
        omittedPathCount: 8,
      },
    });
    expectSafeSerializedValue(result);
  });

  it("omits pre-redacted path markers while incrementing omittedPathCount", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "?? [REDACTED_SECRET]\0?? [REDACTED_PRIVATE_KEY]\0?? [REDACTED_CREDENTIAL_URL]\0",
      }),
    });

    expect(result).toEqual({
      paths: [],
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      untrackedPaths: [],
      counts: {
        changedFileCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 3,
      },
    });
    expectSafeSerializedValue(result);
  });

  it("consumes rename and copy source records without leaking or misparsing them", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary: "R  src/new-name.ts\0src/old-name.ts\0C  docs/copied.md\0docs/original.md\0",
      }),
    });

    expect(result.modifiedPaths).toEqual(["docs/copied.md", "src/new-name.ts"]);
    expect(result.paths).toEqual(["docs/copied.md", "src/new-name.ts"]);
    expect(result.counts).toEqual({
      changedFileCount: 2,
      addedCount: 0,
      modifiedCount: 2,
      deletedCount: 0,
      untrackedCount: 0,
      omittedPathCount: 0,
    });
    expectSafeSerializedValue(result);
  });

  it("counts unsafe rename and copy source records as omitted paths", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "R  src/new-name.ts\0secrets/API_KEY.ts\0C  docs/copied.md\0function leakedSource() { return token; }\0",
      }),
    });

    expect(result.paths).toEqual(["docs/copied.md", "src/new-name.ts"]);
    expect(result.modifiedPaths).toEqual(["docs/copied.md", "src/new-name.ts"]);
    expect(result.counts).toEqual({
      changedFileCount: 2,
      addedCount: 0,
      modifiedCount: 2,
      deletedCount: 0,
      untrackedCount: 0,
      omittedPathCount: 2,
    });
    expectSafeSerializedValue(result);
  });

  it("does not serialize command summaries, diffs, patches, file contents, or fixture secret text", async () => {
    const result = await scanChangedFiles(WORKTREE_PATH, {
      commandRunner: commandRunnerFromResult({
        stdoutSummary:
          "?? safe/file.txt\0?? diff --git a/private.ts b/private.ts\0?? patch/file.txt\0?? source.ts\0?? content.md\0",
        stderrSummary: UNSAFE_TEXT.join("\n"),
      }),
    });

    expect(result.paths).toEqual(["safe/file.txt"]);
    expect(result.counts.omittedPathCount).toBe(4);
    expectSafeSerializedValue(result);
  });

  it("exports the scanner from the runner entrypoint", () => {
    const status: ChangedFileStatusFromEntrypoint = "modified" satisfies ChangedFileStatus;
    const result: ChangedFilesResultFromEntrypoint = {
      paths: [],
      addedPaths: [],
      modifiedPaths: [],
      deletedPaths: [],
      untrackedPaths: [],
      counts: {
        changedFileCount: 0,
        addedCount: 0,
        modifiedCount: 0,
        deletedCount: 0,
        untrackedCount: 0,
        omittedPathCount: 0,
      },
    } satisfies ChangedFilesResult;

    expect(status).toBe("modified");
    expect(result.paths).toEqual([]);
    expect(scanChangedFilesFromEntrypoint).toBe(scanChangedFiles);
  });
});

type CommandResultOptions = {
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
};

type RecordingCommandRunner = ChangedFilesCommandRunner & {
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

const expectSafeSerializedValue = (value: unknown): void => {
  const serialized = JSON.stringify(value);

  for (const unsafeText of UNSAFE_TEXT) {
    expect(serialized).not.toContain(unsafeText);
  }
};

import {
  CONTRACT_VERSION,
  DryRunCheckResultSchema,
  RiskFindingSchema,
} from "@control-plane/shared";
import { describe, expect, it } from "vitest";

import type { RepoPolicy } from "@control-plane/shared";

import type { CommandExecutionResult, RunCommandOptions } from "../command.js";
import {
  checkProtectedBranch,
  type CheckProtectedBranchCommandRunner,
  type CheckProtectedBranchOptions,
} from "./check-branch.js";
import {
  checkProtectedBranch as checkProtectedBranchFromEntrypoint,
  type CheckProtectedBranchOptions as CheckProtectedBranchOptionsFromEntrypoint,
  type CheckProtectedBranchResult as CheckProtectedBranchResultFromEntrypoint,
} from "../index.js";

const REPO_PATH = "/repos/control-plane";

const UNSAFE_COMMAND_OUTPUT = [
  "stdoutSummary",
  "stderrSummary",
  "SECRET_TOKEN=do-not-print",
  "GITHUB_TOKEN=ghp_branchsecret1234567890",
  "diff --git a/file.ts b/file.ts",
  "patch contains private code",
  "function leakedSource() { return token; }",
] as const;

describe("protected branch dry-run check", () => {
  it("passes when the current branch is not protected", async () => {
    const commandRunner = commandRunnerFromResult({ stdoutSummary: "feature/task-042\n" });

    const result = await checkProtectedBranch(REPO_PATH, validPolicy(), { commandRunner });

    expect(result).toEqual({
      check: {
        id: "current_branch_not_protected",
        label: "Current branch not protected",
        status: "passed",
        message: "Current branch is not protected by repo policy.",
        metadata: {
          branchKnown: true,
          currentBranch: "feature/task-042",
          protectedBranchCount: 2,
          matchedProtectedBranch: false,
        },
      },
      blockers: [],
      warnings: [],
    });
    expect(DryRunCheckResultSchema.safeParse(result.check).success).toBe(true);
  });

  it("runs git symbolic-ref with direct argv in the target repo", async () => {
    const commandRunner = commandRunnerFromResult({ stdoutSummary: "feature/task-042\n" });

    await checkProtectedBranch(REPO_PATH, validPolicy(), { commandRunner });

    expect(commandRunner.calls).toEqual([
      {
        command: "git",
        args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
        cwd: REPO_PATH,
        summaryLimit: 4096,
      },
    ]);
  });

  it("blocks when the current branch exactly matches a protected branch", async () => {
    const result = await checkProtectedBranch(REPO_PATH, validPolicy(), {
      commandRunner: commandRunnerFromResult({ stdoutSummary: "main\n" }),
    });

    expect(result.check).toEqual({
      id: "current_branch_not_protected",
      label: "Current branch not protected",
      status: "failed",
      message: "Current branch is protected by repo policy.",
      metadata: {
        branchKnown: true,
        currentBranch: "main",
        protectedBranchCount: 2,
        matchedProtectedBranch: true,
      },
    });
    expect(result.blockers).toEqual([protectedBranchBlocker()]);
    expect(RiskFindingSchema.safeParse(result.blockers[0]).success).toBe(true);
  });

  it("blocks when the current branch matches a single-segment wildcard protected branch", async () => {
    const result = await checkProtectedBranch(
      REPO_PATH,
      validPolicy({ protectedBranches: ["main", "release/*"] }),
      {
        commandRunner: commandRunnerFromResult({ stdoutSummary: "release/2026-05\n" }),
      },
    );

    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toEqual({
      branchKnown: true,
      currentBranch: "release/2026-05",
      protectedBranchCount: 2,
      matchedProtectedBranch: true,
    });
    expect(result.blockers).toEqual([protectedBranchBlocker()]);
  });

  it.each([
    {
      label: "git exits nonzero",
      result: {
        exitCode: 128,
        stdoutSummary: `${UNSAFE_COMMAND_OUTPUT[2]}\n${UNSAFE_COMMAND_OUTPUT[4]}`,
        stderrSummary: `${UNSAFE_COMMAND_OUTPUT[3]}\n${UNSAFE_COMMAND_OUTPUT[5]}`,
      },
      expectedMetadata: {
        branchKnown: false,
        protectedBranchCount: 2,
        matchedProtectedBranch: false,
        gitExitCode: 128,
      },
    },
    {
      label: "git returns empty output",
      result: { stdoutSummary: "" },
      expectedMetadata: {
        branchKnown: false,
        protectedBranchCount: 2,
        matchedProtectedBranch: false,
      },
    },
  ])(
    "blocks detached or unknown branch state when $label",
    async ({ result, expectedMetadata }) => {
      const checkResult = await checkProtectedBranch(REPO_PATH, validPolicy(), {
        commandRunner: commandRunnerFromResult(result),
      });

      expect(checkResult.check).toEqual({
        id: "current_branch_not_protected",
        label: "Current branch not protected",
        status: "failed",
        message: "Unable to verify current branch before execution.",
        metadata: expectedMetadata,
      });
      expect(checkResult.blockers).toEqual([
        protectedBranchBlocker("Unable to verify current branch before execution."),
      ]);
      expectSafeSerializedResult(checkResult);
    },
  );

  it.each([
    { label: "malformed", stdoutSummary: "../main\n" },
    { label: "truncated", stdoutSummary: "main\n[truncated]" },
    { label: "redacted", stdoutSummary: "[redacted]\n" },
    { label: "source-like", stdoutSummary: UNSAFE_COMMAND_OUTPUT[6] },
  ])("blocks when git branch output is $label", async ({ stdoutSummary }) => {
    const result = await checkProtectedBranch(REPO_PATH, validPolicy(), {
      commandRunner: commandRunnerFromResult({
        stdoutSummary,
        stderrSummary: `${UNSAFE_COMMAND_OUTPUT[3]}\n${UNSAFE_COMMAND_OUTPUT[5]}`,
      }),
    });

    expect(result.check.status).toBe("failed");
    expect(result.check.metadata).toEqual({
      branchKnown: false,
      protectedBranchCount: 2,
      matchedProtectedBranch: false,
    });
    expect(result.blockers).toEqual([
      protectedBranchBlocker("Unable to verify current branch before execution."),
    ]);
    expectSafeSerializedResult(result);
  });

  it("fails closed when protected branch patterns use unsupported glob syntax", async () => {
    const result = await checkProtectedBranch(
      REPO_PATH,
      validPolicy({ protectedBranches: ["main", "release/[0-9]*"] }),
      {
        commandRunner: commandRunnerFromResult({ stdoutSummary: "feature/task-042\n" }),
      },
    );

    expect(result.check).toEqual({
      id: "current_branch_not_protected",
      label: "Current branch not protected",
      status: "failed",
      message: "Unable to evaluate protected branch policy.",
      metadata: {
        branchKnown: true,
        currentBranch: "feature/task-042",
        protectedBranchCount: 2,
        matchedProtectedBranch: false,
      },
    });
    expect(result.blockers).toEqual([
      protectedBranchBlocker("Unable to evaluate protected branch policy."),
    ]);
  });

  it("exports the protected branch check from the runner entrypoint", async () => {
    const options: CheckProtectedBranchOptionsFromEntrypoint =
      {} satisfies CheckProtectedBranchOptions;

    const result: CheckProtectedBranchResultFromEntrypoint = await checkProtectedBranch(
      REPO_PATH,
      validPolicy(),
      {
        commandRunner: commandRunnerFromResult({ stdoutSummary: "feature/task-042\n" }),
      },
    );

    expect(options).toEqual({});
    expect(result.check.id).toBe("current_branch_not_protected");
    expect(checkProtectedBranchFromEntrypoint).toBe(checkProtectedBranch);
  });
});

type CommandResultOptions = {
  exitCode?: number;
  stdoutSummary?: string;
  stderrSummary?: string;
};

type RecordingCommandRunner = CheckProtectedBranchCommandRunner & {
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

const protectedBranchBlocker = (message = "Current branch is protected by repo policy.") => ({
  id: "risk:protected_branch",
  severity: "blocked",
  category: "protected_branch",
  message,
  paths: [],
});

const validPolicy = (overrides: Partial<RepoPolicy> = {}): RepoPolicy => ({
  contractVersion: CONTRACT_VERSION,
  protectedBranches: ["main", "release/*"],
  protectedPaths: ["src/security/**"],
  sensitivePaths: [".env", ".env.*"],
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
  dryRunChecks: ["current_branch_not_protected"],
  ...overrides,
});

const expectSafeSerializedResult = (result: unknown): void => {
  const serialized = JSON.stringify(result);

  for (const unsafeText of UNSAFE_COMMAND_OUTPUT) {
    expect(serialized).not.toContain(unsafeText);
  }
};

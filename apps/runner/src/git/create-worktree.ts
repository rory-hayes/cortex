import { lstat as fsLstat, mkdir as fsMkdir } from "node:fs/promises";
import { dirname, isAbsolute } from "node:path";

import { DryRunResultSchema, type DryRunResult } from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";
import { isSafeBranchName } from "./branch-name.js";

export type CreateWorktreeErrorCode =
  | "dry_run_blocked"
  | "dry_run_mismatch"
  | "invalid_branch"
  | "invalid_worktree_path"
  | "worktree_path_exists"
  | "worktree_path_uninspectable"
  | "git_worktree_failed";

export type CreateWorktreeErrorMetadata = {
  branchName?: string;
  baseBranch?: string;
  gitExitCode?: number;
};

export class CreateWorktreeError extends Error {
  readonly code: CreateWorktreeErrorCode;
  readonly metadata: CreateWorktreeErrorMetadata;

  constructor(
    code: CreateWorktreeErrorCode,
    message: string,
    metadata: CreateWorktreeErrorMetadata = {},
  ) {
    super(message);
    this.name = "CreateWorktreeError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type CreateWorktreeCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type CreateWorktreeOptions = {
  repoPath: string;
  runId: string;
  dryRunResult: DryRunResult;
  targetBranch: string;
  defaultBranch: string;
  worktreePath: string;
  commandRunner?: CreateWorktreeCommandRunner;
  lstat?: (path: string) => Promise<unknown>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
};

export type CreateWorktreeResult = {
  runId: string;
  branchName: string;
  baseBranch: string;
  worktreePath: string;
  metadata: {
    branchName: string;
    baseBranch: string;
    worktreeCreated: boolean;
    gitExitCode: number;
  };
};

export const createWorktree = async (
  options: CreateWorktreeOptions,
): Promise<CreateWorktreeResult> => {
  const dryRunResult = parseDryRunResult(options.dryRunResult);

  assertDryRunAllowsWorktreeCreation(dryRunResult, options.runId);
  assertSafeBranchInputs(options.targetBranch, options.defaultBranch);
  assertSafeWorktreePath(options.worktreePath);

  const lstat = options.lstat ?? fsLstat;
  const mkdir = options.mkdir ?? fsMkdir;
  const commandRunner = options.commandRunner ?? runCommand;

  await assertWorktreePathAvailable(options.worktreePath, lstat);
  await createParentDirectory(options.worktreePath, mkdir);

  const gitResult = await commandRunner({
    command: "git",
    args: [
      "worktree",
      "add",
      "-b",
      options.targetBranch,
      options.worktreePath,
      options.defaultBranch,
    ],
    cwd: options.repoPath,
    summaryLimit: 1,
  });

  if (gitResult.exitCode !== 0) {
    throw new CreateWorktreeError(
      "git_worktree_failed",
      "Git worktree creation failed.",
      safeGitMetadata(options, gitResult.exitCode),
    );
  }

  return {
    runId: options.runId,
    branchName: options.targetBranch,
    baseBranch: options.defaultBranch,
    worktreePath: options.worktreePath,
    metadata: {
      branchName: options.targetBranch,
      baseBranch: options.defaultBranch,
      worktreeCreated: true,
      gitExitCode: gitResult.exitCode,
    },
  };
};

const parseDryRunResult = (dryRunResult: DryRunResult): DryRunResult => {
  const parsed = DryRunResultSchema.safeParse(dryRunResult);

  if (!parsed.success) {
    throw new CreateWorktreeError(
      "dry_run_blocked",
      "Dry run must be schema-valid before worktree creation.",
    );
  }

  return parsed.data;
};

const assertDryRunAllowsWorktreeCreation = (
  dryRunResult: DryRunResult,
  expectedRunId: string,
): void => {
  if (dryRunResult.runId !== expectedRunId) {
    throw new CreateWorktreeError(
      "dry_run_mismatch",
      "Dry run result does not belong to this run.",
    );
  }

  if (dryRunResult.status === "failed" || dryRunResult.blockers.length > 0) {
    throw new CreateWorktreeError(
      "dry_run_blocked",
      "Dry run did not pass cleanly for worktree creation.",
    );
  }
};

const assertSafeBranchInputs = (targetBranch: string, defaultBranch: string): void => {
  if (!isSafeBranchName(targetBranch) || !isSafeBranchName(defaultBranch)) {
    throw new CreateWorktreeError("invalid_branch", "Branch name is invalid or unsafe.");
  }
};

const assertSafeWorktreePath = (worktreePath: string): void => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.trim() !== worktreePath ||
    !isAbsolute(worktreePath) ||
    hasControlCharacters(worktreePath)
  ) {
    throw new CreateWorktreeError(
      "invalid_worktree_path",
      "Worktree path must be a safe absolute path.",
    );
  }
};

const assertWorktreePathAvailable = async (
  worktreePath: string,
  lstat: NonNullable<CreateWorktreeOptions["lstat"]>,
): Promise<void> => {
  try {
    await lstat(worktreePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return;
    }

    throw new CreateWorktreeError(
      "worktree_path_uninspectable",
      "Unable to inspect worktree target path.",
    );
  }

  throw new CreateWorktreeError("worktree_path_exists", "Worktree target path already exists.");
};

const createParentDirectory = async (
  worktreePath: string,
  mkdir: NonNullable<CreateWorktreeOptions["mkdir"]>,
): Promise<void> => {
  try {
    await mkdir(dirname(worktreePath), { recursive: true });
  } catch {
    throw new CreateWorktreeError(
      "worktree_path_uninspectable",
      "Unable to prepare worktree parent directory.",
    );
  }
};

const safeGitMetadata = (
  options: CreateWorktreeOptions,
  gitExitCode: number,
): CreateWorktreeErrorMetadata => ({
  branchName: options.targetBranch,
  baseBranch: options.defaultBranch,
  gitExitCode,
});

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

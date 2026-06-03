import { lstat as fsLstat, realpath as fsRealpath } from "node:fs/promises";
import { isAbsolute, parse, relative, resolve } from "node:path";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";

export type CleanupWorktreeErrorCode =
  | "invalid_worktree_root"
  | "invalid_worktree_path"
  | "worktree_path_outside_root"
  | "worktree_path_uninspectable"
  | "git_worktree_remove_failed"
  | "git_worktree_prune_failed";

export type CleanupWorktreeErrorMetadata = {
  gitExitCode?: number;
  phase?: "remove" | "prune";
};

export class CleanupWorktreeError extends Error {
  readonly code: CleanupWorktreeErrorCode;
  readonly metadata: CleanupWorktreeErrorMetadata;

  constructor(
    code: CleanupWorktreeErrorCode,
    message: string,
    metadata: CleanupWorktreeErrorMetadata = {},
  ) {
    super(message);
    this.name = "CleanupWorktreeError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type CleanupWorktreeCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;
export type CleanupWorktreeLstat = (path: string) => Promise<unknown>;
export type CleanupWorktreeRealpath = (path: string) => Promise<string>;

export type CleanupWorktreeOptions = {
  repoPath: string;
  worktreeRoot: string;
  worktreePath: string;
  commandRunner?: CleanupWorktreeCommandRunner;
  lstat?: CleanupWorktreeLstat;
  realpath?: CleanupWorktreeRealpath;
};

export type CleanupWorktreeResult = {
  worktreePath: string;
  removed: boolean;
  pruned: boolean;
  metadata: {
    worktreeRemoved: boolean;
    gitRemoveExitCode: number | null;
    gitPruneExitCode: number;
  };
};

export const cleanupWorktree = async (
  options: CleanupWorktreeOptions,
): Promise<CleanupWorktreeResult> => {
  const worktreeRoot = assertSafeAbsolutePath(
    options.worktreeRoot,
    "invalid_worktree_root",
    "Worktree root must be a safe absolute path.",
  );
  const worktreePath = assertSafeAbsolutePath(
    options.worktreePath,
    "invalid_worktree_path",
    "Worktree path must be a safe absolute path.",
  );

  if (worktreeRoot === parse(worktreeRoot).root || !isPathInside(worktreeRoot, worktreePath)) {
    throw new CleanupWorktreeError(
      "worktree_path_outside_root",
      "Worktree path must stay inside the configured worktree root.",
    );
  }

  const lstat = options.lstat ?? fsLstat;
  const realpath = options.realpath ?? fsRealpath;
  const commandRunner = options.commandRunner ?? runCommand;
  const rootStatus = await inspectPath(worktreeRoot, lstat);
  const worktreeStatus = await inspectPath(worktreePath, lstat);

  if (!rootStatus.exists && worktreeStatus.exists) {
    throw new CleanupWorktreeError(
      "worktree_path_uninspectable",
      "Unable to prove worktree ownership.",
    );
  }

  if (rootStatus.exists && worktreeStatus.exists) {
    await assertRealpathInsideRoot(worktreeRoot, worktreePath, realpath);
  }

  let gitRemoveExitCode: number | null = null;

  if (worktreeStatus.exists) {
    const removeResult = await commandRunner({
      command: "git",
      args: ["worktree", "remove", "--force", worktreePath],
      cwd: options.repoPath,
      summaryLimit: 1,
    });

    gitRemoveExitCode = removeResult.exitCode;

    if (removeResult.exitCode !== 0) {
      throw gitFailure("git_worktree_remove_failed", "remove", removeResult.exitCode);
    }
  }

  const pruneResult = await commandRunner({
    command: "git",
    args: ["worktree", "prune", "--expire", "now"],
    cwd: options.repoPath,
    summaryLimit: 1,
  });

  if (pruneResult.exitCode !== 0) {
    throw gitFailure("git_worktree_prune_failed", "prune", pruneResult.exitCode);
  }

  return {
    worktreePath,
    removed: worktreeStatus.exists,
    pruned: true,
    metadata: {
      worktreeRemoved: worktreeStatus.exists,
      gitRemoveExitCode,
      gitPruneExitCode: pruneResult.exitCode,
    },
  };
};

type PathInspection = {
  exists: boolean;
};

const assertSafeAbsolutePath = (
  value: string,
  code: "invalid_worktree_root" | "invalid_worktree_path",
  message: string,
): string => {
  if (
    typeof value !== "string" ||
    value.trim().length === 0 ||
    value.trim() !== value ||
    !isAbsolute(value) ||
    hasControlCharacters(value)
  ) {
    throw new CleanupWorktreeError(code, message);
  }

  return resolve(value);
};

const inspectPath = async (
  path: string,
  lstat: NonNullable<CleanupWorktreeOptions["lstat"]>,
): Promise<PathInspection> => {
  try {
    await lstat(path);

    return {
      exists: true,
    };
  } catch (error) {
    if (isMissingPathError(error)) {
      return {
        exists: false,
      };
    }

    throw new CleanupWorktreeError(
      "worktree_path_uninspectable",
      "Unable to inspect worktree path.",
    );
  }
};

const assertRealpathInsideRoot = async (
  worktreeRoot: string,
  worktreePath: string,
  realpath: NonNullable<CleanupWorktreeOptions["realpath"]>,
): Promise<void> => {
  let realRoot: string;
  let realWorktreePath: string;

  try {
    realRoot = resolve(await realpath(worktreeRoot));
    realWorktreePath = resolve(await realpath(worktreePath));
  } catch {
    throw new CleanupWorktreeError(
      "worktree_path_uninspectable",
      "Unable to prove worktree ownership.",
    );
  }

  if (!isPathInside(realRoot, realWorktreePath)) {
    throw new CleanupWorktreeError(
      "worktree_path_outside_root",
      "Worktree path must stay inside the configured worktree root.",
    );
  }
};

const gitFailure = (
  code: "git_worktree_remove_failed" | "git_worktree_prune_failed",
  phase: NonNullable<CleanupWorktreeErrorMetadata["phase"]>,
  gitExitCode: number,
): CleanupWorktreeError =>
  new CleanupWorktreeError(
    code,
    phase === "remove" ? "Git worktree removal failed." : "Git worktree prune failed.",
    {
      gitExitCode,
      phase,
    },
  );

const isPathInside = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate);

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

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

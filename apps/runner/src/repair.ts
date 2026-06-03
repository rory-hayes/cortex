import { lstat as fsLstat, mkdir as fsMkdir, realpath as fsRealpath } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve } from "node:path";

import type { TaskPacket } from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "./command.js";
import type { CreateWorktreeResult } from "./git/create-worktree.js";
import { isSafeBranchName } from "./git/branch-name.js";

export type PrepareRepairWorktreeErrorCode =
  | "attempt_limit_exceeded"
  | "branch_mismatch"
  | "dirty_repo"
  | "dirty_worktree"
  | "git_worktree_failed"
  | "invalid_branch"
  | "invalid_repair_packet"
  | "invalid_worktree_path"
  | "protected_branch"
  | "repo_mapping_mismatch"
  | "unavailable_branch"
  | "untrusted_git_output"
  | "worktree_path_uninspectable";

export type PrepareRepairWorktreeErrorMetadata = {
  branchName?: string;
  gitExitCode?: number;
  repairAttempt?: number;
};

export class PrepareRepairWorktreeError extends Error {
  readonly code: PrepareRepairWorktreeErrorCode;
  readonly metadata: PrepareRepairWorktreeErrorMetadata;

  constructor(
    code: PrepareRepairWorktreeErrorCode,
    message: string,
    metadata: PrepareRepairWorktreeErrorMetadata = {},
  ) {
    super(message);
    this.name = "PrepareRepairWorktreeError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type PrepareRepairWorktreeCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type RepairExecutionMetadata = {
  repairAttempt: number;
  maxRepairAttempts: number;
  previousRunId: string;
};

export type PrepareRepairWorktreeOptions = {
  repoPath: string;
  taskPacket: TaskPacket;
  worktreeRoot: string;
  commandRunner?: PrepareRepairWorktreeCommandRunner;
  lstat?: (path: string) => Promise<unknown>;
  mkdir?: (path: string, options: { recursive: true }) => Promise<unknown>;
  realpath?: (path: string) => Promise<string>;
};

export type PrepareRepairWorktreeResult = CreateWorktreeResult & {
  metadata: CreateWorktreeResult["metadata"] & {
    repair: true;
    repairAttempt: number;
    reusedExistingWorktree: boolean;
  };
};

type RepairTaskPacket = TaskPacket & {
  mode: "repair";
  repair: NonNullable<TaskPacket["repair"]>;
};

const MANUAL_REPAIR_ATTEMPT_LIMIT = 2;

export const repairExecutionMetadata = (
  taskPacket: TaskPacket,
): RepairExecutionMetadata | undefined => {
  if (taskPacket.mode !== "repair") {
    return undefined;
  }

  const repairPacket = parseRepairTaskPacket(taskPacket);

  return {
    repairAttempt: repairPacket.repair.attempt,
    maxRepairAttempts: repairPacket.repair.maxAttempts,
    previousRunId: repairPacket.repair.previousRunId,
  };
};

export const prepareRepairWorktree = async (
  options: PrepareRepairWorktreeOptions,
): Promise<PrepareRepairWorktreeResult> => {
  const repairPacket = parseRepairTaskPacket(options.taskPacket);
  assertRepairAttemptAllowed(repairPacket);
  assertSafeRepairBranchInputs(repairPacket);
  assertRepairBranchAllowed(repairPacket);
  const worktreePath = parseWorktreePath(repairPacket.repo.worktreePath);
  const worktreeRoot = parseWorktreeRoot(options.repoPath, options.worktreeRoot);
  assertWorktreePathInsideRoot(worktreeRoot, worktreePath);
  assertWorktreePathNotRepoMapping(options.repoPath, repairPacket.repo.localPath, worktreePath);

  const commandRunner = options.commandRunner ?? runCommand;
  const lstat = options.lstat ?? fsLstat;
  const mkdir = options.mkdir ?? fsMkdir;
  const realpath = options.realpath ?? fsRealpath;

  await assertRepoMappingMatches(options.repoPath, repairPacket.repo.localPath, realpath);
  await assertMappedRepoClean({
    commandRunner,
    repoPath: options.repoPath,
  });
  await assertExistingBranch({
    branchName: repairPacket.repo.targetBranch,
    commandRunner,
    repoPath: options.repoPath,
  });

  const worktreeExists = await inspectWorktreePath(worktreePath, lstat);
  if (worktreeExists) {
    await assertExistingWorktreeRealpathSafe({
      realpath,
      repoPath: options.repoPath,
      taskRepoPath: repairPacket.repo.localPath,
      worktreePath,
      worktreeRoot,
    });
  }

  if (!worktreeExists) {
    await createParentDirectory(worktreePath, mkdir);
    await addRepairWorktree({
      branchName: repairPacket.repo.targetBranch,
      commandRunner,
      repoPath: options.repoPath,
      worktreePath,
    });
  }

  await assertWorktreeOnBranch({
    branchName: repairPacket.repo.targetBranch,
    commandRunner,
    worktreePath,
  });
  await assertWorktreeClean({
    commandRunner,
    worktreePath,
  });

  return {
    runId: repairPacket.runId,
    branchName: repairPacket.repo.targetBranch,
    baseBranch: repairPacket.repo.defaultBranch,
    worktreePath,
    metadata: {
      branchName: repairPacket.repo.targetBranch,
      baseBranch: repairPacket.repo.defaultBranch,
      worktreeCreated: !worktreeExists,
      reusedExistingWorktree: worktreeExists,
      repair: true,
      repairAttempt: repairPacket.repair.attempt,
      gitExitCode: 0,
    },
  };
};

const parseRepairTaskPacket = (taskPacket: TaskPacket): RepairTaskPacket => {
  if (
    taskPacket.mode !== "repair" ||
    taskPacket.repair === undefined ||
    taskPacket.source.type !== "repair"
  ) {
    throw new PrepareRepairWorktreeError(
      "invalid_repair_packet",
      "Repair execution requires a repair-mode task packet.",
    );
  }

  return taskPacket as RepairTaskPacket;
};

const assertRepairAttemptAllowed = (taskPacket: RepairTaskPacket): void => {
  if (
    taskPacket.repair.attempt > taskPacket.repair.maxAttempts ||
    taskPacket.repair.attempt > MANUAL_REPAIR_ATTEMPT_LIMIT ||
    taskPacket.repair.maxAttempts > MANUAL_REPAIR_ATTEMPT_LIMIT
  ) {
    throw new PrepareRepairWorktreeError(
      "attempt_limit_exceeded",
      "Repair attempt exceeds the configured limit.",
      {
        repairAttempt: taskPacket.repair.attempt,
      },
    );
  }
};

const assertSafeRepairBranchInputs = (taskPacket: RepairTaskPacket): void => {
  if (
    !isSafeBranchName(taskPacket.repo.targetBranch) ||
    !isSafeBranchName(taskPacket.repo.defaultBranch)
  ) {
    throw new PrepareRepairWorktreeError(
      "invalid_branch",
      "Repair branch metadata is invalid or unsafe.",
    );
  }
};

const assertRepairBranchAllowed = (taskPacket: RepairTaskPacket): void => {
  const targetBranch = taskPacket.repo.targetBranch;

  if (
    targetBranch === taskPacket.repo.defaultBranch ||
    matchesProtectedBranchPolicy(targetBranch, taskPacket.policy.protectedBranches)
  ) {
    throw new PrepareRepairWorktreeError(
      "protected_branch",
      "Repair target branch is protected and cannot be modified.",
      { branchName: targetBranch },
    );
  }
};

const parseWorktreePath = (worktreePath: string | undefined): string => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.trim() !== worktreePath ||
    !isAbsolute(worktreePath) ||
    worktreePath === parse(worktreePath).root ||
    hasControlCharacter(worktreePath)
  ) {
    throw new PrepareRepairWorktreeError(
      "invalid_worktree_path",
      "Repair worktree path must be a safe absolute path.",
    );
  }

  return worktreePath;
};

const parseWorktreeRoot = (repoPath: string, worktreeRoot: string): string => {
  if (
    typeof worktreeRoot !== "string" ||
    worktreeRoot.trim().length === 0 ||
    worktreeRoot.trim() !== worktreeRoot ||
    hasControlCharacter(worktreeRoot)
  ) {
    throw new PrepareRepairWorktreeError(
      "invalid_worktree_path",
      "Repair worktree root must be safe.",
    );
  }

  const resolvedRoot = isAbsolute(worktreeRoot)
    ? resolve(worktreeRoot)
    : resolve(repoPath, worktreeRoot);

  if (resolvedRoot === parse(resolvedRoot).root) {
    throw new PrepareRepairWorktreeError(
      "invalid_worktree_path",
      "Repair worktree root must be safe.",
    );
  }

  return resolvedRoot;
};

const assertWorktreePathInsideRoot = (worktreeRoot: string, worktreePath: string): void => {
  if (isPathInside(worktreeRoot, worktreePath)) {
    return;
  }

  throw new PrepareRepairWorktreeError(
    "invalid_worktree_path",
    "Repair worktree path must stay inside the runner worktree root.",
  );
};

const assertWorktreePathNotRepoMapping = (
  repoPath: string,
  taskRepoPath: string,
  worktreePath: string,
): void => {
  const resolvedWorktreePath = resolve(worktreePath);

  if (
    resolvedWorktreePath !== resolve(repoPath) &&
    resolvedWorktreePath !== resolve(taskRepoPath)
  ) {
    return;
  }

  throw new PrepareRepairWorktreeError(
    "invalid_worktree_path",
    "Repair worktree path must not reuse the mapped repository checkout.",
  );
};

const assertRepoMappingMatches = async (
  repoPath: string,
  taskRepoPath: string,
  realpath: NonNullable<PrepareRepairWorktreeOptions["realpath"]>,
): Promise<void> => {
  try {
    const [resolvedRepoPath, resolvedTaskRepoPath] = await Promise.all([
      realpath(repoPath),
      realpath(taskRepoPath),
    ]);

    if (resolvedRepoPath === resolvedTaskRepoPath) {
      return;
    }
  } catch {
    throw new PrepareRepairWorktreeError(
      "repo_mapping_mismatch",
      "Repair repository mapping could not be verified.",
    );
  }

  throw new PrepareRepairWorktreeError(
    "repo_mapping_mismatch",
    "Repair repository mapping does not match the validated repository.",
  );
};

const assertExistingWorktreeRealpathSafe = async ({
  realpath,
  repoPath,
  taskRepoPath,
  worktreePath,
  worktreeRoot,
}: {
  realpath: NonNullable<PrepareRepairWorktreeOptions["realpath"]>;
  repoPath: string;
  taskRepoPath: string;
  worktreePath: string;
  worktreeRoot: string;
}): Promise<void> => {
  let resolvedWorktreePath: string;
  let resolvedWorktreeRoot: string;
  let resolvedRepoPath: string;
  let resolvedTaskRepoPath: string;

  try {
    [resolvedWorktreePath, resolvedWorktreeRoot, resolvedRepoPath, resolvedTaskRepoPath] =
      await Promise.all([
        realpath(worktreePath),
        realpath(worktreeRoot),
        realpath(repoPath),
        realpath(taskRepoPath),
      ]);
  } catch {
    throw new PrepareRepairWorktreeError(
      "invalid_worktree_path",
      "Repair worktree path ownership could not be verified.",
    );
  }

  if (
    isPathInside(resolvedWorktreeRoot, resolvedWorktreePath) &&
    resolvedWorktreePath !== resolvedRepoPath &&
    resolvedWorktreePath !== resolvedTaskRepoPath
  ) {
    return;
  }

  throw new PrepareRepairWorktreeError(
    "invalid_worktree_path",
    "Repair worktree path must stay inside the runner worktree root.",
  );
};

const assertExistingBranch = async ({
  branchName,
  commandRunner,
  repoPath,
}: {
  branchName: string;
  commandRunner: PrepareRepairWorktreeCommandRunner;
  repoPath: string;
}): Promise<void> => {
  const formatResult = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["check-ref-format", "--branch", branchName],
    cwd: repoPath,
    summaryLimit: 1,
  });

  if (formatResult.exitCode !== 0) {
    throw new PrepareRepairWorktreeError(
      "invalid_branch",
      "Repair branch metadata is invalid or unsafe.",
      { branchName, gitExitCode: formatResult.exitCode },
    );
  }

  const showRefResult = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["show-ref", "--verify", "--quiet", `refs/heads/${branchName}`],
    cwd: repoPath,
    summaryLimit: 1,
  });

  if (showRefResult.exitCode === 0) {
    return;
  }

  if (showRefResult.exitCode === 1) {
    throw new PrepareRepairWorktreeError(
      "unavailable_branch",
      "Repair target branch is not available locally.",
      { branchName },
    );
  }

  throw new PrepareRepairWorktreeError(
    "untrusted_git_output",
    "Repair target branch availability could not be trusted.",
    { branchName, gitExitCode: showRefResult.exitCode },
  );
};

const assertMappedRepoClean = async ({
  commandRunner,
  repoPath,
}: {
  commandRunner: PrepareRepairWorktreeCommandRunner;
  repoPath: string;
}): Promise<void> => {
  const result = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd: repoPath,
    summaryLimit: 1,
  });

  if (result.exitCode !== 0) {
    throw new PrepareRepairWorktreeError(
      "untrusted_git_output",
      "Repair repository clean-state output could not be trusted.",
      { gitExitCode: result.exitCode },
    );
  }

  if (result.stdoutSummary.length > 0) {
    throw new PrepareRepairWorktreeError(
      "dirty_repo",
      "Mapped repository has local changes and cannot start a repair safely.",
    );
  }
};

const inspectWorktreePath = async (
  worktreePath: string,
  lstat: NonNullable<PrepareRepairWorktreeOptions["lstat"]>,
): Promise<boolean> => {
  try {
    await lstat(worktreePath);
    return true;
  } catch (error) {
    if (isMissingPathError(error)) {
      return false;
    }

    throw new PrepareRepairWorktreeError(
      "worktree_path_uninspectable",
      "Repair worktree path could not be inspected.",
    );
  }
};

const createParentDirectory = async (
  worktreePath: string,
  mkdir: NonNullable<PrepareRepairWorktreeOptions["mkdir"]>,
): Promise<void> => {
  try {
    await mkdir(dirname(worktreePath), { recursive: true });
  } catch {
    throw new PrepareRepairWorktreeError(
      "worktree_path_uninspectable",
      "Repair worktree parent directory could not be prepared.",
    );
  }
};

const addRepairWorktree = async ({
  branchName,
  commandRunner,
  repoPath,
  worktreePath,
}: {
  branchName: string;
  commandRunner: PrepareRepairWorktreeCommandRunner;
  repoPath: string;
  worktreePath: string;
}): Promise<void> => {
  const result = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["worktree", "add", worktreePath, branchName],
    cwd: repoPath,
    summaryLimit: 1,
  });

  if (result.exitCode !== 0) {
    throw new PrepareRepairWorktreeError(
      "git_worktree_failed",
      "Git failed to prepare the existing repair branch worktree.",
      { branchName, gitExitCode: result.exitCode },
    );
  }
};

const assertWorktreeOnBranch = async ({
  branchName,
  commandRunner,
  worktreePath,
}: {
  branchName: string;
  commandRunner: PrepareRepairWorktreeCommandRunner;
  worktreePath: string;
}): Promise<void> => {
  const result = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd: worktreePath,
    summaryLimit: 512,
  });

  if (result.exitCode !== 0) {
    throw new PrepareRepairWorktreeError(
      "branch_mismatch",
      "Repair worktree branch could not be verified.",
      { branchName, gitExitCode: result.exitCode },
    );
  }

  const currentBranch = result.stdoutSummary.trim();

  if (!isSafeBranchName(currentBranch)) {
    throw new PrepareRepairWorktreeError(
      "untrusted_git_output",
      "Repair worktree branch output could not be trusted.",
      { branchName },
    );
  }

  if (currentBranch !== branchName) {
    throw new PrepareRepairWorktreeError(
      "branch_mismatch",
      "Repair worktree is not on the expected target branch.",
      { branchName },
    );
  }
};

const assertWorktreeClean = async ({
  commandRunner,
  worktreePath,
}: {
  commandRunner: PrepareRepairWorktreeCommandRunner;
  worktreePath: string;
}): Promise<void> => {
  const result = await runTrustedGit(commandRunner, {
    command: "git",
    args: ["status", "--porcelain=v1", "-z", "--untracked-files=all"],
    cwd: worktreePath,
    summaryLimit: 1,
  });

  if (result.exitCode !== 0) {
    throw new PrepareRepairWorktreeError(
      "untrusted_git_output",
      "Repair worktree clean-state output could not be trusted.",
      { gitExitCode: result.exitCode },
    );
  }

  if (result.stdoutSummary.length > 0) {
    throw new PrepareRepairWorktreeError(
      "dirty_worktree",
      "Repair worktree has local changes and cannot be reused safely.",
    );
  }
};

const runTrustedGit = async (
  commandRunner: PrepareRepairWorktreeCommandRunner,
  options: RunCommandOptions,
): Promise<CommandExecutionResult> => {
  let result: CommandExecutionResult;

  try {
    result = await commandRunner(options);
  } catch {
    throw new PrepareRepairWorktreeError(
      "untrusted_git_output",
      "Repair git command output could not be trusted.",
    );
  }

  if (result.redactionApplied) {
    throw new PrepareRepairWorktreeError(
      "untrusted_git_output",
      "Repair git command output could not be trusted.",
      { gitExitCode: result.exitCode },
    );
  }

  return result;
};

const matchesProtectedBranchPolicy = (
  branchName: string,
  protectedBranches: readonly string[],
): boolean => {
  for (const pattern of protectedBranches) {
    const normalizedPattern = normalizeBranchPattern(pattern);

    if (normalizedPattern === undefined || matchesBranchPattern(normalizedPattern, branchName)) {
      return true;
    }
  }

  return false;
};

const matchesBranchPattern = (pattern: string, branch: string): boolean =>
  matchSegments(pattern.split("/"), branch.split("/"));

const matchSegments = (
  patternSegments: readonly string[],
  branchSegments: readonly string[],
  patternIndex = 0,
  branchIndex = 0,
): boolean => {
  if (patternIndex === patternSegments.length) {
    return branchIndex === branchSegments.length;
  }

  const patternSegment = patternSegments[patternIndex];

  if (patternSegment === undefined) {
    return branchIndex === branchSegments.length;
  }

  if (patternSegment === "**") {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }

    for (
      let nextBranchIndex = branchIndex;
      nextBranchIndex <= branchSegments.length;
      nextBranchIndex += 1
    ) {
      if (matchSegments(patternSegments, branchSegments, patternIndex + 1, nextBranchIndex)) {
        return true;
      }
    }

    return false;
  }

  if (branchIndex >= branchSegments.length) {
    return false;
  }

  const branchSegment = branchSegments[branchIndex];

  return (
    branchSegment !== undefined &&
    matchSingleSegment(patternSegment, branchSegment) &&
    matchSegments(patternSegments, branchSegments, patternIndex + 1, branchIndex + 1)
  );
};

const matchSingleSegment = (patternSegment: string, branchSegment: string): boolean => {
  if (!patternSegment.includes("*")) {
    return patternSegment === branchSegment;
  }

  const regex = new RegExp(
    `^${patternSegment.split("*").map(escapeRegexLiteral).join("[^/]*")}$`,
    "u",
  );

  return regex.test(branchSegment);
};

const normalizeBranchPattern = (pattern: string): string | undefined => {
  if (!isSafeBranchPatternText(pattern)) {
    return undefined;
  }

  const segments = pattern.split("/");

  if (segments.length === 0 || segments.some((segment) => segment.length === 0)) {
    return undefined;
  }

  for (const segment of segments) {
    if (!isSafeBranchPatternSegment(segment)) {
      return undefined;
    }
  }

  return pattern;
};

const isSafeBranchPatternText = (value: string): boolean =>
  value.length > 0 &&
  value.length <= 512 &&
  value.trim() === value &&
  !value.startsWith("-") &&
  !value.startsWith("/") &&
  !value.endsWith("/") &&
  !value.includes("//") &&
  !value.includes("@{") &&
  !value.includes("..") &&
  !hasControlCharacter(value) &&
  !/[?{}[\]\\~^:\s]/u.test(value);

const isSafeBranchPatternSegment = (segment: string): boolean => {
  if (segment === "**") {
    return true;
  }

  if (segment === "." || segment === ".." || segment.startsWith(".") || segment.endsWith(".")) {
    return false;
  }

  if (segment.endsWith(".lock") || (segment.includes("**") && segment !== "**")) {
    return false;
  }

  const literalText = segment.replaceAll("*", "");

  return literalText.length === 0 || /^[A-Za-z0-9._/@+=,%-]+$/u.test(literalText);
};

const escapeRegexLiteral = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const relativePath = relative(resolve(rootPath), resolve(candidatePath));

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

const isMissingPathError = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === "ENOENT";

const hasControlCharacter = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

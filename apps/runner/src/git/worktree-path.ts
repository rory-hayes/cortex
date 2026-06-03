import { createHash } from "node:crypto";
import { isAbsolute, relative, resolve, sep } from "node:path";

import {
  PathPolicyError,
  PathPolicyPatternError,
  evaluatePathAgainstPolicy,
} from "@control-plane/policies";
import type { RepoPolicy, TaskPacket } from "@control-plane/shared";

import type { RunnerConfig } from "../config.js";
import { sanitizeBranchNameSegment } from "./branch-name.js";

export type WorktreePathTaskInput = Pick<
  TaskPacket,
  "contractVersion" | "id" | "repositoryId" | "runId"
>;

export type WorktreePathResult = {
  worktreeRoot: string;
  worktreeDirectoryName: string;
  worktreePath: string;
};

export type WorktreePathErrorCode =
  | "unsafe_worktree_root"
  | "blocked_by_policy"
  | "policy_evaluation_failed";

export type CreateTaskWorktreePathOptions = {
  repoPath: string;
  config: Pick<RunnerConfig, "worktreeRoot">;
  task: WorktreePathTaskInput;
  policy?: RepoPolicy;
};

const HASH_SUFFIX_LENGTH = 12;

export class WorktreePathError extends Error {
  readonly code: WorktreePathErrorCode;

  constructor(code: WorktreePathErrorCode, message: string) {
    super(message);
    this.name = "WorktreePathError";
    this.code = code;
  }
}

export const createTaskWorktreePath = ({
  repoPath,
  config,
  task,
  policy,
}: CreateTaskWorktreePathOptions): WorktreePathResult => {
  const normalizedRepoPath = resolve(repoPath);
  const worktreeRoot = resolveWorktreeRoot(normalizedRepoPath, config.worktreeRoot);
  const worktreeDirectoryName = createWorktreeDirectoryName(task);
  const worktreePath = resolve(worktreeRoot, worktreeDirectoryName);

  if (!isPathInside(worktreeRoot, worktreePath)) {
    throw new WorktreePathError(
      "unsafe_worktree_root",
      "Computed worktree path must stay inside the worktree root.",
    );
  }

  if (policy !== undefined) {
    assertAllowedByPolicy(normalizedRepoPath, worktreePath, policy);
  }

  return {
    worktreeRoot,
    worktreeDirectoryName,
    worktreePath,
  };
};

const resolveWorktreeRoot = (repoPath: string, worktreeRoot: string): string => {
  const trimmedRoot = worktreeRoot.trim();

  if (!isSafeWorktreeRootInput(trimmedRoot)) {
    throw new WorktreePathError("unsafe_worktree_root", "Worktree root is unsafe.");
  }

  const resolvedRoot = isAbsolute(trimmedRoot)
    ? resolve(trimmedRoot)
    : resolve(repoPath, trimmedRoot);

  if (!isAbsolute(trimmedRoot) && !isPathInside(repoPath, resolvedRoot)) {
    throw new WorktreePathError(
      "unsafe_worktree_root",
      "Relative worktree root must stay inside the repository root.",
    );
  }

  if (hasEnvLikePathSegment(resolvedRoot) || hasEnvLikePathSegment(trimmedRoot)) {
    throw new WorktreePathError(
      "unsafe_worktree_root",
      "Worktree root must not be inside an env-like directory.",
    );
  }

  return resolvedRoot;
};

const createWorktreeDirectoryName = (task: WorktreePathTaskInput): string => {
  const runSegment = sanitizeBranchNameSegment(task.runId, "run");
  const suffix = createHash("sha256")
    .update([task.contractVersion, task.repositoryId, task.id, task.runId].join("\0"))
    .digest("hex")
    .slice(0, HASH_SUFFIX_LENGTH);

  return `${runSegment}-${suffix}`;
};

const assertAllowedByPolicy = (
  repoPath: string,
  worktreePath: string,
  policy: RepoPolicy,
): void => {
  const repoRelativePath = relative(repoPath, worktreePath);

  if (
    repoRelativePath.length === 0 ||
    repoRelativePath.startsWith("..") ||
    isAbsolute(repoRelativePath)
  ) {
    return;
  }

  try {
    const evaluation = evaluatePathAgainstPolicy(policy, toPosixPath(repoRelativePath));

    if (evaluation.status === "blocked") {
      throw new WorktreePathError(
        "blocked_by_policy",
        "Computed worktree path is covered by protected or sensitive path policy.",
      );
    }
  } catch (error) {
    if (error instanceof WorktreePathError) {
      throw error;
    }

    if (error instanceof PathPolicyError || error instanceof PathPolicyPatternError) {
      throw new WorktreePathError(
        "policy_evaluation_failed",
        "Unable to evaluate worktree path against repository policy.",
      );
    }

    throw error;
  }
};

const isSafeWorktreeRootInput = (value: string): boolean =>
  value.length > 0 &&
  value !== "." &&
  value !== "./" &&
  value !== ".." &&
  !hasWindowsDrivePrefix(value) &&
  !hasControlCharacters(value);

const isPathInside = (root: string, candidate: string): boolean => {
  const relativePath = relative(root, candidate);

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

const hasEnvLikePathSegment = (value: string): boolean =>
  splitPathSegments(value).some((segment) => segment === ".env" || segment.startsWith(".env."));

const splitPathSegments = (value: string): string[] =>
  value
    .replaceAll("\\", "/")
    .split(/[\\/]+/u)
    .filter(Boolean);

const toPosixPath = (value: string): string => (sep === "/" ? value : value.replaceAll(sep, "/"));

const hasWindowsDrivePrefix = (value: string): boolean => /^[A-Za-z]:/u.test(value);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

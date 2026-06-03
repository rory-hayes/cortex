import {
  commitValidatedChanges as defaultCommitValidatedChanges,
  createMockGhPrAdapter,
  createMockGitPushAdapter,
  getPullRequestWithGh,
  createPullRequestWithGh,
  pushCommittedBranch,
  renderPrSummary as defaultRenderPrSummary,
  type CommitValidatedChangesOptions,
  type CommitValidatedChangesResult,
  type GhPrAdapter,
  type GitPushAdapter,
  type PushedBranchArtifact,
} from "@control-plane/github";
import type { PrArtifact, TaskPacket } from "@control-plane/shared";
import type { ValidationSuiteResult } from "@control-plane/validation";

import type { RunnerCancellationChecker } from "./cancellation.js";
import type { ChangeScanResult } from "./changes/scan-changes.js";
import type { RunnerConfig } from "./config.js";
import { isRunnerError, RunnerError } from "./errors.js";

export type RunGithubForTaskOptions = {
  config: RunnerConfig;
  taskPacket: TaskPacket;
  worktreePath: string;
  changeScanResult: ChangeScanResult;
  validationResult: ValidationSuiteResult;
  checkCancellation?: RunnerCancellationChecker | undefined;
  onPushArtifact?: (pushArtifact: PushedBranchArtifact) => void | Promise<void>;
};

export type RunGithubForTaskDependencies = {
  commitValidatedChanges?: (
    options: CommitValidatedChangesOptions,
  ) => Promise<CommitValidatedChangesResult>;
  pushAdapter?: GitPushAdapter;
  ghPrAdapter?: GhPrAdapter;
  renderPrSummary?: typeof defaultRenderPrSummary;
  checkCancellation?: RunnerCancellationChecker | undefined;
  now?: () => string;
};

export type RunGithubForTaskResult = {
  commitResult: CommitValidatedChangesResult;
  pushArtifact: PushedBranchArtifact;
  prArtifact: PrArtifact;
};

export const runGithubForTask = async (
  options: RunGithubForTaskOptions,
  dependencies: RunGithubForTaskDependencies = {},
): Promise<RunGithubForTaskResult> => {
  const checkCancellation =
    dependencies.checkCancellation ?? options.checkCancellation ?? defaultCancellationChecker;
  const commitValidatedChanges =
    dependencies.commitValidatedChanges ?? defaultCommitValidatedChanges;
  const pushAdapter = dependencies.pushAdapter ?? selectPushAdapter(options.config);
  const ghPrAdapter = dependencies.ghPrAdapter ?? selectGhPrAdapter(options.config);
  const renderPrSummary = dependencies.renderPrSummary ?? defaultRenderPrSummary;
  const now = dependencies.now ?? currentIsoTimestamp;
  const repository = parseRepositoryId(options.taskPacket.repositoryId);

  await throwIfCancelled(checkCancellation, "before_commit", options.taskPacket.runId);
  const commitResult = await runGithubOperation("commit", () =>
    commitValidatedChanges({
      worktreePath: options.worktreePath,
      taskId: options.taskPacket.id,
      runId: options.taskPacket.runId,
      changedFilePaths: options.changeScanResult.changedFiles.paths,
      blockers: options.changeScanResult.blockers,
      validationShouldBlockCommit: options.validationResult.shouldBlockCommit,
    }),
  );

  await throwIfCancelled(checkCancellation, "before_push", options.taskPacket.runId);
  const pushArtifact = await runGithubOperation("push", () =>
    pushAdapter.pushCommittedBranch({
      worktreePath: options.worktreePath,
      taskId: options.taskPacket.id,
      runId: options.taskPacket.runId,
      branchName: options.taskPacket.repo.targetBranch,
      commitHash: commitResult.commitHash,
    }),
  );
  await options.onPushArtifact?.(pushArtifact);

  await throwIfCancelled(checkCancellation, "before_pr_creation", options.taskPacket.runId);
  const prArtifact =
    options.taskPacket.mode === "repair"
      ? await runGithubOperation("pr_view", () =>
          (ghPrAdapter.getPullRequest ?? getPullRequestWithGh)({
            worktreePath: options.worktreePath,
            runId: options.taskPacket.runId,
            repository,
            branchName: options.taskPacket.repo.targetBranch,
            changedFilePaths: options.changeScanResult.changedFiles.paths,
            riskFindings: options.changeScanResult.warnings,
            createdAt: now(),
          }),
        )
      : await runGithubOperation("pr_create", async () => {
          const prBody = await runGithubOperation("pr_summary", () =>
            Promise.resolve(
              renderPrSummary({
                task: options.taskPacket,
                changedFilePaths: options.changeScanResult.changedFiles.paths,
                validationResults: options.validationResult.results,
                riskFindings: options.changeScanResult.warnings,
              }),
            ),
          );

          return ghPrAdapter.createPullRequest({
            worktreePath: options.worktreePath,
            runId: options.taskPacket.runId,
            repository,
            branchName: options.taskPacket.repo.targetBranch,
            baseBranch: options.taskPacket.repo.defaultBranch,
            title: renderPrTitle(options.taskPacket),
            body: prBody,
            changedFilePaths: options.changeScanResult.changedFiles.paths,
            riskFindings: options.changeScanResult.warnings,
            createdAt: now(),
          });
        });

  return {
    commitResult,
    pushArtifact,
    prArtifact,
  };
};

const selectPushAdapter = (config: RunnerConfig): GitPushAdapter =>
  config.mockModes.gh
    ? createMockGitPushAdapter()
    : {
        pushCommittedBranch,
      };

const selectGhPrAdapter = (config: RunnerConfig): GhPrAdapter =>
  config.mockModes.gh
    ? createMockGhPrAdapter()
    : {
        createPullRequest: createPullRequestWithGh,
        getPullRequest: getPullRequestWithGh,
      };

const parseRepositoryId = (repositoryId: string): { owner: string; name: string } => {
  const parts = repositoryId.split("/");

  if (parts.length !== 2) {
    throw invalidRepositoryIdError();
  }

  const [owner, name] = parts;

  if (!isSafeRepositoryPart(owner) || !isSafeRepositoryPart(name)) {
    throw invalidRepositoryIdError();
  }

  return {
    owner,
    name,
  };
};

const invalidRepositoryIdError = (): RunnerError =>
  new RunnerError({
    category: "repo_path",
    userSafeMessage: "Repository metadata is not ready for pull request creation.",
    metadata: {
      reason: "invalid_repository_id",
    },
  });

const isSafeRepositoryPart = (value: string | undefined): value is string => {
  if (
    value === undefined ||
    value.length === 0 ||
    value.length > 100 ||
    value.trim() !== value ||
    value === "." ||
    value === ".." ||
    value.startsWith("-") ||
    value.includes("/") ||
    value.includes("\\") ||
    value.includes(":") ||
    value.includes("@") ||
    value.endsWith(".lock") ||
    hasControlCharacter(value) ||
    /\s/u.test(value) ||
    !/^[A-Za-z0-9._-]+$/u.test(value) ||
    looksSecretLike(value)
  ) {
    return false;
  }

  return true;
};

const renderPrTitle = (taskPacket: TaskPacket): string =>
  `${taskPacket.id}: ${taskPacket.source.title}`;

const throwIfCancelled = async (
  checkCancellation: RunnerCancellationChecker,
  boundary: "before_commit" | "before_push" | "before_pr_creation",
  runId: string,
): Promise<void> => {
  if (!(await checkCancellation({ boundary, runId }))) {
    return;
  }

  throw new RunnerError({
    category: "cancelled",
    metadata: {
      boundary,
    },
  });
};

const runGithubOperation = async <Result>(
  phase: "commit" | "push" | "pr_summary" | "pr_create" | "pr_view",
  operation: () => Promise<Result>,
): Promise<Result> => {
  try {
    return await operation();
  } catch (error) {
    if (isRunnerError(error)) {
      throw error;
    }

    throw new RunnerError({
      category: "command_execution",
      userSafeMessage: "GitHub flow operation failed.",
      metadata: {
        phase,
      },
      cause: error,
    });
  }
};

const defaultCancellationChecker = (): boolean => false;

const currentIsoTimestamp = (): string => new Date().toISOString();

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const looksSecretLike = (value: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/u.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
  /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]/iu.test(
    value,
  ) ||
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/u.test(value) ||
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\blin_api_[A-Za-z0-9_]{12,}\b/u.test(value) ||
  /\bsk-[A-Za-z0-9_-]{12,}\b/u.test(value) ||
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/u.test(value) ||
  /\bya29\.[A-Za-z0-9_-]{20,}\b/u.test(value) ||
  /\bxox[baprs]-[A-Za-z0-9-]{12,}\b/u.test(value) ||
  /\bAuthorization\s*:\s*Bearer\s+[A-Za-z0-9._~+/=-]{8,}\b/iu.test(value);

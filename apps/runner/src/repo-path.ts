import { spawn } from "node:child_process";
import { stat } from "node:fs/promises";

export type RepoPathValidationErrorCode = "path_missing" | "not_directory" | "not_git_repository";

export type RepoPathGitResult = {
  exitCode: number;
  stdout: string;
  stderr: string;
};

export type RunGitForRepoPathValidation = (
  args: readonly string[],
  options: {
    cwd: string;
  },
) => Promise<RepoPathGitResult>;

export type ValidateRepoPathOptions = {
  runGit?: RunGitForRepoPathValidation;
};

export type ValidatedRepoPath = {
  repoPath: string;
};

type RepoPathValidationErrorOptions = {
  code: RepoPathValidationErrorCode;
  repoPath: string;
  message: string;
};

export class RepoPathValidationError extends Error {
  readonly code: RepoPathValidationErrorCode;
  readonly repoPath: string;

  constructor({ code, repoPath, message }: RepoPathValidationErrorOptions) {
    super(message);
    this.name = "RepoPathValidationError";
    this.code = code;
    this.repoPath = repoPath;
  }
}

export const validateRepoPath = async (
  repoPath: string,
  options: ValidateRepoPathOptions = {},
): Promise<ValidatedRepoPath> => {
  const runGit = options.runGit ?? runGitForRepoPathValidation;
  const repoPathStat = await statRepoPath(repoPath);

  if (!repoPathStat.isDirectory()) {
    throw new RepoPathValidationError({
      code: "not_directory",
      repoPath,
      message: `Repository path is not a directory at ${repoPath}: not_directory.`,
    });
  }

  let gitResult: RepoPathGitResult;

  try {
    gitResult = await runGit(["rev-parse", "--is-inside-work-tree"], { cwd: repoPath });
  } catch {
    throw notGitRepositoryError(repoPath);
  }

  if (gitResult.exitCode !== 0 || gitResult.stdout.trim() !== "true") {
    throw notGitRepositoryError(repoPath);
  }

  return {
    repoPath,
  };
};

export const runGitForRepoPathValidation: RunGitForRepoPathValidation = async (args, { cwd }) =>
  new Promise((resolve) => {
    const child = spawn("git", [...args], {
      cwd,
      shell: false,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");

    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
    });

    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    child.on("error", () => {
      resolve({
        exitCode: 1,
        stdout: "",
        stderr: "",
      });
    });

    child.on("close", (exitCode) => {
      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr,
      });
    });
  });

const statRepoPath = async (repoPath: string) => {
  try {
    return await stat(repoPath);
  } catch {
    throw new RepoPathValidationError({
      code: "path_missing",
      repoPath,
      message: `Repository path does not exist at ${repoPath}: path_missing.`,
    });
  }
};

const notGitRepositoryError = (repoPath: string): RepoPathValidationError =>
  new RepoPathValidationError({
    code: "not_git_repository",
    repoPath,
    message: `Repository path is not a Git working tree at ${repoPath}: not_git_repository.`,
  });

import { spawn, type ChildProcessByStdio } from "node:child_process";
import { isAbsolute, parse } from "node:path";
import type { Readable } from "node:stream";

import { RiskFindingSchema, type RiskFinding } from "@control-plane/shared";

const COMMIT_SUBJECT = "aicp: commit validated task changes";
const MAX_METADATA_LENGTH = 128;
const MAX_CHANGED_PATH_LENGTH = 512;
const DEFAULT_CAPTURE_LIMIT = 4_096;
const OUTPUT_TRUNCATED_MARKER = "[truncated]";

export type GitCommitErrorCode =
  | "invalid_worktree_path"
  | "invalid_metadata"
  | "missing_changed_files"
  | "invalid_changed_file_path"
  | "invalid_risk_finding"
  | "blocked_risk_findings"
  | "validation_blocked"
  | "unapproved_staged_changes"
  | "git_add_failed"
  | "git_diff_failed"
  | "no_staged_changes"
  | "git_commit_failed"
  | "git_rev_parse_failed"
  | "invalid_commit_hash";

export type GitCommitErrorMetadata = {
  gitStep?: "add" | "diff" | "commit" | "rev_parse";
  gitExitCode?: number;
  changedFileCount?: number;
};

export class GitCommitError extends Error {
  readonly code: GitCommitErrorCode;
  readonly metadata: GitCommitErrorMetadata;

  constructor(code: GitCommitErrorCode, message: string, metadata: GitCommitErrorMetadata = {}) {
    super(message);
    this.name = "GitCommitError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type GitCommitCommand = {
  command: "git";
  args: string[];
  cwd: string;
};

export type GitCommitCommandResult = {
  exitCode: number;
  stdoutSummary: string;
  stderrSummary: string;
};

export type GitCommitCommandRunner = (command: GitCommitCommand) => Promise<GitCommitCommandResult>;

export type CommitValidatedChangesOptions = {
  worktreePath: string;
  taskId: string;
  runId: string;
  changedFilePaths: string[];
  blockers: RiskFinding[];
  validationShouldBlockCommit: boolean;
  commandRunner?: GitCommitCommandRunner;
};

export type CommitValidatedChangesResult = {
  taskId: string;
  runId: string;
  commitHash: string;
  changedFileCount: number;
};

type ParsedCommitOptions = {
  worktreePath: string;
  taskId: string;
  runId: string;
  changedFilePaths: string[];
};

export const commitValidatedChanges = async (
  options: CommitValidatedChangesOptions,
): Promise<CommitValidatedChangesResult> => {
  const parsedOptions = parseCommitOptions(options);
  const commandRunner = options.commandRunner ?? defaultGitCommitCommandRunner;
  const approvedPathSet = new Set(parsedOptions.changedFilePaths);

  await assertOnlyApprovedStagedPaths(commandRunner, parsedOptions, approvedPathSet);

  const addResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["--literal-pathspecs", "add", "--", ...parsedOptions.changedFilePaths],
    cwd: parsedOptions.worktreePath,
  });

  if (addResult.exitCode !== 0) {
    throw new GitCommitError("git_add_failed", "Git failed to stage approved changes.", {
      gitStep: "add",
      gitExitCode: addResult.exitCode,
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const stagedPaths = await assertOnlyApprovedStagedPaths(
    commandRunner,
    parsedOptions,
    approvedPathSet,
  );

  if (stagedPaths.length === 0) {
    throw new GitCommitError("no_staged_changes", "No staged changes were available to commit.", {
      gitStep: "diff",
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const diffResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["diff", "--cached", "--quiet", "--exit-code"],
    cwd: parsedOptions.worktreePath,
  });

  if (diffResult.exitCode === 0) {
    throw new GitCommitError("no_staged_changes", "No staged changes were available to commit.", {
      gitStep: "diff",
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  if (diffResult.exitCode !== 1) {
    throw new GitCommitError("git_diff_failed", "Git failed to inspect staged changes.", {
      gitStep: "diff",
      gitExitCode: diffResult.exitCode,
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const commitResult = await runGitCommand(commandRunner, {
    command: "git",
    args: [
      "--literal-pathspecs",
      "commit",
      "--only",
      "-m",
      COMMIT_SUBJECT,
      "-m",
      `Task: ${parsedOptions.taskId}\nRun: ${parsedOptions.runId}`,
      "--",
      ...parsedOptions.changedFilePaths,
    ],
    cwd: parsedOptions.worktreePath,
  });

  if (commitResult.exitCode !== 0) {
    throw new GitCommitError("git_commit_failed", "Git failed to create a commit.", {
      gitStep: "commit",
      gitExitCode: commitResult.exitCode,
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const revParseResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: parsedOptions.worktreePath,
  });

  if (revParseResult.exitCode !== 0) {
    throw new GitCommitError("git_rev_parse_failed", "Git failed to resolve the commit hash.", {
      gitStep: "rev_parse",
      gitExitCode: revParseResult.exitCode,
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const commitHash = parseCommitHash(revParseResult.stdoutSummary);

  return {
    taskId: parsedOptions.taskId,
    runId: parsedOptions.runId,
    commitHash,
    changedFileCount: parsedOptions.changedFilePaths.length,
  };
};

const assertOnlyApprovedStagedPaths = async (
  commandRunner: GitCommitCommandRunner,
  parsedOptions: ParsedCommitOptions,
  approvedPathSet: ReadonlySet<string>,
): Promise<string[]> => {
  const stagedPathResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["diff", "--cached", "--name-only", "-z"],
    cwd: parsedOptions.worktreePath,
  });

  if (stagedPathResult.exitCode !== 0) {
    throw new GitCommitError("git_diff_failed", "Git failed to inspect staged changes.", {
      gitStep: "diff",
      gitExitCode: stagedPathResult.exitCode,
      changedFileCount: parsedOptions.changedFilePaths.length,
    });
  }

  const stagedPaths = parseStagedPathOutput(
    stagedPathResult.stdoutSummary,
    parsedOptions.changedFilePaths.length,
  );

  for (const stagedPath of stagedPaths) {
    if (
      !approvedPathSet.has(stagedPath) ||
      !isSafeChangedFilePath(stagedPath) ||
      isRealEnvPath(stagedPath)
    ) {
      throw new GitCommitError(
        "unapproved_staged_changes",
        "Unapproved staged changes prevent commit creation.",
        { changedFileCount: parsedOptions.changedFilePaths.length },
      );
    }
  }

  return stagedPaths;
};

const parseStagedPathOutput = (stdoutSummary: string, changedFileCount: number): string[] => {
  if (stdoutSummary.length === 0) {
    return [];
  }

  if (!stdoutSummary.endsWith("\0")) {
    throw new GitCommitError("git_diff_failed", "Git failed to inspect staged changes.", {
      gitStep: "diff",
      changedFileCount,
    });
  }

  const stagedPaths = stdoutSummary.slice(0, -1).split("\0");

  if (stagedPaths.some((stagedPath) => stagedPath.length === 0)) {
    throw new GitCommitError("git_diff_failed", "Git failed to inspect staged changes.", {
      gitStep: "diff",
      changedFileCount,
    });
  }

  return [...new Set(stagedPaths)].toSorted((left, right) => left.localeCompare(right));
};

const parseCommitOptions = (options: CommitValidatedChangesOptions): ParsedCommitOptions => {
  const worktreePath = parseWorktreePath(options.worktreePath);
  const taskId = parseMetadataValue(options.taskId);
  const runId = parseMetadataValue(options.runId);
  const changedFilePaths = parseChangedFilePaths(options.changedFilePaths);

  parseRiskFindings(options.blockers);

  if (options.blockers.some((finding) => finding.severity === "blocked")) {
    throw new GitCommitError(
      "blocked_risk_findings",
      "Blocked risk findings prevent commit creation.",
      { changedFileCount: changedFilePaths.length },
    );
  }

  if (options.validationShouldBlockCommit !== false) {
    throw new GitCommitError("validation_blocked", "Validation status prevents commit creation.", {
      changedFileCount: changedFilePaths.length,
    });
  }

  return {
    worktreePath,
    taskId,
    runId,
    changedFilePaths,
  };
};

const parseWorktreePath = (worktreePath: string): string => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.trim() !== worktreePath ||
    !isAbsolute(worktreePath) ||
    worktreePath === parse(worktreePath).root ||
    hasControlCharacter(worktreePath)
  ) {
    throw new GitCommitError(
      "invalid_worktree_path",
      "Worktree path must be a safe absolute path.",
    );
  }

  return worktreePath;
};

const parseMetadataValue = (value: string): string => {
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > MAX_METADATA_LENGTH ||
    value.trim() !== value ||
    hasControlCharacter(value) ||
    looksSecretLike(value)
  ) {
    throw new GitCommitError(
      "invalid_metadata",
      "Commit metadata values must be short, single-line, and non-secret.",
    );
  }

  return value;
};

const parseChangedFilePaths = (changedFilePaths: string[]): string[] => {
  if (!Array.isArray(changedFilePaths)) {
    throw new GitCommitError("missing_changed_files", "Changed file paths are required.");
  }

  const uniquePaths = [...new Set(changedFilePaths)];

  if (uniquePaths.length === 0) {
    throw new GitCommitError("missing_changed_files", "Changed file paths are required.");
  }

  for (const changedFilePath of uniquePaths) {
    if (!isSafeChangedFilePath(changedFilePath) || isRealEnvPath(changedFilePath)) {
      throw new GitCommitError(
        "invalid_changed_file_path",
        "Changed file paths must be safe repo-relative paths.",
        { changedFileCount: uniquePaths.length },
      );
    }
  }

  return uniquePaths.toSorted((left, right) => left.localeCompare(right));
};

const parseRiskFindings = (blockers: RiskFinding[]): void => {
  if (!Array.isArray(blockers)) {
    throw new GitCommitError("invalid_risk_finding", "Risk findings must be schema-valid.");
  }

  for (const finding of blockers) {
    const result = RiskFindingSchema.safeParse(finding);

    if (!result.success) {
      throw new GitCommitError("invalid_risk_finding", "Risk findings must be schema-valid.");
    }
  }
};

const runGitCommand = async (
  commandRunner: GitCommitCommandRunner,
  command: GitCommitCommand,
): Promise<GitCommitCommandResult> => {
  try {
    const result = await commandRunner(command);

    if (!Number.isInteger(result.exitCode)) {
      return {
        exitCode: 1,
        stdoutSummary: "",
        stderrSummary: "",
      };
    }

    return {
      exitCode: result.exitCode,
      stdoutSummary: typeof result.stdoutSummary === "string" ? result.stdoutSummary : "",
      stderrSummary: typeof result.stderrSummary === "string" ? result.stderrSummary : "",
    };
  } catch {
    return {
      exitCode: 1,
      stdoutSummary: "",
      stderrSummary: "",
    };
  }
};

const defaultGitCommitCommandRunner: GitCommitCommandRunner = async (
  command: GitCommitCommand,
): Promise<GitCommitCommandResult> =>
  new Promise((resolve) => {
    let settled = false;
    let child: ChildProcessByStdio<null, Readable, Readable>;

    try {
      child = spawn(command.command, command.args, {
        cwd: command.cwd,
        shell: false,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (error) {
      resolve(formatSpawnFailure(error));
      return;
    }

    let stdoutSummary = "";
    let stderrSummary = "";

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");

    child.stdout?.on("data", (chunk: Buffer | string) => {
      stdoutSummary = appendBounded(stdoutSummary, String(chunk), DEFAULT_CAPTURE_LIMIT);
    });

    child.stderr?.on("data", (chunk: Buffer | string) => {
      stderrSummary = appendBounded(stderrSummary, String(chunk), DEFAULT_CAPTURE_LIMIT);
    });

    child.on("error", (error) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve(formatSpawnFailure(error));
    });

    child.on("close", (exitCode) => {
      if (settled) {
        return;
      }

      settled = true;
      resolve({
        exitCode: exitCode ?? 1,
        stdoutSummary,
        stderrSummary,
      });
    });
  });

const formatSpawnFailure = (error: unknown): GitCommitCommandResult => ({
  exitCode: getErrorCode(error) === "ENOENT" ? 127 : 1,
  stdoutSummary: "",
  stderrSummary: "",
});

const getErrorCode = (error: unknown): string | undefined => {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return undefined;
  }

  const code = error.code;

  return typeof code === "string" ? code : undefined;
};

const appendBounded = (current: string, addition: string, limit: number): string => {
  if (current.includes(OUTPUT_TRUNCATED_MARKER)) {
    return current;
  }

  if (current.length >= limit) {
    return `${current}${OUTPUT_TRUNCATED_MARKER}`;
  }

  const next = `${current}${addition}`;

  if (next.length <= limit) {
    return next;
  }

  return `${next.slice(0, limit)}${OUTPUT_TRUNCATED_MARKER}`;
};

const parseCommitHash = (stdoutSummary: string): string => {
  const commitHash = stdoutSummary.trim();

  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitHash)) {
    throw new GitCommitError("invalid_commit_hash", "Git returned an invalid commit hash.", {
      gitStep: "rev_parse",
    });
  }

  return commitHash;
};

const isSafeChangedFilePath = (changedFilePath: string): boolean => {
  if (
    typeof changedFilePath !== "string" ||
    changedFilePath.length === 0 ||
    changedFilePath.length > MAX_CHANGED_PATH_LENGTH ||
    changedFilePath.trim() !== changedFilePath ||
    hasControlCharacter(changedFilePath) ||
    changedFilePath.startsWith("/") ||
    changedFilePath.startsWith("\\") ||
    /^[A-Za-z]:[\\/]/u.test(changedFilePath) ||
    changedFilePath.includes("\\")
  ) {
    return false;
  }

  const segments = changedFilePath.split("/");

  return segments.every((segment) => segment.length > 0 && segment !== "." && segment !== "..");
};

const isRealEnvPath = (changedFilePath: string): boolean => {
  const basename = changedFilePath.split("/").at(-1);

  if (basename === undefined || basename === ".env.example") {
    return false;
  }

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

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

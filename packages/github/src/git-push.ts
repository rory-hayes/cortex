import { spawn, type ChildProcessByStdio } from "node:child_process";
import { isAbsolute, parse } from "node:path";
import type { Readable } from "node:stream";

const MAX_METADATA_LENGTH = 128;
const MAX_BRANCH_NAME_LENGTH = 200;
const MAX_REMOTE_NAME_LENGTH = 64;
const DEFAULT_REMOTE_NAME = "origin";
const DEFAULT_CAPTURE_LIMIT = 4_096;
const OUTPUT_TRUNCATED_MARKER = "[truncated]";

export type GitPushErrorCode =
  | "invalid_worktree_path"
  | "invalid_metadata"
  | "invalid_branch_name"
  | "invalid_remote_name"
  | "invalid_commit_hash"
  | "git_branch_failed"
  | "branch_mismatch"
  | "git_rev_parse_failed"
  | "head_mismatch"
  | "git_push_failed";

export type GitPushErrorMetadata = {
  gitStep?: "branch" | "rev_parse" | "push";
  gitExitCode?: number;
};

export class GitPushError extends Error {
  readonly code: GitPushErrorCode;
  readonly metadata: GitPushErrorMetadata;

  constructor(code: GitPushErrorCode, message: string, metadata: GitPushErrorMetadata = {}) {
    super(message);
    this.name = "GitPushError";
    this.code = code;
    this.metadata = metadata;
  }
}

export type GitPushCommand = {
  command: "git";
  args: string[];
  cwd: string;
};

export type GitPushCommandResult = {
  exitCode: number;
  stdoutSummary: string;
  stderrSummary: string;
};

export type GitPushCommandRunner = (command: GitPushCommand) => Promise<GitPushCommandResult>;

export type PushCommittedBranchOptions = {
  worktreePath: string;
  taskId: string;
  runId: string;
  branchName: string;
  remoteName?: string;
  commitHash: string;
  commandRunner?: GitPushCommandRunner;
};

export type PushedBranchArtifact = {
  taskId: string;
  runId: string;
  branchName: string;
  remoteName: string;
  remoteRef: string;
  commitHash: string;
};

export type GitPushAdapter = {
  pushCommittedBranch(options: PushCommittedBranchOptions): Promise<PushedBranchArtifact>;
};

export type MockGitPushAdapter = GitPushAdapter & {
  readonly calls: readonly PushedBranchArtifact[];
};

type ParsedPushOptions = {
  worktreePath: string;
  taskId: string;
  runId: string;
  branchName: string;
  remoteName: string;
  remoteRef: string;
  commitHash: string;
};

export const pushCommittedBranch = async (
  options: PushCommittedBranchOptions,
): Promise<PushedBranchArtifact> => {
  const parsedOptions = parsePushOptions(options);
  const commandRunner = options.commandRunner ?? defaultGitPushCommandRunner;

  const branchResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["symbolic-ref", "--quiet", "--short", "HEAD"],
    cwd: parsedOptions.worktreePath,
  });

  if (branchResult.exitCode !== 0) {
    throw new GitPushError("git_branch_failed", "Git failed to resolve the current branch.", {
      gitStep: "branch",
      gitExitCode: branchResult.exitCode,
    });
  }

  const currentBranch = parseCurrentBranch(branchResult.stdoutSummary);

  if (currentBranch !== parsedOptions.branchName) {
    throw new GitPushError(
      "branch_mismatch",
      "Current branch does not match branch expected for push.",
      { gitStep: "branch" },
    );
  }

  const revParseResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["rev-parse", "HEAD"],
    cwd: parsedOptions.worktreePath,
  });

  if (revParseResult.exitCode !== 0) {
    throw new GitPushError("git_rev_parse_failed", "Git failed to resolve HEAD.", {
      gitStep: "rev_parse",
      gitExitCode: revParseResult.exitCode,
    });
  }

  const headCommitHash = parseCommitHash(revParseResult.stdoutSummary, "rev_parse");

  if (headCommitHash !== parsedOptions.commitHash) {
    throw new GitPushError("head_mismatch", "HEAD does not match the expected commit hash.", {
      gitStep: "rev_parse",
    });
  }

  const pushResult = await runGitCommand(commandRunner, {
    command: "git",
    args: ["push", "-u", parsedOptions.remoteName, `HEAD:${parsedOptions.remoteRef}`],
    cwd: parsedOptions.worktreePath,
  });

  if (pushResult.exitCode !== 0) {
    throw new GitPushError("git_push_failed", "Git failed to push the committed branch.", {
      gitStep: "push",
      gitExitCode: pushResult.exitCode,
    });
  }

  return toPushedBranchArtifact(parsedOptions);
};

export const createMockGitPushAdapter = (): MockGitPushAdapter => {
  const calls: PushedBranchArtifact[] = [];

  return {
    get calls(): readonly PushedBranchArtifact[] {
      return [...calls];
    },
    async pushCommittedBranch(options: PushCommittedBranchOptions): Promise<PushedBranchArtifact> {
      const artifact = toPushedBranchArtifact(parsePushOptions(options));
      calls.push(artifact);

      return artifact;
    },
  };
};

const parsePushOptions = (options: PushCommittedBranchOptions): ParsedPushOptions => {
  const worktreePath = parseWorktreePath(options.worktreePath);
  const taskId = parseMetadataValue(options.taskId);
  const runId = parseMetadataValue(options.runId);
  const branchName = parseBranchName(options.branchName);
  const remoteName = parseRemoteName(options.remoteName ?? DEFAULT_REMOTE_NAME);
  const commitHash = parseCommitHash(options.commitHash, undefined);

  return {
    worktreePath,
    taskId,
    runId,
    branchName,
    remoteName,
    remoteRef: `refs/heads/${branchName}`,
    commitHash,
  };
};

const toPushedBranchArtifact = (parsedOptions: ParsedPushOptions): PushedBranchArtifact => ({
  taskId: parsedOptions.taskId,
  runId: parsedOptions.runId,
  branchName: parsedOptions.branchName,
  remoteName: parsedOptions.remoteName,
  remoteRef: parsedOptions.remoteRef,
  commitHash: parsedOptions.commitHash,
});

const parseWorktreePath = (worktreePath: string): string => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.trim() !== worktreePath ||
    !isAbsolute(worktreePath) ||
    worktreePath === parse(worktreePath).root ||
    hasControlCharacter(worktreePath)
  ) {
    throw new GitPushError("invalid_worktree_path", "Worktree path must be a safe absolute path.");
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
    throw new GitPushError(
      "invalid_metadata",
      "Push metadata values must be short, single-line, and non-secret.",
    );
  }

  return value;
};

const parseBranchName = (branchName: string): string => {
  if (!isSafeBranchName(branchName) || looksSecretLike(branchName)) {
    throw new GitPushError("invalid_branch_name", "Branch name must be a safe local branch ref.");
  }

  return branchName;
};

const parseCurrentBranch = (stdoutSummary: string): string => {
  const branchName = stdoutSummary.trim();

  if (!isSafeBranchName(branchName) || looksSecretLike(branchName)) {
    throw new GitPushError(
      "branch_mismatch",
      "Current branch does not match branch expected for push.",
      { gitStep: "branch" },
    );
  }

  return branchName;
};

const parseRemoteName = (remoteName: string): string => {
  if (
    typeof remoteName !== "string" ||
    remoteName.length === 0 ||
    remoteName.length > MAX_REMOTE_NAME_LENGTH ||
    remoteName.trim() !== remoteName ||
    remoteName === "." ||
    remoteName === ".." ||
    remoteName.startsWith("-") ||
    remoteName.includes("/") ||
    remoteName.includes("\\") ||
    remoteName.includes(":") ||
    remoteName.endsWith(".lock") ||
    hasControlCharacter(remoteName) ||
    /\s/u.test(remoteName) ||
    !/^[A-Za-z0-9._-]+$/u.test(remoteName) ||
    looksSecretLike(remoteName)
  ) {
    throw new GitPushError("invalid_remote_name", "Remote name must be a safe git remote name.");
  }

  return remoteName;
};

const parseCommitHash = (
  stdoutSummary: string,
  gitStep: GitPushErrorMetadata["gitStep"],
): string => {
  const commitHash = stdoutSummary.trim();

  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/u.test(commitHash)) {
    throw new GitPushError(
      "invalid_commit_hash",
      "Git commit hash must be a full hash.",
      gitStep === undefined ? {} : { gitStep },
    );
  }

  return commitHash;
};

const isSafeBranchName = (branchName: string): boolean => {
  if (
    typeof branchName !== "string" ||
    branchName.length === 0 ||
    branchName.length > MAX_BRANCH_NAME_LENGTH ||
    branchName.trim() !== branchName ||
    branchName.startsWith("-") ||
    branchName.startsWith("/") ||
    branchName.endsWith("/") ||
    branchName.endsWith(".") ||
    branchName.endsWith(".lock") ||
    branchName.includes("\\") ||
    branchName.includes("..") ||
    branchName.includes("@{") ||
    branchName.includes(":") ||
    branchName.includes("~") ||
    branchName.includes("^") ||
    branchName.includes("?") ||
    branchName.includes("*") ||
    branchName.includes("[") ||
    hasControlCharacter(branchName) ||
    /\s/u.test(branchName)
  ) {
    return false;
  }

  const segments = branchName.split("/");

  return segments.every(
    (segment) =>
      segment.length > 0 &&
      segment !== "." &&
      segment !== ".." &&
      !segment.startsWith(".") &&
      !segment.endsWith(".lock"),
  );
};

const runGitCommand = async (
  commandRunner: GitPushCommandRunner,
  command: GitPushCommand,
): Promise<GitPushCommandResult> => {
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

const defaultGitPushCommandRunner: GitPushCommandRunner = async (
  command: GitPushCommand,
): Promise<GitPushCommandResult> =>
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

const formatSpawnFailure = (error: unknown): GitPushCommandResult => ({
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

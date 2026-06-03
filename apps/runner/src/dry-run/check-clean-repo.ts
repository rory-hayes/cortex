import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RiskFinding,
} from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";

const GIT_STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"] as const;
const GIT_STATUS_SUMMARY_LIMIT = 1_000_000;
const TRUNCATION_MARKER = "\n[truncated]";

type CleanRepoMetadata = {
  stagedCount: number;
  unstagedCount: number;
  untrackedCount: number;
  dirtyEntryCount: number;
  safePathCount: number;
  omittedPathCount: number;
  paths: string[];
  gitExitCode?: number;
};

type ParsedGitStatus =
  | {
      ok: true;
      metadata: CleanRepoMetadata;
    }
  | {
      ok: false;
    };

export type CheckCleanRepoCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type CheckCleanRepoOptions = {
  commandRunner?: CheckCleanRepoCommandRunner;
};

export type CheckCleanRepoResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkCleanRepo = async (
  repoPath: string,
  options: CheckCleanRepoOptions = {},
): Promise<CheckCleanRepoResult> => {
  const commandRunner = options.commandRunner ?? runCommand;
  let gitStatus: CommandExecutionResult;

  try {
    gitStatus = await commandRunner({
      command: "git",
      args: GIT_STATUS_ARGS,
      cwd: repoPath,
      summaryLimit: GIT_STATUS_SUMMARY_LIMIT,
    });
  } catch {
    return failedUnableToVerify();
  }

  if (gitStatus.exitCode !== 0) {
    return failedUnableToVerify(gitStatus.exitCode);
  }

  const parsedStatus = parseGitStatusPorcelain({
    stdoutSummary: gitStatus.stdoutSummary,
    stderrSummary: gitStatus.stderrSummary,
  });

  if (!parsedStatus.ok) {
    return failedUnableToVerify();
  }

  if (parsedStatus.metadata.dirtyEntryCount === 0) {
    return {
      check: buildCheck({
        status: "passed",
        message: "Repository has no staged, unstaged, or untracked changes.",
        metadata: parsedStatus.metadata,
      }),
      blockers: [],
      warnings: [],
    };
  }

  const blocker = buildDirtyRepoFinding({
    message: "Repository has uncommitted changes and must be clean before runner execution.",
    paths: parsedStatus.metadata.paths,
  });

  return {
    check: buildCheck({
      status: "failed",
      message: "Repository has staged, unstaged, or untracked changes.",
      metadata: parsedStatus.metadata,
    }),
    blockers: [blocker],
    warnings: [],
  };
};

const failedUnableToVerify = (gitExitCode?: number): CheckCleanRepoResult => {
  const metadata = emptyCleanRepoMetadata();

  if (gitExitCode !== undefined) {
    metadata.gitExitCode = gitExitCode;
  }

  return {
    check: buildCheck({
      status: "failed",
      message: "Unable to verify repository clean state.",
      metadata,
    }),
    blockers: [
      buildDirtyRepoFinding({
        message: "Unable to verify repository clean state before execution.",
        paths: [],
      }),
    ],
    warnings: [],
  };
};

const buildCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: CleanRepoMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "repo_clean",
    label: "Git clean state",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildDirtyRepoFinding = (input: { message: string; paths: string[] }): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:dirty_repo",
    severity: "blocked",
    category: "dirty_repo",
    message: input.message,
    paths: input.paths,
  });

const parseGitStatusPorcelain = (input: {
  stdoutSummary: string;
  stderrSummary: string;
}): ParsedGitStatus => {
  if (appearsTruncated(input.stdoutSummary) || appearsTruncated(input.stderrSummary)) {
    return { ok: false };
  }

  if (input.stdoutSummary.length === 0) {
    return {
      ok: true,
      metadata: emptyCleanRepoMetadata(),
    };
  }

  if (!input.stdoutSummary.endsWith("\0")) {
    return { ok: false };
  }

  const records = input.stdoutSummary.split("\0");
  records.pop();

  const safePaths = new Set<string>();
  let stagedCount = 0;
  let unstagedCount = 0;
  let untrackedCount = 0;
  let dirtyEntryCount = 0;
  let omittedPathCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === undefined) {
      return { ok: false };
    }

    const parsedRecord = parsePorcelainRecord(record);

    if (!parsedRecord.ok) {
      return { ok: false };
    }

    if (parsedRecord.requiresSourcePathRecord) {
      index += 1;

      if (records[index] === undefined || records[index]?.length === 0) {
        return { ok: false };
      }
    }

    if (!parsedRecord.isDirty) {
      continue;
    }

    dirtyEntryCount += 1;
    stagedCount += parsedRecord.isStaged ? 1 : 0;
    unstagedCount += parsedRecord.isUnstaged ? 1 : 0;
    untrackedCount += parsedRecord.isUntracked ? 1 : 0;

    const safePath = sanitizeRepoRelativePath(parsedRecord.path);

    if (safePath === undefined) {
      omittedPathCount += 1;
      continue;
    }

    safePaths.add(safePath);
  }

  const paths = [...safePaths].sort(comparePaths);

  return {
    ok: true,
    metadata: {
      stagedCount,
      unstagedCount,
      untrackedCount,
      dirtyEntryCount,
      safePathCount: paths.length,
      omittedPathCount,
      paths,
    },
  };
};

type ParsedPorcelainRecord =
  | {
      ok: true;
      isDirty: boolean;
      isStaged: boolean;
      isUnstaged: boolean;
      isUntracked: boolean;
      requiresSourcePathRecord: boolean;
      path: string;
    }
  | {
      ok: false;
    };

const VALID_STATUS_CODES = new Set([" ", "M", "T", "A", "D", "R", "C", "U", "?", "!"]);

const parsePorcelainRecord = (record: string): ParsedPorcelainRecord => {
  if (record.length < 4 || record.charAt(2) !== " ") {
    return { ok: false };
  }

  const indexStatus = record.charAt(0);
  const worktreeStatus = record.charAt(1);
  const path = record.slice(3);

  if (
    path.length === 0 ||
    !VALID_STATUS_CODES.has(indexStatus) ||
    !VALID_STATUS_CODES.has(worktreeStatus)
  ) {
    return { ok: false };
  }

  const isUntracked = indexStatus === "?" && worktreeStatus === "?";
  const isIgnored = indexStatus === "!" && worktreeStatus === "!";
  const isStaged = !isUntracked && !isIgnored && indexStatus !== " ";
  const isUnstaged = !isUntracked && !isIgnored && worktreeStatus !== " ";
  const requiresSourcePathRecord = indexStatus === "R" || indexStatus === "C";

  return {
    ok: true,
    isDirty: isUntracked || isStaged || isUnstaged,
    isStaged,
    isUnstaged,
    isUntracked,
    requiresSourcePathRecord,
    path,
  };
};

const emptyCleanRepoMetadata = (): CleanRepoMetadata => ({
  stagedCount: 0,
  unstagedCount: 0,
  untrackedCount: 0,
  dirtyEntryCount: 0,
  safePathCount: 0,
  omittedPathCount: 0,
  paths: [],
});

const appearsTruncated = (value: string): boolean => value.includes(TRUNCATION_MARKER);

const comparePaths = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

const sanitizeRepoRelativePath = (value: string): string | undefined => {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    return undefined;
  }

  if (hasControlCharacters(value) || hasUnsafePathText(value)) {
    return undefined;
  }

  const normalized = normalizeRepoRelativePath(value);

  if (
    normalized === undefined ||
    hasUnsafePathText(normalized) ||
    !/^[A-Za-z0-9._/@+=, ()[\]-]+$/.test(normalized)
  ) {
    return undefined;
  }

  return normalized;
};

const normalizeRepoRelativePath = (value: string): string | undefined => {
  const path = value.replace(/\\/g, "/");

  if (
    path.startsWith("/") ||
    path.includes("://") ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  const segments = path.split("/").filter((segment) => segment.length > 0 && segment !== ".");
  const normalized = segments.join("/");

  if (normalized.length === 0 || normalized.startsWith("../") || normalized === "..") {
    return undefined;
  }

  return normalized;
};

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const hasUnsafePathText = (value: string): boolean =>
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
  /(?:^|[/_. -])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)(?:$|[/_. -])/i.test(
    value,
  ) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/.test(value) ||
  /(?:=>|[{};])/.test(value);

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";

const GIT_STATUS_ARGS = ["status", "--porcelain=v1", "-z", "--untracked-files=all"] as const;
const GIT_STATUS_SUMMARY_LIMIT = 1_000_000;
const TRUNCATION_MARKER = "\n[truncated]";

export type ChangedFileStatus = "added" | "modified" | "deleted" | "untracked";

export type ChangedFilesResult = {
  paths: string[];
  addedPaths: string[];
  modifiedPaths: string[];
  deletedPaths: string[];
  untrackedPaths: string[];
  counts: {
    changedFileCount: number;
    addedCount: number;
    modifiedCount: number;
    deletedCount: number;
    untrackedCount: number;
    omittedPathCount: number;
  };
};

export type ChangedFilesCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export class ChangedFilesScannerError extends Error {
  readonly gitExitCode: number | undefined;

  constructor(options: { gitExitCode?: number } = {}) {
    super("Unable to scan changed files.");
    Object.defineProperty(this, "name", {
      value: "ChangedFilesScannerError",
      configurable: true,
    });
    this.gitExitCode = options.gitExitCode;
  }
}

type ChangedPathSets = Record<ChangedFileStatus, Set<string>>;

type ParsedPorcelainRecord =
  | {
      ok: true;
      path: string;
      status: ChangedFileStatus;
      requiresSourcePathRecord: boolean;
    }
  | {
      ok: false;
    };

export const scanChangedFiles = async (
  worktreePath: string,
  options: { commandRunner?: ChangedFilesCommandRunner } = {},
): Promise<ChangedFilesResult> => {
  const commandRunner = options.commandRunner ?? runCommand;
  let gitStatus: CommandExecutionResult;

  try {
    gitStatus = await commandRunner({
      command: "git",
      args: GIT_STATUS_ARGS,
      cwd: worktreePath,
      summaryLimit: GIT_STATUS_SUMMARY_LIMIT,
    });
  } catch {
    throw new ChangedFilesScannerError();
  }

  if (gitStatus.exitCode !== 0) {
    throw new ChangedFilesScannerError({ gitExitCode: gitStatus.exitCode });
  }

  return parseGitStatusPorcelain(gitStatus.stdoutSummary, gitStatus.stderrSummary);
};

const parseGitStatusPorcelain = (
  stdoutSummary: string,
  stderrSummary: string,
): ChangedFilesResult => {
  if (appearsTruncated(stdoutSummary) || appearsTruncated(stderrSummary)) {
    throw new ChangedFilesScannerError();
  }

  if (stdoutSummary.length === 0) {
    return emptyChangedFilesResult();
  }

  if (!stdoutSummary.endsWith("\0")) {
    throw new ChangedFilesScannerError();
  }

  const records = stdoutSummary.split("\0");
  records.pop();

  const pathSets = emptyPathSets();
  let omittedPathCount = 0;

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];

    if (record === undefined || record.length === 0) {
      throw new ChangedFilesScannerError();
    }

    const parsedRecord = parsePorcelainRecord(record);

    if (!parsedRecord.ok) {
      throw new ChangedFilesScannerError();
    }

    if (parsedRecord.requiresSourcePathRecord) {
      index += 1;

      const sourcePathRecord = records[index];

      if (sourcePathRecord === undefined || sourcePathRecord.length === 0) {
        throw new ChangedFilesScannerError();
      }

      if (sanitizeRepoRelativePath(sourcePathRecord) === undefined) {
        omittedPathCount += 1;
      }
    }

    const safePath = sanitizeRepoRelativePath(parsedRecord.path);

    if (safePath === undefined) {
      omittedPathCount += 1;
      continue;
    }

    pathSets[parsedRecord.status].add(safePath);
  }

  return buildChangedFilesResult(pathSets, omittedPathCount);
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

  const status = classifyChangedFileStatus(indexStatus, worktreeStatus);

  if (status === undefined) {
    return { ok: false };
  }

  return {
    ok: true,
    path,
    status,
    requiresSourcePathRecord: indexStatus === "R" || indexStatus === "C",
  };
};

const classifyChangedFileStatus = (
  indexStatus: string,
  worktreeStatus: string,
): ChangedFileStatus | undefined => {
  if (indexStatus === "?" && worktreeStatus === "?") {
    return "untracked";
  }

  if (indexStatus === "!" && worktreeStatus === "!") {
    return undefined;
  }

  if (isConflictishStatus(indexStatus, worktreeStatus)) {
    return "modified";
  }

  if (indexStatus === "D" || worktreeStatus === "D") {
    return "deleted";
  }

  if (indexStatus === "A" || worktreeStatus === "A") {
    return "added";
  }

  if (
    indexStatus === "M" ||
    worktreeStatus === "M" ||
    indexStatus === "T" ||
    worktreeStatus === "T" ||
    indexStatus === "R" ||
    indexStatus === "C"
  ) {
    return "modified";
  }

  return undefined;
};

const isConflictishStatus = (indexStatus: string, worktreeStatus: string): boolean =>
  indexStatus === "U" ||
  worktreeStatus === "U" ||
  (indexStatus === "A" && worktreeStatus === "A") ||
  (indexStatus === "D" && worktreeStatus === "D");

const emptyChangedFilesResult = (): ChangedFilesResult => ({
  paths: [],
  addedPaths: [],
  modifiedPaths: [],
  deletedPaths: [],
  untrackedPaths: [],
  counts: {
    changedFileCount: 0,
    addedCount: 0,
    modifiedCount: 0,
    deletedCount: 0,
    untrackedCount: 0,
    omittedPathCount: 0,
  },
});

const emptyPathSets = (): ChangedPathSets => ({
  added: new Set<string>(),
  modified: new Set<string>(),
  deleted: new Set<string>(),
  untracked: new Set<string>(),
});

const buildChangedFilesResult = (
  pathSets: ChangedPathSets,
  omittedPathCount: number,
): ChangedFilesResult => {
  const addedPaths = sortedPaths(pathSets.added);
  const modifiedPaths = sortedPaths(pathSets.modified);
  const deletedPaths = sortedPaths(pathSets.deleted);
  const untrackedPaths = sortedPaths(pathSets.untracked);
  const paths = sortedPaths(
    new Set([...addedPaths, ...modifiedPaths, ...deletedPaths, ...untrackedPaths]),
  );

  return {
    paths,
    addedPaths,
    modifiedPaths,
    deletedPaths,
    untrackedPaths,
    counts: {
      changedFileCount: paths.length,
      addedCount: addedPaths.length,
      modifiedCount: modifiedPaths.length,
      deletedCount: deletedPaths.length,
      untrackedCount: untrackedPaths.length,
      omittedPathCount,
    },
  };
};

const sortedPaths = (paths: Iterable<string>): string[] => [...paths].sort(comparePaths);

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
  /\[REDACTED_(?:SECRET|PRIVATE_KEY|CREDENTIAL_URL)\]/i.test(value) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/.test(value) ||
  /(?:^|[/_. -])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)(?:$|[/_. -])/i.test(
    value,
  ) ||
  /(?:^|[/_. -])(?:diff|patch|source|code|content|stdoutSummary|stderrSummary)(?:$|[/_. -])/i.test(
    value,
  ) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/.test(value) ||
  /(?:=>|[{};])/.test(value);

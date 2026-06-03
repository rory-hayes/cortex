import { RiskFindingSchema, type RepoPolicy, type RiskFinding } from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";
import type { ChangedFilesResult } from "./changed-files.js";

const TRACKED_DIFF_SHORTSTAT_ARGS = ["diff", "--shortstat", "HEAD", "--"] as const;
const NO_INDEX_DIFF_SHORTSTAT_ARGS_PREFIX = [
  "diff",
  "--shortstat",
  "--no-index",
  "--",
  "/dev/null",
] as const;
const SHORTSTAT_SUMMARY_LIMIT = 8_192;
const TRUNCATION_MARKER = "\n[truncated]";

export type ChangeSizeGateCounts = {
  changedFileCount: number;
  omittedPathCount: number;
  evaluatedFileCount: number;
  trackedDiffLineCount: number;
  untrackedDiffLineCount: number;
  diffLineCount: number;
};

export type ChangeSizeGateResult = {
  counts: ChangeSizeGateCounts;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export type ChangeSizeGateCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type ChangeSizeGateOptions = {
  worktreePath: string;
  policy: Pick<RepoPolicy, "maxChangedFiles" | "maxDiffLines">;
  changedFiles: ChangedFilesResult;
  commandRunner?: ChangeSizeGateCommandRunner;
};

export class ChangeSizeGateError extends Error {
  constructor() {
    super("Unable to evaluate change size.");
    Object.defineProperty(this, "name", {
      value: "ChangeSizeGateError",
      configurable: true,
    });
  }
}

const FILE_COUNT_WARNING_FINDING = {
  id: "risk:large_diff:file_count",
  severity: "warning",
  category: "large_diff",
  message: "Changed file count exceeds repository policy threshold.",
  paths: [],
} as const satisfies RiskFinding;

const DIFF_LINES_WARNING_FINDING = {
  id: "risk:large_diff:diff_lines",
  severity: "warning",
  category: "large_diff",
  message: "Changed diff line count exceeds repository policy threshold.",
  paths: [],
} as const satisfies RiskFinding;

const EVALUATION_FAILED_FINDING = {
  id: "risk:large_diff:evaluation_failed",
  severity: "blocked",
  category: "large_diff",
  message: "Change size could not be evaluated.",
  paths: [],
} as const satisfies RiskFinding;

export const evaluateChangeSizeGate = async (
  options: ChangeSizeGateOptions,
): Promise<ChangeSizeGateResult> => {
  const commandRunner = options.commandRunner ?? runCommand;
  const counts = createInitialCounts(options.changedFiles);

  try {
    counts.trackedDiffLineCount = await countTrackedDiffLines(options.worktreePath, commandRunner);
    counts.untrackedDiffLineCount = await countUntrackedDiffLines(
      options.worktreePath,
      options.changedFiles.untrackedPaths,
      commandRunner,
    );
    counts.diffLineCount = counts.trackedDiffLineCount + counts.untrackedDiffLineCount;
  } catch {
    return {
      counts,
      blockers: [RiskFindingSchema.parse(EVALUATION_FAILED_FINDING)],
      warnings: [],
    };
  }

  return {
    counts,
    blockers: [],
    warnings: buildWarnings(options.policy, counts),
  };
};

const createInitialCounts = (changedFiles: ChangedFilesResult): ChangeSizeGateCounts => {
  const changedFileCount = changedFiles.counts.changedFileCount;
  const omittedPathCount = changedFiles.counts.omittedPathCount;

  return {
    changedFileCount,
    omittedPathCount,
    evaluatedFileCount: changedFileCount + omittedPathCount,
    trackedDiffLineCount: 0,
    untrackedDiffLineCount: 0,
    diffLineCount: 0,
  };
};

const countTrackedDiffLines = async (
  worktreePath: string,
  commandRunner: ChangeSizeGateCommandRunner,
): Promise<number> => {
  const result = await commandRunner({
    command: "git",
    args: TRACKED_DIFF_SHORTSTAT_ARGS,
    cwd: worktreePath,
    summaryLimit: SHORTSTAT_SUMMARY_LIMIT,
  });

  if (result.exitCode !== 0) {
    throw new ChangeSizeGateError();
  }

  return parseShortstatLineCount(result);
};

const countUntrackedDiffLines = async (
  worktreePath: string,
  untrackedPaths: readonly string[],
  commandRunner: ChangeSizeGateCommandRunner,
): Promise<number> => {
  let lineCount = 0;

  for (const path of sortedUniquePaths(untrackedPaths)) {
    const safePath = normalizeSafeUntrackedPath(path);

    if (safePath === undefined) {
      throw new ChangeSizeGateError();
    }

    const result = await commandRunner({
      command: "git",
      args: [...NO_INDEX_DIFF_SHORTSTAT_ARGS_PREFIX, safePath],
      cwd: worktreePath,
      summaryLimit: SHORTSTAT_SUMMARY_LIMIT,
    });

    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new ChangeSizeGateError();
    }

    if (result.exitCode === 1 && result.stdoutSummary.trim().length === 0) {
      throw new ChangeSizeGateError();
    }

    lineCount += parseShortstatLineCount(result);
  }

  return lineCount;
};

const parseShortstatLineCount = (result: CommandExecutionResult): number => {
  if (appearsTruncated(result.stdoutSummary) || appearsTruncated(result.stderrSummary)) {
    throw new ChangeSizeGateError();
  }

  const summary = result.stdoutSummary.trim();

  if (summary.length === 0) {
    return 0;
  }

  if (summary.includes("\n")) {
    throw new ChangeSizeGateError();
  }

  const parts = summary.split(",").map((part) => part.trim());
  const fileCountPart = parts.shift();

  if (fileCountPart === undefined || !/^\d+ files? changed$/.test(fileCountPart)) {
    throw new ChangeSizeGateError();
  }

  let insertions = 0;
  let deletions = 0;
  const seenStats = new Set<"insertions" | "deletions">();

  for (const part of parts) {
    const insertionCount = parseCountPart(part, "insertion", "insertions", "(+)");

    if (insertionCount !== undefined) {
      if (seenStats.has("insertions")) {
        throw new ChangeSizeGateError();
      }

      seenStats.add("insertions");
      insertions = insertionCount;
      continue;
    }

    const deletionCount = parseCountPart(part, "deletion", "deletions", "(-)");

    if (deletionCount !== undefined) {
      if (seenStats.has("deletions")) {
        throw new ChangeSizeGateError();
      }

      seenStats.add("deletions");
      deletions = deletionCount;
      continue;
    }

    throw new ChangeSizeGateError();
  }

  return insertions + deletions;
};

const parseCountPart = (
  value: string,
  singularLabel: string,
  pluralLabel: string,
  suffix: string,
): number | undefined => {
  const match = /^(\d+) ([a-z]+)\(([-+])\)$/.exec(value);

  if (match === null) {
    return undefined;
  }

  const [, rawCount, rawLabel, rawSuffixSign] = match;

  if (rawCount === undefined || rawLabel === undefined || rawSuffixSign === undefined) {
    throw new ChangeSizeGateError();
  }

  const normalizedSuffix = `(${rawSuffixSign})`;

  if (rawLabel !== singularLabel && rawLabel !== pluralLabel) {
    return undefined;
  }

  if (normalizedSuffix !== suffix) {
    return undefined;
  }

  const count = Number.parseInt(rawCount, 10);

  if (!Number.isSafeInteger(count) || count < 0) {
    throw new ChangeSizeGateError();
  }

  return count;
};

const buildWarnings = (
  policy: Pick<RepoPolicy, "maxChangedFiles" | "maxDiffLines">,
  counts: ChangeSizeGateCounts,
): RiskFinding[] => {
  const warnings: RiskFinding[] = [];

  if (counts.evaluatedFileCount > policy.maxChangedFiles) {
    warnings.push(RiskFindingSchema.parse(FILE_COUNT_WARNING_FINDING));
  }

  if (policy.maxDiffLines !== undefined && counts.diffLineCount > policy.maxDiffLines) {
    warnings.push(RiskFindingSchema.parse(DIFF_LINES_WARNING_FINDING));
  }

  return warnings;
};

const sortedUniquePaths = (paths: readonly string[]): string[] =>
  [...new Set(paths)].sort(comparePaths);

const normalizeSafeUntrackedPath = (value: string): string | undefined => {
  if (value.length === 0 || value.length > 512 || value.trim() !== value) {
    return undefined;
  }

  const path = value.replace(/\\/g, "/");

  if (
    path.startsWith("/") ||
    path.includes("://") ||
    /^[A-Za-z]:\//.test(path) ||
    path.split("/").some((segment) => segment === "..")
  ) {
    return undefined;
  }

  const normalized = path
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".")
    .join("/");

  if (normalized.length === 0 || hasControlCharacters(normalized)) {
    return undefined;
  }

  return normalized;
};

const appearsTruncated = (value: string): boolean => value.includes(TRUNCATION_MARKER);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const comparePaths = (left: string, right: string): number => {
  if (left < right) {
    return -1;
  }

  if (left > right) {
    return 1;
  }

  return 0;
};

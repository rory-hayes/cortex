import {
  DryRunCheckResultSchema,
  RiskFindingSchema,
  type DryRunCheckResult,
  type RepoPolicy,
  type RiskFinding,
} from "@control-plane/shared";

import { runCommand, type CommandExecutionResult, type RunCommandOptions } from "../command.js";

const GIT_CURRENT_BRANCH_ARGS = ["symbolic-ref", "--quiet", "--short", "HEAD"] as const;
const GIT_BRANCH_SUMMARY_LIMIT = 4096;
const TRUNCATION_MARKER = "\n[truncated]";

type ProtectedBranchMetadata = {
  branchKnown: boolean;
  currentBranch?: string;
  protectedBranchCount: number;
  matchedProtectedBranch: boolean;
  gitExitCode?: number;
};

type ParsedCurrentBranch =
  | {
      ok: true;
      branch: string;
    }
  | {
      ok: false;
    };

type ProtectedBranchEvaluation =
  | {
      ok: true;
      matchedProtectedBranch: boolean;
    }
  | {
      ok: false;
    };

export type CheckProtectedBranchCommandRunner = (
  options: RunCommandOptions,
) => Promise<CommandExecutionResult>;

export type CheckProtectedBranchOptions = {
  commandRunner?: CheckProtectedBranchCommandRunner;
};

export type CheckProtectedBranchResult = {
  check: DryRunCheckResult;
  blockers: RiskFinding[];
  warnings: RiskFinding[];
};

export const checkProtectedBranch = async (
  repoPath: string,
  policy: RepoPolicy,
  options: CheckProtectedBranchOptions = {},
): Promise<CheckProtectedBranchResult> => {
  const commandRunner = options.commandRunner ?? runCommand;
  let gitBranch: CommandExecutionResult;

  try {
    gitBranch = await commandRunner({
      command: "git",
      args: GIT_CURRENT_BRANCH_ARGS,
      cwd: repoPath,
      summaryLimit: GIT_BRANCH_SUMMARY_LIMIT,
    });
  } catch {
    return failedUnableToVerify(policy);
  }

  if (gitBranch.exitCode !== 0) {
    return failedUnableToVerify(policy, gitBranch.exitCode);
  }

  const parsedBranch = parseCurrentBranch(gitBranch);

  if (!parsedBranch.ok) {
    return failedUnableToVerify(policy);
  }

  const evaluation = evaluateProtectedBranch(parsedBranch.branch, policy.protectedBranches);
  const baseMetadata = buildMetadata(policy, {
    branchKnown: true,
    currentBranch: parsedBranch.branch,
  });

  if (!evaluation.ok) {
    return {
      check: buildCheck({
        status: "failed",
        message: "Unable to evaluate protected branch policy.",
        metadata: baseMetadata,
      }),
      blockers: [buildProtectedBranchFinding("Unable to evaluate protected branch policy.")],
      warnings: [],
    };
  }

  const metadata: ProtectedBranchMetadata = {
    ...baseMetadata,
    matchedProtectedBranch: evaluation.matchedProtectedBranch,
  };

  if (!evaluation.matchedProtectedBranch) {
    return {
      check: buildCheck({
        status: "passed",
        message: "Current branch is not protected by repo policy.",
        metadata,
      }),
      blockers: [],
      warnings: [],
    };
  }

  return {
    check: buildCheck({
      status: "failed",
      message: "Current branch is protected by repo policy.",
      metadata,
    }),
    blockers: [buildProtectedBranchFinding("Current branch is protected by repo policy.")],
    warnings: [],
  };
};

const failedUnableToVerify = (
  policy: RepoPolicy,
  gitExitCode?: number,
): CheckProtectedBranchResult => {
  const metadata = buildMetadata(policy, { branchKnown: false });

  if (gitExitCode !== undefined) {
    metadata.gitExitCode = gitExitCode;
  }

  return {
    check: buildCheck({
      status: "failed",
      message: "Unable to verify current branch before execution.",
      metadata,
    }),
    blockers: [buildProtectedBranchFinding("Unable to verify current branch before execution.")],
    warnings: [],
  };
};

const buildCheck = (input: {
  status: DryRunCheckResult["status"];
  message: string;
  metadata: ProtectedBranchMetadata;
}): DryRunCheckResult =>
  DryRunCheckResultSchema.parse({
    id: "current_branch_not_protected",
    label: "Current branch not protected",
    status: input.status,
    message: input.message,
    metadata: input.metadata,
  });

const buildProtectedBranchFinding = (message: string): RiskFinding =>
  RiskFindingSchema.parse({
    id: "risk:protected_branch",
    severity: "blocked",
    category: "protected_branch",
    message,
    paths: [],
  });

const buildMetadata = (
  policy: RepoPolicy,
  input: {
    branchKnown: boolean;
    currentBranch?: string;
  },
): ProtectedBranchMetadata => {
  const metadata: ProtectedBranchMetadata = {
    branchKnown: input.branchKnown,
    protectedBranchCount: policy.protectedBranches.length,
    matchedProtectedBranch: false,
  };

  if (input.currentBranch !== undefined) {
    metadata.currentBranch = input.currentBranch;
  }

  return metadata;
};

const parseCurrentBranch = (result: CommandExecutionResult): ParsedCurrentBranch => {
  if (
    result.redactionApplied ||
    appearsTruncated(result.stdoutSummary) ||
    appearsTruncated(result.stderrSummary)
  ) {
    return { ok: false };
  }

  const branch = parseSingleLine(result.stdoutSummary);

  if (branch === undefined || !isSafeBranchName(branch)) {
    return { ok: false };
  }

  return {
    ok: true,
    branch,
  };
};

const evaluateProtectedBranch = (
  currentBranch: string,
  protectedBranches: readonly string[],
): ProtectedBranchEvaluation => {
  let matchedProtectedBranch = false;

  for (const pattern of protectedBranches) {
    const normalizedPattern = normalizeBranchPattern(pattern);

    if (normalizedPattern === undefined) {
      return { ok: false };
    }

    if (matchesBranchPattern(normalizedPattern, currentBranch)) {
      matchedProtectedBranch = true;
    }
  }

  return {
    ok: true,
    matchedProtectedBranch,
  };
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
  !hasControlCharacters(value) &&
  !hasUnsafeText(value) &&
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

const parseSingleLine = (value: string): string | undefined => {
  const line = value.endsWith("\n") ? value.slice(0, -1) : value;

  if (line.length === 0 || line.includes("\n") || line.includes("\0")) {
    return undefined;
  }

  return line;
};

const isSafeBranchName = (value: string): boolean =>
  isSafeBranchPatternText(value) &&
  !value.includes("*") &&
  value !== "@" &&
  value.split("/").every(isSafeBranchNameSegment);

const isSafeBranchNameSegment = (segment: string): boolean =>
  segment.length > 0 &&
  segment !== "." &&
  segment !== ".." &&
  !segment.startsWith(".") &&
  !segment.endsWith(".") &&
  !segment.endsWith(".lock") &&
  /^[A-Za-z0-9._/@+=,%-]+$/u.test(segment);

const appearsTruncated = (value: string): boolean => value.includes(TRUNCATION_MARKER);

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const hasUnsafeText = (value: string): boolean =>
  /\[(?:redacted|REDACTED)[^\]]*\]/u.test(value) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu.test(value) ||
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/iu.test(value) ||
  /\bgh[pousr]_[A-Za-z0-9_]{8,}\b/u.test(value) ||
  /\bsk-[A-Za-z0-9_-]{8,}\b/u.test(value) ||
  /(?:^|[/_. -])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)(?:$|[/_. -])/iu.test(
    value,
  ) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/u.test(value) ||
  /(?:=>|[{};])/u.test(value);

const escapeRegexLiteral = (value: string): string => value.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&");

import { posix as posixPath } from "node:path";

import {
  REPO_POLICY_WARNING_PATH_CATEGORIES,
  type RepoPolicy,
  type RepoPolicyWarningPathCategory,
} from "@control-plane/shared";

export type PathPolicyStatus = "blocked" | "warning" | "safe";

export type PathPolicyWarningMatch = {
  category: RepoPolicyWarningPathCategory;
  patterns: string[];
};

export type PathPolicyEvaluation = {
  inputPath: string;
  normalizedPath: string;
  status: PathPolicyStatus;
  protectedPatterns: string[];
  sensitivePatterns: string[];
  warningMatches: PathPolicyWarningMatch[];
};

export type PathPolicyErrorCode = "empty_path" | "absolute_path" | "path_escapes_repo_root";

export type PathPolicyPatternErrorCode = "unsupported_glob_pattern";

export class PathPolicyError extends Error {
  readonly code: PathPolicyErrorCode;
  readonly inputPath: string;

  constructor(code: PathPolicyErrorCode, inputPath: string) {
    super(formatPathPolicyErrorMessage(code));
    this.name = "PathPolicyError";
    this.code = code;
    this.inputPath = inputPath;
  }
}

export class PathPolicyPatternError extends Error {
  readonly code: PathPolicyPatternErrorCode;
  readonly pattern: string;

  constructor(code: PathPolicyPatternErrorCode, pattern: string) {
    super(formatPathPolicyPatternErrorMessage(code));
    this.name = "PathPolicyPatternError";
    this.code = code;
    this.pattern = pattern;
  }
}

export const normalizeRepoRelativePath = (inputPath: string): string => {
  const pathWithForwardSlashes = inputPath.replaceAll("\\", "/");

  if (pathWithForwardSlashes.length === 0) {
    throw new PathPolicyError("empty_path", inputPath);
  }

  if (
    hasWindowsDrivePrefix(pathWithForwardSlashes) ||
    posixPath.isAbsolute(pathWithForwardSlashes)
  ) {
    throw new PathPolicyError("absolute_path", inputPath);
  }

  const normalizedPath = posixPath.normalize(pathWithForwardSlashes);

  if (normalizedPath === "." || normalizedPath.length === 0) {
    throw new PathPolicyError("empty_path", inputPath);
  }

  if (normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new PathPolicyError("path_escapes_repo_root", inputPath);
  }

  return normalizedPath;
};

export const evaluatePathAgainstPolicy = (
  policy: RepoPolicy,
  inputPath: string,
): PathPolicyEvaluation => {
  const normalizedPath = normalizeRepoRelativePath(inputPath);
  const protectedPatterns = findMatchingPatterns(policy.protectedPaths, normalizedPath);
  const sensitivePatterns = findMatchingPatterns(policy.sensitivePaths, normalizedPath);
  const implicitSensitivePattern = getImplicitSensitiveEnvPattern(normalizedPath);

  if (
    implicitSensitivePattern !== undefined &&
    !sensitivePatterns.includes(implicitSensitivePattern)
  ) {
    sensitivePatterns.push(implicitSensitivePattern);
  }

  const warningMatches = REPO_POLICY_WARNING_PATH_CATEGORIES.flatMap((category) => {
    const patterns = findMatchingPatterns(policy.warningPaths[category], normalizedPath);

    return patterns.length === 0 ? [] : [{ category, patterns }];
  });

  const status =
    protectedPatterns.length > 0 || sensitivePatterns.length > 0
      ? "blocked"
      : warningMatches.length > 0
        ? "warning"
        : "safe";

  return {
    inputPath,
    normalizedPath,
    status,
    protectedPatterns,
    sensitivePatterns,
    warningMatches,
  };
};

export const evaluatePathsAgainstPolicy = (
  policy: RepoPolicy,
  inputPaths: readonly string[],
): PathPolicyEvaluation[] =>
  inputPaths.map((inputPath) => evaluatePathAgainstPolicy(policy, inputPath));

const findMatchingPatterns = (patterns: readonly string[], normalizedPath: string): string[] =>
  patterns.filter((pattern) => matchesGlobPattern(pattern, normalizedPath));

const matchesGlobPattern = (pattern: string, normalizedPath: string): boolean => {
  const normalizedPattern = normalizePolicyPattern(pattern);

  return matchSegments(normalizedPattern.split("/"), normalizedPath.split("/"));
};

const matchSegments = (
  patternSegments: readonly string[],
  pathSegments: readonly string[],
  patternIndex = 0,
  pathIndex = 0,
): boolean => {
  if (patternIndex === patternSegments.length) {
    return pathIndex === pathSegments.length;
  }

  const patternSegment = patternSegments[patternIndex];

  if (patternSegment === undefined) {
    return pathIndex === pathSegments.length;
  }

  if (patternSegment === "**") {
    if (patternIndex === patternSegments.length - 1) {
      return true;
    }

    for (let nextPathIndex = pathIndex; nextPathIndex <= pathSegments.length; nextPathIndex += 1) {
      if (matchSegments(patternSegments, pathSegments, patternIndex + 1, nextPathIndex)) {
        return true;
      }
    }

    return false;
  }

  if (pathIndex >= pathSegments.length) {
    return false;
  }

  const pathSegment = pathSegments[pathIndex];

  return (
    pathSegment !== undefined &&
    matchSingleSegment(patternSegment, pathSegment) &&
    matchSegments(patternSegments, pathSegments, patternIndex + 1, pathIndex + 1)
  );
};

const matchSingleSegment = (patternSegment: string, pathSegment: string): boolean => {
  if (!patternSegment.includes("*")) {
    return patternSegment === pathSegment;
  }

  const regex = new RegExp(
    `^${patternSegment.split("*").map(escapeRegexLiteral).join("[^/]*")}$`,
    "u",
  );

  return regex.test(pathSegment);
};

const normalizePolicyPattern = (pattern: string): string => {
  const patternWithForwardSlashes = pattern.replaceAll("\\", "/");

  if (patternWithForwardSlashes.length === 0) {
    throw new PathPolicyError("empty_path", pattern);
  }

  if (
    hasWindowsDrivePrefix(patternWithForwardSlashes) ||
    posixPath.isAbsolute(patternWithForwardSlashes)
  ) {
    throw new PathPolicyError("absolute_path", pattern);
  }

  if (usesUnsupportedGlobSyntax(patternWithForwardSlashes)) {
    throw new PathPolicyPatternError("unsupported_glob_pattern", pattern);
  }

  const segments = patternWithForwardSlashes
    .split("/")
    .filter((segment) => segment.length > 0 && segment !== ".");

  if (segments.length === 0) {
    throw new PathPolicyError("empty_path", pattern);
  }

  if (segments.includes("..")) {
    throw new PathPolicyError("path_escapes_repo_root", pattern);
  }

  return segments.join("/");
};

const getImplicitSensitiveEnvPattern = (normalizedPath: string): string | undefined => {
  const basename = normalizedPath.split("/").at(-1);

  if (basename === ".env") {
    return ".env";
  }

  if (basename !== undefined && basename.startsWith(".env.") && basename !== ".env.example") {
    return ".env.*";
  }

  return undefined;
};

const hasWindowsDrivePrefix = (path: string): boolean => /^[A-Za-z]:/u.test(path);

const usesUnsupportedGlobSyntax = (pattern: string): boolean =>
  pattern.startsWith("!") ||
  /[?{}[\]]/u.test(pattern) ||
  /[@+?!*]\(/u.test(pattern) ||
  pattern.split("/").some((segment) => segment.includes("**") && segment !== "**");

const escapeRegexLiteral = (value: string): string => value.replace(/[\\^$+?.()|[\]{}]/gu, "\\$&");

const formatPathPolicyErrorMessage = (code: PathPolicyErrorCode): string => {
  switch (code) {
    case "empty_path":
      return "Repo-relative path must not be empty.";
    case "absolute_path":
      return "Repo-relative path must not be absolute.";
    case "path_escapes_repo_root":
      return "Repo-relative path must not escape the repository root.";
  }
};

const formatPathPolicyPatternErrorMessage = (code: PathPolicyPatternErrorCode): string => {
  switch (code) {
    case "unsupported_glob_pattern":
      return "Path policy pattern uses unsupported glob syntax.";
  }
};

import { readFile as readPolicyFile } from "node:fs/promises";

import { RepoPolicySchema, type RepoPolicy } from "@control-plane/shared";

import {
  REPO_POLICY_RELATIVE_PATH,
  RepoPolicyPathLookupError,
  getRepoPolicyFilePath,
  resolveRepoPolicyPath,
  type RepoPolicyPathLookupErrorCode,
  type RepoPolicyPathStat,
} from "./policy-path.js";

export type RepoPolicyParseErrorCode =
  | RepoPolicyPathLookupErrorCode
  | "policy_read_failed"
  | "invalid_json"
  | "invalid_policy";

export type RepoPolicyParseIssue = {
  path: string;
  message: string;
};

export type RepoPolicyReadFile = (path: string, encoding: BufferEncoding) => Promise<string>;

export type ParseRepoPolicyOptions = {
  stat?: RepoPolicyPathStat;
  readFile?: RepoPolicyReadFile;
};

type RepoPolicyParseErrorOptions = {
  code: RepoPolicyParseErrorCode;
  repoRoot: string;
  policyPath: string;
  relativePath: string;
  issues?: RepoPolicyParseIssue[];
};

export class RepoPolicyParseError extends Error {
  readonly code: RepoPolicyParseErrorCode;
  readonly repoRoot: string;
  readonly policyPath: string;
  readonly relativePath: string;
  readonly issues: RepoPolicyParseIssue[];

  constructor({
    code,
    repoRoot,
    policyPath,
    relativePath,
    issues = [],
  }: RepoPolicyParseErrorOptions) {
    super(formatRepoPolicyParseErrorMessage(code, relativePath, issues));
    this.name = "RepoPolicyParseError";
    this.code = code;
    this.repoRoot = repoRoot;
    this.policyPath = policyPath;
    this.relativePath = relativePath;
    this.issues = issues;
  }
}

export const parseRepoPolicy = async (
  repoRoot: string,
  options: ParseRepoPolicyOptions = {},
): Promise<RepoPolicy> => {
  const policyPath = await resolvePolicyPathForParsing(repoRoot, options.stat);
  const readFile = options.readFile ?? readPolicyFile;

  let contents: string;

  try {
    contents = await readFile(policyPath, "utf8");
  } catch {
    throw new RepoPolicyParseError({
      code: "policy_read_failed",
      repoRoot,
      policyPath,
      relativePath: REPO_POLICY_RELATIVE_PATH,
    });
  }

  let parsedJson: unknown;

  try {
    parsedJson = JSON.parse(contents);
  } catch {
    throw new RepoPolicyParseError({
      code: "invalid_json",
      repoRoot,
      policyPath,
      relativePath: REPO_POLICY_RELATIVE_PATH,
    });
  }

  const result = RepoPolicySchema.safeParse(parsedJson);

  if (!result.success) {
    const issues = result.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path, issue.code === "unrecognized_keys"),
      message: formatIssueMessage(issue.code),
    }));

    throw new RepoPolicyParseError({
      code: "invalid_policy",
      repoRoot,
      policyPath,
      relativePath: REPO_POLICY_RELATIVE_PATH,
      issues,
    });
  }

  return result.data;
};

const resolvePolicyPathForParsing = async (
  repoRoot: string,
  stat: RepoPolicyPathStat | undefined,
): Promise<string> => {
  try {
    return await resolveRepoPolicyPath(repoRoot, stat === undefined ? {} : { stat });
  } catch (error) {
    if (error instanceof RepoPolicyPathLookupError) {
      throw new RepoPolicyParseError({
        code: error.code,
        repoRoot,
        policyPath: error.policyPath,
        relativePath: error.relativePath,
      });
    }

    throw new RepoPolicyParseError({
      code: "policy_file_missing",
      repoRoot,
      policyPath: getRepoPolicyFilePath(repoRoot),
      relativePath: REPO_POLICY_RELATIVE_PATH,
    });
  }
};

const formatRepoPolicyParseErrorMessage = (
  code: RepoPolicyParseErrorCode,
  relativePath: string,
  issues: RepoPolicyParseIssue[],
): string => {
  if (code !== "invalid_policy" || issues.length === 0) {
    return `Repo policy file ${relativePath} failed with ${code}.`;
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Repo policy file ${relativePath} failed schema validation: ${issueSummary}.`;
};

const formatIssuePath = (path: readonly PropertyKey[], unknownKey = false): string => {
  const formattedPath =
    path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

  return unknownKey ? `${formattedPath}.<unknown>` : formattedPath;
};

const formatIssueMessage = (code: string): string => {
  switch (code) {
    case "unrecognized_keys":
      return "Unrecognized policy field.";
    case "invalid_type":
      return "Invalid policy field type.";
    case "too_small":
      return "Policy field does not meet the minimum requirement.";
    case "too_big":
      return "Policy field exceeds the maximum requirement.";
    case "invalid_value":
      return "Invalid policy field value.";
    default:
      return "Invalid policy field.";
  }
};

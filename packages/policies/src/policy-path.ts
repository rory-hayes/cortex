import { stat as statFile } from "node:fs/promises";
import { join } from "node:path";

export const REPO_POLICY_DIRECTORY = ".aicp";
export const REPO_POLICY_FILE_NAME = "policy.json";
export const REPO_POLICY_RELATIVE_PATH = `${REPO_POLICY_DIRECTORY}/${REPO_POLICY_FILE_NAME}`;

export type RepoPolicyPathLookupErrorCode = "policy_file_missing" | "policy_path_not_file";

export type RepoPolicyPathStat = (path: string) => Promise<{
  isFile: () => boolean;
}>;

export type ResolveRepoPolicyPathOptions = {
  stat?: RepoPolicyPathStat;
};

type RepoPolicyPathLookupErrorOptions = {
  code: RepoPolicyPathLookupErrorCode;
  repoRoot: string;
  policyPath: string;
  relativePath: string;
};

export class RepoPolicyPathLookupError extends Error {
  readonly code: RepoPolicyPathLookupErrorCode;
  readonly repoRoot: string;
  readonly policyPath: string;
  readonly relativePath: string;

  constructor({ code, repoRoot, policyPath, relativePath }: RepoPolicyPathLookupErrorOptions) {
    super(`Repo policy file ${relativePath} could not be resolved under ${repoRoot}: ${code}.`);
    this.name = "RepoPolicyPathLookupError";
    this.code = code;
    this.repoRoot = repoRoot;
    this.policyPath = policyPath;
    this.relativePath = relativePath;
  }
}

export const getRepoPolicyFilePath = (repoRoot: string): string =>
  join(repoRoot, REPO_POLICY_DIRECTORY, REPO_POLICY_FILE_NAME);

export const resolveRepoPolicyPath = async (
  repoRoot: string,
  options: ResolveRepoPolicyPathOptions = {},
): Promise<string> => {
  const policyPath = getRepoPolicyFilePath(repoRoot);
  const stat = options.stat ?? statFile;
  let policyPathStat: Awaited<ReturnType<RepoPolicyPathStat>>;

  try {
    policyPathStat = await stat(policyPath);
  } catch {
    throw createPolicyPathLookupError("policy_file_missing", repoRoot, policyPath);
  }

  if (!policyPathStat.isFile()) {
    throw createPolicyPathLookupError("policy_path_not_file", repoRoot, policyPath);
  }

  return policyPath;
};

const createPolicyPathLookupError = (
  code: RepoPolicyPathLookupErrorCode,
  repoRoot: string,
  policyPath: string,
): RepoPolicyPathLookupError =>
  new RepoPolicyPathLookupError({
    code,
    repoRoot,
    policyPath,
    relativePath: REPO_POLICY_RELATIVE_PATH,
  });

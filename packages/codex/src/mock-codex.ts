import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, parse, relative, resolve, win32 } from "node:path";
import { performance } from "node:perf_hooks";

import type { CodexAdapter, CodexExecutionRequest, CodexExecutionResult } from "./types.js";

export type MockCodexFileChange = {
  relativePath: string;
  contents: string;
};

export type MockCodexAdapterOptions = {
  fileChanges?: readonly MockCodexFileChange[];
};

type ValidatedFileChange = {
  relativePath: string;
  targetPath: string;
  contents: string;
};

const DEFAULT_FILE_CHANGES: readonly MockCodexFileChange[] = [
  {
    relativePath: "docs/mock-codex-result.txt",
    contents: "Mock Codex fixture change.\n",
  },
];

const REJECTED_FILE_CHANGE_SUMMARY = "Mock Codex rejected unsafe file change.";
const FAILED_WRITE_SUMMARY = "Mock Codex failed to apply file changes.";

export const createMockCodexAdapter = (options: MockCodexAdapterOptions = {}): CodexAdapter => ({
  async execute(request: CodexExecutionRequest): Promise<CodexExecutionResult> {
    const startedAt = performance.now();
    const worktreeRoot = await normalizeWorktreeRoot(request.worktreePath);

    if (worktreeRoot === null) {
      return createFailedResult(startedAt, REJECTED_FILE_CHANGE_SUMMARY);
    }

    const fileChanges = options.fileChanges ?? DEFAULT_FILE_CHANGES;
    const validatedChanges = validateFileChanges(worktreeRoot, fileChanges);

    if (validatedChanges === null) {
      return createFailedResult(startedAt, REJECTED_FILE_CHANGE_SUMMARY);
    }

    const preparedChanges = await prepareFileChangeTargets(worktreeRoot, validatedChanges);

    if (preparedChanges === null) {
      return createFailedResult(startedAt, REJECTED_FILE_CHANGE_SUMMARY);
    }

    try {
      for (const fileChange of preparedChanges) {
        await writeFile(fileChange.targetPath, fileChange.contents, "utf8");
      }
    } catch {
      return createFailedResult(startedAt, FAILED_WRITE_SUMMARY);
    }

    return {
      status: "succeeded",
      exitCode: 0,
      durationMs: durationSince(startedAt),
      stdoutSummary: formatSuccessSummary(preparedChanges.length),
      stderrSummary: "",
      redactionApplied: true,
    };
  },
});

const validateFileChanges = (
  worktreeRoot: string,
  fileChanges: readonly MockCodexFileChange[],
): ValidatedFileChange[] | null => {
  const validatedChanges: ValidatedFileChange[] = [];

  for (const fileChange of fileChanges) {
    if (typeof fileChange.contents !== "string") {
      return null;
    }

    const relativePath = validateRelativePath(fileChange.relativePath);

    if (relativePath === null) {
      return null;
    }

    if (isEnvExamplePath(relativePath) && containsSecretLikeContent(fileChange.contents)) {
      return null;
    }

    const targetPath = resolve(worktreeRoot, relativePath);

    if (!isPathInsideRoot(worktreeRoot, targetPath)) {
      return null;
    }

    validatedChanges.push({
      relativePath,
      targetPath,
      contents: fileChange.contents,
    });
  }

  return validatedChanges;
};

const prepareFileChangeTargets = async (
  worktreeRoot: string,
  fileChanges: readonly ValidatedFileChange[],
): Promise<ValidatedFileChange[] | null> => {
  for (const fileChange of fileChanges) {
    const parentPrepared = await ensureSafeParentDirectory(worktreeRoot, fileChange.relativePath);

    if (!parentPrepared || !(await isSafeWriteTarget(fileChange.targetPath))) {
      return null;
    }
  }

  return [...fileChanges];
};

const ensureSafeParentDirectory = async (
  worktreeRoot: string,
  relativePath: string,
): Promise<boolean> => {
  const parentSegments = relativePath.split("/").slice(0, -1);
  let currentPath = worktreeRoot;

  for (const segment of parentSegments) {
    currentPath = resolve(currentPath, segment);

    if (
      !isPathInsideRootOrSelf(worktreeRoot, currentPath) ||
      !(await ensureSafeDirectory(currentPath, worktreeRoot))
    ) {
      return false;
    }
  }

  const parentPath = dirname(resolve(worktreeRoot, relativePath));

  return (
    isPathInsideRootOrSelf(worktreeRoot, parentPath) &&
    (await ensureSafeDirectory(parentPath, worktreeRoot))
  );
};

const ensureSafeDirectory = async (
  directoryPath: string,
  worktreeRoot: string,
): Promise<boolean> => {
  const existingStatus = await readPathStatus(directoryPath);

  if (existingStatus === undefined) {
    return false;
  }

  if (existingStatus === null) {
    try {
      await mkdir(directoryPath);
    } catch {
      return false;
    }
  }

  const currentStatus = await readPathStatus(directoryPath);

  if (currentStatus === null || currentStatus === undefined) {
    return false;
  }

  if (currentStatus.isSymbolicLink() || !currentStatus.isDirectory()) {
    return false;
  }

  try {
    const realDirectoryPath = await realpath(directoryPath);

    return isPathInsideRootOrSelf(worktreeRoot, realDirectoryPath);
  } catch {
    return false;
  }
};

const isSafeWriteTarget = async (targetPath: string): Promise<boolean> => {
  const targetStatus = await readPathStatus(targetPath);

  return targetStatus === null || (targetStatus !== undefined && !targetStatus.isSymbolicLink());
};

const readPathStatus = async (path: string) => {
  try {
    return await lstat(path);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }

    return undefined;
  }
};

const normalizeWorktreeRoot = async (worktreePath: string): Promise<string | null> => {
  if (
    typeof worktreePath !== "string" ||
    worktreePath.trim().length === 0 ||
    worktreePath.includes("\0") ||
    !isAbsolute(worktreePath)
  ) {
    return null;
  }

  const worktreeRoot = resolve(worktreePath);

  if (worktreeRoot === parse(worktreeRoot).root) {
    return null;
  }

  try {
    const realWorktreeRoot = await realpath(worktreeRoot);
    const worktreeStatus = await lstat(realWorktreeRoot);

    if (realWorktreeRoot === parse(realWorktreeRoot).root || !worktreeStatus.isDirectory()) {
      return null;
    }

    return realWorktreeRoot;
  } catch {
    return null;
  }
};

const validateRelativePath = (relativePath: string): string | null => {
  if (
    typeof relativePath !== "string" ||
    relativePath.trim().length === 0 ||
    relativePath.includes("\0") ||
    relativePath.includes("\\") ||
    isAbsolute(relativePath) ||
    win32.isAbsolute(relativePath)
  ) {
    return null;
  }

  const segments = relativePath.split("/");

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return null;
  }

  const basename = segments[segments.length - 1];

  if (basename === undefined || isRealEnvFile(basename)) {
    return null;
  }

  return relativePath;
};

const isRealEnvFile = (basename: string): boolean =>
  basename === ".env" || (basename.startsWith(".env.") && basename !== ".env.example");

const isEnvExamplePath = (relativePath: string): boolean =>
  relativePath.split("/").at(-1) === ".env.example";

const containsSecretLikeContent = (contents: string): boolean =>
  SECRET_LIKE_CONTENT_PATTERNS.some((pattern) => pattern.test(contents));

const SECRET_LIKE_CONTENT_PATTERNS = [
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/,
  /\bsk-[A-Za-z0-9_-]{8,}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
  /\b(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)\s*=\s*(?!(?:<[^>\n]+>|placeholder|example|mock|value|changeme|your[_-]?[A-Z0-9_-]+)\b)[^\s#]+/i,
];

const isPathInsideRoot = (rootPath: string, targetPath: string): boolean => {
  const relativePath = relative(rootPath, targetPath);

  return relativePath.length > 0 && !relativePath.startsWith("..") && !isAbsolute(relativePath);
};

const isPathInsideRootOrSelf = (rootPath: string, targetPath: string): boolean => {
  const relativePath = relative(rootPath, targetPath);

  return relativePath.length === 0 || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const isNodeError = (error: unknown): error is NodeJS.ErrnoException =>
  typeof error === "object" && error !== null && "code" in error;

const createFailedResult = (startedAt: number, stderrSummary: string): CodexExecutionResult => ({
  status: "failed",
  exitCode: 1,
  durationMs: durationSince(startedAt),
  stdoutSummary: "",
  stderrSummary,
  redactionApplied: true,
});

const formatSuccessSummary = (changeCount: number): string =>
  `Mock Codex applied ${changeCount} file ${changeCount === 1 ? "change" : "changes"}.`;

const durationSince = (startedAt: number): number =>
  Math.max(0, Math.round(performance.now() - startedAt));

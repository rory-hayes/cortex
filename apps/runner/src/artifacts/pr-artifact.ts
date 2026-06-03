import { createHash } from "node:crypto";
import { lstat, mkdir, open, realpath } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { redactLogText } from "@control-plane/logging";
import { PrArtifactSchema, type PrArtifact } from "@control-plane/shared";

export type PrArtifactWriterErrorCode =
  | "invalid_artifact"
  | "unsafe_artifact_path"
  | "write_failed";

export type PrArtifactWriterIssue = {
  path: string;
  message: string;
};

export type WritePrArtifactOptions = {
  artifactRoot: string;
  artifact: unknown;
};

export type WritePrArtifactResult = {
  artifactPath: string;
  artifact: PrArtifact;
};

type PrArtifactWriterErrorOptions = {
  code: PrArtifactWriterErrorCode;
  artifactPath?: string;
  message: string;
  issues?: PrArtifactWriterIssue[];
};

export class PrArtifactWriterError extends Error {
  readonly code: PrArtifactWriterErrorCode;
  readonly artifactPath?: string;
  readonly issues: PrArtifactWriterIssue[];

  constructor({ code, artifactPath, message, issues = [] }: PrArtifactWriterErrorOptions) {
    super(message);
    this.name = "PrArtifactWriterError";
    this.code = code;
    if (artifactPath !== undefined) {
      this.artifactPath = artifactPath;
    }
    this.issues = issues;
  }
}

export const writePrArtifact = async ({
  artifactRoot,
  artifact,
}: WritePrArtifactOptions): Promise<WritePrArtifactResult> => {
  const parsedArtifact = PrArtifactSchema.safeParse(artifact);

  if (!parsedArtifact.success) {
    const issues = parsedArtifact.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path, issue.code === "unrecognized_keys"),
      message: formatIssueMessage(issue.code),
    }));

    throw invalidArtifactError(issues);
  }

  const safetyIssues = collectPrArtifactSafetyIssues(parsedArtifact.data);

  if (safetyIssues.length > 0) {
    throw invalidArtifactError(safetyIssues);
  }

  const safeArtifact = parsedArtifact.data;
  const artifactPath = prArtifactPath({
    artifactRoot,
    runId: safeArtifact.runId,
    prNumber: safeArtifact.prNumber,
  });

  try {
    await preparePrArtifactDirectory({ artifactRoot, artifactPath });
    await writeNewPrArtifactFile(artifactPath, `${JSON.stringify(safeArtifact, null, 2)}\n`);
  } catch (error) {
    if (error instanceof PrArtifactWriterError) {
      throw error;
    }

    throw new PrArtifactWriterError({
      code: "write_failed",
      artifactPath,
      message: "Unable to write PR artifact: write_failed.",
    });
  }

  return {
    artifactPath,
    artifact: safeArtifact,
  };
};

const preparePrArtifactDirectory = async ({
  artifactRoot,
  artifactPath,
}: {
  artifactRoot: string;
  artifactPath: string;
}): Promise<void> => {
  const resolvedRoot = resolve(artifactRoot);
  const prDirectory = resolve(resolvedRoot, "pr");

  await mkdir(resolvedRoot, { recursive: true });
  const realRoot = await realpath(resolvedRoot);

  if (!(await isSafeExistingDirectory(prDirectory))) {
    throw unsafeArtifactPathError(artifactPath);
  }

  await mkdir(prDirectory, { recursive: true });

  if (!(await isSafeExistingDirectory(prDirectory))) {
    throw unsafeArtifactPathError(artifactPath);
  }

  const realPrDirectory = await realpath(prDirectory);

  if (!isPathInside(realRoot, realPrDirectory)) {
    throw unsafeArtifactPathError(artifactPath);
  }
};

const isSafeExistingDirectory = async (directoryPath: string): Promise<boolean> => {
  try {
    const stat = await lstat(directoryPath);

    return stat.isDirectory() && !stat.isSymbolicLink();
  } catch (error) {
    if (isNodeErrorWithCode(error, "ENOENT")) {
      return true;
    }

    throw error;
  }
};

const writeNewPrArtifactFile = async (artifactPath: string, payload: string): Promise<void> => {
  let fileHandle;

  try {
    fileHandle = await open(artifactPath, "wx");
  } catch (error) {
    if (isNodeErrorWithCode(error, "EEXIST") || isNodeErrorWithCode(error, "ELOOP")) {
      throw unsafeArtifactPathError(artifactPath);
    }

    throw error;
  }

  try {
    await fileHandle.writeFile(payload, "utf8");
  } finally {
    await fileHandle.close();
  }
};

const collectPrArtifactSafetyIssues = (artifact: PrArtifact): PrArtifactWriterIssue[] => {
  const issues: PrArtifactWriterIssue[] = [];

  addUnsafeTextIssue(issues, "id", artifact.id, "Unsafe PR artifact text.");
  addUnsafeTextIssue(issues, "runId", artifact.runId, "Unsafe PR artifact text.");
  addUnsafeTextIssue(
    issues,
    "repository.owner",
    artifact.repository.owner,
    "Unsafe PR artifact text.",
  );
  addUnsafeTextIssue(
    issues,
    "repository.name",
    artifact.repository.name,
    "Unsafe PR artifact text.",
  );
  addUnsafeTextIssue(issues, "branchName", artifact.branchName, "Unsafe PR artifact text.");
  addUnsafeTextIssue(issues, "prUrl", artifact.prUrl, "Unsafe PR artifact text.");
  addUnsafeTextIssue(issues, "prTitle", artifact.prTitle, "Unsafe PR artifact text.");
  addUnsafeTextIssue(issues, "createdAt", artifact.createdAt, "Unsafe PR artifact text.");

  for (const changedFilePath of artifact.changedFilePaths) {
    if (!isSafeChangedPath(changedFilePath)) {
      issues.push({
        path: "changedFilePaths.<item>",
        message: "Unsafe changed file path.",
      });
    }
  }

  artifact.riskFindings.forEach((riskFinding, index) => {
    addUnsafeTextIssue(
      issues,
      `riskFindings.${index}.id`,
      riskFinding.id,
      "Unsafe risk finding text.",
    );
    addUnsafeTextIssue(
      issues,
      `riskFindings.${index}.message`,
      riskFinding.message,
      "Unsafe risk finding text.",
    );

    for (const riskPath of riskFinding.paths) {
      if (!isSafeChangedPath(riskPath)) {
        issues.push({
          path: `riskFindings.${index}.paths.<item>`,
          message: "Unsafe risk finding path.",
        });
      }
    }
  });

  return dedupeIssues(issues);
};

const addUnsafeTextIssue = (
  issues: PrArtifactWriterIssue[],
  path: string,
  value: string,
  message: string,
): void => {
  if (!isSafeArtifactText(value)) {
    issues.push({
      path,
      message,
    });
  }
};

const prArtifactPath = ({
  artifactRoot,
  runId,
  prNumber,
}: {
  artifactRoot: string;
  runId: string;
  prNumber: number;
}): string => {
  const resolvedRoot = resolve(artifactRoot);
  const artifactPath = resolve(
    resolvedRoot,
    "pr",
    `${safeFilenameSegment(runId, "run")}-${prNumber}.json`,
  );
  const relativeArtifactPath = relative(resolvedRoot, artifactPath);

  if (
    relativeArtifactPath === "" ||
    relativeArtifactPath.startsWith("..") ||
    isAbsolute(relativeArtifactPath)
  ) {
    throw unsafeArtifactPathError(artifactPath);
  }

  return artifactPath;
};

const unsafeArtifactPathError = (artifactPath: string): PrArtifactWriterError =>
  new PrArtifactWriterError({
    code: "unsafe_artifact_path",
    artifactPath,
    message: "PR artifact path is outside the artifact root.",
  });

const isPathInside = (rootPath: string, candidatePath: string): boolean => {
  const relativePath = relative(rootPath, candidatePath);

  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath));
};

const isNodeErrorWithCode = (error: unknown, code: string): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { code?: unknown }).code === code;

const safeFilenameSegment = (value: string, fallback: string): string => {
  if (redactLogText(value).redactionApplied) {
    return `${fallback}-${hashSegment(value)}`;
  }

  const normalized = value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/^\.+/, "")
    .replace(/\.+$/, "")
    .replace(/[^A-Za-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();

  return normalized.length > 0 ? normalized : fallback;
};

const hashSegment = (value: string): string =>
  createHash("sha256").update(value).digest("hex").slice(0, 12);

const isSafeArtifactText = (value: string): boolean =>
  value.length > 0 &&
  value.trim() === value &&
  !hasControlCharacters(value) &&
  !redactLogText(value).redactionApplied &&
  !SOURCE_LIKE_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const isSafeChangedPath = (value: string): boolean => {
  if (
    value.length === 0 ||
    value.length > MAX_CHANGED_PATH_LENGTH ||
    value.trim() !== value ||
    value.includes("\\") ||
    hasControlCharacters(value) ||
    hasUnsafePathText(value)
  ) {
    return false;
  }

  if (
    value.startsWith("/") ||
    value.includes("://") ||
    /^[A-Za-z]:[\\/]/u.test(value) ||
    isRealEnvPath(value)
  ) {
    return false;
  }

  const segments = value.split("/");

  if (segments.some((segment) => segment.length === 0 || segment === "." || segment === "..")) {
    return false;
  }

  return SAFE_CHANGED_PATH_PATTERN.test(value);
};

const isRealEnvPath = (value: string): boolean => {
  const basename = value.split("/").at(-1);

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

const hasControlCharacters = (value: string): boolean =>
  [...value].some((character) => {
    const codePoint = character.codePointAt(0);

    return codePoint !== undefined && (codePoint < 32 || codePoint === 127);
  });

const hasUnsafePathText = (value: string): boolean =>
  redactLogText(value).redactionApplied ||
  /\[REDACTED_(?:SECRET|PRIVATE_KEY|CREDENTIAL_URL)\]/iu.test(value) ||
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/iu.test(value) ||
  /diff --git\s+/iu.test(value) ||
  /^@@\s+[-+0-9, ]+@@/mu.test(value) ||
  /(^|\n)\*\*\* Begin Patch\b/iu.test(value) ||
  /(?:^|[/_. -])(?:diff|patch|source|code|content|stdout|stderr)(?:$|[/_. -])/iu.test(value) ||
  /(?:^|[/_. -])(?:api[-_]?key|token|secret|secrets|password|passwd|private[-_]?key)(?:$|[/_. -])/iu.test(
    value,
  ) ||
  /\b(?:function|class|const|let|var|import|export|return)\b/u.test(value) ||
  /(?:=>|[{};])/u.test(value);

const dedupeIssues = (issues: PrArtifactWriterIssue[]): PrArtifactWriterIssue[] => {
  const seen = new Set<string>();
  const dedupedIssues: PrArtifactWriterIssue[] = [];

  for (const issue of issues) {
    const key = `${issue.path}\0${issue.message}`;
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    dedupedIssues.push(issue);
  }

  return dedupedIssues;
};

const invalidArtifactError = (issues: PrArtifactWriterIssue[]): PrArtifactWriterError =>
  new PrArtifactWriterError({
    code: "invalid_artifact",
    message: formatInvalidPrArtifactMessage(issues),
    issues,
  });

const formatInvalidPrArtifactMessage = (issues: PrArtifactWriterIssue[]): string => {
  if (issues.length === 0) {
    return "Invalid PR artifact payload.";
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Invalid PR artifact payload: ${issueSummary}.`;
};

const formatIssuePath = (path: PropertyKey[], unknownKey = false): string => {
  const formattedPath =
    path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

  return unknownKey ? `${formattedPath}.<unknown>` : formattedPath;
};

const formatIssueMessage = (code: string): string => {
  switch (code) {
    case "unrecognized_keys":
      return "Unrecognized PR artifact field.";
    case "invalid_type":
      return "Invalid PR artifact field type.";
    case "too_small":
      return "PR artifact field does not meet the minimum requirement.";
    case "too_big":
      return "PR artifact field exceeds the maximum requirement.";
    case "invalid_value":
      return "Invalid PR artifact field value.";
    default:
      return "Invalid PR artifact field.";
  }
};

const MAX_CHANGED_PATH_LENGTH = 512;
const SAFE_CHANGED_PATH_PATTERN = /^[A-Za-z0-9._/@+=, ()[\]-]+$/u;

const SOURCE_LIKE_TEXT_PATTERNS = [
  /(^|\n)diff --git\b/iu,
  /(^|\n)\*\*\* Begin Patch\b/iu,
  /(^|\n)@@\s+-\d/iu,
  /(^|\n)---\s+a\//iu,
  /(^|\n)\+\+\+\s+b\//iu,
  /(^|\n)```/u,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,160}[;{}=()]/u,
  /\b(?:import|export|const|let|var|function|class|type|interface|enum)\b[\s\S]{0,120}[;{}=()]/u,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/u,
  /(^|\n)\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)+\s*\([^)\n]*\)\s*;?\s*(?=\n|$)/u,
];

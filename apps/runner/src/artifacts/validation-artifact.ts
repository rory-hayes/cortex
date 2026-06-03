import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, relative, resolve } from "node:path";

import { redactLogText } from "@control-plane/logging";
import { ValidationResultSchema, type ValidationResult } from "@control-plane/shared";

export type ValidationArtifactWriterErrorCode =
  | "invalid_result"
  | "unsafe_artifact_path"
  | "write_failed";

export type ValidationArtifactWriterIssue = {
  path: string;
  message: string;
};

export type WriteValidationResultArtifactOptions = {
  artifactRoot: string;
  result: unknown;
};

export type WriteValidationResultArtifactResult = {
  artifactPath: string;
  result: ValidationResult;
};

type ValidationArtifactWriterErrorOptions = {
  code: ValidationArtifactWriterErrorCode;
  artifactPath?: string;
  message: string;
  issues?: ValidationArtifactWriterIssue[];
};

type SafeText = {
  value: string;
  redactionApplied: boolean;
};

export class ValidationArtifactWriterError extends Error {
  readonly code: ValidationArtifactWriterErrorCode;
  readonly artifactPath?: string;
  readonly issues: ValidationArtifactWriterIssue[];

  constructor({ code, artifactPath, message, issues = [] }: ValidationArtifactWriterErrorOptions) {
    super(message);
    this.name = "ValidationArtifactWriterError";
    this.code = code;
    if (artifactPath !== undefined) {
      this.artifactPath = artifactPath;
    }
    this.issues = issues;
  }
}

export const writeValidationResultArtifact = async ({
  artifactRoot,
  result,
}: WriteValidationResultArtifactOptions): Promise<WriteValidationResultArtifactResult> => {
  const parsedResult = ValidationResultSchema.safeParse(result);

  if (!parsedResult.success) {
    const issues = parsedResult.error.issues.map((issue) => ({
      path: formatIssuePath(issue.path, issue.code === "unrecognized_keys"),
      message: formatIssueMessage(issue.code),
    }));

    throw new ValidationArtifactWriterError({
      code: "invalid_result",
      message: formatInvalidValidationResultMessage(issues),
      issues,
    });
  }

  const sanitizedResult = sanitizeValidationResult(parsedResult.data);
  const safeResult = ValidationResultSchema.parse(sanitizedResult);
  const artifactPath = validationArtifactPath({
    artifactRoot,
    runId: safeResult.runId,
    commandId: safeResult.commandId,
  });

  try {
    await mkdir(resolve(artifactRoot, "validation"), { recursive: true });
    await writeFile(artifactPath, `${JSON.stringify(safeResult, null, 2)}\n`, "utf8");
  } catch {
    throw new ValidationArtifactWriterError({
      code: "write_failed",
      artifactPath,
      message: `Unable to write validation artifact: write_failed.`,
    });
  }

  return {
    artifactPath,
    result: safeResult,
  };
};

const sanitizeValidationResult = (result: ValidationResult): ValidationResult => {
  const id = safeValidationIdentity(result.id, "validation-result");
  const runId = safeValidationIdentity(result.runId, "run");
  const commandId = safeValidationIdentity(result.commandId, "command");
  const commandLabel = safeValidationText(result.commandLabel);
  const command = safeValidationText(result.command);
  const stdoutSummary = safeValidationText(result.stdoutSummary);
  const stderrSummary = safeValidationText(result.stderrSummary);
  const redactionApplied =
    result.redactionApplied ||
    id.redactionApplied ||
    runId.redactionApplied ||
    commandId.redactionApplied ||
    commandLabel.redactionApplied ||
    command.redactionApplied ||
    stdoutSummary.redactionApplied ||
    stderrSummary.redactionApplied;

  return {
    contractVersion: result.contractVersion,
    id: id.value,
    runId: runId.value,
    commandId: commandId.value,
    commandLabel: commandLabel.value,
    command: command.value,
    status: result.status,
    exitCode: result.exitCode,
    durationMs: result.durationMs,
    stdoutSummary: stdoutSummary.value,
    stderrSummary: stderrSummary.value,
    redactionApplied,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
};

const safeValidationIdentity = (value: string, fallback: string): SafeText => {
  const safeText = safeValidationText(value);
  const normalized = safeText.value
    .trim()
    .replace(/[/\\]+/g, "-")
    .replace(/[^A-Za-z0-9:_\-[\]]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const safeValue = normalized.length > 0 ? normalized : fallback;

  return {
    value: safeValue,
    redactionApplied: safeText.redactionApplied || safeValue !== value,
  };
};

const safeValidationText = (value: string): SafeText => {
  const redacted = redactLogText(value);

  if (SOURCE_LIKE_PATTERNS.some((pattern) => pattern.test(redacted.text))) {
    return {
      value: SOURCE_LIKE_SUPPRESSION,
      redactionApplied: true,
    };
  }

  return {
    value: redacted.text,
    redactionApplied: redacted.redactionApplied,
  };
};

const validationArtifactPath = ({
  artifactRoot,
  runId,
  commandId,
}: {
  artifactRoot: string;
  runId: string;
  commandId: string;
}): string => {
  const resolvedRoot = resolve(artifactRoot);
  const artifactPath = resolve(
    resolvedRoot,
    "validation",
    `${safeFilenameSegment(runId, "run")}-${safeFilenameSegment(commandId, "command")}.json`,
  );
  const relativeArtifactPath = relative(resolvedRoot, artifactPath);

  if (
    relativeArtifactPath === "" ||
    relativeArtifactPath.startsWith("..") ||
    isAbsolute(relativeArtifactPath)
  ) {
    throw new ValidationArtifactWriterError({
      code: "unsafe_artifact_path",
      artifactPath,
      message: "Validation artifact path is outside the artifact root.",
    });
  }

  return artifactPath;
};

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

const formatInvalidValidationResultMessage = (issues: ValidationArtifactWriterIssue[]): string => {
  if (issues.length === 0) {
    return "Invalid validation result artifact payload.";
  }

  const issueSummary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");

  return `Invalid validation result artifact payload: ${issueSummary}.`;
};

const formatIssuePath = (path: PropertyKey[], unknownKey = false): string => {
  const formattedPath =
    path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

  return unknownKey ? `${formattedPath}.<unknown>` : formattedPath;
};

const formatIssueMessage = (code: string): string => {
  switch (code) {
    case "unrecognized_keys":
      return "Unrecognized validation result field.";
    case "invalid_type":
      return "Invalid validation result field type.";
    case "too_small":
      return "Validation result field does not meet the minimum requirement.";
    case "too_big":
      return "Validation result field exceeds the maximum requirement.";
    case "invalid_value":
      return "Invalid validation result field value.";
    default:
      return "Invalid validation result field.";
  }
};

const SOURCE_LIKE_SUPPRESSION = "[REDACTED_SOURCE_LIKE_OUTPUT]";

const SOURCE_LIKE_PATTERNS = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)[+-]\s*(?:import|export|const|let|var|function|class|type|interface)\b/i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?function\s+[$A-Z_][\w$]*\s*\(/i,
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i,
  /(^|\n)\s*[$A-Za-z_][\w$]*(?:\s*\.\s*[$A-Za-z_][\w$]*)+\s*=\s*[^\n]+/,
  /(^|\n)\s*(?![A-Z0-9_]+\s*=)[$A-Za-z_][\w$]*\s+=\s+[^\n]+/,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /(^|\n)\s*>?\s*\d+\s*\|[^\n]*(?:\b(?:import|export|const|let|var|function|class|type|interface|enum|return|throw|yield|await|async|expect|describe|it|test)\b|[{};=]|=>)/i,
  /(^|\n)\s*(?:SELECT\b[^\n]*\bFROM\b|INSERT\s+INTO\b|UPDATE\b[^\n]*\bSET\b|DELETE\s+FROM\b|CREATE\s+(?:TABLE|INDEX|VIEW)\b|ALTER\s+TABLE\b|DROP\s+(?:TABLE|INDEX|VIEW)\b)/i,
  /(^|\n)\s*[A-Z0-9_-]+:\s*\n\s{2,}[A-Z0-9_-]+:/i,
  /(^|\n)\s*<\/?[A-Z][\w:-]*(?:\s+[^>\n]*)?>/i,
  /```[^\n]*\n/i,
];

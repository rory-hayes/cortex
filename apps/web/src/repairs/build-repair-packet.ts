import "server-only";

import {
  CONTRACT_VERSION,
  RepoPolicySchema,
  TaskPacketSchema,
  ValidationCommandSchema,
  type RepoPolicy,
  type TaskPacket,
  type ValidationCommand,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";
import type { BuildRepairTaskPacketInput, PreviousRunValidationSummary } from "./repair-requests";

const requiredTextMaxLength = 240;
const objectiveMaxLength = 4_000;
const acceptanceCriterionMaxLength = 1_000;
const contextFilePathMaxLength = 512;
const validationSummaryMaxLength = 800;
const validationNoteMaxLength = 1_800;
const maxValidationNotes = 10;
const validationResultStatuses = new Set(["passed", "failed", "skipped", "cancelled"]);

const unsafeValidationSummaryPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /^\s*(?:---|\+\+\+) [ab]\//m,
  /^\s*[+-]\s*(?:class|const|export|function|import|let|return|var)\b/m,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i,
  /\b(?:gh[pousr]_|github_pat_|lin_api_|xox[baprs]-)[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:sk-[A-Za-z0-9_-]{12,}|(?:sk|rk)_(?:live|test)_[A-Za-z0-9_]{12,})\b/,
  /\b[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
  /\b[A-Za-z0-9._%+-]+:\/\/[^/\s:@]+:[^/\s@]+@/,
  /\b(?:api[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret|database[_-]?url|password|private[_-]?key|secret|token)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s,;]{8,}/i,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*interface\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\s+extends\s+[A-Za-z_$][\w$.,\s<>]*)?\s*\{/m,
  /^\s*type\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?\s*=\s*.+$/m,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+|;)/m,
  /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/,
  /\breturn\s+[^;\n]+;/,
  /\bpatch\b/i,
  /\braw\s+output\s*:/i,
  /\bsourceCode\b/,
  /\bstd(?:out|err)\b/i,
] as const;

const failValidation = (): never => {
  throw createActionError("validation_error");
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    );
  });

const assertRequiredText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    return failValidation();
  }

  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > maxLength ||
    hasControlCharacter(normalizedValue)
  ) {
    return failValidation();
  }

  return normalizedValue;
};

const assertSafeCopiedText = (value: unknown, maxLength: number): string => {
  const normalizedValue = assertRequiredText(value, maxLength);

  if (hasUnsafeValidationSummary(normalizedValue)) {
    return failValidation();
  }

  return normalizedValue;
};

const assertSafeCopiedTextList = (value: unknown, maxItemLength: number): string[] => {
  if (!Array.isArray(value)) {
    return failValidation();
  }

  return value.map((item) => assertSafeCopiedText(item, maxItemLength));
};

const normalizeNonNegativeInteger = (value: unknown): number => {
  if (!Number.isInteger(value) || (value as number) < 0) {
    return failValidation();
  }

  return value as number;
};

const normalizePositiveInteger = (value: unknown): number => {
  const normalizedValue = normalizeNonNegativeInteger(value);

  if (normalizedValue === 0) {
    return failValidation();
  }

  return normalizedValue;
};

const toIsoTimestamp = (value: Date): string => {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    return failValidation();
  }

  return value.toISOString();
};

const isEnvLikePath = (path: string): boolean => {
  const basename = path.split("/").at(-1) ?? "";

  if (basename === ".env.example") {
    return false;
  }

  return (
    basename === ".env" ||
    basename.startsWith(".env.") ||
    basename === "local.env" ||
    basename.endsWith(".local.env")
  );
};

const normalizeContextFilePath = (value: unknown): string => {
  const path = assertRequiredText(value, contextFilePathMaxLength);

  if (
    hasUnsafeValidationSummary(path) ||
    path.startsWith("/") ||
    path === "~" ||
    path.startsWith("~/") ||
    /^[A-Za-z]:/.test(path) ||
    path.includes("\\") ||
    path
      .split("/")
      .some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    isEnvLikePath(path)
  ) {
    return failValidation();
  }

  return path;
};

const normalizeChangedPaths = (paths: unknown): string[] => {
  if (!Array.isArray(paths)) {
    return failValidation();
  }

  return [...new Set(paths.map(normalizeContextFilePath))];
};

const parseRepoPolicy = (policySnapshot: unknown): RepoPolicy => {
  const parsedPolicy = RepoPolicySchema.safeParse(policySnapshot);

  if (parsedPolicy.success !== true) {
    return failValidation();
  }

  return parsedPolicy.data;
};

const parseValidationCommands = (commands: unknown): ValidationCommand[] => {
  if (!Array.isArray(commands) || commands.length === 0) {
    return failValidation();
  }

  return commands.map((command) => {
    const parsedCommand = ValidationCommandSchema.safeParse(command);

    if (parsedCommand.success !== true) {
      return failValidation();
    }

    return parsedCommand.data;
  });
};

const hasUnsafeValidationSummary = (value: string): boolean =>
  unsafeValidationSummaryPatterns.some((pattern) => pattern.test(value));

const normalizeValidationSummaryText = (value: unknown): string => {
  if (typeof value !== "string") {
    return failValidation();
  }

  const trimmedValue = value.trim();

  if (hasControlCharacter(trimmedValue) || hasUnsafeValidationSummary(trimmedValue)) {
    return failValidation();
  }

  const normalizedValue = trimmedValue.replace(/\s+/g, " ");

  if (hasUnsafeValidationSummary(normalizedValue)) {
    return failValidation();
  }

  if (normalizedValue.length <= validationSummaryMaxLength) {
    return normalizedValue;
  }

  return `${normalizedValue.slice(0, validationSummaryMaxLength - 3)}...`;
};

const formatExitCode = (exitCode: number | null): string => {
  if (exitCode !== null && (!Number.isInteger(exitCode) || exitCode < 0)) {
    return failValidation();
  }

  return exitCode === null ? "with no exit code" : `with exit code ${exitCode}`;
};

const formatDuration = (durationMs: unknown): string => {
  const normalizedDurationMs = normalizeNonNegativeInteger(durationMs);

  return `duration ${normalizedDurationMs}ms`;
};

const normalizeValidationStatus = (status: PreviousRunValidationSummary["status"]): string => {
  if (!validationResultStatuses.has(status)) {
    return failValidation();
  }

  return status;
};

const formatValidationSummaryNote = (summary: PreviousRunValidationSummary): string => {
  const commandLabel = assertSafeCopiedText(summary.commandLabel, requiredTextMaxLength);
  const stdoutSummary = normalizeValidationSummaryText(summary.stdoutSummary);
  const stderrSummary = normalizeValidationSummaryText(summary.stderrSummary);
  const startedAt = toIsoTimestamp(summary.startedAt);
  const finishedAt = toIsoTimestamp(summary.finishedAt);
  const status = normalizeValidationStatus(summary.status);
  const noteParts = [
    `Validation ${commandLabel} ${status} ${formatExitCode(summary.exitCode)}; ${formatDuration(summary.durationMs)}; started at ${startedAt}; finished at ${finishedAt}.`,
  ];

  if (stdoutSummary.length > 0) {
    noteParts.push(`Output summary: ${stdoutSummary}.`);
  }

  if (stderrSummary.length > 0) {
    noteParts.push(`Error summary: ${stderrSummary}.`);
  }

  if (summary.redactionApplied) {
    noteParts.push("Redaction was applied.");
  }

  const note = noteParts.join(" ");

  if (note.length > validationNoteMaxLength || hasUnsafeValidationSummary(note)) {
    return failValidation();
  }

  return note;
};

const buildContextNotes = (input: BuildRepairTaskPacketInput): string[] => {
  const notes = [
    `Previous run: ${assertRequiredText(input.previousRun.id, requiredTextMaxLength)}`,
  ];
  const validationSummaries = input.previousRun.validationSummaries.slice(0, maxValidationNotes);

  for (const summary of validationSummaries) {
    notes.push(formatValidationSummaryNote(summary));
  }

  if (input.previousRun.validationSummaries.length > maxValidationNotes) {
    notes.push(
      `Additional validation summaries omitted: ${input.previousRun.validationSummaries.length - maxValidationNotes}`,
    );
  }

  return notes;
};

const createRepairSourceTitle = (previousPacket: TaskPacket): string => {
  const title = assertSafeCopiedText(previousPacket.source.title, requiredTextMaxLength);
  const repairTitle = `Repair request for ${title}`;

  return repairTitle.length <= requiredTextMaxLength
    ? repairTitle
    : repairTitle.slice(0, requiredTextMaxLength);
};

const hasUnsafeCopiedText = (value: unknown, seen: WeakSet<object> = new WeakSet()): boolean => {
  if (typeof value === "string") {
    return hasUnsafeValidationSummary(value);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeCopiedText(item, seen));
  }

  return Object.values(value).some((childValue) => hasUnsafeCopiedText(childValue, seen));
};

const assertSafePreviousTaskPacket = (previousPacket: TaskPacket): void => {
  if (hasUnsafeCopiedText(previousPacket)) {
    return failValidation();
  }

  previousPacket.context.files.forEach(normalizeContextFilePath);
};

const assertSafeCopiedContract = <Value>(value: Value): Value => {
  if (hasUnsafeCopiedText(value)) {
    return failValidation();
  }

  return value;
};

const selectPolicySnapshot = (
  policySnapshot: RepoPolicy | null,
  previousPolicy: RepoPolicy,
): RepoPolicy => {
  if (policySnapshot === null) {
    return previousPolicy;
  }

  return assertSafeCopiedContract(parseRepoPolicy(policySnapshot));
};

const selectValidationCommands = (
  validationCommands: ValidationCommand[] | null,
  previousValidationCommands: ValidationCommand[],
): ValidationCommand[] => {
  if (validationCommands === null) {
    return previousValidationCommands;
  }

  return assertSafeCopiedContract(parseValidationCommands(validationCommands));
};

const assertRepairAttemptBounds = (
  input: BuildRepairTaskPacketInput,
): {
  attempt: number;
  maxAttempts: number;
} => {
  const attempt = normalizePositiveInteger(input.attempt);
  const maxAttempts = normalizePositiveInteger(input.maxAttempts);
  const previousAttemptCount = normalizeNonNegativeInteger(input.previousRun.attemptCount);
  const previousMaxAttempts = normalizePositiveInteger(input.previousRun.maxAttempts);

  if (
    attempt !== previousAttemptCount + 1 ||
    maxAttempts < previousMaxAttempts ||
    attempt > maxAttempts
  ) {
    return failValidation();
  }

  return {
    attempt,
    maxAttempts,
  };
};

export const buildRepairTaskPacket = (input: BuildRepairTaskPacketInput): TaskPacket => {
  const previousPacket = TaskPacketSchema.safeParse(input.previousRun.taskPacket);

  if (previousPacket.success !== true) {
    return failValidation();
  }

  const previousTaskPacket = previousPacket.data;
  const workspaceId = assertRequiredText(input.workspaceId, requiredTextMaxLength);
  const previousRunId = assertRequiredText(input.previousRun.id, requiredTextMaxLength);
  assertRequiredText(input.previousRun.repoMappingId, requiredTextMaxLength);
  const queuedRunId = assertRequiredText(input.queuedRunId, requiredTextMaxLength);
  const repairRequestId = assertRequiredText(input.repairRequestId, requiredTextMaxLength);
  const { attempt, maxAttempts } = assertRepairAttemptBounds(input);

  if (
    input.previousRun.contractVersion !== CONTRACT_VERSION ||
    input.previousRun.workspaceId !== workspaceId ||
    previousTaskPacket.workspaceId !== workspaceId ||
    previousTaskPacket.runId !== previousRunId ||
    input.previousRun.mode !== previousTaskPacket.mode ||
    input.previousRun.state !== "awaiting_approval" ||
    previousTaskPacket.mode === "dryRun"
  ) {
    return failValidation();
  }

  assertSafePreviousTaskPacket(previousTaskPacket);
  const policySnapshot = selectPolicySnapshot(
    input.previousRun.policySnapshot,
    previousTaskPacket.policy,
  );
  const validationCommands = selectValidationCommands(
    input.previousRun.validationCommands,
    previousTaskPacket.validation.commands,
  );

  const packet = {
    acceptanceCriteria: assertSafeCopiedTextList(
      previousTaskPacket.acceptanceCriteria,
      acceptanceCriterionMaxLength,
    ),
    context: {
      files: normalizeChangedPaths(input.previousRun.changedPaths),
      notes: buildContextNotes(input),
    },
    contractVersion: CONTRACT_VERSION,
    createdAt: toIsoTimestamp(input.requestedAt),
    id: `repair:${repairRequestId}`,
    mode: "repair",
    objective: assertSafeCopiedText(previousTaskPacket.objective, objectiveMaxLength),
    policy: policySnapshot,
    repair: {
      attempt,
      feedback: assertSafeCopiedText(input.feedback, 2_000),
      maxAttempts,
      previousRunId,
    },
    repo: {
      defaultBranch: assertSafeCopiedText(
        previousTaskPacket.repo.defaultBranch,
        requiredTextMaxLength,
      ),
      localPath: assertSafeCopiedText(previousTaskPacket.repo.localPath, 1_024),
      targetBranch: assertSafeCopiedText(
        previousTaskPacket.repo.targetBranch,
        requiredTextMaxLength,
      ),
    },
    repositoryId: assertSafeCopiedText(previousTaskPacket.repositoryId, requiredTextMaxLength),
    runId: queuedRunId,
    source: {
      externalId: repairRequestId,
      title: createRepairSourceTitle(previousTaskPacket),
      type: "repair",
    },
    validation: {
      commands: validationCommands,
    },
    workspaceId,
  };
  const parsedPacket = TaskPacketSchema.safeParse(packet);

  if (parsedPacket.success !== true) {
    return failValidation();
  }

  return parsedPacket.data;
};

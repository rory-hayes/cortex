import "server-only";

import {
  CortexTaskSchema,
  DryRunResultSchema,
  FindingSchema,
  PrArtifactSchema,
  RunEventSchema,
  ValidationResultSchema,
  type CortexTask,
  type DryRunResult,
  type Finding,
  type PrArtifactStatus,
  type RiskFinding,
  type RunEventSeverity,
  type RunState,
  type TaskPacketMode,
  type ValidationResultStatus,
} from "@control-plane/shared";

import { and, eq, inArray, schema, sql, type Database } from "../db";
import { hasUnsafeArtifactText, hasUnsafePathText } from "./artifact-safety";
import { DEFAULT_REPAIR_MAX_ATTEMPTS } from "../repairs/constants";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import type { GitHubChecksSummary, GitHubPrReviewState } from "../github/pull-requests";

const ID_MAX_LENGTH = 160;

export type RunTimelineEvent = {
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  message: string;
  metadata: Record<string, unknown>;
  receivedAt: Date;
  severity: RunEventSeverity;
  state: RunState;
};

export type RunDetailPr = {
  branchName: string;
  changedFilePaths: string[];
  checks: GitHubChecksSummary;
  createdAt: Date;
  githubSyncedAt: Date | null;
  number: number;
  repository: {
    name: string;
    owner: string;
  };
  reviewState: GitHubPrReviewState;
  riskFlags: RiskFinding[];
  status: PrArtifactStatus;
  title: string;
  url: string | null;
};

export type RunDetailValidationResult = {
  commandId: string;
  commandLabel: string;
  durationMs: number;
  exitCode: number | null;
  finishedAt: Date;
  id: string;
  redactionApplied: boolean;
  startedAt: Date;
  status: ValidationResultStatus;
  stderrSummary: string;
  stdoutSummary: string;
};

export type RunDetailCortexFinding = Pick<
  Finding,
  "category" | "severity" | "status" | "summary" | "title"
> & {
  findingId: string;
};

export type RunDetailCortexTaskContext = Pick<
  CortexTask,
  | "acceptanceCriteria"
  | "approvalStatus"
  | "executionMode"
  | "latestRunId"
  | "origin"
  | "prArtifactIds"
  | "riskLevel"
  | "runIds"
  | "status"
  | "suggestedValidation"
  | "taskId"
  | "title"
> & {
  findings: RunDetailCortexFinding[];
};

export type RunDetail = {
  cortexTask: RunDetailCortexTaskContext | null;
  createdAt: Date;
  dryRunResult: DryRunResult | null;
  id: string;
  mode: TaskPacketMode;
  pr: RunDetailPr | null;
  repair: {
    attemptCount: number;
    canRequestRepair: boolean;
    disabledReason: string | null;
    maxAttempts: number;
    nextAttempt: number;
    remainingAttempts: number;
  };
  repoMapping: {
    id: string;
    repositoryName: string;
    repositoryOwner: string;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  state: RunState;
  task: {
    id: string;
    title: string;
  };
  timeline: RunTimelineEvent[];
  updatedAt: Date;
  validationResults: RunDetailValidationResult[];
  workspaceId: string;
};

export type RunDetailDryRunResultRow = {
  blockers: unknown;
  capabilities: unknown;
  checks: unknown;
  contractVersion: string;
  id: string;
  resultCreatedAt: Date;
  runId: string;
  status: DryRunResult["status"];
  warnings: unknown;
};

export type RunDetailStoreRunRow = {
  attemptCount: number;
  createdAt: Date;
  dryRunResult: RunDetailDryRunResultRow | null;
  id: string;
  lastEventAt: Date | null;
  maxAttempts: number;
  mode: TaskPacketMode;
  prArtifactContractVersion: string | null;
  prArtifactCreatedAt: Date | null;
  prGithubChecksSummary: GitHubChecksSummary | null;
  prGithubReviewState: GitHubPrReviewState | null;
  prGithubSyncedAt: Date | null;
  prArtifactId: string | null;
  prArtifactRunId: string | null;
  prBranchName: string | null;
  prChangedFilePaths: string[] | null;
  prNumber: number | null;
  prRepositoryName: string | null;
  prRepositoryOwner: string | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
  prTitle: string | null;
  prUrl: string | null;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  runnerDisplayName: string | null;
  runnerId: string | null;
  state: RunState;
  taskId: string;
  taskTitle: string;
  updatedAt: Date;
  workspaceId: string;
};

export type RunTimelineEventStoreRow = {
  contractVersion: string;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  message: string;
  metadata: Record<string, unknown>;
  receivedAt: Date;
  runId: string;
  runnerId: string | null;
  severity: RunEventSeverity;
  state: RunState;
  workspaceId: string;
};

export type RunDetailValidationResultStoreRow = {
  command: string;
  commandId: string;
  commandLabel: string;
  contractVersion: string;
  durationMs: number;
  exitCode: number | null;
  finishedAt: Date;
  id: string;
  redactionApplied: boolean;
  runId: string;
  startedAt: Date;
  status: ValidationResultStatus;
  stderrSummary: string;
  stdoutSummary: string;
  workspaceId: string;
};

export type RunDetailCortexTaskStoreRow = {
  acceptanceCriteria: CortexTask["acceptanceCriteria"];
  approvalStatus: CortexTask["approvalStatus"];
  contractVersion: string;
  createdAt: Date;
  executionMode: CortexTask["executionMode"];
  externalLinks: CortexTask["externalLinks"];
  findingIds: string[];
  id: string;
  latestRunId: string | null;
  metadata: CortexTask["metadata"];
  objective: string;
  originExternalId: string | null;
  originExternalSystem: string | null;
  originType: CortexTask["origin"]["type"];
  prArtifactIds: string[];
  repoId: string;
  riskLevel: CortexTask["riskLevel"];
  runIds: string[];
  status: CortexTask["status"];
  suggestedValidation: CortexTask["suggestedValidation"];
  taskPacketId: string | null;
  taskRecommendationId: string | null;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type RunDetailCortexFindingStoreRow = {
  category: Finding["category"];
  confidence: number;
  contractVersion: string;
  createdAt: Date;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type RunDetailCortexTaskContextStoreRow = {
  findings: RunDetailCortexFindingStoreRow[];
  task: RunDetailCortexTaskStoreRow;
};

export type RunDetailStore = WorkspaceMembershipStore & {
  getRunCortexTaskContext: (input: {
    runId: string;
    workspaceId: string;
  }) => Promise<RunDetailCortexTaskContextStoreRow | null>;
  getWorkspaceRunDetail: (input: {
    runId: string;
    workspaceId: string;
  }) => Promise<RunDetailStoreRunRow | null>;
  listRunEvents: (input: {
    runId: string;
    workspaceId: string;
  }) => Promise<RunTimelineEventStoreRow[]>;
  listValidationResults: (input: {
    runId: string;
    workspaceId: string;
  }) => Promise<RunDetailValidationResultStoreRow[]>;
};

export type RunDetailService = {
  getRunDetail: (input: { runId: string; workspaceId: string }) => Promise<RunDetail | null>;
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const normalizeRequiredId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > ID_MAX_LENGTH ||
    hasControlCharacter(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const compareTimelineEvents = (
  left: RunTimelineEventStoreRow,
  right: RunTimelineEventStoreRow,
): number => {
  const createdAtComparison = left.createdAt.getTime() - right.createdAt.getTime();

  if (createdAtComparison !== 0) {
    return createdAtComparison;
  }

  const receivedAtComparison = left.receivedAt.getTime() - right.receivedAt.getTime();

  if (receivedAtComparison !== 0) {
    return receivedAtComparison;
  }

  return left.id.localeCompare(right.id);
};

const compareValidationResults = (
  left: RunDetailValidationResultStoreRow,
  right: RunDetailValidationResultStoreRow,
): number => {
  const startedAtComparison = left.startedAt.getTime() - right.startedAt.getTime();

  if (startedAtComparison !== 0) {
    return startedAtComparison;
  }

  const finishedAtComparison = left.finishedAt.getTime() - right.finishedAt.getTime();

  if (finishedAtComparison !== 0) {
    return finishedAtComparison;
  }

  return left.id.localeCompare(right.id);
};

const toSafePrUrl = (prUrl: string | null): string | null => {
  if (prUrl === null) {
    return null;
  }

  const normalizedPrUrl = prUrl.trim();

  if (normalizedPrUrl.length === 0 || hasUnsafeArtifactText(normalizedPrUrl)) {
    return null;
  }

  try {
    const url = new URL(normalizedPrUrl);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const toSafeArtifactText = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)) {
    return null;
  }

  return normalizedValue;
};

const toSafeChangedFilePaths = (changedFilePaths: string[] | null): string[] => {
  if (!Array.isArray(changedFilePaths)) {
    return [];
  }

  return changedFilePaths
    .map((changedFilePath) =>
      typeof changedFilePath === "string" ? changedFilePath.trim() : "",
    )
    .filter((changedFilePath) => changedFilePath.length > 0 && !hasUnsafePathText(changedFilePath));
};

const toSafeRiskFindings = (riskFindings: RiskFinding[] | null): RiskFinding[] => {
  if (!Array.isArray(riskFindings)) {
    return [];
  }

  return riskFindings
    .map((riskFinding) => ({
      ...riskFinding,
      id: riskFinding.id.trim(),
      message: riskFinding.message.trim(),
      paths: riskFinding.paths.map((pathValue) => pathValue.trim()),
    }))
    .filter(
      (riskFinding) =>
        riskFinding.id.length > 0 &&
        riskFinding.message.length > 0 &&
        !hasUnsafeArtifactText(riskFinding.id) &&
        !hasUnsafeArtifactText(riskFinding.message) &&
        !riskFinding.paths.some(
          (pathValue) => pathValue.length === 0 || hasUnsafePathText(pathValue),
        ),
    );
};

const unknownChecksSummary: GitHubChecksSummary = {
  conclusion: "unknown",
  failedCount: 0,
  passedCount: 0,
  pendingCount: 0,
  skippedCount: 0,
  totalCount: 0,
};

const isNonNegativeInteger = (value: number): boolean =>
  Number.isSafeInteger(value) && value >= 0;

const toSafeReviewState = (value: GitHubPrReviewState | null): GitHubPrReviewState => {
  if (
    value === "approved" ||
    value === "changes_requested" ||
    value === "review_required" ||
    value === "unknown"
  ) {
    return value;
  }

  return "unknown";
};

const toSafeChecksSummary = (value: GitHubChecksSummary | null): GitHubChecksSummary => {
  if (
    value === null ||
    (value.conclusion !== "failing" &&
      value.conclusion !== "passing" &&
      value.conclusion !== "pending" &&
      value.conclusion !== "unknown") ||
    !isNonNegativeInteger(value.failedCount) ||
    !isNonNegativeInteger(value.passedCount) ||
    !isNonNegativeInteger(value.pendingCount) ||
    !isNonNegativeInteger(value.skippedCount) ||
    !isNonNegativeInteger(value.totalCount)
  ) {
    return unknownChecksSummary;
  }

  return value;
};

const toSafeOptionalDate = (value: Date | null): Date | null => {
  if (value === null || Number.isNaN(value.getTime())) {
    return null;
  }

  return value;
};

const toSafeIsoTimestamp = (value: Date | null): string | null => {
  if (value === null || Number.isNaN(value.getTime())) {
    return null;
  }

  return value.toISOString();
};

const toRunDetailPr = (run: RunDetailStoreRunRow): RunDetailPr | null => {
  if (run.prArtifactId === null) {
    return null;
  }

  const parsedArtifact = PrArtifactSchema.safeParse({
    branchName: run.prBranchName,
    changedFilePaths: run.prChangedFilePaths,
    contractVersion: run.prArtifactContractVersion,
    createdAt: toSafeIsoTimestamp(run.prArtifactCreatedAt),
    id: run.prArtifactId,
    prNumber: run.prNumber,
    prStatus: run.prStatus,
    prTitle: run.prTitle,
    prUrl: run.prUrl,
    repository: {
      name: run.prRepositoryName,
      owner: run.prRepositoryOwner,
    },
    riskFindings: run.prRiskFindings,
    runId: run.prArtifactRunId,
  });

  if (!parsedArtifact.success) {
    return null;
  }

  const artifact = parsedArtifact.data;

  if (artifact.runId !== run.id) {
    return null;
  }

  const branchName = toSafeArtifactText(artifact.branchName);
  const repositoryName = toSafeArtifactText(artifact.repository.name);
  const repositoryOwner = toSafeArtifactText(artifact.repository.owner);
  const title = toSafeArtifactText(artifact.prTitle);
  const createdAt = new Date(artifact.createdAt);

  if (
    branchName === null ||
    repositoryName === null ||
    repositoryOwner === null ||
    title === null ||
    Number.isNaN(createdAt.getTime())
  ) {
    return null;
  }

  return {
    branchName,
    changedFilePaths: toSafeChangedFilePaths(artifact.changedFilePaths),
    checks: toSafeChecksSummary(run.prGithubChecksSummary),
    createdAt,
    githubSyncedAt: toSafeOptionalDate(run.prGithubSyncedAt),
    number: artifact.prNumber,
    repository: {
      name: repositoryName,
      owner: repositoryOwner,
    },
    reviewState: toSafeReviewState(run.prGithubReviewState),
    riskFlags: toSafeRiskFindings(artifact.riskFindings),
    status: artifact.prStatus,
    title,
    url: toSafePrUrl(artifact.prUrl),
  };
};

const unsafeMetadataKeys = new Set([
  "acceptancecriteria",
  "capabilitiessnapshot",
  "changedpaths",
  "command",
  "commandline",
  "commands",
  "commandtext",
  "content",
  "contents",
  "contextfilepaths",
  "credentials",
  "diff",
  "filecontent",
  "filecontents",
  "localpath",
  "logs",
  "objective",
  "patch",
  "policysnapshot",
  "rawlogs",
  "rawoutput",
  "riskfindings",
  "shellcommand",
  "snippet",
  "source",
  "sourcecode",
  "taskpacket",
  "validationcommands",
  "repopath",
  "repositorypath",
  "worktreepath",
]);

const unsafePayloadMetadataKeyPattern =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|code|line|lines)?$/;

const unsafeLogMetadataKeyPattern =
  /^(?:raw|full)?(?:stdout|stderr|output|log|logs)(?:text|content|contents|body|data|blob|value|line|lines)?$/;

const unsafeCredentialMetadataKeyPattern =
  /(?:apikey|credential|password|passwd|privatekey|secret|token)/;

const unsafeAbsolutePathValuePattern =
  /(?:file:\/\/|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[a-z]:[\\/]|\\\\))/i;
const absolutePathStartPattern = /^(?:\/(?!\/)|[a-z]:[\\/]|\\\\)/i;

const normalizeMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isUnsafeMetadataKey = (key: string): boolean => {
  const normalizedKey = normalizeMetadataKey(key);

  return (
    unsafeMetadataKeys.has(normalizedKey) ||
    unsafePayloadMetadataKeyPattern.test(normalizedKey) ||
    unsafeLogMetadataKeyPattern.test(normalizedKey) ||
    unsafeCredentialMetadataKeyPattern.test(normalizedKey)
  );
};

const sanitizeMetadataValue = (value: unknown): unknown => {
  if (typeof value === "string") {
    return unsafeAbsolutePathValuePattern.test(value.trim()) ? undefined : value;
  }

  if (Array.isArray(value)) {
    const sanitizedItems = value
      .map((item) => sanitizeMetadataValue(item))
      .filter((item) => item !== undefined);

    return sanitizedItems.length === 0 ? undefined : sanitizedItems;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  const sanitizedEntries = Object.entries(value)
    .filter(([key]) => !isUnsafeMetadataKey(key))
    .map(([key, childValue]) => [key, sanitizeMetadataValue(childValue)] as const)
    .filter(([, childValue]) => childValue !== undefined);

  if (sanitizedEntries.length === 0) {
    return undefined;
  }

  return Object.fromEntries(sanitizedEntries);
};

const sanitizeMetadata = (metadata: Record<string, unknown>): Record<string, unknown> => {
  const sanitizedValue = sanitizeMetadataValue(metadata);

  if (
    typeof sanitizedValue !== "object" ||
    sanitizedValue === null ||
    Array.isArray(sanitizedValue)
  ) {
    return {};
  }

  return sanitizedValue as Record<string, unknown>;
};

const toIsoTimestamp = (value: Date): string => value.toISOString();

const toRunTimelineEvent = (event: RunTimelineEventStoreRow): RunTimelineEvent | null => {
  const metadata = sanitizeMetadata(event.metadata);
  const parsedEvent = RunEventSchema.safeParse({
    contractVersion: event.contractVersion,
    createdAt: toIsoTimestamp(event.createdAt),
    id: event.id,
    idempotencyKey: event.idempotencyKey,
    metadata,
    message: event.message,
    runId: event.runId,
    ...(event.runnerId === null ? {} : { runnerId: event.runnerId }),
    severity: event.severity,
    state: event.state,
  });

  if (!parsedEvent.success) {
    return null;
  }

  return {
    createdAt: event.createdAt,
    id: parsedEvent.data.id,
    idempotencyKey: parsedEvent.data.idempotencyKey,
    message: parsedEvent.data.message,
    metadata: parsedEvent.data.metadata,
    receivedAt: event.receivedAt,
    severity: parsedEvent.data.severity,
    state: parsedEvent.data.state,
  };
};

const toRunDetailValidationResult = (
  result: RunDetailValidationResultStoreRow,
): RunDetailValidationResult | null => {
  const parsedResult = ValidationResultSchema.safeParse({
    command: result.command,
    commandId: result.commandId,
    commandLabel: result.commandLabel,
    contractVersion: result.contractVersion,
    durationMs: result.durationMs,
    exitCode: result.exitCode,
    finishedAt: toIsoTimestamp(result.finishedAt),
    id: result.id,
    redactionApplied: result.redactionApplied,
    runId: result.runId,
    startedAt: toIsoTimestamp(result.startedAt),
    status: result.status,
    stderrSummary: result.stderrSummary,
    stdoutSummary: result.stdoutSummary,
  });

  if (!parsedResult.success) {
    return null;
  }

  return {
    commandId: parsedResult.data.commandId,
    commandLabel: parsedResult.data.commandLabel,
    durationMs: parsedResult.data.durationMs,
    exitCode: parsedResult.data.exitCode,
    finishedAt: result.finishedAt,
    id: parsedResult.data.id,
    redactionApplied: parsedResult.data.redactionApplied,
    startedAt: result.startedAt,
    status: parsedResult.data.status,
    stderrSummary: parsedResult.data.stderrSummary,
    stdoutSummary: parsedResult.data.stdoutSummary,
  };
};

const stripCapabilityToolPaths = (
  capabilities: DryRunResult["capabilities"],
): DryRunResult["capabilities"] => ({
  ...capabilities,
  shell: toSafeCapabilityText(capabilities.shell),
  tools: Object.fromEntries(
    Object.entries(capabilities.tools)
      .filter(([, capability]) => capability !== undefined)
      .map(([tool, capability]) => {
        const presentCapability = capability as NonNullable<typeof capability>;
        const safeVersion =
          presentCapability.version === undefined
            ? undefined
            : toOptionalSafeCapabilityText(presentCapability.version);

        return [
          tool,
          {
            available: presentCapability.available,
            ...(safeVersion === undefined ? {} : { version: safeVersion }),
          },
        ];
      }),
  ) as DryRunResult["capabilities"]["tools"],
});

const toSafeCapabilityText = (value: string): string => {
  const trimmedValue = value.trim();

  if (!unsafeAbsolutePathValuePattern.test(trimmedValue)) {
    return value;
  }

  if (absolutePathStartPattern.test(trimmedValue)) {
    const pathSegments = trimmedValue.replace(/\\/g, "/").split("/").filter(Boolean);
    const lastSegment = pathSegments.at(-1);

    if (lastSegment !== undefined && lastSegment.length > 0) {
      return lastSegment;
    }
  }

  return "redacted";
};

const toOptionalSafeCapabilityText = (value: string): string | undefined => {
  const safeValue = toSafeCapabilityText(value);

  return safeValue === "redacted" ? undefined : safeValue;
};

const sanitizeRiskFindingPaths = (
  findings: DryRunResult["blockers"],
): DryRunResult["blockers"] =>
  findings.map((finding) => ({
    ...finding,
    paths: finding.paths.filter((path) => !unsafeAbsolutePathValuePattern.test(path.trim())),
  }));

const sanitizeDryRunResult = (result: DryRunResult): DryRunResult => ({
  ...result,
  blockers: sanitizeRiskFindingPaths(result.blockers),
  capabilities: stripCapabilityToolPaths(result.capabilities),
  checks: result.checks.map((check) => ({
    ...check,
    metadata: sanitizeMetadata(check.metadata),
  })),
  warnings: sanitizeRiskFindingPaths(result.warnings),
});

const toDryRunResult = (
  dryRunResult: RunDetailDryRunResultRow | null,
  runId: string,
): DryRunResult | null => {
  if (dryRunResult === null) {
    return null;
  }

  const parsedResult = DryRunResultSchema.safeParse({
    blockers: dryRunResult.blockers,
    capabilities: dryRunResult.capabilities,
    checks: dryRunResult.checks,
    contractVersion: dryRunResult.contractVersion,
    createdAt: toIsoTimestamp(dryRunResult.resultCreatedAt),
    id: dryRunResult.id,
    runId: dryRunResult.runId,
    status: dryRunResult.status,
    warnings: dryRunResult.warnings,
  });

  if (!parsedResult.success || parsedResult.data.runId !== runId) {
    return null;
  }

  return sanitizeDryRunResult(parsedResult.data);
};

const toCortexTaskFromRow = (row: RunDetailCortexTaskStoreRow): CortexTask | null => {
  const parsedTask = CortexTaskSchema.safeParse({
    acceptanceCriteria: row.acceptanceCriteria,
    approvalStatus: row.approvalStatus,
    contractVersion: row.contractVersion,
    createdAt: toIsoTimestamp(row.createdAt),
    executionMode: row.executionMode,
    externalLinks: row.externalLinks,
    findingIds: row.findingIds,
    ...(row.latestRunId === null ? {} : { latestRunId: row.latestRunId }),
    metadata: row.metadata,
    objective: row.objective,
    origin: {
      type: row.originType,
      ...(row.originExternalId === null ? {} : { externalId: row.originExternalId }),
      ...(row.originExternalSystem === null ? {} : { externalSystem: row.originExternalSystem }),
    },
    prArtifactIds: row.prArtifactIds,
    repoId: row.repoId,
    riskLevel: row.riskLevel,
    runIds: row.runIds,
    status: row.status,
    suggestedValidation: row.suggestedValidation,
    taskId: row.id,
    ...(row.taskPacketId === null ? {} : { taskPacketId: row.taskPacketId }),
    ...(row.taskRecommendationId === null
      ? {}
      : { taskRecommendationId: row.taskRecommendationId }),
    title: row.title,
    updatedAt: toIsoTimestamp(row.updatedAt),
    workspaceId: row.workspaceId,
  });

  return parsedTask.success ? parsedTask.data : null;
};

const toCortexFindingFromRow = (row: RunDetailCortexFindingStoreRow): Finding | null => {
  const parsedFinding = FindingSchema.safeParse({
    category: row.category,
    confidence: row.confidence,
    contractVersion: row.contractVersion,
    createdAt: toIsoTimestamp(row.createdAt),
    deterministicRuleId: row.deterministicRuleId,
    evidence: row.evidence,
    findingId: row.id,
    recommendation: row.recommendation,
    repoId: row.repoId,
    scanId: row.scanId,
    severity: row.severity,
    source: row.source,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: toIsoTimestamp(row.updatedAt),
    workspaceId: row.workspaceId,
  });

  return parsedFinding.success ? parsedFinding.data : null;
};

const toSafeStringArray = (values: string[]): string[] =>
  values
    .map((value) => toSafeArtifactText(value))
    .filter((value): value is string => value !== null);

const toSafeOrigin = (origin: CortexTask["origin"]): CortexTask["origin"] => {
  const externalId =
    origin.externalId === undefined ? undefined : toSafeArtifactText(origin.externalId);
  const externalSystem =
    origin.externalSystem === undefined ? undefined : toSafeArtifactText(origin.externalSystem);

  return {
    type: origin.type,
    ...(externalId === undefined || externalId === null ? {} : { externalId }),
    ...(externalSystem === undefined || externalSystem === null ? {} : { externalSystem }),
  };
};

const toRunDetailCortexFinding = (input: {
  finding: Finding;
  repoId: string;
  taskFindingIds: string[];
  workspaceId: string;
}): RunDetailCortexFinding | null => {
  if (
    input.finding.workspaceId !== input.workspaceId ||
    input.finding.repoId !== input.repoId ||
    !input.taskFindingIds.includes(input.finding.findingId)
  ) {
    return null;
  }

  const title = toSafeArtifactText(input.finding.title);
  const summary = toSafeArtifactText(input.finding.summary);

  if (title === null || summary === null) {
    return null;
  }

  return {
    category: input.finding.category,
    findingId: input.finding.findingId,
    severity: input.finding.severity,
    status: input.finding.status,
    summary,
    title,
  };
};

const toRunDetailCortexTaskContext = (input: {
  context: RunDetailCortexTaskContextStoreRow | null;
  runId: string;
  workspaceId: string;
}): RunDetailCortexTaskContext | null => {
  if (input.context === null) {
    return null;
  }

  const task = toCortexTaskFromRow(input.context.task);

  if (
    task === null ||
    task.workspaceId !== input.workspaceId ||
    !task.runIds.includes(input.runId)
  ) {
    return null;
  }

  const title = toSafeArtifactText(task.title);
  const acceptanceCriteria = toSafeStringArray(task.acceptanceCriteria);
  const runIds = toSafeStringArray(task.runIds);
  const prArtifactIds = toSafeStringArray(task.prArtifactIds);
  const latestRunId =
    task.latestRunId === undefined ? undefined : toSafeArtifactText(task.latestRunId);
  const suggestedValidation = task.suggestedValidation
    .map((validation) => {
      const label = toSafeArtifactText(validation.label);
      const validationId = toSafeArtifactText(validation.validationId);

      if (label === null || validationId === null) {
        return null;
      }

      return {
        label,
        required: validation.required,
        validationId,
      };
    })
    .filter(
      (validation): validation is CortexTask["suggestedValidation"][number] =>
        validation !== null,
    );

  if (
    title === null ||
    acceptanceCriteria.length !== task.acceptanceCriteria.length ||
    acceptanceCriteria.length === 0 ||
    runIds.length !== task.runIds.length ||
    prArtifactIds.length !== task.prArtifactIds.length ||
    suggestedValidation.length !== task.suggestedValidation.length ||
    (latestRunId === null && task.latestRunId !== undefined)
  ) {
    return null;
  }

  const safeLatestRunId = latestRunId ?? undefined;
  const findings = input.context.findings
    .map(toCortexFindingFromRow)
    .filter((finding): finding is Finding => finding !== null)
    .map((finding) =>
      toRunDetailCortexFinding({
        finding,
        repoId: task.repoId,
        taskFindingIds: task.findingIds,
        workspaceId: input.workspaceId,
      }),
    )
    .filter((finding): finding is RunDetailCortexFinding => finding !== null);

  return {
    acceptanceCriteria,
    approvalStatus: task.approvalStatus,
    executionMode: task.executionMode,
    findings,
    ...(safeLatestRunId === undefined ? {} : { latestRunId: safeLatestRunId }),
    origin: toSafeOrigin(task.origin),
    prArtifactIds,
    riskLevel: task.riskLevel,
    runIds,
    status: task.status,
    suggestedValidation,
    taskId: task.taskId,
    title,
  };
};

const toRunDetailRepair = (run: RunDetailStoreRunRow): RunDetail["repair"] => {
  const maxAttempts = Math.max(run.maxAttempts, DEFAULT_REPAIR_MAX_ATTEMPTS);
  const nextAttempt = run.attemptCount + 1;
  const remainingAttempts = Math.max(maxAttempts - run.attemptCount, 0);
  const canRequestRepair = run.state === "awaiting_approval" && nextAttempt <= maxAttempts;
  const disabledReason =
    nextAttempt > maxAttempts
      ? "Repair attempt limit reached."
      : run.state !== "awaiting_approval"
        ? "Repairs are available only while the run is awaiting approval."
        : null;

  return {
    attemptCount: run.attemptCount,
    canRequestRepair,
    disabledReason,
    maxAttempts,
    nextAttempt,
    remainingAttempts,
  };
};

const toRunDetail = (input: {
  cortexTaskContext: RunDetailCortexTaskContextStoreRow | null;
  events: RunTimelineEventStoreRow[];
  run: RunDetailStoreRunRow;
  runId: string;
  validationResults: RunDetailValidationResultStoreRow[];
  workspaceId: string;
}): RunDetail | null => {
  if (input.run.workspaceId !== input.workspaceId || input.run.id !== input.runId) {
    return null;
  }

  const seenIdempotencyKeys = new Set<string>();
  const timeline = input.events
    .filter((event) => event.workspaceId === input.workspaceId && event.runId === input.runId)
    .toSorted(compareTimelineEvents)
    .map(toRunTimelineEvent)
    .filter((event): event is RunTimelineEvent => event !== null)
    .filter((event) => {
      if (seenIdempotencyKeys.has(event.idempotencyKey)) {
        return false;
      }

      seenIdempotencyKeys.add(event.idempotencyKey);

      return true;
    });
  const validationResults = input.validationResults
    .filter((result) => result.workspaceId === input.workspaceId && result.runId === input.runId)
    .toSorted(compareValidationResults)
    .map(toRunDetailValidationResult)
    .filter((result): result is RunDetailValidationResult => result !== null);

  return {
    cortexTask: toRunDetailCortexTaskContext({
      context: input.cortexTaskContext,
      runId: input.runId,
      workspaceId: input.workspaceId,
    }),
    createdAt: input.run.createdAt,
    dryRunResult: toDryRunResult(input.run.dryRunResult, input.runId),
    id: input.run.id,
    mode: input.run.mode,
    pr: toRunDetailPr(input.run),
    repair: toRunDetailRepair(input.run),
    repoMapping: {
      id: input.run.repoMappingId,
      repositoryName: input.run.repositoryName,
      repositoryOwner: input.run.repositoryOwner,
    },
    runner:
      input.run.runnerId === null || input.run.runnerDisplayName === null
        ? null
        : {
            displayName: input.run.runnerDisplayName,
            id: input.run.runnerId,
          },
    state: input.run.state,
    task: {
      id: input.run.taskId,
      title: input.run.taskTitle,
    },
    timeline,
    updatedAt: input.run.lastEventAt ?? input.run.updatedAt,
    validationResults,
    workspaceId: input.run.workspaceId,
  };
};

export const createDrizzleRunDetailStore = (db: Database): RunDetailStore => ({
  findWorkspaceMembership: async ({ userId, workspaceId }) => {
    const [membership] = await db
      .select({
        id: schema.memberships.id,
        role: schema.memberships.role,
      })
      .from(schema.memberships)
      .where(
        and(eq(schema.memberships.workspaceId, workspaceId), eq(schema.memberships.userId, userId)),
      )
      .limit(1);

    return membership ?? null;
  },
  getRunCortexTaskContext: async ({ runId, workspaceId }) => {
    const [task] = await db
      .select({
        acceptanceCriteria: schema.cortexTasks.acceptanceCriteria,
        approvalStatus: schema.cortexTasks.approvalStatus,
        contractVersion: schema.cortexTasks.contractVersion,
        createdAt: schema.cortexTasks.createdAt,
        executionMode: schema.cortexTasks.executionMode,
        externalLinks: schema.cortexTasks.externalLinks,
        findingIds: schema.cortexTasks.findingIds,
        id: schema.cortexTasks.id,
        latestRunId: schema.cortexTasks.latestRunId,
        metadata: schema.cortexTasks.metadata,
        objective: schema.cortexTasks.objective,
        originExternalId: schema.cortexTasks.originExternalId,
        originExternalSystem: schema.cortexTasks.originExternalSystem,
        originType: schema.cortexTasks.originType,
        prArtifactIds: schema.cortexTasks.prArtifactIds,
        repoId: schema.cortexTasks.repoId,
        riskLevel: schema.cortexTasks.riskLevel,
        runIds: schema.cortexTasks.runIds,
        status: schema.cortexTasks.status,
        suggestedValidation: schema.cortexTasks.suggestedValidation,
        taskPacketId: schema.cortexTasks.taskPacketId,
        taskRecommendationId: schema.cortexTasks.taskRecommendationId,
        title: schema.cortexTasks.title,
        updatedAt: schema.cortexTasks.updatedAt,
        workspaceId: schema.cortexTasks.workspaceId,
      })
      .from(schema.cortexTasks)
      .where(
        and(
          eq(schema.cortexTasks.workspaceId, workspaceId),
          sql`${schema.cortexTasks.runIds} ? ${runId}`,
        ),
      )
      .limit(1);

    if (task === undefined) {
      return null;
    }

    const taskFindingIds = task.findingIds.filter((findingId) => findingId.trim().length > 0);

    if (taskFindingIds.length === 0) {
      return {
        findings: [],
        task,
      };
    }

    const findings = await db
      .select({
        category: schema.findings.category,
        confidence: schema.findings.confidence,
        contractVersion: schema.findings.contractVersion,
        createdAt: schema.findings.createdAt,
        deterministicRuleId: schema.findings.deterministicRuleId,
        evidence: schema.findings.evidence,
        id: schema.findings.id,
        recommendation: schema.findings.recommendation,
        repoId: schema.findings.repoId,
        scanId: schema.findings.scanId,
        severity: schema.findings.severity,
        source: schema.findings.source,
        status: schema.findings.status,
        summary: schema.findings.summary,
        title: schema.findings.title,
        updatedAt: schema.findings.updatedAt,
        workspaceId: schema.findings.workspaceId,
      })
      .from(schema.findings)
      .where(
        and(
          eq(schema.findings.workspaceId, workspaceId),
          eq(schema.findings.repoId, task.repoId),
          inArray(schema.findings.id, taskFindingIds),
        ),
      );

    return {
      findings,
      task,
    };
  },
  getWorkspaceRunDetail: async ({ runId, workspaceId }) => {
    const [run] = await db
      .select({
        attemptCount: schema.runs.attemptCount,
        createdAt: schema.runs.createdAt,
        dryRunResult: {
          blockers: schema.dryRunResults.blockers,
          capabilities: schema.dryRunResults.capabilities,
          checks: schema.dryRunResults.checks,
          contractVersion: schema.dryRunResults.contractVersion,
          id: schema.dryRunResults.id,
          resultCreatedAt: schema.dryRunResults.resultCreatedAt,
          runId: schema.dryRunResults.runId,
          status: schema.dryRunResults.status,
          warnings: schema.dryRunResults.warnings,
        },
        id: schema.runs.id,
        lastEventAt: schema.runs.lastEventAt,
        maxAttempts: schema.runs.maxAttempts,
        mode: schema.runs.mode,
        prArtifactContractVersion: schema.prArtifacts.contractVersion,
        prArtifactCreatedAt: schema.prArtifacts.createdAt,
        prGithubChecksSummary: schema.prArtifacts.githubChecksSummary,
        prGithubReviewState: schema.prArtifacts.githubReviewState,
        prGithubSyncedAt: schema.prArtifacts.githubSyncedAt,
        prArtifactId: schema.prArtifacts.id,
        prArtifactRunId: schema.prArtifacts.runId,
        prBranchName: schema.prArtifacts.branchName,
        prChangedFilePaths: schema.prArtifacts.changedFilePaths,
        prNumber: schema.prArtifacts.prNumber,
        prRepositoryName: schema.prArtifacts.repositoryName,
        prRepositoryOwner: schema.prArtifacts.repositoryOwner,
        prRiskFindings: schema.prArtifacts.riskFindings,
        prStatus: schema.prArtifacts.prStatus,
        prTitle: schema.prArtifacts.prTitle,
        prUrl: schema.prArtifacts.prUrl,
        repoMappingId: schema.repoMappings.id,
        repositoryName: schema.repoMappings.repositoryName,
        repositoryOwner: schema.repoMappings.repositoryOwner,
        runnerDisplayName: schema.runners.displayName,
        runnerId: schema.runners.id,
        state: schema.runs.state,
        taskId: schema.tasks.id,
        taskTitle: schema.tasks.title,
        updatedAt: schema.runs.updatedAt,
        workspaceId: schema.runs.workspaceId,
      })
      .from(schema.runs)
      .innerJoin(
        schema.tasks,
        and(
          eq(schema.runs.taskId, schema.tasks.id),
          eq(schema.tasks.workspaceId, workspaceId),
        ),
      )
      .innerJoin(
        schema.repoMappings,
        and(
          eq(schema.runs.repoMappingId, schema.repoMappings.id),
          eq(schema.repoMappings.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.runners,
        and(
          eq(schema.runs.runnerId, schema.runners.id),
          eq(schema.runners.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.prArtifacts,
        and(
          eq(schema.prArtifacts.runId, schema.runs.id),
          eq(schema.prArtifacts.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.dryRunResults,
        and(
          eq(schema.dryRunResults.runId, schema.runs.id),
          eq(schema.dryRunResults.workspaceId, workspaceId),
        ),
      )
      .where(and(eq(schema.runs.id, runId), eq(schema.runs.workspaceId, workspaceId)))
      .limit(1);

    return run ?? null;
  },
  listRunEvents: async ({ runId, workspaceId }) =>
    db
      .select({
        contractVersion: schema.runEvents.contractVersion,
        createdAt: schema.runEvents.createdAt,
        id: schema.runEvents.id,
        idempotencyKey: schema.runEvents.idempotencyKey,
        message: schema.runEvents.message,
        metadata: schema.runEvents.metadata,
        receivedAt: schema.runEvents.receivedAt,
        runId: schema.runEvents.runId,
        runnerId: schema.runEvents.runnerId,
        severity: schema.runEvents.severity,
        state: schema.runEvents.state,
        workspaceId: schema.runEvents.workspaceId,
      })
      .from(schema.runEvents)
      .where(and(eq(schema.runEvents.runId, runId), eq(schema.runEvents.workspaceId, workspaceId)))
      .orderBy(schema.runEvents.createdAt, schema.runEvents.receivedAt, schema.runEvents.id),
  listValidationResults: async ({ runId, workspaceId }) =>
    db
      .select({
        command: schema.validationResults.command,
        commandId: schema.validationResults.commandId,
        commandLabel: schema.validationResults.commandLabel,
        contractVersion: schema.validationResults.contractVersion,
        durationMs: schema.validationResults.durationMs,
        exitCode: schema.validationResults.exitCode,
        finishedAt: schema.validationResults.finishedAt,
        id: schema.validationResults.id,
        redactionApplied: schema.validationResults.redactionApplied,
        runId: schema.validationResults.runId,
        startedAt: schema.validationResults.startedAt,
        status: schema.validationResults.status,
        stderrSummary: schema.validationResults.stderrSummary,
        stdoutSummary: schema.validationResults.stdoutSummary,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(
        and(
          eq(schema.validationResults.runId, runId),
          eq(schema.validationResults.workspaceId, workspaceId),
        ),
      )
      .orderBy(
        schema.validationResults.startedAt,
        schema.validationResults.finishedAt,
        schema.validationResults.id,
      ),
});

export const createRunDetailService = (input: {
  getAuthContext?: GetAuthContext;
  store: RunDetailStore;
}): RunDetailService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    getRunDetail: async ({ runId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeRequiredId(workspaceId);
      const normalizedRunId = normalizeRequiredId(runId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const run = await input.store.getWorkspaceRunDetail({
        runId: normalizedRunId,
        workspaceId: scope.workspaceId,
      });

      if (run === null) {
        return null;
      }

      const [cortexTaskContext, events, validationResults] = await Promise.all([
        input.store.getRunCortexTaskContext({
          runId: normalizedRunId,
          workspaceId: scope.workspaceId,
        }),
        input.store.listRunEvents({
          runId: normalizedRunId,
          workspaceId: scope.workspaceId,
        }),
        input.store.listValidationResults({
          runId: normalizedRunId,
          workspaceId: scope.workspaceId,
        }),
      ]);

      return toRunDetail({
        cortexTaskContext,
        events,
        run,
        runId: normalizedRunId,
        validationResults,
        workspaceId: scope.workspaceId,
      });
    },
  };
};

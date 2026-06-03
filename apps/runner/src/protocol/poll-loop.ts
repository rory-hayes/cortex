import {
  CONTRACT_VERSION,
  ClaimJobRequestSchema,
  ClaimJobResponseSchema,
  DryRunResultSchema,
  PollJobsRequestSchema,
  PollJobsResponseSchema,
  PrArtifactSchema,
  RUNNER_PROTOCOL_ENDPOINTS,
  RunEventSchema,
  RunnerCapabilitiesSchema,
  SubmitDryRunResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  SubmitRunEventRequestSchema,
  SubmitValidationResultRequestSchema,
  ValidationResultSchema,
  createClaimJobIdempotencyKey,
  type ClaimJobResponse,
  type DryRunResult,
  type PollJobsResponse,
  type PrArtifact,
  type RunEvent,
  type RunnerCapabilities,
  type RunnerJob,
  type ValidationResult,
} from "@control-plane/shared";

import { detectRunnerCapabilities, type DetectRunnerCapabilitiesOptions } from "../capabilities.js";
import { loadRunnerConfig, type LoadRunnerConfigOptions, type RunnerConfig } from "../config.js";
import {
  loadRunnerCredential,
  type LoadRunnerCredentialOptions,
  type RunnerCredentialRecord,
} from "../credential-store.js";
import { RunnerError } from "../errors.js";
import {
  type RunRunnerDependencies,
  runRunnerForTaskPacket as defaultRunRunnerForTaskPacket,
  type RunRunnerForTaskPacketOptions,
  type RunRunnerResult,
} from "../run.js";
import type { RunnerCancellationChecker } from "../cancellation.js";
import { claimedEvent } from "../events.js";
import { createTaskWorktreePath } from "../git/worktree-path.js";
import { postRunnerProtocolRequest, type RunnerProtocolFetch } from "./client.js";

export type RunnerPollLoopOptions = {
  credentialPath?: string;
  maxPolls?: number;
  runnerConfigPath?: string;
  stopAfterJob?: boolean;
};

export type RunnerPollOnceOptions = Omit<RunnerPollLoopOptions, "maxPolls" | "stopAfterJob">;

export type RunnerPollLoopDependencies = {
  detectCapabilities?: (options?: DetectRunnerCapabilitiesOptions) => Promise<RunnerCapabilities>;
  fetch?: RunnerProtocolFetch;
  loadRunnerConfig?: (options?: LoadRunnerConfigOptions) => Promise<RunnerConfig>;
  loadCredential?: (options?: LoadRunnerCredentialOptions) => Promise<RunnerCredentialRecord>;
  now?: () => Date;
  runRunnerForTaskPacket?: (
    options: RunRunnerForTaskPacketOptions,
    dependencies?: RunRunnerDependencies,
  ) => Promise<RunRunnerResult>;
};

export type RunnerPollOnceDependencies = RunnerPollLoopDependencies;

export type RunnerPollLoopSubmissionCounts = {
  dryRunResults: number;
  prArtifacts: number;
  runEvents: number;
  validationResults: number;
};

export type RunnerPollLoopResult = {
  claimStatus: ClaimJobResponse["status"] | null;
  executedRunId: string | null;
  exitCode: number | null;
  jobsClaimed: number;
  jobsExecuted: number;
  jobsReceived: number;
  lastPollIntervalSeconds: number | null;
  lastServerTime: string | null;
  polls: number;
  runnerId: string;
  submissions: RunnerPollLoopSubmissionCounts;
};

export type RunnerPollOnceResult = RunnerPollLoopResult;

export type RunnerProtocolSubmissionContext = {
  credential: RunnerCredentialRecord;
  fetch?: RunnerProtocolFetch;
  now: () => Date;
};

export type PollRunnerJobsOptions = {
  availableConcurrency?: number;
  capabilities: RunnerCapabilities;
  credential: RunnerCredentialRecord;
  fetch?: RunnerProtocolFetch;
  knownCurrentRunIds?: string[];
};

export type ClaimRunnerJobOptions = {
  capabilities: RunnerCapabilities;
  credential: RunnerCredentialRecord;
  fetch?: RunnerProtocolFetch;
  job: RunnerJob;
};

export type RunnerPollIterationOptions = {
  credential: RunnerCredentialRecord;
  runnerConfigPath?: string;
};

export type RunnerPollIterationDependencies = Omit<RunnerPollLoopDependencies, "loadCredential">;

type SafeProtocolRequestSchema<TRequest> = {
  safeParse: (value: unknown) =>
    | {
        data: TRequest;
        success: true;
      }
    | {
        success: false;
      };
};

const DEFAULT_MAX_POLLS = 1;

export const runRunnerPollLoop = async (
  options: RunnerPollLoopOptions = {},
  dependencies: RunnerPollLoopDependencies = {},
): Promise<RunnerPollLoopResult> => {
  const now = dependencies.now ?? (() => new Date());
  const loadCredential = dependencies.loadCredential ?? loadRunnerCredential;
  const credential = await loadCredential(
    options.credentialPath === undefined ? {} : { credentialPath: options.credentialPath },
  );
  const maxPolls = normalizeMaxPolls(options.maxPolls);
  const stopAfterJob = options.stopAfterJob ?? true;
  const summary = createEmptySummary(credential.runnerId);

  for (let pollIndex = 0; pollIndex < maxPolls; pollIndex += 1) {
    const iteration = await runRunnerPollIteration(
      {
        credential,
        ...(options.runnerConfigPath === undefined
          ? {}
          : { runnerConfigPath: options.runnerConfigPath }),
      },
      {
        ...(dependencies.detectCapabilities === undefined
          ? {}
          : { detectCapabilities: dependencies.detectCapabilities }),
        ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
        ...(dependencies.loadRunnerConfig === undefined
          ? {}
          : { loadRunnerConfig: dependencies.loadRunnerConfig }),
        now,
        ...(dependencies.runRunnerForTaskPacket === undefined
          ? {}
          : { runRunnerForTaskPacket: dependencies.runRunnerForTaskPacket }),
      },
    );
    mergePollIterationSummary(summary, iteration);

    if (stopAfterJob && iteration.jobsExecuted > 0) {
      break;
    }
  }

  return summary;
};

export const runRunnerPollingLoop = runRunnerPollLoop;

export const runRunnerPollOnce = async (
  options: RunnerPollOnceOptions = {},
  dependencies: RunnerPollOnceDependencies = {},
): Promise<RunnerPollOnceResult> =>
  runRunnerPollLoop(
    {
      ...options,
      maxPolls: 1,
      stopAfterJob: true,
    },
    dependencies,
  );

export const runRunnerPollIteration = async (
  options: RunnerPollIterationOptions,
  dependencies: RunnerPollIterationDependencies = {},
): Promise<RunnerPollLoopResult> => {
  const now = dependencies.now ?? (() => new Date());
  const detectCapabilities = dependencies.detectCapabilities ?? detectRunnerCapabilities;
  const runRunnerForTaskPacket =
    dependencies.runRunnerForTaskPacket ?? defaultRunRunnerForTaskPacket;
  const summary = createEmptySummary(options.credential.runnerId);
  const submissions = createSubmissionCallbacks({
    credential: options.credential,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    now,
  });
  const capabilities = await detectCapabilities({
    now,
    runnerId: options.credential.runnerId,
  });
  const pollResponse = await pollRunnerJobs({
    availableConcurrency: 1,
    capabilities,
    credential: options.credential,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    knownCurrentRunIds: [],
  });

  summary.polls = 1;
  summary.jobsReceived = pollResponse.jobs.length;
  summary.lastPollIntervalSeconds = pollResponse.pollIntervalSeconds;
  summary.lastServerTime = pollResponse.serverTime;

  const job = pollResponse.jobs.find(isEligibleTaskJob);

  if (job === undefined) {
    return summary;
  }

  const claimResponse = await claimRunnerJob({
    capabilities,
    credential: options.credential,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    job,
  });
  summary.claimStatus = claimResponse.status;

  if (
    !claimResponseMatchesJob(claimResponse, job) ||
    !isExecutableClaim(claimResponse, options.credential.runnerId)
  ) {
    return summary;
  }

  summary.jobsClaimed = 1;
  await submissions.onRunEvent(
    claimedEvent({
      jobId: job.jobId,
      now: () => now().toISOString(),
      taskPacket: job.taskPacket,
    }),
  );
  const taskPacket = await createEffectiveLocalTaskPacket({
    loadConfig: dependencies.loadRunnerConfig ?? loadRunnerConfig,
    runnerConfigPath: options.runnerConfigPath,
    taskPacket: job.taskPacket,
  });
  const checkCancellation = createProtocolCancellationChecker({
    capabilities,
    credential: options.credential,
    ...(dependencies.fetch === undefined ? {} : { fetch: dependencies.fetch }),
    ...(pollResponse.cancellation === undefined
      ? {}
      : { initialCancellation: pollResponse.cancellation }),
    runId: taskPacket.runId,
  });

  const runResult = await runRunnerForTaskPacket(
    {
      dryRun: taskPacket.mode === "dryRun",
      repo: taskPacket.repo.localPath,
      taskPacket,
      ...(options.runnerConfigPath === undefined ? {} : { configPath: options.runnerConfigPath }),
    },
    {
      emitRunEvent: submissions.onRunEvent,
      onDryRunResult: submissions.onDryRunResult,
      onPrArtifact: submissions.onPrArtifact,
      onValidationResult: submissions.onValidationResult,
      checkCancellation,
    },
  );

  summary.jobsExecuted = 1;
  summary.executedRunId = runResult.runId;
  summary.exitCode = runResult.exitCode;
  summary.submissions = submissions.counts;

  return summary;
};

export const pollRunnerJobs = async ({
  availableConcurrency = 1,
  capabilities,
  credential,
  fetch,
  knownCurrentRunIds = [],
}: PollRunnerJobsOptions): Promise<PollJobsResponse> => {
  const request = validateInternalRequest(
    PollJobsRequestSchema,
    {
      availableConcurrency,
      capabilities: sanitizeCapabilitiesForProtocol(capabilities),
      contractVersion: CONTRACT_VERSION,
      knownCurrentRunIds,
      runnerId: credential.runnerId,
    },
    "Runner poll request could not be validated.",
  );

  return postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.pollJobs,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: PollJobsResponseSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

export const claimRunnerJob = async ({
  capabilities,
  credential,
  fetch,
  job,
}: ClaimRunnerJobOptions): Promise<ClaimJobResponse> => {
  const request = validateInternalRequest(
    ClaimJobRequestSchema,
    {
      capabilitiesSnapshot: sanitizeCapabilitiesForProtocol(capabilities),
      contractVersion: CONTRACT_VERSION,
      idempotencyKey: createClaimJobIdempotencyKey({
        jobId: job.jobId,
        runId: job.runId,
        runnerId: credential.runnerId,
      }),
      jobId: job.jobId,
      runId: job.runId,
      runnerId: credential.runnerId,
    },
    "Runner claim request could not be validated.",
  );

  return postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.claimJob,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: ClaimJobResponseSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

export const pollJobs = pollRunnerJobs;
export const claimJob = claimRunnerJob;

const createSubmissionCallbacks = (context: RunnerProtocolSubmissionContext) => {
  const counts: RunnerPollLoopSubmissionCounts = {
    dryRunResults: 0,
    prArtifacts: 0,
    runEvents: 0,
    validationResults: 0,
  };

  return {
    counts,
    onDryRunResult: async (result: DryRunResult): Promise<void> => {
      await submitDryRunResult(context, result);
      counts.dryRunResults += 1;
    },
    onPrArtifact: async (artifact: PrArtifact): Promise<void> => {
      await submitPrArtifact(context, artifact);
      counts.prArtifacts += 1;
    },
    onRunEvent: async (event: RunEvent): Promise<void> => {
      await submitRunEvent(context, event);
      counts.runEvents += 1;
    },
    onValidationResult: async (result: ValidationResult): Promise<void> => {
      await submitValidationResult(context, result);
      counts.validationResults += 1;
    },
  };
};

const createProtocolCancellationChecker = ({
  capabilities,
  credential,
  fetch,
  initialCancellation,
  runId,
}: {
  capabilities: RunnerCapabilities;
  credential: RunnerCredentialRecord;
  fetch?: RunnerProtocolFetch;
  initialCancellation?: PollJobsResponse["cancellation"];
  runId: string;
}): RunnerCancellationChecker => {
  let cancellationObserved = initialCancellation?.runId === runId;

  return async (context) => {
    if (context.runId !== runId) {
      return false;
    }

    if (cancellationObserved) {
      return true;
    }

    const response = await pollRunnerJobs({
      availableConcurrency: 0,
      capabilities,
      credential,
      ...(fetch === undefined ? {} : { fetch }),
      knownCurrentRunIds: [runId],
    });

    cancellationObserved = response.cancellation?.runId === runId;

    return cancellationObserved;
  };
};

export const submitRunEvent = async (
  { credential, fetch }: RunnerProtocolSubmissionContext,
  event: RunEvent,
): Promise<void> => {
  if (hasUnsafeLocalAbsolutePathText(event.message)) {
    throw unsafeSubmissionError();
  }

  const request = validateSubmissionRequest(SubmitRunEventRequestSchema, {
    contractVersion: CONTRACT_VERSION,
    createdAt: event.createdAt,
    eventId: event.id,
    idempotencyKey: event.idempotencyKey,
    message: event.message,
    metadata: sanitizeLocalPathMetadata(event.metadata),
    runId: event.runId,
    runnerId: credential.runnerId,
    severity: event.severity,
    state: event.state,
  });

  await postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.submitRunEvent,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: RunEventSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

export const submitDryRunResult = async (
  { credential, fetch, now }: RunnerProtocolSubmissionContext,
  result: DryRunResult,
): Promise<void> => {
  const safeResult = sanitizeDryRunResult(result);
  const request = validateSubmissionRequest(SubmitDryRunResultRequestSchema, {
    contractVersion: CONTRACT_VERSION,
    result: safeResult,
    runId: safeResult.runId,
    runnerId: credential.runnerId,
    submittedAt: now().toISOString(),
  });

  await postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.submitDryRunResult,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: DryRunResultSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

export const submitValidationResult = async (
  { credential, fetch, now }: RunnerProtocolSubmissionContext,
  result: ValidationResult,
): Promise<void> => {
  const safeResult = sanitizeValidationResult(result);
  const request = validateSubmissionRequest(SubmitValidationResultRequestSchema, {
    contractVersion: CONTRACT_VERSION,
    result: safeResult,
    runId: safeResult.runId,
    runnerId: credential.runnerId,
    submittedAt: now().toISOString(),
  });

  await postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.submitValidationResult,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: ValidationResultSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

export const submitPrArtifact = async (
  { credential, fetch, now }: RunnerProtocolSubmissionContext,
  artifact: PrArtifact,
): Promise<void> => {
  const request = validateSubmissionRequest(SubmitPrArtifactRequestSchema, {
    artifact,
    contractVersion: CONTRACT_VERSION,
    runId: artifact.runId,
    runnerId: credential.runnerId,
    submittedAt: now().toISOString(),
  });

  await postRunnerProtocolRequest({
    baseUrl: credential.pollingBaseUrl,
    endpoint: RUNNER_PROTOCOL_ENDPOINTS.submitPrArtifact,
    ...(fetch === undefined ? {} : { fetch }),
    request,
    responseSchema: PrArtifactSchema,
    runnerCredential: credential.runnerCredential,
    runnerId: credential.runnerId,
  });
};

const sanitizeDryRunResult = (result: DryRunResult): DryRunResult => {
  const parsedResult = DryRunResultSchema.safeParse({
    ...result,
    capabilities: sanitizeCapabilitiesForProtocol(result.capabilities),
    checks: result.checks.map((check) => ({
      ...check,
      metadata: sanitizeLocalPathMetadata(check.metadata),
    })),
  });

  if (!parsedResult.success) {
    throw unsafeSubmissionError();
  }

  return parsedResult.data;
};

const sanitizeValidationResult = (result: ValidationResult): ValidationResult => {
  const parsedResult = ValidationResultSchema.safeParse(result);

  if (!parsedResult.success || hasUnsafeValidationResultText(parsedResult.data)) {
    throw unsafeSubmissionError();
  }

  return ValidationResultSchema.parse({
    ...parsedResult.data,
    redactionApplied: true,
  });
};

const hasUnsafeValidationResultText = (result: ValidationResult): boolean =>
  [
    result.id,
    result.runId,
    result.commandId,
    result.commandLabel,
    result.command,
    result.stdoutSummary,
    result.stderrSummary,
  ].some(
    (value) => hasUnsafeProtocolSubmissionText(value) || hasUnsafeLocalAbsolutePathText(value),
  );

const sanitizeCapabilitiesForProtocol = (capabilities: RunnerCapabilities): RunnerCapabilities => {
  const parsedCapabilities = RunnerCapabilitiesSchema.safeParse(capabilities);

  if (!parsedCapabilities.success) {
    throw unsafeSubmissionError();
  }

  type ToolCapability = NonNullable<RunnerCapabilities["tools"][keyof RunnerCapabilities["tools"]]>;
  const safeTools = Object.fromEntries(
    Object.entries(parsedCapabilities.data.tools).map(([toolName, tool]) => {
      const safeTool: ToolCapability = { ...(tool as ToolCapability) };
      delete safeTool.path;

      return [toolName, safeTool];
    }),
  ) as RunnerCapabilities["tools"];

  return {
    ...parsedCapabilities.data,
    tools: safeTools,
  };
};

const sanitizeLocalPathMetadata = (
  value: unknown,
  seen: WeakSet<object> = new WeakSet(),
): unknown => {
  if (typeof value === "string") {
    return isAbsoluteLocalPath(value) || hasUnsafeLocalAbsolutePathText(value) ? undefined : value;
  }

  if (typeof value !== "object" || value === null) {
    return value;
  }

  if (seen.has(value)) {
    return undefined;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value
      .map((item) => sanitizeLocalPathMetadata(item, seen))
      .filter((item) => item !== undefined);
  }

  const safeValue: Record<string, unknown> = {};

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    if (isLocalOnlyProtocolMetadataKey(key)) {
      continue;
    }

    const safeChildValue = sanitizeLocalPathMetadata(childValue, seen);

    if (safeChildValue !== undefined) {
      safeValue[key] = safeChildValue;
    }
  }

  return safeValue;
};

const LOCAL_ONLY_PROTOCOL_METADATA_KEYS = new Set([
  "localpath",
  "repopath",
  "worktreepath",
  "worktreeroot",
]);

const isLocalOnlyProtocolMetadataKey = (key: string): boolean =>
  LOCAL_ONLY_PROTOCOL_METADATA_KEYS.has(normalizeKey(key));

const isAbsoluteLocalPath = (value: string): boolean => {
  const normalizedValue = value.trim().replace(/\\/g, "/");

  return (
    normalizedValue.startsWith("/") ||
    normalizedValue.startsWith("~/") ||
    /^[A-Za-z]:\//.test(normalizedValue)
  );
};

const validateInternalRequest = <TRequest>(
  schema: SafeProtocolRequestSchema<TRequest>,
  request: unknown,
  userSafeMessage: string,
): TRequest => {
  const parsed = schema.safeParse(request);

  if (!parsed.success) {
    throw new RunnerError({
      category: "internal",
      userSafeMessage,
    });
  }

  return parsed.data;
};

const validateSubmissionRequest = <TRequest>(
  schema: SafeProtocolRequestSchema<TRequest>,
  request: unknown,
): TRequest => {
  const parsed = schema.safeParse(request);

  if (!parsed.success || hasUnsafeProtocolSubmissionPayload(parsed.data)) {
    throw unsafeSubmissionError();
  }

  return parsed.data;
};

const isExecutableClaim = (response: ClaimJobResponse, runnerId: string): boolean =>
  response.status === "claimed" ||
  (response.status === "already_claimed" &&
    (response.claimedByRunnerId === undefined || response.claimedByRunnerId === runnerId));

const claimResponseMatchesJob = (response: ClaimJobResponse, job: RunnerJob): boolean =>
  response.jobId === job.jobId && response.runId === job.runId;

const isEligibleTaskJob = (job: RunnerJob): boolean =>
  (job.type === "task" && job.taskPacket.mode !== "repair") ||
  (job.type === "repair" && job.taskPacket.mode === "repair");

const createEffectiveLocalTaskPacket = async ({
  loadConfig,
  runnerConfigPath,
  taskPacket,
}: {
  loadConfig: (options?: LoadRunnerConfigOptions) => Promise<RunnerConfig>;
  runnerConfigPath: string | undefined;
  taskPacket: RunnerJob["taskPacket"];
}): Promise<RunnerJob["taskPacket"]> => {
  if (typeof taskPacket.repo.worktreePath === "string" && taskPacket.repo.worktreePath.length > 0) {
    return taskPacket;
  }

  const config = await loadConfig(
    runnerConfigPath === undefined ? {} : { configPath: runnerConfigPath },
  );
  const worktree = createTaskWorktreePath({
    config,
    policy: taskPacket.policy,
    repoPath: taskPacket.repo.localPath,
    task: taskPacket,
  });

  return {
    ...taskPacket,
    repo: {
      ...taskPacket.repo,
      worktreePath: worktree.worktreePath,
    },
  };
};

const normalizeMaxPolls = (value: number | undefined): number => {
  if (value === undefined || !Number.isFinite(value) || value < 1) {
    return DEFAULT_MAX_POLLS;
  }

  return Math.floor(value);
};

const createEmptySummary = (runnerId: string): RunnerPollLoopResult => ({
  claimStatus: null,
  executedRunId: null,
  exitCode: null,
  jobsClaimed: 0,
  jobsExecuted: 0,
  jobsReceived: 0,
  lastPollIntervalSeconds: null,
  lastServerTime: null,
  polls: 0,
  runnerId,
  submissions: {
    dryRunResults: 0,
    prArtifacts: 0,
    runEvents: 0,
    validationResults: 0,
  },
});

const mergePollIterationSummary = (
  summary: RunnerPollLoopResult,
  iteration: RunnerPollLoopResult,
): void => {
  summary.polls += iteration.polls;
  summary.jobsReceived += iteration.jobsReceived;
  summary.jobsClaimed += iteration.jobsClaimed;
  summary.jobsExecuted += iteration.jobsExecuted;
  summary.submissions.dryRunResults += iteration.submissions.dryRunResults;
  summary.submissions.prArtifacts += iteration.submissions.prArtifacts;
  summary.submissions.runEvents += iteration.submissions.runEvents;
  summary.submissions.validationResults += iteration.submissions.validationResults;

  if (iteration.claimStatus !== null) {
    summary.claimStatus = iteration.claimStatus;
  }

  if (iteration.executedRunId !== null) {
    summary.executedRunId = iteration.executedRunId;
  }

  if (iteration.exitCode !== null) {
    summary.exitCode = iteration.exitCode;
  }

  if (iteration.lastPollIntervalSeconds !== null) {
    summary.lastPollIntervalSeconds = iteration.lastPollIntervalSeconds;
  }

  if (iteration.lastServerTime !== null) {
    summary.lastServerTime = iteration.lastServerTime;
  }
};

const unsafeSubmissionError = (): RunnerError =>
  new RunnerError({
    category: "usage",
    userSafeMessage: "Runner protocol submission payload is not safe to send.",
  });

const hasUnsafeProtocolSubmissionPayload = (
  value: unknown,
  keyPath: string[] = [],
  seen: WeakSet<object> = new WeakSet(),
): boolean => {
  if (typeof value === "string") {
    return hasUnsafeProtocolSubmissionText(value) || isUnsafePathValue(value, keyPath);
  }

  if (typeof value !== "object" || value === null) {
    return false;
  }

  if (seen.has(value)) {
    return false;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    return value.some((item) => hasUnsafeProtocolSubmissionPayload(item, keyPath, seen));
  }

  return Object.entries(value).some(([key, childValue]) => {
    if (isUnsafeProtocolSubmissionKey(key)) {
      return true;
    }

    return hasUnsafeProtocolSubmissionPayload(childValue, [...keyPath, key], seen);
  });
};

const UNSAFE_SUBMISSION_KEYS = new Set([
  "code",
  "content",
  "contents",
  "diff",
  "filecontent",
  "filecontents",
  "patch",
  "rawlog",
  "rawlogs",
  "rawoutput",
  "rawstderr",
  "rawstdout",
  "snippet",
  "snippets",
  "source",
  "sourcecode",
  "sourcecontent",
  "stderr",
  "stdout",
]);

const RAW_LOG_KEY_PATTERN =
  /^(?:raw|full|unredacted)?(?:stdout|stderr|output|log|logs)(?:text|content|contents|body|data|blob|value|line|lines)?$/;

const SOURCE_PAYLOAD_KEY_PATTERN =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|line|lines)?$/;

const isUnsafeProtocolSubmissionKey = (key: string): boolean => {
  const normalizedKey = normalizeKey(key);

  return (
    UNSAFE_SUBMISSION_KEYS.has(normalizedKey) ||
    RAW_LOG_KEY_PATTERN.test(normalizedKey) ||
    SOURCE_PAYLOAD_KEY_PATTERN.test(normalizedKey)
  );
};

const normalizeKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const hasUnsafeProtocolSubmissionText = (value: string): boolean =>
  hasUnsafeFreeTextControlCharacter(value) ||
  isRealEnvPath(value) ||
  UNSAFE_SUBMISSION_TEXT_PATTERNS.some((pattern) => pattern.test(value));

const hasUnsafeLocalAbsolutePathText = (value: string): boolean =>
  LOCAL_ABSOLUTE_PATH_TEXT_PATTERN.test(value.replace(/\\/g, "/"));

const LOCAL_ABSOLUTE_PATH_TEXT_PATTERN = /(^|[\s"'(:=,])(?:~\/|\/(?!\/)[^\s'"<>]+|[A-Za-z]:\/)/i;

const UNSAFE_SUBMISSION_TEXT_PATTERNS = [
  /(^|\n)diff --git\b/i,
  /(^|\n)\*\*\* Begin Patch\b/i,
  /(^|\n)@@\s+-\d/i,
  /(^|\n)(?:---|\+\+\+) [ab]\//i,
  /(^|\n)\s*(?:import|export|const|let|var|function|class|type|interface|enum)\b/i,
  /(^|\n)\s*(?:async\s+)?function\s+[$A-Z_][\w$]*\s*\(/i,
  /(^|\n)\s*(?:const|let|var)\s+[$A-Z_][\w$]*\s*(?::[^=\n]+)?=/i,
  /(^|\n)\s*(?:async\s+)?def\s+[$A-Z_][\w$]*\s*\([^)]*\)\s*:/i,
  /(^|\n)\s*class\s+[$A-Z_][\w$]*(?:\([^)]*\))?\s*:/i,
  /(^|\n)\s*(?:return|throw|yield)\b[^\n]*;?\s*(?=\n|$)/i,
  /```[^\n]*\n/i,
  /\b(?:raw\s+)?(?:stdout|stderr|output|log|logs)\s*:/i,
  /\b(?:raw|full|unredacted)\s+(?:command\s+)?(?:output|log)s?\b/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/i,
  /\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+(?::[^\s/@]*)?@[^\s)'"<>]+/i,
  /\b(?:[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|PASSWD|PRIVATE[_-]?KEY)[A-Z0-9_]*|password)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s'";,)]+/i,
  /\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-][A-Za-z0-9._~+/=-]{7,}\b/i,
  /\bgithub_pat_[A-Za-z0-9_]{12,}\b/i,
  /\bgh[pousr]_[A-Za-z0-9_]{12,}\b/i,
  /\blin_api_[A-Za-z0-9_]{12,}\b/i,
  /\bsk-[A-Za-z0-9_-]{12,}\b/i,
  /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/,
] as const;

const hasUnsafeFreeTextControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (
      codePoint !== undefined &&
      (codePoint === 127 ||
        (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13))
    ) {
      return true;
    }
  }

  return false;
};

const hasControlCharacter = (value: string): boolean => {
  for (const character of value) {
    const codePoint = character.codePointAt(0);

    if (codePoint !== undefined && (codePoint < 32 || codePoint === 127)) {
      return true;
    }
  }

  return false;
};

const isUnsafePathValue = (value: string, keyPath: string[]): boolean => {
  const parentKey = keyPath[keyPath.length - 1];

  if (parentKey === undefined) {
    return false;
  }

  const normalizedParentKey = normalizeKey(parentKey);

  if (normalizedParentKey !== "paths" && normalizedParentKey !== "changedfilepaths") {
    return false;
  }

  const normalizedValue = value.replace(/\\/g, "/");

  return (
    hasControlCharacter(value) ||
    normalizedValue.startsWith("/") ||
    /^[A-Za-z]:\//.test(normalizedValue) ||
    normalizedValue.split("/").some((segment) => segment === "..") ||
    isRealEnvPath(normalizedValue)
  );
};

const isRealEnvPath = (value: string): boolean => {
  const segments = value
    .replace(/\\/g, "/")
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => segment.toLowerCase());

  return segments.some((segment) => {
    if (segment === ".env.example") {
      return false;
    }

    return (
      segment === ".env" ||
      segment.startsWith(".env.") ||
      segment === "local.env" ||
      segment.endsWith(".local.env")
    );
  });
};

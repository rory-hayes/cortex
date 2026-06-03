import { z } from "zod";

import { DryRunResultSchema } from "./dry-run-result.js";
import { RiskFindingSchema } from "./risk.js";
import { RunEventMetadataSchema, RunEventSeveritySchema } from "./run-event.js";
import { RunStateSchema } from "./run-state.js";
import { RunnerCapabilitiesSchema } from "./runner-capabilities.js";
import { TaskPacketSchema } from "./task-packet.js";
import { ValidationResultSchema } from "./validation-result.js";
import { CONTRACT_VERSION } from "./version.js";

const NonEmptyStringSchema = z.string().min(1);
const PositiveIntegerSchema = z.number().int().positive();
const NonNegativeIntegerSchema = z.number().int().nonnegative();

const UNSAFE_PROTOCOL_METADATA_KEYS = new Set([
  "diff",
  "patch",
  "source",
  "code",
  "sourcecode",
  "sourcecontent",
  "content",
  "contents",
  "snippet",
  "snippets",
  "filecontent",
  "filecontents",
]);

const RAW_PAYLOAD_METADATA_KEY_PATTERN =
  /^(?:raw|full|unified|git)?(?:diff|patch|source|code)(?:text|content|contents|snippet|snippets|filecontent|filecontents|body|data|blob|value|code|line|lines)?$/;

const RAW_LOG_METADATA_KEY_PATTERN =
  /^(?:raw|full)?(?:stdout|stderr|output|log|logs)(?:text|content|contents|body|data|blob|value|line|lines)?$/;

const normalizeProtocolMetadataKey = (key: string): string =>
  key
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");

const isUnsafeProtocolMetadataKey = (key: string): boolean => {
  const normalizedKey = normalizeProtocolMetadataKey(key);

  return (
    UNSAFE_PROTOCOL_METADATA_KEYS.has(normalizedKey) ||
    RAW_PAYLOAD_METADATA_KEY_PATTERN.test(normalizedKey) ||
    RAW_LOG_METADATA_KEY_PATTERN.test(normalizedKey)
  );
};

const addUnsafeProtocolMetadataKeyIssues = (
  value: unknown,
  context: z.RefinementCtx,
  path: (string | number)[] = [],
  seen: WeakSet<object> = new WeakSet(),
) => {
  if (typeof value !== "object" || value === null) {
    return;
  }

  if (seen.has(value)) {
    return;
  }
  seen.add(value);

  if (Array.isArray(value)) {
    value.forEach((item, index) =>
      addUnsafeProtocolMetadataKeyIssues(item, context, [...path, index], seen),
    );
    return;
  }

  for (const [key, childValue] of Object.entries(value as Record<string, unknown>)) {
    const childPath = [...path, key];
    if (isUnsafeProtocolMetadataKey(key)) {
      context.addIssue({
        code: "custom",
        message: `Run event protocol metadata cannot include unsafe key "${key}".`,
        path: childPath,
      });
    }

    addUnsafeProtocolMetadataKeyIssues(childValue, context, childPath, seen);
  }
};

const SubmitRunEventMetadataSchema = RunEventMetadataSchema.superRefine((metadata, context) => {
  addUnsafeProtocolMetadataKeyIssues(metadata, context);
});

export const RUNNER_PROTOCOL_ENDPOINTS = {
  linkRunner: "/runner/link",
  heartbeat: "/runner/heartbeat",
  pollJobs: "/runner/jobs/poll",
  claimJob: "/runner/jobs/claim",
  submitRunEvent: "/runner/runs/events",
  submitDryRunResult: "/runner/runs/dry-run-result",
  submitValidationResult: "/runner/runs/validation-result",
  submitPrArtifact: "/runner/runs/pr-artifact",
} as const;

export type RunnerProtocolEndpointName = keyof typeof RUNNER_PROTOCOL_ENDPOINTS;
export type RunnerProtocolEndpoint = (typeof RUNNER_PROTOCOL_ENDPOINTS)[RunnerProtocolEndpointName];

export const RUNNER_HEARTBEAT_STATUSES = ["idle", "busy", "offline"] as const;

export const RunnerHeartbeatStatusSchema = z.enum(RUNNER_HEARTBEAT_STATUSES);
export type RunnerHeartbeatStatus = z.infer<typeof RunnerHeartbeatStatusSchema>;

export const RUNNER_JOB_TYPES = ["task", "repair"] as const;

export const RunnerJobTypeSchema = z.enum(RUNNER_JOB_TYPES);
export type RunnerJobType = z.infer<typeof RunnerJobTypeSchema>;

export const CLAIM_JOB_STATUSES = ["claimed", "already_claimed", "conflict", "not_found"] as const;

export const ClaimJobStatusSchema = z.enum(CLAIM_JOB_STATUSES);
export type ClaimJobStatus = z.infer<typeof ClaimJobStatusSchema>;

export const PR_ARTIFACT_STATUSES = ["draft", "open", "closed", "merged"] as const;

export const PrArtifactStatusSchema = z.enum(PR_ARTIFACT_STATUSES);
export type PrArtifactStatus = z.infer<typeof PrArtifactStatusSchema>;

export const createClaimJobIdempotencyKey = ({
  runnerId,
  jobId,
  runId,
}: {
  runnerId: string;
  jobId: string;
  runId: string;
}): string => `runner:${runnerId}:claim:${jobId}:${runId}`;

export const CancellationRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: NonEmptyStringSchema,
    requestedByActorId: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    requestedAt: NonEmptyStringSchema,
  })
  .strict();

export type CancellationRequest = z.infer<typeof CancellationRequestSchema>;

export const RepairRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: NonEmptyStringSchema,
    requestedByActorId: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    taskPacket: TaskPacketSchema,
    requestedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.taskPacket.runId !== request.runId) {
      context.addIssue({
        code: "custom",
        message: "Repair request runId must match taskPacket.runId.",
        path: ["taskPacket", "runId"],
      });
    }

    if (request.taskPacket.mode !== "repair") {
      context.addIssue({
        code: "custom",
        message: "Repair requests require a repair-mode task packet.",
        path: ["taskPacket", "mode"],
      });
    }
  });

export type RepairRequest = z.infer<typeof RepairRequestSchema>;

export const CloseRunRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: NonEmptyStringSchema,
    closedByActorId: NonEmptyStringSchema,
    reason: NonEmptyStringSchema,
    closedAt: NonEmptyStringSchema,
  })
  .strict();

export type CloseRunRequest = z.infer<typeof CloseRunRequestSchema>;

export const LinkRunnerRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    pairingCode: NonEmptyStringSchema,
    capabilities: RunnerCapabilitiesSchema,
    requestedAt: NonEmptyStringSchema,
  })
  .strict();

export type LinkRunnerRequest = z.infer<typeof LinkRunnerRequestSchema>;

export const LinkRunnerResponseSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    workspaceId: NonEmptyStringSchema,
    runnerCredential: NonEmptyStringSchema,
    pollingBaseUrl: NonEmptyStringSchema,
    pollIntervalSeconds: PositiveIntegerSchema,
    linkedAt: NonEmptyStringSchema,
  })
  .strict();

export type LinkRunnerResponse = z.infer<typeof LinkRunnerResponseSchema>;

export const HeartbeatRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    status: RunnerHeartbeatStatusSchema,
    currentRunId: NonEmptyStringSchema.nullable(),
    capabilities: RunnerCapabilitiesSchema,
    timestamp: NonEmptyStringSchema,
  })
  .strict();

export type HeartbeatRequest = z.infer<typeof HeartbeatRequestSchema>;

export const HeartbeatResponseSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    serverTime: NonEmptyStringSchema,
    pollIntervalSeconds: PositiveIntegerSchema,
    cancellation: CancellationRequestSchema.optional(),
    repair: RepairRequestSchema.optional(),
    close: CloseRunRequestSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const instructionCount = [response.cancellation, response.repair, response.close].filter(
      Boolean,
    ).length;

    if (instructionCount > 1) {
      context.addIssue({
        code: "custom",
        message: "Heartbeat responses may include at most one control instruction.",
        path: [],
      });
    }
  });

export type HeartbeatResponse = z.infer<typeof HeartbeatResponseSchema>;

export const RunnerJobSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    jobId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    type: RunnerJobTypeSchema,
    taskPacket: TaskPacketSchema,
    queuedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((job, context) => {
    if (job.taskPacket.runId !== job.runId) {
      context.addIssue({
        code: "custom",
        message: "Runner job runId must match taskPacket.runId.",
        path: ["taskPacket", "runId"],
      });
    }

    if (job.type === "repair" && job.taskPacket.mode !== "repair") {
      context.addIssue({
        code: "custom",
        message: "Repair runner jobs require repair-mode task packets.",
        path: ["taskPacket", "mode"],
      });
    }

    if (job.type === "task" && job.taskPacket.mode === "repair") {
      context.addIssue({
        code: "custom",
        message: "Task runner jobs must not carry repair-mode task packets.",
        path: ["taskPacket", "mode"],
      });
    }
  });

export type RunnerJob = z.infer<typeof RunnerJobSchema>;

export const PollJobsRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    capabilities: RunnerCapabilitiesSchema,
    availableConcurrency: NonNegativeIntegerSchema,
    knownCurrentRunIds: z.array(NonEmptyStringSchema),
  })
  .strict();

export type PollJobsRequest = z.infer<typeof PollJobsRequestSchema>;

export const PollJobsResponseSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    jobs: z.array(RunnerJobSchema),
    pollIntervalSeconds: PositiveIntegerSchema,
    serverTime: NonEmptyStringSchema,
    cancellation: CancellationRequestSchema.optional(),
  })
  .strict();

export type PollJobsResponse = z.infer<typeof PollJobsResponseSchema>;

export const ClaimJobRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    jobId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    idempotencyKey: NonEmptyStringSchema,
    capabilitiesSnapshot: RunnerCapabilitiesSchema,
  })
  .strict()
  .superRefine((request, context) => {
    const expectedKey = createClaimJobIdempotencyKey({
      runnerId: request.runnerId,
      jobId: request.jobId,
      runId: request.runId,
    });

    if (request.idempotencyKey !== expectedKey) {
      context.addIssue({
        code: "custom",
        message: "Claim job idempotency key must use the canonical runner claim format.",
        path: ["idempotencyKey"],
      });
    }
  });

export type ClaimJobRequest = z.infer<typeof ClaimJobRequestSchema>;

export const ClaimJobResponseSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    jobId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    status: ClaimJobStatusSchema,
    claimedByRunnerId: NonEmptyStringSchema.optional(),
    claimExpiresAt: NonEmptyStringSchema.optional(),
    conflictReason: NonEmptyStringSchema.optional(),
  })
  .strict();

export type ClaimJobResponse = z.infer<typeof ClaimJobResponseSchema>;

export const SubmitRunEventRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runId: NonEmptyStringSchema,
    runnerId: NonEmptyStringSchema.optional(),
    eventId: NonEmptyStringSchema,
    idempotencyKey: NonEmptyStringSchema,
    state: RunStateSchema,
    severity: RunEventSeveritySchema,
    message: NonEmptyStringSchema,
    metadata: SubmitRunEventMetadataSchema,
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export type SubmitRunEventRequest = z.infer<typeof SubmitRunEventRequestSchema>;

export const SubmitDryRunResultRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    result: DryRunResultSchema,
    submittedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.result.runId !== request.runId) {
      context.addIssue({
        code: "custom",
        message: "Dry-run result runId must match request runId.",
        path: ["result", "runId"],
      });
    }
  });

export type SubmitDryRunResultRequest = z.infer<typeof SubmitDryRunResultRequestSchema>;

export const SubmitValidationResultRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    result: ValidationResultSchema,
    submittedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.result.runId !== request.runId) {
      context.addIssue({
        code: "custom",
        message: "Validation result runId must match request runId.",
        path: ["result", "runId"],
      });
    }
  });

export type SubmitValidationResultRequest = z.infer<typeof SubmitValidationResultRequestSchema>;

export const PrArtifactSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    id: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    repository: z
      .object({
        owner: NonEmptyStringSchema,
        name: NonEmptyStringSchema,
      })
      .strict(),
    branchName: NonEmptyStringSchema,
    prNumber: PositiveIntegerSchema,
    prUrl: NonEmptyStringSchema,
    prTitle: NonEmptyStringSchema,
    prStatus: PrArtifactStatusSchema,
    changedFilePaths: z.array(NonEmptyStringSchema),
    riskFindings: z.array(RiskFindingSchema),
    createdAt: NonEmptyStringSchema,
  })
  .strict();

export type PrArtifact = z.infer<typeof PrArtifactSchema>;

export const SubmitPrArtifactRequestSchema = z
  .object({
    contractVersion: z.literal(CONTRACT_VERSION),
    runnerId: NonEmptyStringSchema,
    runId: NonEmptyStringSchema,
    artifact: PrArtifactSchema,
    submittedAt: NonEmptyStringSchema,
  })
  .strict()
  .superRefine((request, context) => {
    if (request.artifact.runId !== request.runId) {
      context.addIssue({
        code: "custom",
        message: "PR artifact runId must match request runId.",
        path: ["artifact", "runId"],
      });
    }
  });

export type SubmitPrArtifactRequest = z.infer<typeof SubmitPrArtifactRequestSchema>;

export const RunnerProtocolRequestSchema = z.union([
  LinkRunnerRequestSchema,
  HeartbeatRequestSchema,
  PollJobsRequestSchema,
  ClaimJobRequestSchema,
  SubmitRunEventRequestSchema,
  SubmitDryRunResultRequestSchema,
  SubmitValidationResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  CancellationRequestSchema,
  RepairRequestSchema,
  CloseRunRequestSchema,
]);

export type RunnerProtocolRequest = z.infer<typeof RunnerProtocolRequestSchema>;

export const RunnerProtocolResponseSchema = z.union([
  LinkRunnerResponseSchema,
  HeartbeatResponseSchema,
  PollJobsResponseSchema,
  ClaimJobResponseSchema,
]);

export type RunnerProtocolResponse = z.infer<typeof RunnerProtocolResponseSchema>;

export const RunnerProtocolSchema = z.union([
  LinkRunnerRequestSchema,
  LinkRunnerResponseSchema,
  HeartbeatRequestSchema,
  HeartbeatResponseSchema,
  PollJobsRequestSchema,
  PollJobsResponseSchema,
  ClaimJobRequestSchema,
  ClaimJobResponseSchema,
  SubmitRunEventRequestSchema,
  SubmitDryRunResultRequestSchema,
  SubmitValidationResultRequestSchema,
  SubmitPrArtifactRequestSchema,
  CancellationRequestSchema,
  RepairRequestSchema,
  CloseRunRequestSchema,
]);

export type RunnerProtocol = z.infer<typeof RunnerProtocolSchema>;

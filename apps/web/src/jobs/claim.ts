import { and, eq, exists, isNull, schema, type Database } from "@control-plane/db";
import {
  ClaimJobRequestSchema,
  ClaimJobResponseSchema,
  CONTRACT_VERSION,
  RunEventSchema,
  TaskPacketSchema,
  createRunEventIdempotencyKey,
  type ClaimJobRequest,
  type ClaimJobResponse,
  type RiskFinding,
  type RunEvent,
  type RunnerCapabilities,
  type TaskPacket,
} from "@control-plane/shared";

import {
  createMissingMappingRiskFinding,
  withMissingMappingRiskFinding,
} from "./missing-mapping.js";
import { createUsageEventInsert } from "../billing/usage-events.js";
import { incrementWorkspaceUsageForClaim } from "../billing/usage.js";

export const RUNNER_JOB_CLAIM_TTL_MS = 15 * 60 * 1000;

type DatabaseRunRow = typeof schema.runs.$inferSelect;
type DatabaseRepoMappingRow = typeof schema.repoMappings.$inferSelect;

export type ClaimRunRow = Pick<
  DatabaseRunRow,
  | "capabilitiesSnapshot"
  | "claimExpiresAt"
  | "claimIdempotencyKey"
  | "claimedAt"
  | "id"
  | "jobId"
  | "repoMappingId"
  | "riskFindings"
  | "runnerId"
  | "state"
  | "taskPacket"
  | "updatedAt"
  | "workspaceId"
> &
  Partial<DatabaseRunRow>;

type ClaimRepoMappingRow = Pick<
  DatabaseRepoMappingRow,
  "archivedAt" | "defaultBranch" | "id" | "localPath" | "runnerId" | "workspaceId"
>;

export type ClaimRunInput = {
  capabilitiesSnapshot: RunnerCapabilities;
  claimExpiresAt: Date;
  claimedAt: Date;
  idempotencyKey: string;
  jobId: string;
  missingMappingFinding: RiskFinding;
  runId: string;
  runnerId: string;
  updatedAt: Date;
  workspaceId: string;
};

export type ClaimRunResult =
  | {
      run: ClaimRunRow;
      status: "claimed";
    }
  | {
      run: ClaimRunRow;
      status: "blocked_missing_mapping";
    }
  | {
      run: ClaimRunRow | null;
      status: "miss";
    };

export type DuplicateAssignmentBlockInput = {
  event: RunEvent;
  workspaceId: string;
};

export type ClaimJobContext = {
  runnerId: string;
  workspaceId: string;
};

export type ClaimJobStore = {
  claimRun: (input: ClaimRunInput) => Promise<ClaimRunResult>;
  recordDuplicateAssignmentBlock: (input: DuplicateAssignmentBlockInput) => Promise<void>;
};

export type ClaimJobService = {
  claimJob: (input: { context: ClaimJobContext; request: unknown }) => Promise<ClaimJobResponse>;
};

export class ClaimJobRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor() {
    super("Invalid claim job request.");
    this.name = "ClaimJobRequestError";
  }
}

export const isClaimJobRequestError = (error: unknown): error is ClaimJobRequestError =>
  error instanceof ClaimJobRequestError;

const parseClaimJobRequest = (request: unknown): ClaimJobRequest => {
  const parsedRequest = ClaimJobRequestSchema.safeParse(request);

  if (!parsedRequest.success) {
    throw new ClaimJobRequestError();
  }

  return parsedRequest.data;
};

const toIsoTimestamp = (value: Date | string | null | undefined): string | undefined => {
  if (value === null || value === undefined) {
    return undefined;
  }

  const date = value instanceof Date ? value : new Date(value);

  if (Number.isNaN(date.getTime())) {
    return undefined;
  }

  return date.toISOString();
};

const createBaseResponse = (
  request: ClaimJobRequest,
  status: ClaimJobResponse["status"],
): ClaimJobResponse =>
  ClaimJobResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobId: request.jobId,
    runId: request.runId,
    status,
  });

const createClaimedResponse = (
  request: ClaimJobRequest,
  row: ClaimRunRow,
  status: "already_claimed" | "claimed",
): ClaimJobResponse => {
  const claimExpiresAt = toIsoTimestamp(row.claimExpiresAt);

  return ClaimJobResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobId: request.jobId,
    runId: request.runId,
    status,
    ...(row.runnerId === null ? {} : { claimedByRunnerId: row.runnerId }),
    ...(claimExpiresAt === undefined ? {} : { claimExpiresAt }),
  });
};

const createConflictResponse = (request: ClaimJobRequest, run: ClaimRunRow): ClaimJobResponse =>
  ClaimJobResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    conflictReason: getClaimConflictReason(run),
    jobId: request.jobId,
    runId: request.runId,
    status: "conflict",
  });

const getClaimConflictReason = (run: ClaimRunRow): "already_claimed" | "not_claimable" =>
  run.state === "claimed" || run.claimIdempotencyKey !== null ? "already_claimed" : "not_claimable";

const isSameClaimRetry = (request: ClaimJobRequest, row: ClaimRunRow): boolean =>
  row.runnerId === request.runnerId && row.claimIdempotencyKey === request.idempotencyKey;

const createDuplicateAssignmentBlockEvent = ({
  conflictReason,
  createdAt,
  request,
  run,
}: {
  conflictReason: "already_claimed" | "not_claimable";
  createdAt: Date;
  request: ClaimJobRequest;
  run: ClaimRunRow;
}): RunEvent =>
  RunEventSchema.parse({
    contractVersion: CONTRACT_VERSION,
    id: `run:${request.runId}:event:duplicate_assignment:${request.runnerId}:1`,
    idempotencyKey: createRunEventIdempotencyKey({
      attempt: 1,
      runId: request.runId,
      stableStepName: `duplicate_assignment:${request.runnerId}`,
    }),
    runId: request.runId,
    runnerId: request.runnerId,
    state: "blocked",
    severity: "blocked",
    message: "Duplicate assignment blocked.",
    metadata: {
      ...(run.runnerId === null ? {} : { claimedByRunnerId: run.runnerId }),
      claimingRunnerId: request.runnerId,
      conflictReason,
      jobId: request.jobId,
      riskCategory: "duplicate_assignment",
    },
    createdAt: createdAt.toISOString(),
  });

const hasUsableMappingMetadata = (
  mapping: ClaimRepoMappingRow,
): mapping is ClaimRepoMappingRow & {
  defaultBranch: string;
  localPath: string;
  runnerId: string;
} =>
  mapping.archivedAt === null &&
  typeof mapping.defaultBranch === "string" &&
  mapping.defaultBranch.trim().length > 0 &&
  typeof mapping.localPath === "string" &&
  mapping.localPath.trim().length > 0 &&
  typeof mapping.runnerId === "string" &&
  mapping.runnerId.trim().length > 0;

const parseClaimTaskPacket = (taskPacket: unknown): TaskPacket | null => {
  const parsedPacket = TaskPacketSchema.safeParse(taskPacket);

  return parsedPacket.success ? parsedPacket.data : null;
};

const taskPacketMatchesRepoMapping = (
  run: ClaimRunRow,
  taskPacket: TaskPacket,
  mapping: ClaimRepoMappingRow & {
    defaultBranch: string;
    localPath: string;
    runnerId: string;
  },
): boolean =>
  taskPacket.runId === run.id &&
  (taskPacket.workspaceId === undefined || taskPacket.workspaceId === run.workspaceId) &&
  taskPacket.repo.localPath === mapping.localPath &&
  taskPacket.repo.defaultBranch === mapping.defaultBranch;

const mappingBelongsToAnotherActiveRunner = (
  mapping: ClaimRepoMappingRow,
  runnerId: string,
): boolean => hasUsableMappingMetadata(mapping) && mapping.runnerId !== runnerId;

export const createClaimJobService = (input: {
  now?: () => Date;
  store: ClaimJobStore;
}): ClaimJobService => {
  const now = input.now ?? (() => new Date());

  return {
    claimJob: async ({ context, request }) => {
      const parsedRequest = parseClaimJobRequest(request);

      if (parsedRequest.runnerId !== context.runnerId) {
        throw new ClaimJobRequestError();
      }

      if (
        parsedRequest.capabilitiesSnapshot.runnerId !== undefined &&
        parsedRequest.capabilitiesSnapshot.runnerId !== context.runnerId
      ) {
        throw new ClaimJobRequestError();
      }

      const claimedAt = now();
      const claimResult = await input.store.claimRun({
        capabilitiesSnapshot: parsedRequest.capabilitiesSnapshot,
        claimExpiresAt: new Date(claimedAt.getTime() + RUNNER_JOB_CLAIM_TTL_MS),
        claimedAt,
        idempotencyKey: parsedRequest.idempotencyKey,
        jobId: parsedRequest.jobId,
        missingMappingFinding: createMissingMappingRiskFinding(),
        runId: parsedRequest.runId,
        runnerId: context.runnerId,
        updatedAt: claimedAt,
        workspaceId: context.workspaceId,
      });

      if (claimResult.status === "claimed") {
        return createClaimedResponse(parsedRequest, claimResult.run, "claimed");
      }

      if (claimResult.status === "blocked_missing_mapping") {
        return createConflictResponse(parsedRequest, claimResult.run);
      }

      if (claimResult.run === null) {
        return createBaseResponse(parsedRequest, "not_found");
      }

      if (isSameClaimRetry(parsedRequest, claimResult.run)) {
        return createClaimedResponse(parsedRequest, claimResult.run, "already_claimed");
      }

      const conflictReason = getClaimConflictReason(claimResult.run);
      await input.store.recordDuplicateAssignmentBlock({
        event: createDuplicateAssignmentBlockEvent({
          conflictReason,
          createdAt: claimedAt,
          request: parsedRequest,
          run: claimResult.run,
        }),
        workspaceId: context.workspaceId,
      });

      return createConflictResponse(parsedRequest, claimResult.run);
    },
  };
};

const claimRunReturning = {
  capabilitiesSnapshot: schema.runs.capabilitiesSnapshot,
  claimExpiresAt: schema.runs.claimExpiresAt,
  claimIdempotencyKey: schema.runs.claimIdempotencyKey,
  claimedAt: schema.runs.claimedAt,
  id: schema.runs.id,
  jobId: schema.runs.jobId,
  repoMappingId: schema.runs.repoMappingId,
  riskFindings: schema.runs.riskFindings,
  runnerId: schema.runs.runnerId,
  state: schema.runs.state,
  taskPacket: schema.runs.taskPacket,
  updatedAt: schema.runs.updatedAt,
  workspaceId: schema.runs.workspaceId,
};

const claimRepoMappingReturning = {
  archivedAt: schema.repoMappings.archivedAt,
  defaultBranch: schema.repoMappings.defaultBranch,
  id: schema.repoMappings.id,
  localPath: schema.repoMappings.localPath,
  runnerId: schema.repoMappings.runnerId,
  workspaceId: schema.repoMappings.workspaceId,
};

export const createDrizzleClaimJobStore = (db: Database): ClaimJobStore => ({
  claimRun: async (input) =>
    db.transaction(async (tx) => {
      const [existingRun] = await tx
        .select(claimRunReturning)
        .from(schema.runs)
        .where(
          and(
            eq(schema.runs.workspaceId, input.workspaceId),
            eq(schema.runs.id, input.runId),
            eq(schema.runs.jobId, input.jobId),
          ),
        )
        .limit(1);

      if (existingRun === undefined) {
        return {
          run: null,
          status: "miss",
        };
      }

      if (existingRun.state !== "queued" || existingRun.claimIdempotencyKey !== null) {
        return {
          run: existingRun,
          status: "miss",
        };
      }

      const [repoMapping] = await tx
        .select(claimRepoMappingReturning)
        .from(schema.repoMappings)
        .where(
          and(
            eq(schema.repoMappings.workspaceId, input.workspaceId),
            eq(schema.repoMappings.id, existingRun.repoMappingId),
          ),
        )
        .limit(1);

      if (
        repoMapping !== undefined &&
        mappingBelongsToAnotherActiveRunner(repoMapping, input.runnerId)
      ) {
        return {
          run: existingRun,
          status: "miss",
        };
      }

      const taskPacket = parseClaimTaskPacket(existingRun.taskPacket);
      const isEligibleMapping =
        repoMapping !== undefined &&
        repoMapping.workspaceId === input.workspaceId &&
        hasUsableMappingMetadata(repoMapping) &&
        repoMapping.runnerId === input.runnerId &&
        taskPacket !== null &&
        taskPacketMatchesRepoMapping(existingRun, taskPacket, repoMapping);

      if (!isEligibleMapping) {
        const [blockedRun] = await tx
          .update(schema.runs)
          .set({
            riskFindings: withMissingMappingRiskFinding(
              existingRun.riskFindings,
              input.missingMappingFinding,
            ),
            state: "blocked",
            updatedAt: input.updatedAt,
          })
          .where(
            and(
              eq(schema.runs.workspaceId, input.workspaceId),
              eq(schema.runs.id, input.runId),
              eq(schema.runs.jobId, input.jobId),
              eq(schema.runs.state, "queued"),
              isNull(schema.runs.claimIdempotencyKey),
            ),
          )
          .returning(claimRunReturning);

        if (blockedRun !== undefined) {
          return {
            run: blockedRun,
            status: "blocked_missing_mapping",
          };
        }

        return {
          run: existingRun,
          status: "miss",
        };
      }

      const [claimedRun] = await tx
        .update(schema.runs)
        .set({
          capabilitiesSnapshot: input.capabilitiesSnapshot,
          claimExpiresAt: input.claimExpiresAt,
          claimIdempotencyKey: input.idempotencyKey,
          claimedAt: input.claimedAt,
          runnerId: input.runnerId,
          state: "claimed",
          updatedAt: input.updatedAt,
        })
        .where(
          and(
            eq(schema.runs.workspaceId, input.workspaceId),
            eq(schema.runs.id, input.runId),
            eq(schema.runs.jobId, input.jobId),
            eq(schema.runs.state, "queued"),
            isNull(schema.runs.claimIdempotencyKey),
            exists(
              tx
                .select({ id: schema.repoMappings.id })
                .from(schema.repoMappings)
                .where(
                  and(
                    eq(schema.repoMappings.workspaceId, input.workspaceId),
                    eq(schema.repoMappings.id, schema.runs.repoMappingId),
                    eq(schema.repoMappings.runnerId, input.runnerId),
                    isNull(schema.repoMappings.archivedAt),
                    eq(schema.repoMappings.localPath, taskPacket.repo.localPath),
                    eq(schema.repoMappings.defaultBranch, taskPacket.repo.defaultBranch),
                  ),
                ),
            ),
          ),
        )
        .returning(claimRunReturning);

      if (claimedRun !== undefined) {
        if (taskPacket.mode !== "dryRun") {
          const usageSnapshot = await incrementWorkspaceUsageForClaim(tx, {
            updatedAt: input.updatedAt,
            workspaceId: input.workspaceId,
          });

          if (usageSnapshot === null) {
            throw new Error("Workspace usage row was not found for claimed run.");
          }

          await tx
            .insert(schema.usageEvents)
            .values(
              createUsageEventInsert({
                createdAt: input.claimedAt,
                idempotencyKey: `usage:${input.workspaceId}:runner_execution:${claimedRun.id}`,
                metadata: {
                  mode: taskPacket.mode,
                },
                occurredAt: input.claimedAt,
                source: {
                  id: claimedRun.id,
                  table: "runs",
                },
                usageEventType: "runner_execution",
                workspaceId: input.workspaceId,
              }),
            )
            .onConflictDoNothing({
              target: [schema.usageEvents.workspaceId, schema.usageEvents.idempotencyKey],
            });
        }

        return {
          run: claimedRun,
          status: "claimed",
        };
      }

      const [currentRun] = await tx
        .select(claimRunReturning)
        .from(schema.runs)
        .where(
          and(
            eq(schema.runs.workspaceId, input.workspaceId),
            eq(schema.runs.id, input.runId),
            eq(schema.runs.jobId, input.jobId),
          ),
        )
        .limit(1);

      return {
        run: currentRun ?? null,
        status: "miss",
      };
    }),
  recordDuplicateAssignmentBlock: async ({ event, workspaceId }) => {
    const parsedEvent = RunEventSchema.parse(event);

    await db
      .insert(schema.runEvents)
      .values({
        contractVersion: parsedEvent.contractVersion,
        createdAt: new Date(parsedEvent.createdAt),
        id: parsedEvent.id,
        idempotencyKey: parsedEvent.idempotencyKey,
        message: parsedEvent.message,
        metadata: parsedEvent.metadata,
        runId: parsedEvent.runId,
        runnerId: parsedEvent.runnerId,
        severity: parsedEvent.severity,
        state: parsedEvent.state,
        workspaceId,
      })
      .onConflictDoNothing({
        target: [schema.runEvents.runId, schema.runEvents.idempotencyKey],
      });
  },
});

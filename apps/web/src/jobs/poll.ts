import { and, eq, schema, type Database } from "@control-plane/db";
import {
  CONTRACT_VERSION,
  PollJobsRequestSchema,
  PollJobsResponseSchema,
  type CancellationRequest,
  type PollJobsRequest,
  type PollJobsResponse,
  type RiskFinding,
  type RunnerCapabilities,
  type RunnerJob,
  type ValidationCommand,
} from "@control-plane/shared";

import {
  createMissingMappingRiskFinding,
  withMissingMappingRiskFinding,
} from "./missing-mapping.js";
import {
  toCancellationInstruction,
  type CancellationInstructionRow,
} from "../runs/cancellation-instruction";
import { toRunnerJob, type ManualQueueRunRow } from "./manual-queue.js";

export const RUNNER_JOB_POLL_INTERVAL_SECONDS = 15;
export const RUNNER_POLL_MAX_JOBS = 1;

const POLL_CANDIDATE_LIMIT = 25;

type DatabaseRepoMappingRow = typeof schema.repoMappings.$inferSelect;

export type PollRepoMappingRow = {
  [Key in
    | "archivedAt"
    | "defaultBranch"
    | "id"
    | "localPath"
    | "runnerId"
    | "workspaceId"]: DatabaseRepoMappingRow[Key];
} & Partial<DatabaseRepoMappingRow>;

export type PollRunRow = ManualQueueRunRow &
  Pick<
    typeof schema.runs.$inferSelect,
    "claimExpiresAt" | "claimIdempotencyKey" | "claimedAt" | "runnerId"
  >;

export type PollCancellationLookup = {
  runnerId: string;
  runIds: string[];
  workspaceId: string;
};

export type PollCancellationRow = CancellationInstructionRow;

export type PollJobsContext = {
  runnerId: string;
  workspaceId: string;
};

export type PollJobsStore = {
  blockRunForMissingMapping: (input: {
    finding: RiskFinding;
    runId: string;
    updatedAt: Date;
    workspaceId: string;
  }) => Promise<void>;
  findCancellationForCurrentRuns: (
    input: PollCancellationLookup,
  ) => Promise<PollCancellationRow | null>;
  listRepoMappingsForWorkspace: (input: { workspaceId: string }) => Promise<PollRepoMappingRow[]>;
  listQueuedRuns: (input: {
    excludedRunIds: string[];
    limit: number;
    repoMappingIds?: string[];
    workspaceId: string;
  }) => Promise<PollRunRow[]>;
};

export type PollJobsService = {
  pollJobs: (input: { context: PollJobsContext; request: unknown }) => Promise<PollJobsResponse>;
};

export class PollJobsRequestError extends Error {
  readonly code = "invalid_request" as const;

  constructor() {
    super("Invalid poll jobs request.");
    this.name = "PollJobsRequestError";
  }
}

export const isPollJobsRequestError = (error: unknown): error is PollJobsRequestError =>
  error instanceof PollJobsRequestError;

const parsePollJobsRequest = (request: unknown): PollJobsRequest => {
  const parsedRequest = PollJobsRequestSchema.safeParse(request);

  if (!parsedRequest.success) {
    throw new PollJobsRequestError();
  }

  return parsedRequest.data;
};

type RunnerToolName = keyof RunnerCapabilities["tools"];

const INFERABLE_VALIDATION_TOOL_ALIASES: Readonly<Partial<Record<string, RunnerToolName>>> = {
  git: "git",
  gh: "gh",
  codex: "codex",
  node: "node",
  npm: "npm",
  pnpm: "pnpm",
  yarn: "yarn",
  python: "python",
  python3: "python",
};

const hasAvailableTool = (capabilities: RunnerCapabilities, toolName: RunnerToolName) =>
  capabilities.tools[toolName]?.available === true;

const requiresExecutionTools = (job: RunnerJob): boolean =>
  job.type === "repair" || job.taskPacket.mode === "execute" || job.taskPacket.mode === "repair";

const inferRequiredValidationTool = (command: ValidationCommand): RunnerToolName | null => {
  if (!command.required) {
    return null;
  }

  const executable = command.command
    .trim()
    .match(/^[^\s]+/)?.[0]
    ?.toLowerCase();

  if (executable === undefined) {
    return null;
  }

  return INFERABLE_VALIDATION_TOOL_ALIASES[executable] ?? null;
};

const hasRequiredValidationTools = (
  capabilities: RunnerCapabilities,
  commands: ValidationCommand[],
): boolean => {
  for (const command of commands) {
    const requiredTool = inferRequiredValidationTool(command);

    if (requiredTool !== null && !hasAvailableTool(capabilities, requiredTool)) {
      return false;
    }
  }

  return true;
};

const isRunnerCompatibleWithJob = (capabilities: RunnerCapabilities, job: RunnerJob): boolean => {
  if (!capabilities.supportsDryRun) {
    return false;
  }

  if (!hasAvailableTool(capabilities, "git")) {
    return false;
  }

  if (!hasRequiredValidationTools(capabilities, job.taskPacket.validation.commands)) {
    return false;
  }

  if (!requiresExecutionTools(job)) {
    return true;
  }

  return hasAvailableTool(capabilities, "codex") && hasAvailableTool(capabilities, "gh");
};

const createEmptyResponse = (input: {
  cancellation?: CancellationRequest;
  pollIntervalSeconds: number;
  serverTime: string;
}): PollJobsResponse =>
  PollJobsResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobs: [],
    pollIntervalSeconds: input.pollIntervalSeconds,
    serverTime: input.serverTime,
    ...(input.cancellation === undefined ? {} : { cancellation: input.cancellation }),
  });

const createResponse = (input: {
  jobs: RunnerJob[];
  pollIntervalSeconds: number;
  serverTime: string;
}): PollJobsResponse =>
  PollJobsResponseSchema.parse({
    contractVersion: CONTRACT_VERSION,
    jobs: input.jobs,
    pollIntervalSeconds: input.pollIntervalSeconds,
    serverTime: input.serverTime,
  });

const mapSafeRunnerJob = (row: PollRunRow): RunnerJob | null => {
  try {
    return toRunnerJob(row);
  } catch {
    return null;
  }
};

const isPacketlessRepairRun = (row: PollRunRow): boolean =>
  row.jobType === "repair" && row.taskPacket === null;

const hasUsableMappingMetadata = (
  mapping: PollRepoMappingRow,
): mapping is PollRepoMappingRow & {
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

const taskPacketMatchesRepoMapping = (job: RunnerJob, mapping: PollRepoMappingRow): boolean =>
  hasUsableMappingMetadata(mapping) &&
  job.taskPacket.repo.localPath === mapping.localPath &&
  job.taskPacket.repo.defaultBranch === mapping.defaultBranch;

const taskPacketMatchesWorkspace = (job: RunnerJob, workspaceId: string): boolean =>
  job.taskPacket.workspaceId === undefined || job.taskPacket.workspaceId === workspaceId;

const mappingBelongsToAnotherActiveRunner = (
  mapping: PollRepoMappingRow,
  runnerId: string,
): boolean => hasUsableMappingMetadata(mapping) && mapping.runnerId !== runnerId;

export const createPollJobsService = (input: {
  now?: () => Date;
  pollIntervalSeconds?: number;
  store: PollJobsStore;
}): PollJobsService => {
  const now = input.now ?? (() => new Date());
  const pollIntervalSeconds = input.pollIntervalSeconds ?? RUNNER_JOB_POLL_INTERVAL_SECONDS;

  return {
    pollJobs: async ({ context, request }) => {
      const parsedRequest = parsePollJobsRequest(request);
      const currentTime = now();
      const serverTime = currentTime.toISOString();

      if (parsedRequest.runnerId !== context.runnerId) {
        throw new PollJobsRequestError();
      }

      if (
        parsedRequest.capabilities.runnerId !== undefined &&
        parsedRequest.capabilities.runnerId !== context.runnerId
      ) {
        throw new PollJobsRequestError();
      }

      const cancellation =
        parsedRequest.knownCurrentRunIds.length === 0
          ? undefined
          : toCancellationInstruction(
              await input.store.findCancellationForCurrentRuns({
                runnerId: context.runnerId,
                runIds: parsedRequest.knownCurrentRunIds,
                workspaceId: context.workspaceId,
              }),
            );

      if (parsedRequest.knownCurrentRunIds.length > 0) {
        return cancellation === undefined
          ? createEmptyResponse({ pollIntervalSeconds, serverTime })
          : createEmptyResponse({ cancellation, pollIntervalSeconds, serverTime });
      }

      if (parsedRequest.availableConcurrency < 1) {
        return createEmptyResponse({ pollIntervalSeconds, serverTime });
      }

      const repoMappings = await input.store.listRepoMappingsForWorkspace({
        workspaceId: context.workspaceId,
      });

      const repoMappingsById = new Map(
        repoMappings
          .filter((mapping) => mapping.workspaceId === context.workspaceId)
          .map((mapping) => [mapping.id, mapping]),
      );

      const activeRepoMappingsById = new Map(
        repoMappings
          .filter(
            (mapping) =>
              mapping.workspaceId === context.workspaceId &&
              mapping.runnerId === context.runnerId &&
              hasUsableMappingMetadata(mapping),
          )
          .map((mapping) => [mapping.id, mapping]),
      );
      const activeRepoMappingIds = [...activeRepoMappingsById.keys()];
      const blockedRunIds = new Set<string>();

      const mappingGateRows = await input.store.listQueuedRuns({
        excludedRunIds: [],
        limit: POLL_CANDIDATE_LIMIT,
        workspaceId: context.workspaceId,
      });

      for (const row of mappingGateRows) {
        const repoMapping = repoMappingsById.get(row.repoMappingId);

        if (row.workspaceId !== context.workspaceId || row.state !== "queued") {
          continue;
        }

        if (
          repoMapping !== undefined &&
          mappingBelongsToAnotherActiveRunner(repoMapping, context.runnerId)
        ) {
          continue;
        }

        if (
          repoMapping === undefined ||
          repoMapping.workspaceId !== context.workspaceId ||
          !hasUsableMappingMetadata(repoMapping) ||
          repoMapping.runnerId !== context.runnerId
        ) {
          await input.store.blockRunForMissingMapping({
            finding: createMissingMappingRiskFinding(),
            runId: row.id,
            updatedAt: currentTime,
            workspaceId: context.workspaceId,
          });
          blockedRunIds.add(row.id);
          continue;
        }

        const job = mapSafeRunnerJob(row);

        if (
          job !== null &&
          (!taskPacketMatchesRepoMapping(job, repoMapping) ||
            !taskPacketMatchesWorkspace(job, context.workspaceId))
        ) {
          await input.store.blockRunForMissingMapping({
            finding: createMissingMappingRiskFinding(),
            runId: row.id,
            updatedAt: currentTime,
            workspaceId: context.workspaceId,
          });
          blockedRunIds.add(row.id);
        }
      }

      if (activeRepoMappingIds.length === 0) {
        return createEmptyResponse({ pollIntervalSeconds, serverTime });
      }

      const excludedRunIds = [...blockedRunIds];
      const excludedRunIdSet = new Set<string>();
      for (const runId of excludedRunIds) {
        excludedRunIdSet.add(runId);
      }
      const jobs: RunnerJob[] = [];

      while (jobs.length < RUNNER_POLL_MAX_JOBS) {
        const candidateRows = await input.store.listQueuedRuns({
          excludedRunIds: [...excludedRunIds],
          limit: POLL_CANDIDATE_LIMIT,
          repoMappingIds: activeRepoMappingIds,
          workspaceId: context.workspaceId,
        });

        if (candidateRows.length === 0) {
          break;
        }

        let addedExclusion = false;

        for (const row of candidateRows) {
          if (!excludedRunIdSet.has(row.id)) {
            excludedRunIdSet.add(row.id);
            excludedRunIds.push(row.id);
            addedExclusion = true;
          }

          const repoMapping = activeRepoMappingsById.get(row.repoMappingId);

          if (row.workspaceId !== context.workspaceId || row.state !== "queued") {
            continue;
          }

          if (
            repoMapping === undefined ||
            repoMapping.workspaceId !== context.workspaceId ||
            !hasUsableMappingMetadata(repoMapping) ||
            repoMapping.runnerId !== context.runnerId
          ) {
            await input.store.blockRunForMissingMapping({
              finding: createMissingMappingRiskFinding(),
              runId: row.id,
              updatedAt: currentTime,
              workspaceId: context.workspaceId,
            });
            continue;
          }

          if (isPacketlessRepairRun(row)) {
            continue;
          }

          const job = mapSafeRunnerJob(row);

          if (job === null) {
            return createEmptyResponse({ pollIntervalSeconds, serverTime });
          }

          if (
            !taskPacketMatchesRepoMapping(job, repoMapping) ||
            !taskPacketMatchesWorkspace(job, context.workspaceId)
          ) {
            await input.store.blockRunForMissingMapping({
              finding: createMissingMappingRiskFinding(),
              runId: row.id,
              updatedAt: currentTime,
              workspaceId: context.workspaceId,
            });
            continue;
          }

          if (!isRunnerCompatibleWithJob(parsedRequest.capabilities, job)) {
            continue;
          }

          jobs.push(job);
          if (jobs.length >= RUNNER_POLL_MAX_JOBS) {
            break;
          }
        }

        if (
          jobs.length >= RUNNER_POLL_MAX_JOBS ||
          candidateRows.length < POLL_CANDIDATE_LIMIT ||
          !addedExclusion
        ) {
          break;
        }
      }

      return createResponse({
        jobs,
        pollIntervalSeconds,
        serverTime,
      });
    },
  };
};

export const createDrizzlePollJobsStore = (db: Database): PollJobsStore => ({
  blockRunForMissingMapping: async ({ finding, runId, updatedAt, workspaceId }) => {
    const [existingRun] = await db
      .select({
        riskFindings: schema.runs.riskFindings,
      })
      .from(schema.runs)
      .where(and(eq(schema.runs.workspaceId, workspaceId), eq(schema.runs.id, runId)))
      .limit(1);

    await db
      .update(schema.runs)
      .set({
        riskFindings: withMissingMappingRiskFinding(existingRun?.riskFindings, finding),
        state: "blocked",
        updatedAt,
      })
      .where(
        and(
          eq(schema.runs.workspaceId, workspaceId),
          eq(schema.runs.id, runId),
          eq(schema.runs.state, "queued"),
        ),
      );
  },
  findCancellationForCurrentRuns: async ({ runnerId, runIds, workspaceId }) => {
    if (runIds.length === 0) {
      return null;
    }

    const runs = await db.query.runs.findMany({
      columns: {
        cancellationReason: true,
        cancellationRequestedAt: true,
        cancellationRequestedByActorId: true,
        id: true,
      },
      where: (fields, { and, eq, inArray }) =>
        and(
          eq(fields.workspaceId, workspaceId),
          eq(fields.runnerId, runnerId),
          inArray(fields.id, runIds),
          eq(fields.state, "cancel_requested"),
        ),
    });

    const runsById = new Map(runs.map((run) => [run.id, run]));
    const run = runIds.map((runId) => runsById.get(runId)).find((row) => row !== undefined);

    if (run === undefined) {
      return null;
    }

    return {
      cancellationReason: run.cancellationReason,
      cancellationRequestedAt: run.cancellationRequestedAt,
      cancellationRequestedByActorId: run.cancellationRequestedByActorId,
      runId: run.id,
    };
  },
  listRepoMappingsForWorkspace: async ({ workspaceId }) => {
    const rows = await db.query.repoMappings.findMany({
      where: (fields, { eq }) => eq(fields.workspaceId, workspaceId),
    });

    return rows.filter((mapping) => mapping.workspaceId === workspaceId);
  },
  listQueuedRuns: async ({ excludedRunIds, limit, repoMappingIds, workspaceId }) => {
    if (repoMappingIds !== undefined && repoMappingIds.length === 0) {
      return [];
    }

    return db.query.runs.findMany({
      limit,
      orderBy: (fields, { asc }) => [asc(fields.queuedAt)],
      where: (fields, { and, eq, inArray, notInArray }) => {
        if (repoMappingIds !== undefined && excludedRunIds.length > 0) {
          return and(
            eq(fields.workspaceId, workspaceId),
            eq(fields.state, "queued"),
            inArray(fields.repoMappingId, repoMappingIds),
            notInArray(fields.id, excludedRunIds),
          );
        }

        if (repoMappingIds !== undefined) {
          return and(
            eq(fields.workspaceId, workspaceId),
            eq(fields.state, "queued"),
            inArray(fields.repoMappingId, repoMappingIds),
          );
        }

        if (excludedRunIds.length > 0) {
          return and(
            eq(fields.workspaceId, workspaceId),
            eq(fields.state, "queued"),
            notInArray(fields.id, excludedRunIds),
          );
        }

        return and(eq(fields.workspaceId, workspaceId), eq(fields.state, "queued"));
      },
    });
  },
});

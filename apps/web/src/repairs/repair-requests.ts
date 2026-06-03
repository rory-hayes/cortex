import "server-only";

import { randomUUID } from "node:crypto";

import { redactLogText } from "@control-plane/logging";
import {
  CONTRACT_VERSION,
  RunnerJobSchema,
  RunEventSchema,
  TaskPacketSchema,
  createRunEventIdempotencyKey,
  type RepoPolicy,
  type RiskFinding,
  type RunEvent,
  type RunEventSeverity,
  type RunState,
  type TaskPacket,
  type ValidationCommand,
  type ValidationResultStatus,
} from "@control-plane/shared";

import { and, eq, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";
import { buildRepairTaskPacket as defaultBuildRepairTaskPacket } from "./build-repair-packet";
import { DEFAULT_REPAIR_MAX_ATTEMPTS, REPAIR_FEEDBACK_MAX_LENGTH } from "./constants";

export { DEFAULT_REPAIR_MAX_ATTEMPTS, REPAIR_FEEDBACK_MAX_LENGTH } from "./constants";

export const RUN_ID_MAX_LENGTH = 160;
export const WORKSPACE_ID_MAX_LENGTH = 160;

export type RequestRepairInput = {
  feedback: string;
  previousRunId: string;
  workspaceId: string;
};

export type RepairRequestData = {
  actorId: string;
  attempt: number;
  createdAt: Date;
  maxAttempts: number;
  previousRunId: string;
  queuedRunId: string;
  redactionApplied: boolean;
  repairJobId: string;
  repairRequestId: string;
  workspaceId: string;
};

export type PreviousRunForRepair = {
  attemptCount: number;
  changedPaths: string[];
  contractVersion: string;
  id: string;
  jobId: string;
  maxAttempts: number;
  mode: TaskPacket["mode"];
  policySnapshot: RepoPolicy | null;
  repoMappingId: string;
  state: RunState;
  taskId: string;
  taskPacket: TaskPacket | null;
  validationCommands: ValidationCommand[] | null;
  validationSummaries: PreviousRunValidationSummary[];
  workspaceId: string;
};

export type PreviousRunValidationSummary = {
  commandId: string;
  commandLabel: string;
  durationMs: number;
  exitCode: number | null;
  finishedAt: Date;
  redactionApplied: boolean;
  startedAt: Date;
  status: ValidationResultStatus;
  stderrSummary: string;
  stdoutSummary: string;
};

export type RepairRequestInsert = {
  attempt: number;
  createdAt: Date;
  feedback: string;
  id: string;
  maxAttempts: number;
  previousRunId: string;
  queuedRunId: string;
  requestedByActorId: string;
  updatedAt: Date;
  workspaceId: string;
};

export type RepairRunInsert = {
  attemptCount: number;
  cancellationReason: null;
  cancellationRequestedAt: null;
  cancellationRequestedByActorId: null;
  changedPaths: string[];
  claimExpiresAt: null;
  contractVersion: typeof CONTRACT_VERSION;
  id: string;
  jobId: string;
  jobType: "repair";
  maxAttempts: number;
  mode: "repair";
  policySnapshot: RepoPolicy | null;
  queuedAt: Date;
  repoMappingId: string;
  riskFindings: RiskFinding[];
  state: "queued";
  taskId: string;
  taskPacket: TaskPacket;
  validationCommands: ValidationCommand[];
  workspaceId: string;
};

export type RepairRunEventInsert = {
  contractVersion: typeof CONTRACT_VERSION;
  createdAt: Date;
  id: string;
  idempotencyKey: string;
  message: string;
  metadata: RunEvent["metadata"];
  receivedAt: Date;
  runId: string;
  runnerId: string | null;
  severity: RunEventSeverity;
  state: "repair_requested";
  workspaceId: string;
};

export type BuildRepairTaskPacketInput = {
  attempt: number;
  feedback: string;
  maxAttempts: number;
  previousRun: PreviousRunForRepair;
  queuedRunId: string;
  repairRequestId: string;
  requestedAt: Date;
  workspaceId: string;
};

export type BuildRepairTaskPacket = (input: BuildRepairTaskPacketInput) => TaskPacket;

export type RepairRequestBuildContext = {
  attempt: number;
  maxAttempts: number;
  previousRun: PreviousRunForRepair;
};

export type RepairRequestRows = {
  repairRequest: RepairRequestInsert;
  repairRun: RepairRunInsert;
};

export type RepairRequestAuditContext = {
  previousRun: PreviousRunForRepair;
  repairRequest: RepairRequestInsert;
  repairRun: RepairRunInsert;
};

export type RepairRequestRunEventContext = RepairRequestAuditContext;

export type CreateRepairRequestWithJobInput = {
  auditEventFor: (context: RepairRequestAuditContext) => AuditEventInsert;
  buildRepairRows: (context: RepairRequestBuildContext) => RepairRequestRows;
  defaultMaxAttempts: number;
  previousRunId: string;
  requestedAt: Date;
  runEventFor: (context: RepairRequestRunEventContext) => RepairRunEventInsert;
  workspaceId: string;
};

export type CreateRepairRequestWithJobResult =
  | {
      previousRun: PreviousRunForRepair;
      repairRequest: RepairRequestInsert;
      repairRun: RepairRunInsert;
      status: "created";
    }
  | {
      status: "not_found";
    }
  | {
      attempt: number;
      maxAttempts: number;
      status: "max_attempts_reached";
    }
  | {
      status: "not_repairable";
    };

export type RepairRequestStore = WorkspaceMembershipStore & {
  createRepairRequestWithJob: (
    input: CreateRepairRequestWithJobInput,
  ) => Promise<CreateRepairRequestWithJobResult>;
};

export type RepairRequestService = {
  requestRepair: (input: RequestRepairInput) => Promise<RepairRequestData>;
};

const sourceLikeFeedbackPatterns = [
  /```[\s\S]*?```/,
  /\bdiff --git\b/i,
  /^@@\s+-\d+(?:,\d+)?\s+\+\d+(?:,\d+)?\s+@@/m,
  /^\s*(?:---|\+\+\+) [ab]\//m,
  /^\s*[+-]\s*(?:class|const|export|function|import|let|return|var)\b/m,
  /\bfunction\s+[A-Za-z_$][\w$]*\s*\([^)]*\)\s*\{/,
  /\bclass\s+[A-Za-z_$][\w$]*(?:\s+extends\s+[A-Za-z_$][\w$]*)?\s*\{/,
  /^\s*interface\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?(?:\s+extends\s+[A-Za-z_$][\w$.,\s<>]*)?\s*\{/m,
  /^\s*type\s+[A-Za-z_$][\w$]*(?:<[^>\n]+>)?\s*=\s*.+$/m,
  /\b(?:if|for|while|switch|catch)\s*\([^)]*\)\s*\{/,
  /\b(?:try|else|finally)\s*\{/,
  /^\s*(?:import|export)\s+.+(?:from\s+["'][^"']+["']|[;{])/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*(?:\s*[:=]\s*[^;\n]+)?;?\s*$/m,
  /^\s*(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>/m,
  /^\s*(?:await\s+)?[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*|\([^{}\n;]*\))*\s*\([^;\n]*\{[^;\n]*\}[^;\n]*\)\s*;?\s*$/m,
  /^\s*[A-Za-z_$][\w$.]*\s*\([^;\n{}]*\)\s*;?\s*$/m,
  /^\s*[A-Za-z_$][\w$.[\]'"]*(?:\.[A-Za-z_$][\w$]*)*\s*=\s*[^;\n]+;\s*$/m,
  /^\s*(?:SELECT\s+[\s\S]+?\s+FROM|INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|CREATE\s+TABLE|ALTER\s+TABLE|DROP\s+TABLE)\b[\s\S]*;\s*$/im,
  /^\s*(?:FAIL|PASS)\s+\S+\.(?:test|spec)\.[cm]?[jt]sx?(?:\s|$)/m,
  /^\s*(?:Test Files|Tests)\s+\d+\s+(?:failed|passed|skipped)/m,
  /^\s*(?:AssertionError|Error|EvalError|RangeError|ReferenceError|SyntaxError|TypeError|URIError):\s+.+/m,
  /^\s+at\s+(?:[A-Za-z_$][\w$.[\]<>]*(?:\s+\[as\s+[^\]]+\])?\s+)?\(?[^()\s]+:\d+:\d+\)?/m,
  /^\s*(?:>|\u276f)\s+\S+:\d+:\d+/m,
  /^\s*\S+\.[cm]?[jt]sx?\(\d+,\d+\):\s+error\s+TS\d+:/m,
  /^\s*error\s+TS\d+:/m,
  /^\s*(?:ELIFECYCLE|ERR_PNPM_[A-Z0-9_]+|npm ERR!|pnpm ERR!|yarn ERR!|Command failed with exit code \d+|Process exited with code \d+)\b/im,
  /^\s*(?:git\s+(?:add|branch|checkout|clean|commit|diff|log|merge|pull|push|rebase|reset|show|status|switch|worktree)|(?:pnpm|npm|yarn)\s+(?:add|build|ci|exec|install|lint|run|test|typecheck)|(?:node|python3?|bash|sh|docker|kubectl)\s+\S+|rm\s+-[A-Za-z]+|curl\s+https?:\/\/|wget\s+https?:\/\/).*/im,
  /\bprocess\.env\.[A-Z0-9_]+\b/,
  /\breturn\s+[^;\n]+;/,
] as const;

const dotenvStyleSecretFeedbackPattern =
  /^\s*(?:export\s+)?[A-Z_][A-Z0-9_]*(?:API[_-]?KEY|ACCESS[_-]?TOKEN|AUTH[_-]?TOKEN|CLIENT[_-]?SECRET|DATABASE[_-]?URL|PRIVATE[_-]?KEY|PASSWORD|SECRET|TOKEN)[A-Z0-9_]*\s*=\s*.+$/im;

const privateKeyFeedbackPattern = /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/i;

const residualSecretFeedbackPattern =
  /(?:-----BEGIN|gh[pousr]_[A-Za-z0-9_]{12,}|github_pat_[A-Za-z0-9_]{12,}|sk_(?:live|test)_[A-Za-z0-9_]{12,}|xox[baprs]-[A-Za-z0-9-]{12,}|\bbearer\s+(?!\[REDACTED_SECRET\])[A-Za-z0-9._~+/=-]{8,}|(?:api[_-]?key|access[_-]?token|auth[_-]?token|password|secret|token)\s*[:=]\s*(?!"?\[REDACTED_SECRET\]"?|'?\[REDACTED_SECRET\]'?)[^\s,;]{8,})/i;

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    );
  });

const hasUnsafeFeedbackShape = (feedback: string): boolean =>
  dotenvStyleSecretFeedbackPattern.test(feedback) ||
  privateKeyFeedbackPattern.test(feedback) ||
  sourceLikeFeedbackPatterns.some((pattern) => pattern.test(feedback));

const normalizeRequiredText = (value: unknown, maxLength: number): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

  const normalized = value.trim();

  if (normalized.length === 0 || normalized.length > maxLength || hasControlCharacter(normalized)) {
    throw createActionError("validation_error");
  }

  return normalized;
};

const normalizeRepairFeedback = (
  feedback: unknown,
): {
  feedback: string;
  redactionApplied: boolean;
} => {
  const normalizedFeedback = normalizeRequiredText(feedback, REPAIR_FEEDBACK_MAX_LENGTH);

  if (hasUnsafeFeedbackShape(normalizedFeedback)) {
    throw createActionError("validation_error");
  }

  const redacted = redactLogText(normalizedFeedback);
  const safeFeedback = normalizeRequiredText(redacted.text, REPAIR_FEEDBACK_MAX_LENGTH);

  if (hasUnsafeFeedbackShape(safeFeedback) || residualSecretFeedbackPattern.test(safeFeedback)) {
    throw createActionError("validation_error");
  }

  return {
    feedback: safeFeedback,
    redactionApplied: redacted.redactionApplied,
  };
};

const normalizeRunId = (runId: unknown): string => normalizeRequiredText(runId, RUN_ID_MAX_LENGTH);

const normalizeWorkspaceId = (workspaceId: unknown): string =>
  normalizeRequiredText(workspaceId, WORKSPACE_ID_MAX_LENGTH);

const REPAIRABLE_PREVIOUS_RUN_STATES = new Set<RunState>(["awaiting_approval"]);

const parseInjectedRepairTaskPacket = (input: {
  attempt: number;
  feedback: string;
  jobId: string;
  maxAttempts: number;
  previousRun: PreviousRunForRepair;
  queuedAt: Date;
  queuedRunId: string;
  repairRequestId: string;
  taskPacket: TaskPacket;
  workspaceId: string;
}): TaskPacket => {
  const parsedPacket = TaskPacketSchema.safeParse(input.taskPacket);

  if (!parsedPacket.success) {
    throw createActionError("validation_error");
  }

  const taskPacket = parsedPacket.data;
  const repair = taskPacket.repair;
  const previousTaskPacket = input.previousRun.taskPacket;

  if (
    repair === undefined ||
    taskPacket.id.length === 0 ||
    taskPacket.mode !== "repair" ||
    taskPacket.runId !== input.queuedRunId ||
    taskPacket.workspaceId !== input.workspaceId ||
    taskPacket.source.type !== "repair" ||
    taskPacket.source.externalId !== input.repairRequestId ||
    repair.attempt !== input.attempt ||
    repair.maxAttempts !== input.maxAttempts ||
    repair.feedback !== input.feedback ||
    repair.previousRunId !== input.previousRun.id
  ) {
    throw createActionError("validation_error");
  }

  if (
    previousTaskPacket !== null &&
    (taskPacket.repositoryId !== previousTaskPacket.repositoryId ||
      taskPacket.repo.localPath !== previousTaskPacket.repo.localPath ||
      taskPacket.repo.defaultBranch !== previousTaskPacket.repo.defaultBranch)
  ) {
    throw createActionError("validation_error");
  }

  const runnerJob = RunnerJobSchema.safeParse({
    contractVersion: CONTRACT_VERSION,
    jobId: input.jobId,
    queuedAt: input.queuedAt.toISOString(),
    runId: input.queuedRunId,
    taskPacket,
    type: "repair",
  });

  if (!runnerJob.success) {
    throw createActionError("validation_error");
  }

  return taskPacket;
};

const buildRepairRows = (input: {
  actorId: string;
  attempt: number;
  buildRepairTaskPacket: BuildRepairTaskPacket;
  createdAt: Date;
  createJobId: () => string;
  createQueuedRunId: () => string;
  createRepairRequestId: () => string;
  feedback: string;
  maxAttempts: number;
  previousRun: PreviousRunForRepair;
  workspaceId: string;
}): RepairRequestRows => {
  const repairRequestId = input.createRepairRequestId();
  const queuedRunId = input.createQueuedRunId();
  const repairJobId = input.createJobId();
  const taskPacket = parseInjectedRepairTaskPacket({
    attempt: input.attempt,
    feedback: input.feedback,
    jobId: repairJobId,
    maxAttempts: input.maxAttempts,
    previousRun: input.previousRun,
    queuedAt: input.createdAt,
    queuedRunId,
    repairRequestId,
    taskPacket: input.buildRepairTaskPacket({
      attempt: input.attempt,
      feedback: input.feedback,
      maxAttempts: input.maxAttempts,
      previousRun: input.previousRun,
      queuedRunId,
      repairRequestId,
      requestedAt: input.createdAt,
      workspaceId: input.workspaceId,
    }),
    workspaceId: input.workspaceId,
  });

  return {
    repairRequest: {
      attempt: input.attempt,
      createdAt: input.createdAt,
      feedback: input.feedback,
      id: repairRequestId,
      maxAttempts: input.maxAttempts,
      previousRunId: input.previousRun.id,
      queuedRunId,
      requestedByActorId: input.actorId,
      updatedAt: input.createdAt,
      workspaceId: input.workspaceId,
    },
    repairRun: {
      attemptCount: input.attempt,
      cancellationReason: null,
      cancellationRequestedAt: null,
      cancellationRequestedByActorId: null,
      changedPaths: [],
      claimExpiresAt: null,
      contractVersion: CONTRACT_VERSION,
      id: queuedRunId,
      jobId: repairJobId,
      jobType: "repair",
      maxAttempts: input.maxAttempts,
      mode: "repair",
      policySnapshot: taskPacket.policy,
      queuedAt: input.createdAt,
      repoMappingId: input.previousRun.repoMappingId,
      riskFindings: [],
      state: "queued",
      taskId: input.previousRun.taskId,
      taskPacket,
      validationCommands: taskPacket.validation.commands,
      workspaceId: input.workspaceId,
    },
  };
};

const createRepairRequestedRunEventInsert = (input: {
  createId: () => string;
  previousRun: PreviousRunForRepair;
  repairRequest: RepairRequestInsert;
  repairRun: RepairRunInsert;
  requestedAt: Date;
}): RepairRunEventInsert => {
  const parsedEvent = RunEventSchema.parse({
    contractVersion: CONTRACT_VERSION,
    createdAt: input.requestedAt.toISOString(),
    id: input.createId(),
    idempotencyKey: createRunEventIdempotencyKey({
      attempt: input.repairRequest.attempt,
      runId: input.previousRun.id,
      stableStepName: "repair_requested",
    }),
    message: "Repair requested.",
    metadata: {
      attempt: input.repairRequest.attempt,
      maxAttempts: input.repairRequest.maxAttempts,
      queuedRunId: input.repairRun.id,
      repairJobId: input.repairRun.jobId,
      repairRequestId: input.repairRequest.id,
    },
    runId: input.previousRun.id,
    severity: "info",
    state: "repair_requested",
  });

  return {
    contractVersion: parsedEvent.contractVersion,
    createdAt: input.requestedAt,
    id: parsedEvent.id,
    idempotencyKey: parsedEvent.idempotencyKey,
    message: parsedEvent.message,
    metadata: parsedEvent.metadata,
    receivedAt: input.requestedAt,
    runId: parsedEvent.runId,
    runnerId: null,
    severity: parsedEvent.severity,
    state: "repair_requested",
    workspaceId: input.previousRun.workspaceId,
  };
};

const previousRunForRepairSelection = {
  attemptCount: schema.runs.attemptCount,
  changedPaths: schema.runs.changedPaths,
  contractVersion: schema.runs.contractVersion,
  id: schema.runs.id,
  jobId: schema.runs.jobId,
  maxAttempts: schema.runs.maxAttempts,
  mode: schema.runs.mode,
  policySnapshot: schema.runs.policySnapshot,
  repoMappingId: schema.runs.repoMappingId,
  state: schema.runs.state,
  taskId: schema.runs.taskId,
  taskPacket: schema.runs.taskPacket,
  validationCommands: schema.runs.validationCommands,
  workspaceId: schema.runs.workspaceId,
};

const previousRunValidationSummarySelection = {
  commandId: schema.validationResults.commandId,
  commandLabel: schema.validationResults.commandLabel,
  durationMs: schema.validationResults.durationMs,
  exitCode: schema.validationResults.exitCode,
  finishedAt: schema.validationResults.finishedAt,
  redactionApplied: schema.validationResults.redactionApplied,
  startedAt: schema.validationResults.startedAt,
  status: schema.validationResults.status,
  stderrSummary: schema.validationResults.stderrSummary,
  stdoutSummary: schema.validationResults.stdoutSummary,
};

export const createDrizzleRepairRequestStore = (db: Database): RepairRequestStore => ({
  createRepairRequestWithJob: async ({
    auditEventFor,
    buildRepairRows: buildRows,
    defaultMaxAttempts,
    previousRunId,
    requestedAt,
    runEventFor,
    workspaceId,
  }) =>
    db.transaction(async (tx) => {
      const [previousRun] = await tx
        .select(previousRunForRepairSelection)
        .from(schema.runs)
        .where(and(eq(schema.runs.id, previousRunId), eq(schema.runs.workspaceId, workspaceId)))
        .limit(1);

      if (previousRun === undefined) {
        return { status: "not_found" };
      }

      if (!REPAIRABLE_PREVIOUS_RUN_STATES.has(previousRun.state)) {
        return { status: "not_repairable" };
      }

      const validationSummaries = await tx
        .select(previousRunValidationSummarySelection)
        .from(schema.validationResults)
        .where(
          and(
            eq(schema.validationResults.runId, previousRun.id),
            eq(schema.validationResults.workspaceId, workspaceId),
          ),
        )
        .orderBy(schema.validationResults.startedAt, schema.validationResults.id);
      const previousRunWithContext = {
        ...previousRun,
        validationSummaries,
      };

      const maxAttempts = Math.max(previousRunWithContext.maxAttempts, defaultMaxAttempts);
      const attempt = previousRunWithContext.attemptCount + 1;

      if (attempt > maxAttempts) {
        return {
          attempt,
          maxAttempts,
          status: "max_attempts_reached" as const,
        };
      }

      const rows = buildRows({
        attempt,
        maxAttempts,
        previousRun: previousRunWithContext,
      });
      const [repairRun] = await tx.insert(schema.runs).values(rows.repairRun).returning({
        id: schema.runs.id,
      });

      if (repairRun === undefined) {
        throw new Error("Repair run insert did not return a row.");
      }

      const [repairRequest] = await tx
        .insert(schema.repairRequests)
        .values(rows.repairRequest)
        .returning({
          id: schema.repairRequests.id,
        });

      if (repairRequest === undefined) {
        throw new Error("Repair request insert did not return a row.");
      }

      const [updatedPreviousRun] = await tx
        .update(schema.runs)
        .set({
          lastEventAt: requestedAt,
          state: "repair_requested",
          updatedAt: requestedAt,
        })
        .where(and(eq(schema.runs.id, previousRun.id), eq(schema.runs.workspaceId, workspaceId)))
        .returning({
          id: schema.runs.id,
        });

      if (updatedPreviousRun === undefined) {
        throw new Error("Previous run repair state update did not return a row.");
      }

      const runEvent = runEventFor({
        previousRun: previousRunWithContext,
        repairRequest: rows.repairRequest,
        repairRun: rows.repairRun,
      });

      await tx
        .insert(schema.runEvents)
        .values({
          contractVersion: runEvent.contractVersion,
          createdAt: runEvent.createdAt,
          id: runEvent.id,
          idempotencyKey: runEvent.idempotencyKey,
          message: runEvent.message,
          metadata: runEvent.metadata,
          receivedAt: runEvent.receivedAt,
          runId: runEvent.runId,
          runnerId: runEvent.runnerId,
          severity: runEvent.severity,
          state: runEvent.state,
          workspaceId: runEvent.workspaceId,
        })
        .onConflictDoNothing({
          target: [schema.runEvents.runId, schema.runEvents.idempotencyKey],
        });

      await tx.insert(schema.auditEvents).values(
        auditEventFor({
          previousRun: previousRunWithContext,
          repairRequest: rows.repairRequest,
          repairRun: rows.repairRun,
        }),
      );

      return {
        previousRun: previousRunWithContext,
        repairRequest: rows.repairRequest,
        repairRun: rows.repairRun,
        status: "created" as const,
      };
    }),
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
});

export const createRepairRequestService = (input: {
  buildRepairTaskPacket?: BuildRepairTaskPacket;
  createAuditEventId?: () => string;
  createJobId?: () => string;
  createRunEventId?: () => string;
  createQueuedRunId?: () => string;
  createRepairRequestId?: () => string;
  getAuthContext?: GetAuthContext;
  now?: () => Date;
  store: RepairRequestStore;
}): RepairRequestService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const buildRepairTaskPacket = input.buildRepairTaskPacket ?? defaultBuildRepairTaskPacket;

  return {
    requestRepair: async ({ feedback, previousRunId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const normalizedPreviousRunId = normalizeRunId(previousRunId);
      const normalizedFeedback = normalizeRepairFeedback(feedback);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const requestedAt = input.now?.() ?? new Date();
      const result = await input.store.createRepairRequestWithJob({
        auditEventFor: ({ previousRun, repairRequest, repairRun }) =>
          createAuditEventInsert({
            actorId: scope.actorId,
            createId: input.createAuditEventId ?? randomUUID,
            eventType: "run.repair_requested",
            message: "Run repair requested.",
            metadata: {
              feedbackLength: repairRequest.feedback.length,
              feedbackRedactionApplied: normalizedFeedback.redactionApplied,
              maxAttempts: repairRequest.maxAttempts,
              previousRunAttemptCount: previousRun.attemptCount,
              previousRunId: previousRun.id,
              previousRunState: previousRun.state,
              repairJobId: repairRun.jobId,
              repairRequestId: repairRequest.id,
              queuedRunAttemptCount: repairRun.attemptCount,
              queuedRunId: repairRun.id,
              targetState: "repair_requested",
            },
            now: () => requestedAt,
            runId: previousRun.id,
            taskId: previousRun.taskId,
            workspaceId: previousRun.workspaceId,
          }),
        buildRepairRows: ({ attempt, maxAttempts, previousRun }) =>
          buildRepairRows({
            actorId: scope.actorId,
            attempt,
            buildRepairTaskPacket,
            createdAt: requestedAt,
            createJobId: input.createJobId ?? randomUUID,
            createQueuedRunId: input.createQueuedRunId ?? randomUUID,
            createRepairRequestId: input.createRepairRequestId ?? randomUUID,
            feedback: normalizedFeedback.feedback,
            maxAttempts,
            previousRun,
            workspaceId: scope.workspaceId,
          }),
        defaultMaxAttempts: DEFAULT_REPAIR_MAX_ATTEMPTS,
        previousRunId: normalizedPreviousRunId,
        requestedAt,
        runEventFor: ({ previousRun, repairRequest, repairRun }) =>
          createRepairRequestedRunEventInsert({
            createId: input.createRunEventId ?? randomUUID,
            previousRun,
            repairRequest,
            repairRun,
            requestedAt,
          }),
        workspaceId: scope.workspaceId,
      });

      if (result.status === "not_found") {
        throw createActionError("forbidden");
      }

      if (result.status === "max_attempts_reached" || result.status === "not_repairable") {
        throw createActionError("validation_error");
      }

      return {
        actorId: result.repairRequest.requestedByActorId,
        attempt: result.repairRequest.attempt,
        createdAt: result.repairRequest.createdAt,
        maxAttempts: result.repairRequest.maxAttempts,
        previousRunId: result.repairRequest.previousRunId,
        queuedRunId: result.repairRequest.queuedRunId,
        redactionApplied: normalizedFeedback.redactionApplied,
        repairJobId: result.repairRun.jobId,
        repairRequestId: result.repairRequest.id,
        workspaceId: result.repairRequest.workspaceId,
      };
    },
  };
};

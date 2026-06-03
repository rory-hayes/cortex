import "server-only";

import {
  PrArtifactStatusSchema,
  RunStateSchema,
  ValidationResultStatusSchema,
  type PrArtifactStatus,
  type RunState,
  type ValidationResultStatus,
} from "@control-plane/shared";

import { and, eq, inArray, isNotNull, schema, type Database } from "../db";
import { hasUnsafeArtifactText } from "../runs/artifact-safety";
import { summarizeValidationStatuses, type ValidationStatusCount } from "../runs/review-metadata";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import { DEFAULT_REPAIR_MAX_ATTEMPTS } from "./constants";

const ID_MAX_LENGTH = 160;

export type CortexTaskRepairContext = {
  attemptCount: number;
  canRequestRepair: boolean;
  disabledReason: string | null;
  maxAttempts: number;
  nextAttempt: number;
  previousRunId: string;
  pr: {
    number: number;
    status: PrArtifactStatus;
    url: string | null;
  } | null;
  remainingAttempts: number;
  taskId: string;
  validationEvidence: {
    statusCounts: ValidationStatusCount[];
    totalCount: number;
  };
};

export type CortexTaskRepairContextRow = {
  attemptCount: number;
  maxAttempts: number;
  prNumber: number | null;
  prStatus: PrArtifactStatus | null;
  prUrl: string | null;
  runId: string;
  runState: RunState;
  taskId: string;
  validationResultId: string | null;
  validationStatus: ValidationResultStatus | null;
  workspaceId: string;
};

export type ListCortexTaskRepairContextsInput = {
  taskIds?: string[];
  workspaceId: string;
};

export type CortexTaskRepairContextStore = WorkspaceMembershipStore & {
  listCortexTaskRepairContextRows: (input: {
    taskIds: string[];
    workspaceId: string;
  }) => Promise<CortexTaskRepairContextRow[]>;
};

export type CortexTaskRepairContextService = {
  listCortexTaskRepairContexts: (
    input: ListCortexTaskRepairContextsInput,
  ) => Promise<Record<string, CortexTaskRepairContext>>;
};

type RepairContextAccumulator = Omit<CortexTaskRepairContext, "validationEvidence"> & {
  validationResultIds: Set<string>;
  validationStatuses: ValidationResultStatus[];
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return (
      (codePoint < 32 && codePoint !== 9 && codePoint !== 10 && codePoint !== 13) ||
      codePoint === 127
    );
  });

const normalizeRequiredId = (value: unknown): string => {
  if (typeof value !== "string") {
    throw createActionError("validation_error");
  }

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

const normalizeTaskIds = (taskIds: string[] | undefined): string[] =>
  taskIds === undefined
    ? []
    : Array.from(new Set(taskIds.map((taskId) => normalizeRequiredId(taskId))));

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

const createAttemptContext = (row: CortexTaskRepairContextRow) => {
  const maxAttempts = Math.max(row.maxAttempts, DEFAULT_REPAIR_MAX_ATTEMPTS);
  const nextAttempt = row.attemptCount + 1;
  const remainingAttempts = Math.max(maxAttempts - row.attemptCount, 0);
  const canRequestRepair = row.runState === "awaiting_approval" && nextAttempt <= maxAttempts;
  const disabledReason =
    nextAttempt > maxAttempts
      ? "Repair attempt limit reached."
      : row.runState !== "awaiting_approval"
        ? "Repairs are available only while the run is awaiting approval."
        : null;

  return {
    canRequestRepair,
    disabledReason,
    maxAttempts,
    nextAttempt,
    remainingAttempts,
  };
};

const toRepairContextAccumulator = (row: CortexTaskRepairContextRow): RepairContextAccumulator => {
  const taskId = normalizeRequiredId(row.taskId);
  const previousRunId = normalizeRequiredId(row.runId);
  const runState = RunStateSchema.parse(row.runState);
  const prStatus = row.prStatus === null ? null : PrArtifactStatusSchema.parse(row.prStatus);
  const attemptContext = createAttemptContext({
    ...row,
    runState,
  });
  const pr =
    row.prNumber === null || prStatus === null || !Number.isInteger(row.prNumber)
      ? null
      : {
          number: row.prNumber,
          status: prStatus,
          url: toSafePrUrl(row.prUrl),
        };

  return {
    attemptCount: row.attemptCount,
    canRequestRepair: attemptContext.canRequestRepair,
    disabledReason: attemptContext.disabledReason,
    maxAttempts: attemptContext.maxAttempts,
    nextAttempt: attemptContext.nextAttempt,
    pr,
    previousRunId,
    remainingAttempts: attemptContext.remainingAttempts,
    taskId,
    validationResultIds: new Set<string>(),
    validationStatuses: [],
  };
};

const addValidationEvidence = (
  context: RepairContextAccumulator,
  row: CortexTaskRepairContextRow,
): void => {
  if (row.validationResultId === null || row.validationStatus === null) {
    return;
  }

  const validationResultId = normalizeRequiredId(row.validationResultId);

  if (context.validationResultIds.has(validationResultId)) {
    return;
  }

  context.validationResultIds.add(validationResultId);
  context.validationStatuses.push(ValidationResultStatusSchema.parse(row.validationStatus));
};

const finalizeContext = (context: RepairContextAccumulator): CortexTaskRepairContext => ({
  attemptCount: context.attemptCount,
  canRequestRepair: context.canRequestRepair,
  disabledReason: context.disabledReason,
  maxAttempts: context.maxAttempts,
  nextAttempt: context.nextAttempt,
  pr: context.pr,
  previousRunId: context.previousRunId,
  remainingAttempts: context.remainingAttempts,
  taskId: context.taskId,
  validationEvidence: {
    statusCounts: summarizeValidationStatuses(context.validationStatuses),
    totalCount: context.validationResultIds.size,
  },
});

export const createDrizzleCortexTaskRepairContextStore = (
  db: Database,
): CortexTaskRepairContextStore => ({
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
  listCortexTaskRepairContextRows: async ({ taskIds, workspaceId }) => {
    const conditions = [
      eq(schema.cortexTasks.workspaceId, workspaceId),
      isNotNull(schema.cortexTasks.latestRunId),
    ];

    if (taskIds.length > 0) {
      conditions.push(inArray(schema.cortexTasks.id, taskIds));
    }

    return db
      .select({
        attemptCount: schema.runs.attemptCount,
        maxAttempts: schema.runs.maxAttempts,
        prNumber: schema.prArtifacts.prNumber,
        prStatus: schema.prArtifacts.prStatus,
        prUrl: schema.prArtifacts.prUrl,
        runId: schema.runs.id,
        runState: schema.runs.state,
        taskId: schema.cortexTasks.id,
        validationResultId: schema.validationResults.id,
        validationStatus: schema.validationResults.status,
        workspaceId: schema.cortexTasks.workspaceId,
      })
      .from(schema.cortexTasks)
      .innerJoin(
        schema.runs,
        and(
          eq(schema.runs.id, schema.cortexTasks.latestRunId),
          eq(schema.runs.workspaceId, workspaceId),
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
        schema.validationResults,
        and(
          eq(schema.validationResults.runId, schema.runs.id),
          eq(schema.validationResults.workspaceId, workspaceId),
        ),
      )
      .where(and(...conditions))
      .orderBy(
        schema.cortexTasks.updatedAt,
        schema.validationResults.startedAt,
        schema.validationResults.id,
      );
  },
});

export const createCortexTaskRepairContextService = (input: {
  getAuthContext?: GetAuthContext;
  store: CortexTaskRepairContextStore;
}): CortexTaskRepairContextService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listCortexTaskRepairContexts: async ({ taskIds, workspaceId }) => {
      const normalizedWorkspaceId = normalizeRequiredId(workspaceId);
      const normalizedTaskIds = normalizeTaskIds(taskIds);

      if (taskIds !== undefined && normalizedTaskIds.length === 0) {
        return {};
      }

      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const rows = await input.store.listCortexTaskRepairContextRows({
        taskIds: normalizedTaskIds,
        workspaceId: scope.workspaceId,
      });
      const contexts = new Map<string, RepairContextAccumulator>();

      for (const row of rows) {
        const taskId = normalizeRequiredId(row.taskId);
        const context = contexts.get(taskId) ?? toRepairContextAccumulator(row);

        addValidationEvidence(context, row);
        contexts.set(taskId, context);
      }

      return Object.fromEntries(
        Array.from(contexts.entries(), ([taskId, context]) => [taskId, finalizeContext(context)]),
      );
    },
  };
};

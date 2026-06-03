import "server-only";

import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
  TaskPacketSourceType,
  ValidationResultStatus,
} from "@control-plane/shared";

import { and, desc, eq, inArray, schema, type Database } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";
import {
  deriveReviewStateBucket,
  summarizeRiskFindings,
  summarizeValidationStatuses,
  type RiskCategoryCount,
  type ValidationStatusCount,
} from "../runs/review-metadata";

const WORKSPACE_ID_MAX_LENGTH = 160;

export const taskWorkflowBuckets = [
  "draft",
  "queued",
  "running",
  "blocked_failed",
  "awaiting_approval",
  "pr_ready",
  "completed",
  "cancelled",
] as const;

export type TaskWorkflowBucket = (typeof taskWorkflowBuckets)[number];
export type TaskWorkflowFilter = TaskWorkflowBucket | "all";

export type TaskWorkflowSummary = {
  awaitingApproval: number;
  blockedOrFailed: number;
  drafts: number;
  prReady: number;
  queued: number;
  running: number;
};

export type TaskWorkflowLatestRun = {
  id: string;
  mode: TaskPacketMode;
  pr: {
    number: number;
    status: PrArtifactStatus;
  } | null;
  risk: {
    blockerCount: number;
    riskCategoryCounts: RiskCategoryCount[];
    warningCount: number;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  state: RunState;
  updatedAt: Date;
  validationStatusCounts: ValidationStatusCount[];
};

export type TaskWorkflowItem = {
  createdAt: Date;
  id: string;
  latestRun: TaskWorkflowLatestRun | null;
  mode: TaskPacketMode;
  repoMapping: {
    id: string;
    repositoryName: string;
    repositoryOwner: string;
  };
  requestedByActorId: string | null;
  sourceType: TaskPacketSourceType;
  status: "approved" | "draft";
  title: string;
  updatedAt: Date;
  workflow: {
    bucket: TaskWorkflowBucket;
    label: string;
  };
  workspaceId: string;
};

export type TaskWorkflowList = {
  summary: TaskWorkflowSummary;
  tasks: TaskWorkflowItem[];
};

export type TaskWorkflowStoreRow = {
  approvedAt: Date | null;
  createdAt: Date;
  id: string;
  latestRunCreatedAt: Date | null;
  latestRunId: string | null;
  latestRunLastEventAt: Date | null;
  latestRunMode: TaskPacketMode | null;
  latestRunPrNumber: number | null;
  latestRunPrStatus: PrArtifactStatus | null;
  latestRunRiskFindings: RiskFinding[] | null;
  latestRunRunnerDisplayName: string | null;
  latestRunRunnerId: string | null;
  latestRunState: RunState | null;
  latestRunUpdatedAt: Date | null;
  mode: TaskPacketMode;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  requestedByActorId?: string | null;
  sourceType: TaskPacketSourceType;
  status: "approved" | "draft";
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

export type TaskWorkflowValidationResultRow = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

export type TaskWorkflowStore = WorkspaceMembershipStore & {
  listWorkspaceTaskWorkflowRows: (input: {
    workspaceId: string;
  }) => Promise<TaskWorkflowStoreRow[]>;
  listWorkspaceTaskWorkflowValidationResults: (input: {
    workspaceId: string;
  }) => Promise<TaskWorkflowValidationResultRow[]>;
};

export type TaskWorkflowService = {
  listWorkspaceTaskWorkflow: (input: { workspaceId: string }) => Promise<TaskWorkflowList>;
};

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const normalizeWorkspaceId = (workspaceId: string): string => {
  const normalizedWorkspaceId = workspaceId.trim();

  if (
    normalizedWorkspaceId.length === 0 ||
    normalizedWorkspaceId.length > WORKSPACE_ID_MAX_LENGTH ||
    hasControlCharacter(normalizedWorkspaceId)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedWorkspaceId;
};

const latestRunTimestamp = (row: TaskWorkflowStoreRow): number =>
  (
    row.latestRunLastEventAt ??
    row.latestRunUpdatedAt ??
    row.latestRunCreatedAt ??
    row.updatedAt
  ).getTime();

const hasNewerRun = (candidate: TaskWorkflowStoreRow, current: TaskWorkflowStoreRow): boolean => {
  if (candidate.latestRunId === null) {
    return false;
  }

  if (current.latestRunId === null) {
    return true;
  }

  const timestampDelta = latestRunTimestamp(candidate) - latestRunTimestamp(current);

  if (timestampDelta !== 0) {
    return timestampDelta > 0;
  }

  return candidate.latestRunId.localeCompare(current.latestRunId) > 0;
};

const selectLatestRows = (rows: TaskWorkflowStoreRow[]): TaskWorkflowStoreRow[] => {
  const rowsByTaskId = new Map<string, TaskWorkflowStoreRow>();

  rows.forEach((row) => {
    const currentRow = rowsByTaskId.get(row.id);

    if (currentRow === undefined || hasNewerRun(row, currentRow)) {
      rowsByTaskId.set(row.id, row);
    }
  });

  return Array.from(rowsByTaskId.values());
};

const taskWorkflowLabels = {
  awaiting_approval: "Awaiting approval",
  blocked_failed: "Blocked or failed",
  cancelled: "Cancelled",
  completed: "Completed",
  draft: "Ready to approve",
  pr_ready: "PR-ready",
  queued: "Queued for runner",
  running: "Running",
} satisfies Record<TaskWorkflowBucket, string>;

const deriveTaskWorkflowBucket = (row: TaskWorkflowStoreRow): TaskWorkflowBucket => {
  if (row.status === "draft") {
    return "draft";
  }

  if (row.latestRunId === null || row.latestRunState === null) {
    return "queued";
  }

  const reviewBucket = deriveReviewStateBucket({
    prStatus: row.latestRunPrStatus,
    state: row.latestRunState,
  });

  if (reviewBucket === "blocked" || reviewBucket === "failed") {
    return "blocked_failed";
  }

  if (reviewBucket === "ready") {
    return "queued";
  }

  return reviewBucket;
};

const toLatestRun = (
  row: TaskWorkflowStoreRow,
  validationResults: TaskWorkflowValidationResultRow[],
): TaskWorkflowLatestRun | null => {
  if (
    row.latestRunId === null ||
    row.latestRunMode === null ||
    row.latestRunState === null ||
    row.latestRunUpdatedAt === null
  ) {
    return null;
  }

  const riskSummary = summarizeRiskFindings(row.latestRunRiskFindings);

  return {
    id: row.latestRunId,
    mode: row.latestRunMode,
    pr:
      row.latestRunPrNumber === null || row.latestRunPrStatus === null
        ? null
        : {
            number: row.latestRunPrNumber,
            status: row.latestRunPrStatus,
          },
    risk: {
      blockerCount: riskSummary.blockerCount,
      riskCategoryCounts: riskSummary.categoryCounts,
      warningCount: riskSummary.warningCount,
    },
    runner:
      row.latestRunRunnerId === null || row.latestRunRunnerDisplayName === null
        ? null
        : {
            displayName: row.latestRunRunnerDisplayName,
            id: row.latestRunRunnerId,
          },
    state: row.latestRunState,
    updatedAt: row.latestRunLastEventAt ?? row.latestRunUpdatedAt,
    validationStatusCounts: summarizeValidationStatuses(
      validationResults.map((validationResult) => validationResult.status),
    ),
  };
};

const createSummary = (tasks: TaskWorkflowItem[]): TaskWorkflowSummary => ({
  awaitingApproval: tasks.filter((task) => task.workflow.bucket === "awaiting_approval").length,
  blockedOrFailed: tasks.filter((task) => task.workflow.bucket === "blocked_failed").length,
  drafts: tasks.filter((task) => task.workflow.bucket === "draft").length,
  prReady: tasks.filter((task) => task.workflow.bucket === "pr_ready").length,
  queued: tasks.filter((task) => task.workflow.bucket === "queued").length,
  running: tasks.filter((task) => task.workflow.bucket === "running").length,
});

const toTaskWorkflowItem = (
  row: TaskWorkflowStoreRow,
  validationResults: TaskWorkflowValidationResultRow[],
): TaskWorkflowItem => {
  const bucket = deriveTaskWorkflowBucket(row);

  return {
    createdAt: row.createdAt,
    id: row.id,
    latestRun: toLatestRun(row, validationResults),
    mode: row.mode,
    repoMapping: {
      id: row.repoMappingId,
      repositoryName: row.repositoryName,
      repositoryOwner: row.repositoryOwner,
    },
    requestedByActorId: row.requestedByActorId ?? null,
    sourceType: row.sourceType,
    status: row.status,
    title: row.title,
    updatedAt: row.latestRunLastEventAt ?? row.latestRunUpdatedAt ?? row.updatedAt,
    workflow: {
      bucket,
      label: taskWorkflowLabels[bucket],
    },
    workspaceId: row.workspaceId,
  };
};

export const createDrizzleTaskWorkflowStore = (db: Database): TaskWorkflowStore => ({
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
  listWorkspaceTaskWorkflowRows: async ({ workspaceId }) =>
    db
      .select({
        approvedAt: schema.tasks.approvedAt,
        createdAt: schema.tasks.createdAt,
        id: schema.tasks.id,
        latestRunCreatedAt: schema.runs.createdAt,
        latestRunId: schema.runs.id,
        latestRunLastEventAt: schema.runs.lastEventAt,
        latestRunMode: schema.runs.mode,
        latestRunPrNumber: schema.prArtifacts.prNumber,
        latestRunPrStatus: schema.prArtifacts.prStatus,
        latestRunRiskFindings: schema.runs.riskFindings,
        latestRunRunnerDisplayName: schema.runners.displayName,
        latestRunRunnerId: schema.runners.id,
        latestRunState: schema.runs.state,
        latestRunUpdatedAt: schema.runs.updatedAt,
        mode: schema.tasks.mode,
        repoMappingId: schema.repoMappings.id,
        repositoryName: schema.repoMappings.repositoryName,
        repositoryOwner: schema.repoMappings.repositoryOwner,
        requestedByActorId: schema.tasks.requestedByActorId,
        sourceType: schema.tasks.sourceType,
        status: schema.tasks.status,
        title: schema.tasks.title,
        updatedAt: schema.tasks.updatedAt,
        workspaceId: schema.tasks.workspaceId,
      })
      .from(schema.tasks)
      .innerJoin(
        schema.repoMappings,
        and(
          eq(schema.repoMappings.id, schema.tasks.repoMappingId),
          eq(schema.repoMappings.workspaceId, workspaceId),
        ),
      )
      .leftJoin(
        schema.runs,
        and(eq(schema.runs.taskId, schema.tasks.id), eq(schema.runs.workspaceId, workspaceId)),
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
      .where(
        and(
          eq(schema.tasks.workspaceId, workspaceId),
          eq(schema.tasks.sourceType, "manual"),
          inArray(schema.tasks.status, ["draft", "approved"]),
        ),
      )
      .orderBy(
        desc(schema.tasks.updatedAt),
        desc(schema.tasks.createdAt),
        desc(schema.runs.updatedAt),
      )
      .then((rows) =>
        rows
          .filter((row) => row.status === "draft" || row.status === "approved")
          .map((row) => ({
            ...row,
            status: row.status as "approved" | "draft",
          })),
      ),
  listWorkspaceTaskWorkflowValidationResults: async ({ workspaceId }) =>
    db
      .select({
        runId: schema.validationResults.runId,
        status: schema.validationResults.status,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(eq(schema.validationResults.workspaceId, workspaceId)),
});

export const createTaskWorkflowService = (input: {
  getAuthContext?: GetAuthContext;
  store: TaskWorkflowStore;
}): TaskWorkflowService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listWorkspaceTaskWorkflow: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [rows, validationResults] = await Promise.all([
        input.store.listWorkspaceTaskWorkflowRows({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceTaskWorkflowValidationResults({ workspaceId: scope.workspaceId }),
      ]);
      const validationResultsByRunId = new Map<string, TaskWorkflowValidationResultRow[]>();

      validationResults
        .filter((result) => result.workspaceId === scope.workspaceId)
        .forEach((result) => {
          const currentResults = validationResultsByRunId.get(result.runId) ?? [];

          currentResults.push(result);
          validationResultsByRunId.set(result.runId, currentResults);
        });

      const tasks = selectLatestRows(rows)
        .filter((row) => row.workspaceId === scope.workspaceId)
        .map((row) =>
          toTaskWorkflowItem(
            row,
            row.latestRunId === null ? [] : (validationResultsByRunId.get(row.latestRunId) ?? []),
          ),
        );

      return {
        summary: createSummary(tasks),
        tasks,
      };
    },
  };
};

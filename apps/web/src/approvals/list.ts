import "server-only";

import type {
  DryRunResultStatus,
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
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
  countUniquePaths,
  summarizeRiskFindings,
  summarizeValidationStatuses,
  type RiskCategoryCount,
  type ValidationStatusCount,
} from "../runs/review-metadata";

const WORKSPACE_ID_MAX_LENGTH = 160;
const approvalQueueRunStates = ["awaiting_approval"] satisfies RunState[];

export type ApprovalQueuePr = {
  number: number;
  status: PrArtifactStatus;
  title: string;
  url: string | null;
};

export type ApprovalQueueItem = {
  evidence: {
    blockerCount: number;
    changedFileCount: number;
    reviewReady: boolean;
    riskCategoryCounts: RiskCategoryCount[];
    validationStatusCounts: ValidationStatusCount[];
    warningCount: number;
  };
  id: string;
  mode: TaskPacketMode;
  pr: ApprovalQueuePr | null;
  repoMapping: {
    id: string;
    repositoryName: string;
    repositoryOwner: string;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  repair: {
    attemptCount: number;
    latestRequestedAt: Date | null;
    maxAttempts: number | null;
  };
  state: RunState;
  task: {
    id: string;
    title: string;
  };
  updatedAt: Date;
};

export type ApprovalQueueRunRow = {
  dryRunBlockerCount: number | null;
  dryRunStatus: DryRunResultStatus | null;
  dryRunWarningCount: number | null;
  id: string;
  lastEventAt: Date | null;
  mode: TaskPacketMode;
  prChangedFilePaths: string[] | null;
  prNumber: number | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
  prTitle: string | null;
  prUrl: string | null;
  repoMappingId: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: RiskFinding[];
  runnerDisplayName: string | null;
  runnerId: string | null;
  state: RunState;
  taskId: string;
  taskTitle: string;
  updatedAt: Date;
  workspaceId: string;
};

export type ApprovalQueueValidationResultRow = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

export type ApprovalQueueRepairRequestRow = {
  attempt: number;
  createdAt: Date;
  maxAttempts: number;
  previousRunId: string;
  workspaceId: string;
};

export type ApprovalQueueStore = WorkspaceMembershipStore & {
  listWorkspaceApprovalRepairRequests: (input: {
    workspaceId: string;
  }) => Promise<ApprovalQueueRepairRequestRow[]>;
  listWorkspaceApprovalRuns: (input: { workspaceId: string }) => Promise<ApprovalQueueRunRow[]>;
  listWorkspaceApprovalValidationResults: (input: {
    workspaceId: string;
  }) => Promise<ApprovalQueueValidationResultRow[]>;
};

export type ApprovalQueueService = {
  listWorkspaceApprovals: (input: { workspaceId: string }) => Promise<ApprovalQueueItem[]>;
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

const unsafeArtifactTextPattern =
  /(?:\bdiff --git\b|@@ -\d|-----BEGIN|(?:^|[\s"'([{:=,])(?:\/(?!\/)|[a-z]:[\\/]|\\\\)|\b(?:const|let|var|function|class|import|export)\s+[A-Za-z_$]|process\.env|=>|[?&](?:token|access_token|secret|password)=)/i;

const toSafePrUrl = (prUrl: string | null): string | null => {
  if (prUrl === null || unsafeArtifactTextPattern.test(prUrl)) {
    return null;
  }

  try {
    const url = new URL(prUrl.trim());

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

const toSafeArtifactText = (value: string | null, fallback: string): string => {
  const normalizedValue = value?.trim() ?? "";

  return normalizedValue.length === 0 || unsafeArtifactTextPattern.test(normalizedValue)
    ? fallback
    : normalizedValue;
};

const toPr = (run: ApprovalQueueRunRow): ApprovalQueuePr | null => {
  if (run.prNumber === null || run.prStatus === null) {
    return null;
  }

  return {
    number: run.prNumber,
    status: run.prStatus,
    title: toSafeArtifactText(run.prTitle, `Pull request #${run.prNumber}`),
    url: toSafePrUrl(run.prUrl),
  };
};

const toApprovalQueueItem = (
  run: ApprovalQueueRunRow,
  validationResults: ApprovalQueueValidationResultRow[],
  repairRequests: ApprovalQueueRepairRequestRow[],
): ApprovalQueueItem => {
  const riskSummary = summarizeRiskFindings(run.riskFindings, run.prRiskFindings);
  const validationStatusCounts = summarizeValidationStatuses(
    validationResults.map((validationResult) => validationResult.status),
  );
  const changedFileCount = countUniquePaths(run.prChangedFilePaths);
  const pr = toPr(run);
  const latestRepairRequest = repairRequests.toSorted(
    (left, right) => right.createdAt.getTime() - left.createdAt.getTime(),
  )[0];
  const maxRepairAttempts =
    repairRequests.length === 0
      ? null
      : Math.max(...repairRequests.map((repairRequest) => repairRequest.maxAttempts));

  return {
    evidence: {
      blockerCount: riskSummary.blockerCount + (run.dryRunBlockerCount ?? 0),
      changedFileCount,
      reviewReady:
        pr !== null &&
        validationStatusCounts.length > 0 &&
        changedFileCount > 0 &&
        run.dryRunStatus !== null,
      riskCategoryCounts: riskSummary.categoryCounts,
      validationStatusCounts,
      warningCount: riskSummary.warningCount + (run.dryRunWarningCount ?? 0),
    },
    id: run.id,
    mode: run.mode,
    pr,
    repoMapping: {
      id: run.repoMappingId,
      repositoryName: run.repositoryName,
      repositoryOwner: run.repositoryOwner,
    },
    runner:
      run.runnerId === null || run.runnerDisplayName === null
        ? null
        : {
            displayName: run.runnerDisplayName,
            id: run.runnerId,
          },
    repair: {
      attemptCount: repairRequests.length,
      latestRequestedAt: latestRepairRequest?.createdAt ?? null,
      maxAttempts: maxRepairAttempts,
    },
    state: run.state,
    task: {
      id: run.taskId,
      title: run.taskTitle,
    },
    updatedAt: run.lastEventAt ?? run.updatedAt,
  };
};

export const createDrizzleApprovalQueueStore = (db: Database): ApprovalQueueStore => ({
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
  listWorkspaceApprovalRepairRequests: async ({ workspaceId }) =>
    db
      .select({
        attempt: schema.repairRequests.attempt,
        createdAt: schema.repairRequests.createdAt,
        maxAttempts: schema.repairRequests.maxAttempts,
        previousRunId: schema.repairRequests.previousRunId,
        workspaceId: schema.repairRequests.workspaceId,
      })
      .from(schema.repairRequests)
      .where(eq(schema.repairRequests.workspaceId, workspaceId)),
  listWorkspaceApprovalRuns: async ({ workspaceId }) =>
    db
      .select({
        dryRunBlockerCount: schema.dryRunResults.blockers,
        dryRunStatus: schema.dryRunResults.status,
        dryRunWarningCount: schema.dryRunResults.warnings,
        id: schema.runs.id,
        lastEventAt: schema.runs.lastEventAt,
        mode: schema.runs.mode,
        prChangedFilePaths: schema.prArtifacts.changedFilePaths,
        prNumber: schema.prArtifacts.prNumber,
        prRiskFindings: schema.prArtifacts.riskFindings,
        prStatus: schema.prArtifacts.prStatus,
        prTitle: schema.prArtifacts.prTitle,
        prUrl: schema.prArtifacts.prUrl,
        repoMappingId: schema.repoMappings.id,
        repositoryName: schema.repoMappings.repositoryName,
        repositoryOwner: schema.repoMappings.repositoryOwner,
        riskFindings: schema.runs.riskFindings,
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
        and(eq(schema.runs.taskId, schema.tasks.id), eq(schema.tasks.workspaceId, workspaceId)),
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
      .where(
        and(
          eq(schema.runs.workspaceId, workspaceId),
          inArray(schema.runs.state, approvalQueueRunStates),
        ),
      )
      .orderBy(desc(schema.runs.updatedAt), desc(schema.runs.createdAt))
      .then((rows) =>
        rows.map((row) => ({
          ...row,
          dryRunBlockerCount: Array.isArray(row.dryRunBlockerCount)
            ? row.dryRunBlockerCount.length
            : null,
          dryRunWarningCount: Array.isArray(row.dryRunWarningCount)
            ? row.dryRunWarningCount.length
            : null,
        })),
      ),
  listWorkspaceApprovalValidationResults: async ({ workspaceId }) =>
    db
      .select({
        runId: schema.validationResults.runId,
        status: schema.validationResults.status,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(eq(schema.validationResults.workspaceId, workspaceId)),
});

export const createApprovalQueueService = (input: {
  getAuthContext?: GetAuthContext;
  store: ApprovalQueueStore;
}): ApprovalQueueService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listWorkspaceApprovals: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [runs, validationResults, repairRequests] = await Promise.all([
        input.store.listWorkspaceApprovalRuns({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceApprovalValidationResults({ workspaceId: scope.workspaceId }),
        input.store.listWorkspaceApprovalRepairRequests({ workspaceId: scope.workspaceId }),
      ]);
      const validationResultsByRunId = new Map<string, ApprovalQueueValidationResultRow[]>();
      const repairRequestsByRunId = new Map<string, ApprovalQueueRepairRequestRow[]>();

      validationResults
        .filter((result) => result.workspaceId === scope.workspaceId)
        .forEach((result) => {
          const currentResults = validationResultsByRunId.get(result.runId) ?? [];

          currentResults.push(result);
          validationResultsByRunId.set(result.runId, currentResults);
        });
      repairRequests
        .filter((repairRequest) => repairRequest.workspaceId === scope.workspaceId)
        .forEach((repairRequest) => {
          const currentRequests = repairRequestsByRunId.get(repairRequest.previousRunId) ?? [];

          currentRequests.push(repairRequest);
          repairRequestsByRunId.set(repairRequest.previousRunId, currentRequests);
        });

      return runs
        .filter((run) => run.workspaceId === scope.workspaceId)
        .map((run) =>
          toApprovalQueueItem(
            run,
            validationResultsByRunId.get(run.id) ?? [],
            repairRequestsByRunId.get(run.id) ?? [],
          ),
        );
    },
  };
};

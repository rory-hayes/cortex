import "server-only";

import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  TaskPacketMode,
  ValidationResultStatus,
} from "@control-plane/shared";

import { and, desc, eq, schema, type Database } from "../db";
import {
  countUniquePaths,
  deriveReviewStateBucket,
  summarizeRiskFindings,
  summarizeValidationStatuses,
  type ReviewStateBucket,
  type RiskCategoryCount,
  type ValidationStatusCount,
} from "./review-metadata";
import { hasUnsafeArtifactText } from "./artifact-safety";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createActionError } from "../server/errors";

const WORKSPACE_ID_MAX_LENGTH = 160;

export type RunListPr = {
  number: number;
  status: PrArtifactStatus;
  url: string | null;
};

export type RunListItem = {
  id: string;
  mode: TaskPacketMode;
  pr: RunListPr | null;
  repoMapping: {
    id: string;
    repositoryName: string;
    repositoryOwner: string;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  review: {
    blockerCount: number;
    changedFileCount: number;
    prReady: boolean;
    riskCategoryCounts: RiskCategoryCount[];
    stateBucket: ReviewStateBucket;
    validationStatusCounts: ValidationStatusCount[];
    warningCount: number;
  };
  state: RunState;
  task: {
    id: string;
    title: string;
  };
  updatedAt: Date;
};

export type RunListStoreRow = {
  changedPaths: string[];
  createdAt: Date;
  id: string;
  lastEventAt: Date | null;
  mode: TaskPacketMode;
  prChangedFilePaths: string[] | null;
  prNumber: number | null;
  prRiskFindings: RiskFinding[] | null;
  prStatus: PrArtifactStatus | null;
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

export type RunListValidationResultRow = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

export type RunListStore = WorkspaceMembershipStore & {
  listWorkspaceRuns: (input: { workspaceId: string }) => Promise<RunListStoreRow[]>;
  listWorkspaceRunValidationResults: (input: {
    workspaceId: string;
  }) => Promise<RunListValidationResultRow[]>;
};

export type RunListService = {
  listWorkspaceRuns: (input: { workspaceId: string }) => Promise<RunListItem[]>;
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

const countReviewFileMetadata = (run: RunListStoreRow): number => {
  if (
    run.state !== "awaiting_approval" &&
    run.prChangedFilePaths !== null &&
    run.prChangedFilePaths.length > 0
  ) {
    return countUniquePaths(run.prChangedFilePaths);
  }

  return countUniquePaths(run.changedPaths, run.prChangedFilePaths);
};

const toRunListItem = (
  run: RunListStoreRow,
  validationResults: RunListValidationResultRow[],
): RunListItem => {
  const riskSummary = summarizeRiskFindings(run.riskFindings, run.prRiskFindings);

  return {
    id: run.id,
    mode: run.mode,
    pr:
      run.prNumber === null || run.prStatus === null
        ? null
        : {
            number: run.prNumber,
            status: run.prStatus,
            url: toSafePrUrl(run.prUrl),
          },
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
    review: {
      blockerCount: riskSummary.blockerCount,
      changedFileCount: countReviewFileMetadata(run),
      prReady:
        run.state === "awaiting_approval" && run.prNumber !== null && run.prStatus !== null,
      riskCategoryCounts: riskSummary.categoryCounts,
      stateBucket: deriveReviewStateBucket({ prStatus: run.prStatus, state: run.state }),
      validationStatusCounts: summarizeValidationStatuses(
        validationResults.map((validationResult) => validationResult.status),
      ),
      warningCount: riskSummary.warningCount,
    },
    state: run.state,
    task: {
      id: run.taskId,
      title: run.taskTitle,
    },
    updatedAt: run.lastEventAt ?? run.updatedAt,
  };
};

export const createDrizzleRunListStore = (db: Database): RunListStore => ({
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
  listWorkspaceRuns: async ({ workspaceId }) =>
    db
      .select({
        changedPaths: schema.runs.changedPaths,
        createdAt: schema.runs.createdAt,
        id: schema.runs.id,
        lastEventAt: schema.runs.lastEventAt,
        mode: schema.runs.mode,
        prChangedFilePaths: schema.prArtifacts.changedFilePaths,
        prNumber: schema.prArtifacts.prNumber,
        prRiskFindings: schema.prArtifacts.riskFindings,
        prStatus: schema.prArtifacts.prStatus,
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
      .where(eq(schema.runs.workspaceId, workspaceId))
      .orderBy(desc(schema.runs.updatedAt), desc(schema.runs.createdAt)),
  listWorkspaceRunValidationResults: async ({ workspaceId }) =>
    db
      .select({
        runId: schema.validationResults.runId,
        status: schema.validationResults.status,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(eq(schema.validationResults.workspaceId, workspaceId)),
});

export const createRunListService = (input: {
  getAuthContext?: GetAuthContext;
  store: RunListStore;
}): RunListService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listWorkspaceRuns: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [runs, validationResults] = await Promise.all([
        input.store.listWorkspaceRuns({
          workspaceId: scope.workspaceId,
        }),
        input.store.listWorkspaceRunValidationResults({
          workspaceId: scope.workspaceId,
        }),
      ]);
      const validationResultsByRunId = new Map<string, RunListValidationResultRow[]>();

      validationResults
        .filter((result) => result.workspaceId === scope.workspaceId)
        .forEach((result) => {
          const currentResults = validationResultsByRunId.get(result.runId) ?? [];

          currentResults.push(result);
          validationResultsByRunId.set(result.runId, currentResults);
        });

      return runs
        .filter((run) => run.workspaceId === scope.workspaceId)
        .map((run) => toRunListItem(run, validationResultsByRunId.get(run.id) ?? []));
    },
  };
};

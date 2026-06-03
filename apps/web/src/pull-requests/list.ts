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
import { hasUnsafeArtifactText, hasUnsafePathText } from "../runs/artifact-safety";
import type { GitHubChecksSummary, GitHubPrReviewState } from "../github/pull-requests";

const WORKSPACE_ID_MAX_LENGTH = 160;

export type PullRequestListItem = {
  branchName: string;
  changedFileCount: number;
  changedFilePaths: string[];
  checks: GitHubChecksSummary;
  createdAt: Date;
  githubSyncedAt: Date | null;
  id: string;
  number: number;
  repository: {
    name: string;
    owner: string;
  };
  risk: {
    blockerCount: number;
    categoryCounts: RiskCategoryCount[];
    warningCount: number;
  };
  run: {
    id: string;
    mode: TaskPacketMode;
    state: RunState;
  };
  runner: {
    displayName: string;
    id: string;
  } | null;
  reviewState: GitHubPrReviewState;
  status: PrArtifactStatus;
  task: {
    id: string;
    title: string;
  };
  title: string;
  updatedAt: Date;
  url: string | null;
  validationStatusCounts: ValidationStatusCount[];
};

export type PullRequestListStoreRow = {
  branchName: string;
  changedFilePaths: string[];
  createdAt: Date;
  githubChecksSummary: GitHubChecksSummary;
  githubReviewState: GitHubPrReviewState;
  githubSyncedAt: Date | null;
  id: string;
  prNumber: number;
  prStatus: PrArtifactStatus;
  prTitle: string;
  prUrl: string;
  repositoryName: string;
  repositoryOwner: string;
  riskFindings: RiskFinding[];
  runId: string;
  runMode: TaskPacketMode;
  runRiskFindings: RiskFinding[];
  runState: RunState;
  runnerDisplayName: string | null;
  runnerId: string | null;
  taskId: string;
  taskTitle: string;
  updatedAt: Date;
  workspaceId: string;
};

export type PullRequestListValidationResultRow = {
  runId: string;
  status: ValidationResultStatus;
  workspaceId: string;
};

export type PullRequestListStore = WorkspaceMembershipStore & {
  listWorkspacePullRequests: (input: { workspaceId: string }) => Promise<PullRequestListStoreRow[]>;
  listWorkspacePullRequestValidationResults: (input: {
    workspaceId: string;
  }) => Promise<PullRequestListValidationResultRow[]>;
};

export type PullRequestListService = {
  listWorkspacePullRequests: (input: { workspaceId: string }) => Promise<PullRequestListItem[]>;
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

const toSafeArtifactText = (value: string, fallback: string): string => {
  const normalizedValue = value.trim();

  return normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)
    ? fallback
    : normalizedValue;
};

const toSafeUrl = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)) {
    return null;
  }

  try {
    const url = new URL(normalizedValue);

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

const toSafeChangedFilePaths = (changedFilePaths: string[]): string[] =>
  Array.from(
    new Set(
      changedFilePaths
        .map((changedFilePath) => changedFilePath.trim())
        .filter(
          (changedFilePath) => changedFilePath.length > 0 && !hasUnsafePathText(changedFilePath),
        ),
    ),
  ).toSorted((left, right) => left.localeCompare(right));

const unknownChecksSummary: GitHubChecksSummary = {
  conclusion: "unknown",
  failedCount: 0,
  passedCount: 0,
  pendingCount: 0,
  skippedCount: 0,
  totalCount: 0,
};

const isNonNegativeInteger = (value: number): boolean => Number.isSafeInteger(value) && value >= 0;

const toSafeReviewState = (value: GitHubPrReviewState): GitHubPrReviewState => {
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

const toSafeChecksSummary = (value: GitHubChecksSummary): GitHubChecksSummary => {
  if (
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

const toPullRequestListItem = (
  row: PullRequestListStoreRow,
  validationResults: PullRequestListValidationResultRow[],
): PullRequestListItem => {
  const risk = summarizeRiskFindings(row.runRiskFindings, row.riskFindings);
  const changedFilePaths = toSafeChangedFilePaths(row.changedFilePaths);

  return {
    branchName: toSafeArtifactText(row.branchName, "Branch unavailable"),
    changedFileCount: countUniquePaths(changedFilePaths),
    changedFilePaths,
    checks: toSafeChecksSummary(row.githubChecksSummary),
    createdAt: row.createdAt,
    githubSyncedAt: toSafeOptionalDate(row.githubSyncedAt),
    id: row.id,
    number: row.prNumber,
    repository: {
      name: toSafeArtifactText(row.repositoryName, "unknown"),
      owner: toSafeArtifactText(row.repositoryOwner, "Repository unavailable"),
    },
    risk: {
      blockerCount: risk.blockerCount,
      categoryCounts: risk.categoryCounts,
      warningCount: risk.warningCount,
    },
    run: {
      id: row.runId,
      mode: row.runMode,
      state: row.runState,
    },
    runner:
      row.runnerId === null || row.runnerDisplayName === null
        ? null
        : {
            displayName: row.runnerDisplayName,
            id: row.runnerId,
          },
    reviewState: toSafeReviewState(row.githubReviewState),
    status: row.prStatus,
    task: {
      id: row.taskId,
      title: row.taskTitle,
    },
    title: toSafeArtifactText(row.prTitle, `Pull request #${row.prNumber}`),
    updatedAt: row.updatedAt,
    url: toSafeUrl(row.prUrl),
    validationStatusCounts: summarizeValidationStatuses(
      validationResults.map((validationResult) => validationResult.status),
    ),
  };
};

export const createDrizzlePullRequestListStore = (db: Database): PullRequestListStore => ({
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
  listWorkspacePullRequests: async ({ workspaceId }) =>
    db
      .select({
        branchName: schema.prArtifacts.branchName,
        changedFilePaths: schema.prArtifacts.changedFilePaths,
        createdAt: schema.prArtifacts.createdAt,
        githubChecksSummary: schema.prArtifacts.githubChecksSummary,
        githubReviewState: schema.prArtifacts.githubReviewState,
        githubSyncedAt: schema.prArtifacts.githubSyncedAt,
        id: schema.prArtifacts.id,
        prNumber: schema.prArtifacts.prNumber,
        prStatus: schema.prArtifacts.prStatus,
        prTitle: schema.prArtifacts.prTitle,
        prUrl: schema.prArtifacts.prUrl,
        repositoryName: schema.prArtifacts.repositoryName,
        repositoryOwner: schema.prArtifacts.repositoryOwner,
        riskFindings: schema.prArtifacts.riskFindings,
        runId: schema.runs.id,
        runMode: schema.runs.mode,
        runRiskFindings: schema.runs.riskFindings,
        runState: schema.runs.state,
        runnerDisplayName: schema.runners.displayName,
        runnerId: schema.runners.id,
        taskId: schema.tasks.id,
        taskTitle: schema.tasks.title,
        updatedAt: schema.prArtifacts.updatedAt,
        workspaceId: schema.prArtifacts.workspaceId,
      })
      .from(schema.prArtifacts)
      .innerJoin(
        schema.runs,
        and(eq(schema.prArtifacts.runId, schema.runs.id), eq(schema.runs.workspaceId, workspaceId)),
      )
      .innerJoin(
        schema.tasks,
        and(eq(schema.runs.taskId, schema.tasks.id), eq(schema.tasks.workspaceId, workspaceId)),
      )
      .leftJoin(
        schema.runners,
        and(
          eq(schema.runs.runnerId, schema.runners.id),
          eq(schema.runners.workspaceId, workspaceId),
        ),
      )
      .where(eq(schema.prArtifacts.workspaceId, workspaceId))
      .orderBy(desc(schema.prArtifacts.updatedAt), desc(schema.prArtifacts.createdAt)),
  listWorkspacePullRequestValidationResults: async ({ workspaceId }) =>
    db
      .select({
        runId: schema.validationResults.runId,
        status: schema.validationResults.status,
        workspaceId: schema.validationResults.workspaceId,
      })
      .from(schema.validationResults)
      .where(eq(schema.validationResults.workspaceId, workspaceId)),
});

export const createPullRequestListService = (input: {
  getAuthContext?: GetAuthContext;
  store: PullRequestListStore;
}): PullRequestListService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;

  return {
    listWorkspacePullRequests: async ({ workspaceId }) => {
      const normalizedWorkspaceId = normalizeWorkspaceId(workspaceId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const [pullRequests, validationResults] = await Promise.all([
        input.store.listWorkspacePullRequests({
          workspaceId: scope.workspaceId,
        }),
        input.store.listWorkspacePullRequestValidationResults({
          workspaceId: scope.workspaceId,
        }),
      ]);
      const validationResultsByRunId = new Map<string, PullRequestListValidationResultRow[]>();

      validationResults
        .filter((result) => result.workspaceId === scope.workspaceId)
        .forEach((result) => {
          const currentResults = validationResultsByRunId.get(result.runId) ?? [];

          currentResults.push(result);
          validationResultsByRunId.set(result.runId, currentResults);
        });

      return pullRequests
        .filter((pullRequest) => pullRequest.workspaceId === scope.workspaceId)
        .map((pullRequest) =>
          toPullRequestListItem(pullRequest, validationResultsByRunId.get(pullRequest.runId) ?? []),
        );
    },
  };
};

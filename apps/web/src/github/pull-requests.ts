import "server-only";

import { randomUUID } from "node:crypto";

import type {
  GitHubAppClient,
  GitHubPullRequestCheckSummary,
  GitHubPullRequestMetadata,
  GitHubPullRequestReviewSummary,
} from "@control-plane/github";
import type { PrArtifactStatus } from "@control-plane/shared";

import { and, eq, schema, type Database, type GitHubPrChecksSummary } from "../db";
import {
  getCurrentAuthContext,
  requireWorkspaceMembership,
  type GetAuthContext,
  type WorkspaceMembershipStore,
} from "../server/auth";
import { createAuditEventInsert, type AuditEventInsert } from "../server/audit";
import { createActionError } from "../server/errors";

export type GitHubPrReviewState = "approved" | "changes_requested" | "review_required" | "unknown";

export type GitHubChecksSummary = GitHubPrChecksSummary;

export type PullRequestArtifactRefreshRow = {
  branchName: string;
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
  runId: string;
  updatedAt: Date;
  workspaceId: string;
};

export type PullRequestInstallationRow = {
  githubInstallationId: string;
};

export type UpdatePullRequestGitHubMetadataInput = {
  githubChecksSummary: GitHubChecksSummary;
  githubReviewState: GitHubPrReviewState;
  githubSyncedAt: Date;
  prArtifactId: string;
  prStatus: PrArtifactStatus;
  prTitle: string;
  prUrl: string;
  updatedAt: Date;
  workspaceId: string;
};

export type PullRequestRefreshStore = WorkspaceMembershipStore & {
  findGitHubInstallationForPullRequest: (input: {
    repositoryName: string;
    repositoryOwner: string;
    workspaceId: string;
  }) => Promise<PullRequestInstallationRow | null>;
  getPullRequestArtifactForRefresh: (input: {
    prArtifactId: string;
    workspaceId: string;
  }) => Promise<PullRequestArtifactRefreshRow | null>;
  insertAuditEvent: (event: AuditEventInsert) => Promise<void>;
  updatePullRequestGitHubMetadata: (
    input: UpdatePullRequestGitHubMetadataInput,
  ) => Promise<PullRequestArtifactRefreshRow>;
};

export type PullRequestRefreshMetadata = {
  checksSummary: GitHubChecksSummary;
  githubSyncedAt: Date;
  id: string;
  number: number;
  repository: {
    name: string;
    owner: string;
  };
  reviewState: GitHubPrReviewState;
  runId: string;
  status: PrArtifactStatus;
  title: string;
  url: string;
};

export type PullRequestRefreshResult =
  | {
      artifact: PullRequestRefreshMetadata;
      status: "refreshed";
    }
  | {
      prArtifactId: string;
      reason: "missing_installation";
      status: "skipped";
    };

export type PullRequestRefreshService = {
  refreshPullRequestStatus: (input: {
    prArtifactId: string;
    workspaceId: string;
  }) => Promise<PullRequestRefreshResult>;
};

const idMaxLength = 160;

const hasControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;

    return codePoint < 32 || codePoint === 127;
  });

const normalizeRequiredId = (value: string): string => {
  const normalizedValue = value.trim();

  if (
    normalizedValue.length === 0 ||
    normalizedValue.length > idMaxLength ||
    hasControlCharacter(normalizedValue)
  ) {
    throw createActionError("validation_error");
  }

  return normalizedValue;
};

const parseInstallationId = (value: string): number => {
  const normalizedValue = value.trim();

  if (!/^\d{1,15}$/u.test(normalizedValue)) {
    throw createActionError("validation_error");
  }

  const installationId = Number(normalizedValue);

  if (!Number.isSafeInteger(installationId) || installationId <= 0) {
    throw createActionError("validation_error");
  }

  return installationId;
};

const repositoryKey = (input: { name: string; owner: string }): string =>
  `${input.owner.toLowerCase()}/${input.name.toLowerCase()}`;

const assertMatchingPullRequest = (
  artifact: PullRequestArtifactRefreshRow,
  pullRequest: GitHubPullRequestMetadata,
) => {
  if (
    artifact.prNumber !== pullRequest.number ||
    repositoryKey({
      name: artifact.repositoryName,
      owner: artifact.repositoryOwner,
    }) !==
      repositoryKey({
        name: pullRequest.repository.name,
        owner: pullRequest.repository.owner,
      })
  ) {
    throw createActionError("validation_error");
  }
};

const toPrStatus = (pullRequest: GitHubPullRequestMetadata): PrArtifactStatus => {
  if (pullRequest.merged) {
    return "merged";
  }

  if (pullRequest.state === "closed") {
    return "closed";
  }

  if (pullRequest.draft) {
    return "draft";
  }

  return "open";
};

export const deriveGitHubReviewState = (
  reviews: GitHubPullRequestReviewSummary,
): GitHubPrReviewState => {
  if (reviews.states.changes_requested > 0) {
    return "changes_requested";
  }

  if (reviews.states.approved > 0) {
    return "approved";
  }

  if (reviews.totalCount > 0) {
    return "review_required";
  }

  return "unknown";
};

export const deriveGitHubChecksSummary = (
  checks: GitHubPullRequestCheckSummary,
): GitHubChecksSummary => {
  const passedCount = checks.conclusionCounts.success + checks.conclusionCounts.neutral;
  const failedCount =
    checks.conclusionCounts.action_required +
    checks.conclusionCounts.cancelled +
    checks.conclusionCounts.failure +
    checks.conclusionCounts.stale +
    checks.conclusionCounts.startup_failure +
    checks.conclusionCounts.timed_out;
  const skippedCount = checks.conclusionCounts.skipped;
  const pendingCount = Math.max(checks.totalCount - passedCount - failedCount - skippedCount, 0);
  const conclusion =
    checks.totalCount === 0
      ? "unknown"
      : failedCount > 0
        ? "failing"
        : pendingCount > 0
          ? "pending"
          : passedCount + skippedCount === checks.totalCount
            ? "passing"
            : "unknown";

  return {
    conclusion,
    failedCount,
    passedCount,
    pendingCount,
    skippedCount,
    totalCount: checks.totalCount,
  };
};

const toRefreshMetadata = (
  artifact: PullRequestArtifactRefreshRow,
): PullRequestRefreshMetadata => ({
  checksSummary: artifact.githubChecksSummary,
  githubSyncedAt: artifact.githubSyncedAt ?? artifact.updatedAt,
  id: artifact.id,
  number: artifact.prNumber,
  repository: {
    name: artifact.repositoryName,
    owner: artifact.repositoryOwner,
  },
  reviewState: artifact.githubReviewState,
  runId: artifact.runId,
  status: artifact.prStatus,
  title: artifact.prTitle,
  url: artifact.prUrl,
});

export const createDrizzlePullRequestRefreshStore = (db: Database): PullRequestRefreshStore => ({
  findGitHubInstallationForPullRequest: async ({
    repositoryName,
    repositoryOwner,
    workspaceId,
  }) => {
    const [installation] = await db
      .select({
        githubInstallationId: schema.githubRepositories.githubInstallationId,
      })
      .from(schema.githubRepositories)
      .where(
        and(
          eq(schema.githubRepositories.workspaceId, workspaceId),
          eq(schema.githubRepositories.repositoryOwner, repositoryOwner),
          eq(schema.githubRepositories.repositoryName, repositoryName),
        ),
      )
      .limit(1);

    return installation ?? null;
  },
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
  getPullRequestArtifactForRefresh: async ({ prArtifactId, workspaceId }) => {
    const [artifact] = await db
      .select({
        branchName: schema.prArtifacts.branchName,
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
        runId: schema.prArtifacts.runId,
        updatedAt: schema.prArtifacts.updatedAt,
        workspaceId: schema.prArtifacts.workspaceId,
      })
      .from(schema.prArtifacts)
      .where(
        and(
          eq(schema.prArtifacts.id, prArtifactId),
          eq(schema.prArtifacts.workspaceId, workspaceId),
        ),
      )
      .limit(1);

    return artifact ?? null;
  },
  insertAuditEvent: async (event) => {
    await db.insert(schema.auditEvents).values(event);
  },
  updatePullRequestGitHubMetadata: async (metadata) => {
    const [artifact] = await db
      .update(schema.prArtifacts)
      .set({
        githubChecksSummary: metadata.githubChecksSummary,
        githubReviewState: metadata.githubReviewState,
        githubSyncedAt: metadata.githubSyncedAt,
        prStatus: metadata.prStatus,
        prTitle: metadata.prTitle,
        prUrl: metadata.prUrl,
        updatedAt: metadata.updatedAt,
      })
      .where(
        and(
          eq(schema.prArtifacts.id, metadata.prArtifactId),
          eq(schema.prArtifacts.workspaceId, metadata.workspaceId),
        ),
      )
      .returning({
        branchName: schema.prArtifacts.branchName,
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
        runId: schema.prArtifacts.runId,
        updatedAt: schema.prArtifacts.updatedAt,
        workspaceId: schema.prArtifacts.workspaceId,
      });

    if (artifact === undefined) {
      throw createActionError("validation_error");
    }

    return artifact;
  },
});

export const createPullRequestRefreshService = (input: {
  createAuditEventId?: () => string;
  getAuthContext?: GetAuthContext;
  githubClient: GitHubAppClient;
  now?: () => Date;
  store: PullRequestRefreshStore;
}): PullRequestRefreshService => {
  const getAuthContext = input.getAuthContext ?? getCurrentAuthContext;
  const now = input.now ?? (() => new Date());

  return {
    refreshPullRequestStatus: async ({ prArtifactId, workspaceId }) => {
      const normalizedWorkspaceId = normalizeRequiredId(workspaceId);
      const normalizedPrArtifactId = normalizeRequiredId(prArtifactId);
      const scope = await requireWorkspaceMembership({
        getAuthContext,
        store: input.store,
        workspaceId: normalizedWorkspaceId,
      });
      const artifact = await input.store.getPullRequestArtifactForRefresh({
        prArtifactId: normalizedPrArtifactId,
        workspaceId: scope.workspaceId,
      });

      if (artifact === null) {
        throw createActionError("validation_error");
      }

      const installation = await input.store.findGitHubInstallationForPullRequest({
        repositoryName: artifact.repositoryName,
        repositoryOwner: artifact.repositoryOwner,
        workspaceId: scope.workspaceId,
      });

      if (installation === null) {
        return {
          prArtifactId: normalizedPrArtifactId,
          reason: "missing_installation",
          status: "skipped",
        };
      }

      const installationId = parseInstallationId(installation.githubInstallationId);
      const [pullRequest, reviews, checks] = await Promise.all([
        input.githubClient.getPullRequest({
          installationId,
          owner: artifact.repositoryOwner,
          pullNumber: artifact.prNumber,
          repo: artifact.repositoryName,
        }),
        input.githubClient.getPullRequestReviewSummary({
          installationId,
          owner: artifact.repositoryOwner,
          pullNumber: artifact.prNumber,
          repo: artifact.repositoryName,
        }),
        input.githubClient.getPullRequestCheckSummary({
          installationId,
          owner: artifact.repositoryOwner,
          ref: artifact.branchName,
          repo: artifact.repositoryName,
        }),
      ]);

      assertMatchingPullRequest(artifact, pullRequest);

      const syncedAt = now();
      const githubReviewState = deriveGitHubReviewState(reviews);
      const githubChecksSummary = deriveGitHubChecksSummary(checks);
      const updatedArtifact = await input.store.updatePullRequestGitHubMetadata({
        githubChecksSummary,
        githubReviewState,
        githubSyncedAt: syncedAt,
        prArtifactId: artifact.id,
        prStatus: toPrStatus(pullRequest),
        prTitle: pullRequest.title,
        prUrl: pullRequest.htmlUrl,
        updatedAt: syncedAt,
        workspaceId: scope.workspaceId,
      });

      await input.store.insertAuditEvent(
        createAuditEventInsert({
          actorId: scope.actorId,
          createId: input.createAuditEventId ?? randomUUID,
          eventType: "github_pull_request.status_refreshed",
          message: "GitHub pull request metadata refreshed.",
          metadata: {
            checksConclusion: githubChecksSummary.conclusion,
            prArtifactId: artifact.id,
            prNumber: artifact.prNumber,
            prStatus: updatedArtifact.prStatus,
            repositoryName: artifact.repositoryName,
            repositoryOwner: artifact.repositoryOwner,
            reviewState: githubReviewState,
          },
          now: () => syncedAt,
          runId: artifact.runId,
          workspaceId: scope.workspaceId,
        }),
      );

      return {
        artifact: toRefreshMetadata(updatedArtifact),
        status: "refreshed",
      };
    },
  };
};

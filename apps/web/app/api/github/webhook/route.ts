import {
  GitHubWebhookError,
  parseGitHubWebhookEnvelope,
  verifyGitHubWebhookSignature,
  type GitHubWebhookEnvelope,
  type GitHubWebhookHeaders,
  type GitHubWebhookPullRequestMetadata,
  type GitHubWebhookRepositoryMetadata,
} from "@control-plane/github";

import { getDatabase } from "@/src/db";
import {
  createDrizzleGitHubRepositoryStore,
  createGitHubRepositoryService,
} from "@/src/github/repositories";
import { createDrizzleRepoScanStore, createRepoScanService } from "@/src/repo-readiness/repo-scans";
import {
  createDrizzleSetupPrMergeResolutionStore,
  createSetupPrMergeResolutionService,
} from "@/src/setup-pr/resolution";
import { createRouteError, createRunnerRouteHandler } from "../../../../src/server/route-handlers";

type AcceptedGitHubWebhook = {
  status: "accepted";
  deliveryId: string;
  eventName: string;
  action: string;
  installationId: number;
};

const toGitHubWebhookHeaders = (headers: Headers): GitHubWebhookHeaders => {
  const convertedHeaders: GitHubWebhookHeaders = {};

  headers.forEach((value, key) => {
    convertedHeaders[key] = value;
  });

  return convertedHeaders;
};

const parseJsonPayload = (rawBody: string): unknown => {
  try {
    return JSON.parse(rawBody);
  } catch {
    throw createRouteError("invalid_request");
  }
};

const rejectInvalidWebhook = (error: unknown): never => {
  if (error instanceof GitHubWebhookError) {
    throw createRouteError("invalid_request");
  }

  throw error;
};

const parseVerifiedWebhook = (
  headers: GitHubWebhookHeaders,
  rawBody: string,
): GitHubWebhookEnvelope => {
  try {
    verifyGitHubWebhookSignature({
      headers,
      payload: rawBody,
      secret: process.env.GITHUB_WEBHOOK_SECRET,
    });

    return parseGitHubWebhookEnvelope({
      headers,
      payload: parseJsonPayload(rawBody),
    });
  } catch (error) {
    return rejectInvalidWebhook(error);
  }
};

const toAcceptedWebhook = (envelope: GitHubWebhookEnvelope): AcceptedGitHubWebhook => ({
  action: envelope.action,
  deliveryId: envelope.deliveryId,
  eventName: envelope.eventName,
  installationId: envelope.installationId,
  status: "accepted",
});

const shouldSyncGitHubRepositories = (envelope: GitHubWebhookEnvelope): boolean =>
  envelope.eventName === "installation" ||
  (envelope.eventName === "installation_repositories" && envelope.action === "added");

const shouldResolveMergedSetupPr = (
  envelope: GitHubWebhookEnvelope,
): envelope is GitHubWebhookEnvelope & {
  pullRequest: GitHubWebhookPullRequestMetadata;
  repository: GitHubWebhookRepositoryMetadata;
} =>
  envelope.eventName === "pull_request" &&
  envelope.pullRequest?.merged === true &&
  envelope.repository !== undefined;

const shouldTriggerDefaultBranchPushRescan = (
  envelope: GitHubWebhookEnvelope,
): envelope is GitHubWebhookEnvelope & {
  repository: GitHubWebhookRepositoryMetadata;
} =>
  envelope.eventName === "push" &&
  envelope.push?.defaultBranchPush === true &&
  envelope.repository !== undefined;

const getGitHubRepositoryService = () => {
  const { db } = getDatabase();

  return createGitHubRepositoryService({
    store: createDrizzleGitHubRepositoryStore(db),
  });
};

const getRepoScanService = () => {
  const { db } = getDatabase();

  return createRepoScanService({
    store: createDrizzleRepoScanStore(db),
  });
};

const getSetupPrMergeResolutionService = () => {
  const { db } = getDatabase();

  return createSetupPrMergeResolutionService({
    store: createDrizzleSetupPrMergeResolutionStore(db),
  });
};

export const POST = createRunnerRouteHandler(async (request) => {
  const envelope = parseVerifiedWebhook(
    toGitHubWebhookHeaders(request.headers),
    await request.text(),
  );

  if (shouldSyncGitHubRepositories(envelope)) {
    await getGitHubRepositoryService().syncGitHubRepositoriesForWebhook({
      githubInstallationId: envelope.installationId,
      repositories: envelope.repositories,
    });
  }

  if (shouldResolveMergedSetupPr(envelope)) {
    await getSetupPrMergeResolutionService().resolveMergedSetupPrForWebhook({
      deliveryId: envelope.deliveryId,
      installationId: envelope.installationId,
      pullRequest: envelope.pullRequest,
      repository: envelope.repository,
    });
    await getRepoScanService().triggerRepoScanForWebhook({
      deliveryId: envelope.deliveryId,
      githubInstallationId: envelope.installationId,
      reason: "pull_request_merged",
      repository: envelope.repository,
    });
  }

  if (shouldTriggerDefaultBranchPushRescan(envelope)) {
    await getRepoScanService().triggerRepoScanForWebhook({
      deliveryId: envelope.deliveryId,
      githubInstallationId: envelope.installationId,
      reason: "default_branch_push",
      repository: envelope.repository,
    });
  }

  return toAcceptedWebhook(envelope);
});

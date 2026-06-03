import { readFile } from "node:fs/promises";
import { describe, expect, test, vi } from "vitest";

import type {
  GitHubAppClient,
  GitHubPullRequestCheckSummary,
  GitHubPullRequestMetadata,
  GitHubPullRequestReviewSummary,
} from "@control-plane/github";
import type { PrArtifactStatus, RiskFinding, RunState } from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importPullRequests = async () => import("./pull-requests");

type StoredPrArtifact = {
  branchName: string;
  changedFilePaths: string[];
  githubChecksSummary: {
    conclusion: "failing" | "passing" | "pending" | "unknown";
    failedCount: number;
    passedCount: number;
    pendingCount: number;
    skippedCount: number;
    totalCount: number;
  };
  githubReviewState: "approved" | "changes_requested" | "review_required" | "unknown";
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
  updatedAt: Date;
  workspaceId: string;
};

type StoredInstallation = {
  githubInstallationId: string;
};

const packageLockRisk = (): RiskFinding => ({
  category: "package_lock",
  id: "risk:package_lock",
  message: "Package lock changed.",
  paths: ["pnpm-lock.yaml"],
  severity: "warning",
});

const createArtifact = (overrides: Partial<StoredPrArtifact> = {}): StoredPrArtifact => ({
  branchName: "aicp/task-154-pr-status-tracking",
  changedFilePaths: ["apps/web/src/github/pull-requests.ts"],
  githubChecksSummary: {
    conclusion: "unknown",
    failedCount: 0,
    passedCount: 0,
    pendingCount: 0,
    skippedCount: 0,
    totalCount: 0,
  },
  githubReviewState: "unknown",
  githubSyncedAt: null,
  id: "pr_artifact_1",
  prNumber: 17,
  prStatus: "draft",
  prTitle: "TASK-154: Add PR status tracking",
  prUrl: "https://github.com/acme/control-plane/pull/17",
  repositoryName: "control-plane",
  repositoryOwner: "acme",
  riskFindings: [packageLockRisk()],
  runId: "run_1",
  updatedAt: new Date("2026-05-24T12:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const pullRequestMetadata = (
  overrides: Partial<GitHubPullRequestMetadata> = {},
): GitHubPullRequestMetadata => ({
  draft: false,
  htmlUrl: "https://github.com/acme/control-plane/pull/17",
  id: 701,
  merged: false,
  number: 17,
  repository: {
    archived: false,
    defaultBranch: "main",
    disabled: false,
    fullName: "acme/control-plane",
    htmlUrl: "https://github.com/acme/control-plane",
    id: 9001,
    name: "control-plane",
    owner: "acme",
    private: true,
    visibility: "private",
  },
  state: "open",
  title: "TASK-154: Add live PR status tracking",
  updatedAt: "2026-05-24T12:30:00.000Z",
  ...overrides,
});

const reviewSummary = (
  overrides: Partial<GitHubPullRequestReviewSummary> = {},
): GitHubPullRequestReviewSummary => ({
  states: {
    approved: 1,
    changes_requested: 0,
    commented: 0,
    dismissed: 0,
    pending: 0,
    unknown: 0,
  },
  totalCount: 1,
  urls: ["https://github.com/acme/control-plane/pull/17#pullrequestreview-801"],
  ...overrides,
});

const checkSummary = (
  overrides: Partial<GitHubPullRequestCheckSummary> = {},
): GitHubPullRequestCheckSummary => ({
  conclusionCounts: {
    action_required: 0,
    cancelled: 0,
    failure: 0,
    neutral: 0,
    skipped: 1,
    stale: 0,
    startup_failure: 0,
    success: 1,
    timed_out: 0,
    unknown: 1,
  },
  ref: "aicp/task-154-pr-status-tracking",
  statusCounts: {
    completed: 2,
    in_progress: 0,
    pending: 0,
    queued: 1,
    requested: 0,
    unknown: 0,
    waiting: 0,
  },
  totalCount: 3,
  urls: ["https://github.com/acme/control-plane/actions/runs/1"],
  ...overrides,
});

const createGitHubClient = (
  overrides: {
    checks?: GitHubPullRequestCheckSummary;
    pullRequest?: GitHubPullRequestMetadata;
    reviews?: GitHubPullRequestReviewSummary;
  } = {},
): GitHubAppClient =>
  ({
    getInstallation: vi.fn(),
    getPullRequest: vi.fn(async () => overrides.pullRequest ?? pullRequestMetadata()),
    getPullRequestCheckSummary: vi.fn(async () => overrides.checks ?? checkSummary()),
    getPullRequestReviewSummary: vi.fn(async () => overrides.reviews ?? reviewSummary()),
    listInstallationRepositories: vi.fn(),
  }) as unknown as GitHubAppClient;

const createStore = (
  input: {
    approvals?: Array<{ id: string; runId: string }>;
    artifact?: StoredPrArtifact | null;
    installation?: StoredInstallation | null;
    memberships?: Array<{ userId: string; workspaceId: string }>;
    runStates?: Record<string, RunState>;
    validationResults?: Array<{ id: string; runId: string; status: string }>;
  } = {},
) => {
  const artifact = input.artifact === undefined ? createArtifact() : input.artifact;
  const installations =
    input.installation === undefined ? { githubInstallationId: "42" } : input.installation;
  const auditEvents: unknown[] = [];
  const approvals = [...(input.approvals ?? [{ id: "approval_1", runId: "run_1" }])];
  const validationResults = [
    ...(input.validationResults ?? [{ id: "validation_1", runId: "run_1", status: "passed" }]),
  ];
  const runStates = { ...(input.runStates ?? { run_1: "awaiting_approval" as RunState }) };

  return {
    approvals,
    auditEvents,
    artifact,
    findGitHubInstallationForPullRequest: vi.fn(async () => installations),
    findWorkspaceMembership: vi.fn(async ({ userId, workspaceId }) =>
      input.memberships?.some(
        (membership) => membership.userId === userId && membership.workspaceId === workspaceId,
      )
        ? { id: "membership_1", role: "member" }
        : null,
    ),
    getPullRequestArtifactForRefresh: vi.fn(async () => artifact),
    insertAuditEvent: vi.fn(async (event: unknown) => {
      auditEvents.push(event);
    }),
    runStates,
    updatePullRequestGitHubMetadata: vi.fn(async (metadata) => {
      if (artifact === null) {
        throw new Error("No artifact to update.");
      }

      Object.assign(artifact, {
        githubChecksSummary: metadata.githubChecksSummary,
        githubReviewState: metadata.githubReviewState,
        githubSyncedAt: metadata.githubSyncedAt,
        prStatus: metadata.prStatus,
        prTitle: metadata.prTitle,
        prUrl: metadata.prUrl,
        updatedAt: metadata.updatedAt,
      });

      return artifact;
    }),
    validationResults,
  };
};

const collectObjectKeys = (value: unknown, keys: string[] = []): string[] => {
  if (typeof value !== "object" || value === null) {
    return keys;
  }

  if (Array.isArray(value)) {
    value.forEach((item) => collectObjectKeys(item, keys));

    return keys;
  }

  Object.entries(value).forEach(([key, childValue]) => {
    keys.push(key);
    collectObjectKeys(childValue, keys);
  });

  return keys;
};

const expectNoUnsafePullRequestRefreshMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const keys = collectObjectKeys(value).map((key) => key.toLowerCase());

  expect(keys).not.toEqual(
    expect.arrayContaining([
      "body",
      "checklogs",
      "comments",
      "diff",
      "logs",
      "output",
      "patch",
      "rawoutput",
      "source",
      "sourcecode",
      "stdout",
      "stderr",
      "token",
    ]),
  );
  expect(serialized).not.toMatch(
    /diff --git|@@ -1 \+1 @@|Do not expose|raw runner log|ghp_|github_pat_|PRIVATE KEY|token=/i,
  );
};

describe("GitHub pull request refresh service", () => {
  test("requires workspace membership before loading a PR artifact", async () => {
    const { createPullRequestRefreshService } = await importPullRequests();
    const store = createStore({
      memberships: [{ userId: "user_2", workspaceId: "workspace_1" }],
    });
    const service = createPullRequestRefreshService({
      getAuthContext: async () => ({ userId: "user_1" }),
      githubClient: createGitHubClient(),
      store,
    });

    await expect(
      service.refreshPullRequestStatus({
        prArtifactId: "pr_artifact_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.getPullRequestArtifactForRefresh).not.toHaveBeenCalled();
  });

  test("returns a safe skipped result when no GitHub installation mapping exists", async () => {
    const { createPullRequestRefreshService } = await importPullRequests();
    const store = createStore({
      installation: null,
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const githubClient = createGitHubClient();
    const service = createPullRequestRefreshService({
      getAuthContext: async () => ({ userId: "user_1" }),
      githubClient,
      store,
    });

    await expect(
      service.refreshPullRequestStatus({
        prArtifactId: " pr_artifact_1 ",
        workspaceId: " workspace_1 ",
      }),
    ).resolves.toEqual({
      prArtifactId: "pr_artifact_1",
      reason: "missing_installation",
      status: "skipped",
    });
    expect(store.findGitHubInstallationForPullRequest).toHaveBeenCalledWith({
      repositoryName: "control-plane",
      repositoryOwner: "acme",
      workspaceId: "workspace_1",
    });
    expect(githubClient.getPullRequest).not.toHaveBeenCalled();
    expect(store.updatePullRequestGitHubMetadata).not.toHaveBeenCalled();
  });

  test("updates status, title, URL, review state, checks summary, and sync timestamp from GitHub metadata", async () => {
    const { createPullRequestRefreshService } = await importPullRequests();
    const syncedAt = new Date("2026-05-24T12:35:00.000Z");
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const githubClient = createGitHubClient();
    const service = createPullRequestRefreshService({
      createAuditEventId: () => "audit_pr_refresh_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      githubClient,
      now: () => syncedAt,
      store,
    });

    const result = await service.refreshPullRequestStatus({
      prArtifactId: "pr_artifact_1",
      workspaceId: "workspace_1",
    });

    expect(githubClient.getPullRequest).toHaveBeenCalledWith({
      installationId: 42,
      owner: "acme",
      pullNumber: 17,
      repo: "control-plane",
    });
    expect(githubClient.getPullRequestReviewSummary).toHaveBeenCalledWith({
      installationId: 42,
      owner: "acme",
      pullNumber: 17,
      repo: "control-plane",
    });
    expect(githubClient.getPullRequestCheckSummary).toHaveBeenCalledWith({
      installationId: 42,
      owner: "acme",
      ref: "aicp/task-154-pr-status-tracking",
      repo: "control-plane",
    });
    expect(store.updatePullRequestGitHubMetadata).toHaveBeenCalledWith({
      githubChecksSummary: {
        conclusion: "pending",
        failedCount: 0,
        passedCount: 1,
        pendingCount: 1,
        skippedCount: 1,
        totalCount: 3,
      },
      githubReviewState: "approved",
      githubSyncedAt: syncedAt,
      prArtifactId: "pr_artifact_1",
      prStatus: "open",
      prTitle: "TASK-154: Add live PR status tracking",
      prUrl: "https://github.com/acme/control-plane/pull/17",
      updatedAt: syncedAt,
      workspaceId: "workspace_1",
    });
    expect(result).toEqual({
      artifact: {
        checksSummary: {
          conclusion: "pending",
          failedCount: 0,
          passedCount: 1,
          pendingCount: 1,
          skippedCount: 1,
          totalCount: 3,
        },
        githubSyncedAt: syncedAt,
        id: "pr_artifact_1",
        number: 17,
        repository: {
          name: "control-plane",
          owner: "acme",
        },
        reviewState: "approved",
        runId: "run_1",
        status: "open",
        title: "TASK-154: Add live PR status tracking",
        url: "https://github.com/acme/control-plane/pull/17",
      },
      status: "refreshed",
    });
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "github_pull_request.status_refreshed",
        id: "audit_pr_refresh_1",
        runId: "run_1",
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafePullRequestRefreshMaterial({ audit: store.auditEvents, result });
  });

  test("refuses owner, repository, or PR-number mismatches without mutating the stored artifact", async () => {
    const { createPullRequestRefreshService } = await importPullRequests();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const before = structuredClone(store.artifact);
    const githubClient = createGitHubClient({
      pullRequest: pullRequestMetadata({
        number: 99,
        repository: {
          ...pullRequestMetadata().repository,
          name: "other-repo",
        },
      }),
    });
    const service = createPullRequestRefreshService({
      getAuthContext: async () => ({ userId: "user_1" }),
      githubClient,
      store,
    });

    await expect(
      service.refreshPullRequestStatus({
        prArtifactId: "pr_artifact_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.updatePullRequestGitHubMetadata).not.toHaveBeenCalled();
    expect(store.artifact).toEqual(before);
  });

  test("does not mutate changed paths, risk findings, validation evidence, run state, or approvals", async () => {
    const { createPullRequestRefreshService } = await importPullRequests();
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const changedPathsBefore = [...(store.artifact?.changedFilePaths ?? [])];
    const riskFindingsBefore = structuredClone(store.artifact?.riskFindings ?? []);
    const validationBefore = structuredClone(store.validationResults);
    const runsBefore = structuredClone(store.runStates);
    const approvalsBefore = structuredClone(store.approvals);
    const service = createPullRequestRefreshService({
      getAuthContext: async () => ({ userId: "user_1" }),
      githubClient: createGitHubClient(),
      now: () => new Date("2026-05-24T12:35:00.000Z"),
      store,
    });

    await service.refreshPullRequestStatus({
      prArtifactId: "pr_artifact_1",
      workspaceId: "workspace_1",
    });

    expect(store.artifact?.changedFilePaths).toEqual(changedPathsBefore);
    expect(store.artifact?.riskFindings).toEqual(riskFindingsBefore);
    expect(store.validationResults).toEqual(validationBefore);
    expect(store.runStates).toEqual(runsBefore);
    expect(store.approvals).toEqual(approvalsBefore);
  });

  test("keeps the PR refresh module server-only and free of merge or local gh behavior", async () => {
    const source = await readFile(new URL("./pull-requests.ts", import.meta.url), "utf8");

    expect(source).toContain('import "server-only";');
    expect(source).not.toMatch(/\bgh\s+pr|mergePullRequest|autoMerge|checkout|worktree|diff/iu);
  });
});

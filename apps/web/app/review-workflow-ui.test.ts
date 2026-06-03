import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { ApprovalQueueItem } from "../src/approvals/list";
import type { PullRequestListItem } from "../src/pull-requests/list";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const createApprovalItem = (overrides: Partial<ApprovalQueueItem> = {}): ApprovalQueueItem => ({
  evidence: {
    blockerCount: 0,
    changedFileCount: 2,
    reviewReady: true,
    riskCategoryCounts: [{ category: "package_lock", count: 1 }],
    validationStatusCounts: [{ count: 1, status: "passed" }],
    warningCount: 1,
  },
  id: "run_1",
  mode: "execute",
  pr: {
    number: 42,
    status: "open",
    title: "TASK-167: Polish review screens",
    url: "https://github.com/rory/control-plane/pull/42",
  },
  repoMapping: {
    id: "repo_mapping_1",
    repositoryName: "control-plane",
    repositoryOwner: "rory",
  },
  runner: {
    displayName: "Mac Studio",
    id: "runner_1",
  },
  repair: {
    attemptCount: 0,
    latestRequestedAt: null,
    maxAttempts: null,
  },
  state: "awaiting_approval",
  task: {
    id: "task_1",
    title: "Polish review screens",
  },
  updatedAt: new Date("2026-05-23T10:30:00.000Z"),
  ...overrides,
});

const createPullRequestItem = (
  overrides: Partial<PullRequestListItem> = {},
): PullRequestListItem => ({
  branchName: "aicp/task-167-polish-review-pages",
  changedFileCount: 2,
  changedFilePaths: ["apps/web/app/runs/page.tsx", "apps/web/components/run-table.tsx"],
  checks: {
    conclusion: "passing",
    failedCount: 0,
    passedCount: 2,
    pendingCount: 0,
    skippedCount: 1,
    totalCount: 3,
  },
  createdAt: new Date("2026-05-23T10:25:00.000Z"),
  githubSyncedAt: new Date("2026-05-24T12:35:00.000Z"),
  id: "pr_artifact_1",
  number: 42,
  repository: {
    name: "control-plane",
    owner: "rory",
  },
  risk: {
    blockerCount: 0,
    categoryCounts: [{ category: "package_lock", count: 1 }],
    warningCount: 1,
  },
  run: {
    id: "run_1",
    mode: "execute",
    state: "awaiting_approval",
  },
  runner: {
    displayName: "Mac Studio",
    id: "runner_1",
  },
  reviewState: "approved",
  status: "open",
  task: {
    id: "task_1",
    title: "Polish review pages",
  },
  title: "TASK-167: Polish review pages",
  updatedAt: new Date("2026-05-23T10:30:00.000Z"),
  url: "https://github.com/rory/control-plane/pull/42",
  validationStatusCounts: [
    { count: 1, status: "passed" },
    { count: 1, status: "skipped" },
  ],
  ...overrides,
});

const expectNoUnsafeReviewWorkflowSource = (source: string) => {
  expect(source).not.toMatch(
    /taskPacket|objective|acceptanceCriteria|validationCommands|rawOutput|rawLogs|sourceCode|diff --git|@@ -1 \+1 @@|\/Users\/rory|localPath|credential/i,
  );
};

describe("review workflow UI", () => {
  test("ApprovalQueueTable renders evidence-rich awaiting-review rows and review links", async () => {
    const { ApprovalQueueTable } = await import("../components/approval-queue-table");
    const html = renderToStaticMarkup(
      createElement(ApprovalQueueTable, {
        approvals: [createApprovalItem()],
      }),
    );

    expect(html).toContain("Approval queue");
    expect(html).toContain("Polish review screens");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("Mac Studio");
    expect(html).toContain("Review ready");
    expect(html).toContain("1 passed");
    expect(html).toContain("2 files");
    expect(html).toContain("1 warning");
    expect(html).toContain("Package lock");
    expect(html).toContain("#42");
    expect(html).toContain('href="/dashboard/runs/run_1"');
  });

  test("PullRequestTable renders stored PR artifact metadata without diffs", async () => {
    const { PullRequestTable } = await import("../components/pull-request-table");
    const html = renderToStaticMarkup(
      createElement(PullRequestTable, {
        pullRequests: [createPullRequestItem()],
      }),
    );

    expect(html).toContain("Pull request artifacts");
    expect(html).toContain("TASK-167: Polish review pages");
    expect(html).toContain("#42");
    expect(html).toContain("Open");
    expect(html).toContain("Approved");
    expect(html).toContain("Checks passing");
    expect(html).toContain("Last GitHub sync");
    expect(html).toContain("aicp/task-167-polish-review-pages");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("2 files");
    expect(html).toContain("Changed paths");
    expect(html).toContain("apps/web/app/runs/page.tsx");
    expect(html).toContain("apps/web/components/run-table.tsx");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 skipped");
    expect(html).toContain("1 warning");
    expect(html).toContain("Package lock");
    expect(html).toContain('href="/dashboard/runs/run_1"');
    expect(html).toContain('href="https://github.com/rory/control-plane/pull/42"');
    expect(html).not.toMatch(/diff|patch|source|raw runner/i);
  });

  test("PullRequestTable filters by PR status and attention-needed evidence", async () => {
    const { PullRequestTable } = await import("../components/pull-request-table");
    const html = renderToStaticMarkup(
      createElement(PullRequestTable, {
        pullRequests: [
          createPullRequestItem({
            id: "pr_open",
            risk: { blockerCount: 0, categoryCounts: [], warningCount: 0 },
            status: "open",
            title: "Routine open artifact",
            validationStatusCounts: [{ count: 1, status: "passed" }],
          }),
          createPullRequestItem({
            id: "pr_draft",
            risk: { blockerCount: 0, categoryCounts: [], warningCount: 0 },
            status: "draft",
            title: "Draft PR",
            validationStatusCounts: [{ count: 1, status: "passed" }],
          }),
          createPullRequestItem({
            id: "pr_merged",
            risk: { blockerCount: 0, categoryCounts: [], warningCount: 0 },
            status: "merged",
            title: "Merged PR",
            validationStatusCounts: [{ count: 1, status: "passed" }],
          }),
          createPullRequestItem({
            id: "pr_attention",
            risk: {
              blockerCount: 0,
              categoryCounts: [{ category: "large_diff", count: 1 }],
              warningCount: 1,
            },
            status: "closed",
            title: "Attention PR",
            validationStatusCounts: [{ count: 1, status: "failed" }],
          }),
        ],
        statusFilter: "attention",
      }),
    );

    expect(html).toContain("All PRs");
    expect(html).toContain("Draft");
    expect(html).toContain("Open");
    expect(html).toContain("Closed");
    expect(html).toContain("Merged");
    expect(html).toContain("Attention needed");
    expect(html).toContain('href="/dashboard/pull-requests?status=open"');
    expect(html).toContain("Showing 1 of 4 pull requests.");
    expect(html).toContain("Attention PR");
    expect(html).toContain("1 failed");
    expect(html).not.toContain("Routine open artifact");
    expect(html).not.toContain("Draft PR");
    expect(html).not.toContain("Merged PR");
  });

  test("approval and pull request pages load real workspace-scoped services", async () => {
    const approvalsSource = await readAppFile("./(app)/dashboard/approvals/page.tsx");
    const pullRequestsSource = await readAppFile("./(app)/dashboard/pull-requests/page.tsx");

    expect(approvalsSource).toContain('export const dynamic = "force-dynamic";');
    expect(approvalsSource).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(approvalsSource).toContain("createApprovalQueueService");
    expect(approvalsSource).toContain("createDrizzleApprovalQueueStore");
    expect(approvalsSource).toMatch(
      /listWorkspaceApprovals\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(approvalsSource).toContain("<ApprovalQueueTable");
    expect(approvalsSource).toContain("metadata only");
    expectNoUnsafeReviewWorkflowSource(approvalsSource);

    expect(pullRequestsSource).toContain('export const dynamic = "force-dynamic";');
    expect(pullRequestsSource).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(pullRequestsSource).toContain("createPullRequestListService");
    expect(pullRequestsSource).toContain("createDrizzlePullRequestListStore");
    expect(pullRequestsSource).toMatch(
      /listWorkspacePullRequests\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(pullRequestsSource).toContain("getPullRequestStatusFilter");
    expect(pullRequestsSource).toMatch(
      /<PullRequestTable[\s\S]*pullRequests={pullRequests}[\s\S]*statusFilter={pullRequestStatusFilter}/,
    );
    expect(pullRequestsSource).toContain("stored PR artifacts");
    expectNoUnsafeReviewWorkflowSource(pullRequestsSource);
  });

  test("dashboard review routes include loading and safe error states", async () => {
    await expectFile("./(app)/dashboard/tasks/loading.tsx");
    await expectFile("./(app)/dashboard/tasks/error.tsx");
    await expectFile("./(app)/dashboard/runs/loading.tsx");
    await expectFile("./(app)/dashboard/runs/error.tsx");
    await expectFile("./(app)/dashboard/approvals/loading.tsx");
    await expectFile("./(app)/dashboard/approvals/error.tsx");
    await expectFile("./(app)/dashboard/pull-requests/loading.tsx");
    await expectFile("./(app)/dashboard/pull-requests/error.tsx");

    const errorSource = [
      await readAppFile("./(app)/dashboard/tasks/error.tsx"),
      await readAppFile("./(app)/dashboard/runs/error.tsx"),
      await readAppFile("./(app)/dashboard/approvals/error.tsx"),
      await readAppFile("./(app)/dashboard/pull-requests/error.tsx"),
    ].join("\n");

    expect(errorSource).toContain('"use client";');
    expect(errorSource).toContain("Unable to load this view.");
    expect(errorSource).not.toMatch(
      /error\.message|stack|digest|JSON\.stringify|raw|diff|patch|source/i,
    );
  });
});

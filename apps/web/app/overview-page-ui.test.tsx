import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import type { WorkspaceDashboardOverview } from "../src/dashboard/overview";

vi.mock("server-only", () => ({}));
vi.mock("@/src/server/actions", () => ({
  triggerRepoScanAction: async () => ({
    data: {
      repoId: "github_repo_1",
      scanId: "repo_scan_1",
      status: "queued",
      workspaceId: "workspace_1",
    },
    ok: true,
  }),
}));

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const createOverviewRun = (
  overrides: Partial<WorkspaceDashboardOverview["recentRuns"][number]> &
    Record<string, unknown> = {},
): WorkspaceDashboardOverview["recentRuns"][number] =>
  ({
    changedFileCount: 3,
    id: "run_1",
    mode: "execute",
    pr: {
      number: 42,
      status: "open",
      title: "TASK-165: Build overview page",
      url: "https://github.com/rory/control-plane/pull/42",
    },
    repository: {
      name: "control-plane",
      owner: "rory",
    },
    risk: {
      blockerCount: 0,
      categoryCounts: [{ category: "package_lock", count: 1 }],
      warningCount: 1,
    },
    runner: {
      displayName: "Mac Studio",
      id: "runner_1",
    },
    state: "awaiting_approval",
    task: {
      id: "task_1",
      title: "Build overview page",
    },
    updatedAt: new Date("2026-05-23T11:00:00.000Z"),
    validationStatusCounts: [{ count: 1, status: "passed" }],
    ...overrides,
  }) as WorkspaceDashboardOverview["recentRuns"][number];

const createOverview = (
  overrides: Partial<WorkspaceDashboardOverview> = {},
): WorkspaceDashboardOverview => {
  const unsafeTraceEvent = {
    createdAt: new Date("2026-05-23T10:04:00.000Z"),
    id: "event_2",
    message: "Awaiting human approval.",
    metadata: {
      diff: "diff --git a/app.ts b/app.ts",
      localPath: "/Users/rory/repos/control-plane",
    },
    rawLogs: "raw runner log line",
    receivedAt: new Date("2026-05-23T10:04:30.000Z"),
    runnerId: "runner_1",
    severity: "warning",
    sourceCode: "const leaked = process.env.SECRET",
    state: "awaiting_approval",
  } as unknown as WorkspaceDashboardOverview["selectedRunTrace"]["events"][number];

  return {
    actionability: {
      items: [
        {
          count: 2,
          description: "1 blocked finding needs review before execution.",
          href: "/dashboard/findings?status=open",
          id: "review_findings",
          label: "Findings",
          title: "Review readiness findings",
          tone: "danger",
        },
        {
          count: 2,
          description: "Approve or convert AI-ready recommendations into Cortex Tasks.",
          href: "/dashboard/task-recommendations",
          id: "review_recommendations",
          label: "Recommendations",
          title: "Approve AI-ready recommendations",
          tone: "warning",
        },
        {
          count: 1,
          description: "Draft or needs-review tasks are waiting for a human decision.",
          href: "/dashboard/tasks?status=draft",
          id: "review_tasks",
          label: "Tasks",
          title: "Review Cortex Tasks",
          tone: "neutral",
        },
        {
          count: 1,
          description: "Approved local-runner work is waiting; source execution stays local.",
          href: "/dashboard/runners",
          id: "pair_runner",
          label: "Runner",
          title: "Pair local runner",
          tone: "warning",
        },
      ],
      runnerInstalled: false,
      runnerOnline: false,
      totals: {
        activeScans: 0,
        approvedLocalRunnerTasks: 1,
        approvedRecommendations: 1,
        awaitingApprovalRuns: 2,
        blockedFindings: 1,
        blockedRuns: 2,
        completedScans: 1,
        draftCortexTasks: 1,
        openFindings: 2,
        openRecommendations: 1,
        queuedLocalRunnerTasks: 0,
        reviewCortexTasks: 0,
        runningRuns: 1,
      },
    },
    activeRuns: [
      createOverviewRun({
        id: "run_active",
        state: "codex_running",
        task: { id: "task_active", title: "Implement active work" },
      }),
    ],
    awaitingApprovalRuns: [
      createOverviewRun({
        id: "run_awaiting",
        state: "awaiting_approval",
        task: { id: "task_awaiting", title: "Awaiting review" },
      }),
    ],
    blockedRuns: [
      createOverviewRun({
        id: "run_blocked",
        risk: {
          blockerCount: 1,
          categoryCounts: [{ category: "protected_path", count: 1 }],
          warningCount: 0,
        },
        state: "blocked",
        task: { id: "task_blocked", title: "Blocked validation" },
        validationStatusCounts: [{ count: 1, status: "failed" }],
      }),
      createOverviewRun({
        id: "run_failed",
        state: "failed",
        task: { id: "task_failed", title: "Failed execution" },
        validationStatusCounts: [{ count: 1, status: "failed" }],
      }),
    ],
    buildPhases: [
      { id: "local_runner_proof", label: "Local runner proof", order: 3, status: "completed" },
      { id: "dashboard_polish", label: "Dashboard Polish", order: 9, status: "current" },
      { id: "billing_hooks", label: "Billing hooks", order: 10, status: "upcoming" },
    ],
    recentRuns: [
      createOverviewRun({ id: "run/with space" }),
      createOverviewRun({ id: "run_recent", state: "completed" }),
    ],
    repoReadinessOnboarding: {
      activeInstallationCount: 1,
      connectionStatus: "connected",
      hasAnyScans: true,
      hasRepoAccess: true,
      installationCount: 1,
      repositoryOptions: [
        {
          archived: false,
          defaultBranch: "main",
          disabled: false,
          id: "github_repo_1",
          repositoryFullName: "rory/control-plane",
          repositoryName: "control-plane",
          repositoryOwner: "rory",
          scanPermissionDetail:
            "Scan-only uses GitHub metadata and repository contents read access without requiring the local runner.",
          scanPermissionLabel: "Scan-only ready",
          scanPermissionStatus: "ready",
          visibility: "private",
          workspaceId: "workspace_1",
        },
      ],
    },
    runnerHealth: {
      busy: 1,
      idle: 1,
      offline: 1,
      online: 2,
      revoked: 1,
      runners: [
        {
          capabilitiesSummary: {
            availableTools: ["git", "codex", "node", "pnpm"],
            maxConcurrentJobs: 2,
            supportsCancellation: true,
            supportsDryRun: true,
            toolAvailability: [
              { available: true, name: "git" },
              { available: false, name: "gh" },
              { available: true, name: "codex" },
              { available: true, name: "node" },
              { available: false, name: "npm" },
              { available: true, name: "pnpm" },
              { available: false, name: "yarn" },
              { available: false, name: "python" },
            ],
          },
          displayName: "Mac Studio",
          id: "runner_1",
          lastHeartbeatAt: new Date("2026-05-23T10:58:00.000Z"),
          revokedAt: null,
          status: "busy",
        },
        {
          capabilitiesSummary: {
            availableTools: [],
            maxConcurrentJobs: 1,
            supportsCancellation: false,
            supportsDryRun: false,
            toolAvailability: [
              { available: false, name: "git" },
              { available: false, name: "gh" },
              { available: false, name: "codex" },
              { available: false, name: "node" },
              { available: false, name: "npm" },
              { available: false, name: "pnpm" },
              { available: false, name: "yarn" },
              { available: false, name: "python" },
            ],
          },
          displayName: "Revoked runner",
          id: "runner_revoked",
          lastHeartbeatAt: null,
          revokedAt: new Date("2026-05-23T09:00:00.000Z"),
          status: "revoked",
        },
      ],
      total: 4,
    },
    selectedRunTrace: {
      events: [
        {
          createdAt: new Date("2026-05-23T10:00:00.000Z"),
          id: "event_1",
          message: "Dry run passed with metadata-only checks.",
          receivedAt: new Date("2026-05-23T10:00:30.000Z"),
          runnerId: "runner_1",
          severity: "info",
          state: "dry_run_passed",
        },
        unsafeTraceEvent,
      ],
      runId: "run_1",
    },
    summaryCards: [
      {
        detail: "1 offline, 1 revoked",
        id: "runner_health",
        label: "Runner health",
        tone: "success",
        value: 2,
      },
      {
        detail: "1 ready, 2 queued",
        id: "ready_work",
        label: "Ready work",
        tone: "neutral",
        value: 3,
      },
      {
        detail: "Runs currently moving through the local runner",
        id: "running_work",
        label: "Running",
        tone: "success",
        value: 1,
      },
      {
        detail: "1 blocked, 1 failed",
        id: "needs_attention",
        label: "Needs attention",
        tone: "danger",
        value: 2,
      },
      {
        detail: "1 PR-ready",
        id: "awaiting_approval",
        label: "Awaiting approval",
        tone: "warning",
        value: 2,
      },
    ],
    workBuckets: {
      awaitingApprovalRuns: 1,
      blockedRuns: 1,
      failedRuns: 1,
      prReadyRuns: 1,
      queuedWork: 2,
      readyTasks: 1,
      runningRuns: 1,
    },
    ...overrides,
  };
};

const expectNoUnsafeOverviewDisplayMaterial = (source: string) => {
  expect(source).not.toMatch(
    /taskPacket|sourceCode|rawLogs|localPath|credential|diff --git|@@ -1 \+1 @@|\/Users\/rory|const leaked|process\.env|\.env\b|SECRET_VALUE/i,
  );
};

describe("overview dashboard UI", () => {
  test("renders actionability, summary cards, runner health, run sections, trace, and build phases", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview: createOverview(),
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("What can safely move forward today?");
    expect(html).toContain("Control Plane");
    expect(html).toContain("Local execution boundary intact");
    expect(html).toContain("Recommended next actions");
    expect(html).toContain("Review readiness findings");
    expect(html).toContain("1 blocked finding needs review before execution.");
    expect(html).toContain('href="/dashboard/findings?status=open"');
    expect(html).toContain("Approve AI-ready recommendations");
    expect(html).toContain('href="/dashboard/task-recommendations"');
    expect(html).toContain("Review Cortex Tasks");
    expect(html).toContain('href="/dashboard/tasks?status=draft"');
    expect(html).toContain("Pair local runner");
    expect(html).toContain("Approved local-runner work is waiting; source execution stays local.");
    expect(html).toContain("Runner health");
    expect(html).toContain("Ready work");
    expect(html).toContain("Running");
    expect(html).toContain("Needs attention");
    expect(html).toContain("Awaiting approval");
    expect(html).toContain(">2<");
    expect(html).toContain(">3<");
    expect(html).toContain("1 offline, 1 revoked");

    expect(html).toContain("2 online");
    expect(html).toContain("1 offline");
    expect(html).toContain("1 revoked");
    expect(html).toContain("Mac Studio");
    expect(html).toContain("runner_1");
    expect(html).toContain("Reported tools: git, codex, node, pnpm");
    expect(html).toContain("gh missing");
    expect(html).toContain("Dry run");
    expect(html).toContain("Cancellation");
    expect(html).toContain("Max concurrency 2");

    expect(html).toContain("Active runs");
    expect(html).toContain("Implement active work");
    expect(html).toContain("Blocked or failed");
    expect(html).toContain("Blocked validation");
    expect(html).toContain("Failed execution");
    expect(html).toContain("Approval needed");
    expect(html).toContain("Awaiting review");
    expect(html).toContain("Recent runs");
    expect(html).toContain("Build overview page");
    expect(html).toContain("3 files");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 warning");
    expect(html).toContain("Protected path");
    expect(html).toContain("#42");
    expect(html).toContain("Open");

    expect(html).toContain('href="/dashboard?runId=run%2Fwith%20space"');
    expect(html).not.toContain('href="/dashboard?runId=run/with space"');

    expect(html).toContain("Selected run trace");
    expect(html).toContain("run_1");
    expect(html).toContain("Dry run passed");
    expect(html).toContain("Info");
    expect(html).toContain("Warning");
    expect(html).toContain("May 23, 2026");
    expect(html).toContain("runner_1");
    expect(html).toContain("Awaiting human approval.");

    expect(html).toContain("Build phase status");
    expect(html).toContain("Local runner proof");
    expect(html).toContain("Dashboard Polish");
    expect(html).toContain("Billing hooks");
    expect(html).toContain("Completed");
    expect(html).toContain("Current");
    expect(html).toContain("Upcoming");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("renders runner-online actionability without pairing as the primary next step", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const overview = createOverview({
      actionability: {
        items: [
          {
            count: 2,
            description: "Approved and queued local-runner tasks can move with the paired runner.",
            href: "/dashboard/tasks?executionMode=local_runner",
            id: "monitor_runs",
            label: "Runner",
            title: "Monitor local execution",
            tone: "success",
          },
          {
            count: 1,
            description: "A validated PR is waiting for human review.",
            href: "/dashboard/approvals",
            id: "review_approvals",
            label: "Approvals",
            title: "Review validated PRs",
            tone: "warning",
          },
        ],
        runnerInstalled: true,
        runnerOnline: true,
        totals: {
          activeScans: 0,
          approvedLocalRunnerTasks: 1,
          approvedRecommendations: 0,
          awaitingApprovalRuns: 1,
          blockedFindings: 0,
          blockedRuns: 0,
          completedScans: 1,
          draftCortexTasks: 0,
          openFindings: 0,
          openRecommendations: 0,
          queuedLocalRunnerTasks: 1,
          reviewCortexTasks: 0,
          runningRuns: 0,
        },
      },
    });
    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview,
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("Monitor local execution");
    expect(html).toContain(
      "Approved and queued local-runner tasks can move with the paired runner.",
    );
    expect(html).toContain('href="/dashboard/tasks?executionMode=local_runner"');
    expect(html).toContain("Review validated PRs");
    expect(html).not.toContain("Pair local runner</");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("renders empty states with runner pairing and manual task creation guidance", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const overview = createOverview({
      activeRuns: [],
      awaitingApprovalRuns: [],
      blockedRuns: [],
      recentRuns: [],
      runnerHealth: {
        busy: 0,
        idle: 0,
        offline: 0,
        online: 0,
        revoked: 0,
        runners: [],
        total: 0,
      },
      selectedRunTrace: {
        events: [],
        runId: null,
      },
      summaryCards: [
        {
          detail: "0 offline, 0 revoked",
          id: "runner_health",
          label: "Runner health",
          tone: "warning",
          value: 0,
        },
        {
          detail: "0 ready, 0 queued",
          id: "ready_work",
          label: "Ready work",
          tone: "neutral",
          value: 0,
        },
        {
          detail: "Runs currently moving through the local runner",
          id: "running_work",
          label: "Running",
          tone: "neutral",
          value: 0,
        },
        {
          detail: "0 blocked, 0 failed",
          id: "needs_attention",
          label: "Needs attention",
          tone: "neutral",
          value: 0,
        },
        {
          detail: "0 PR-ready",
          id: "awaiting_approval",
          label: "Awaiting approval",
          tone: "neutral",
          value: 0,
        },
      ],
    });

    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview,
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("No runners paired.");
    expect(html).toContain("Pair a local runner");
    expect(html).toContain('href="/dashboard/runners"');
    expect(html).toContain("No active runs.");
    expect(html).toContain("Approved work appears here after a runner claims a job.");
    expect(html).toContain("No blocked or failed runs.");
    expect(html).toContain("No approval-needed runs.");
    expect(html).toContain("No recent runs.");
    expect(html).toContain("Create a manual task");
    expect(html).toContain('href="/dashboard/tasks/new"');
    expect(html).toContain("No run selected");
    expect(html).toContain("Run trace appears after runner events are submitted.");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("renders repo-readiness onboarding before any scan and hides runner-first CTAs", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const overview = createOverview({
      repoReadinessOnboarding: {
        activeInstallationCount: 0,
        connectionStatus: "not_connected",
        hasAnyScans: false,
        hasRepoAccess: false,
        installationCount: 0,
        repositoryOptions: [],
      },
    });

    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview,
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("Repo readiness");
    expect(html).toContain("No GitHub connection");
    expect(html).toContain("Connect GitHub repo");
    expect(html).toContain('href="/dashboard/settings/github"');
    expect(html).toContain("The local runner is optional later");
    expect(html).not.toContain("Pair a local runner");
    expect(html).not.toContain("/dashboard/runners");
    expect(html).not.toContain("Create a manual task");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("renders no-repo-access guidance when GitHub is connected without active repos", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const overview = createOverview({
      repoReadinessOnboarding: {
        activeInstallationCount: 1,
        connectionStatus: "connected",
        hasAnyScans: false,
        hasRepoAccess: false,
        installationCount: 1,
        repositoryOptions: [],
      },
    });

    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview,
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("No repository access");
    expect(html).toContain("GitHub is connected, but no active repositories are available");
    expect(html).toContain("Adjust GitHub repo access");
    expect(html).toContain('href="/dashboard/settings/github"');
    expect(html).not.toContain("Start repo scan");
    expect(html).not.toContain("Pair a local runner");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("renders a canonical repo selection screen when synced repositories exist", async () => {
    const { OverviewDashboard } = await import("../components/overview/overview-dashboard");
    const overview = createOverview({
      repoReadinessOnboarding: {
        activeInstallationCount: 1,
        connectionStatus: "connected",
        hasAnyScans: false,
        hasRepoAccess: true,
        installationCount: 1,
        repositoryOptions: [
          {
            archived: false,
            defaultBranch: "main",
            disabled: false,
            id: "github_repo_1",
            repositoryFullName: "rory/control-plane",
            repositoryName: "control-plane",
            repositoryOwner: "rory",
            scanPermissionDetail:
              "Scan-only uses GitHub metadata and repository contents read access without requiring the local runner.",
            scanPermissionLabel: "Scan-only ready",
            scanPermissionStatus: "ready",
            visibility: "private",
            workspaceId: "workspace_1",
          },
          {
            archived: false,
            defaultBranch: "trunk",
            disabled: false,
            id: "github_repo_2",
            repositoryFullName: "rory/worker",
            repositoryName: "worker",
            repositoryOwner: "rory",
            scanPermissionDetail: "Grant metadata read and repository contents read access.",
            scanPermissionLabel: "Scan-only needs permission upgrade",
            scanPermissionStatus: "needs_permission",
            visibility: "public",
            workspaceId: "workspace_1",
          },
        ],
      },
    });

    const html = renderToStaticMarkup(
      createElement(OverviewDashboard, {
        overview,
        workspaceName: "Control Plane",
      }),
    );

    expect(html).toContain("Select repository");
    expect(html).toContain("Describe product goal");
    expect(html).toContain("Skip for now");
    expect(html).toContain("reduced scan quality");
    expect(html).toContain("Scan-only access");
    expect(html).toMatch(/<input(?=[^>]+name="repoId")(?=[^>]+type="radio")/);
    expect(html).toMatch(/<textarea(?=[^>]+name="productGoal")/);
    expect(html).toMatch(
      /<input(?=[^>]+name="workspaceId")(?=[^>]+type="hidden")(?=[^>]+value="workspace_1")[^>]*>/,
    );
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("main");
    expect(html).toContain("Scan-only ready");
    expect(html).toContain("rory/worker");
    expect(html).toContain("trunk");
    expect(html).toContain("Scan-only needs permission upgrade");
    expect(html).toContain("Start repo scan");
    expect(html).toContain("The local runner is optional later");
    expect(html).not.toContain("Pair a local runner");
    expect(html).not.toContain("/dashboard/runners");
    expect(html).not.toContain("Create a manual task");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("repo-readiness scan form submits only canonical workspace and repository ids", async () => {
    const source = await readAppFile("../components/overview/repo-readiness-onboarding.tsx");

    expect(source).toContain("triggerRepoScanAction");
    expect(source).toContain("await triggerRepoScanAction(formData)");
    expect(source).toMatch(/<form[\s\S]*action={submitRepoReadinessScanAction}/);
    expect(source).toContain('name="workspaceId"');
    expect(source).toContain('name="repoId"');
    expect(source).toContain('name="productGoal"');
    expect(source).toContain("reduced scan quality");
    expect(source).not.toMatch(
      /name="(?:owner|repositoryOwner|repositoryName|repositoryFullName|defaultBranch|visibility|localPath|source|diff|patch|stdout|stderr|rawOutput|secret|token)"/i,
    );
    expectNoUnsafeOverviewDisplayMaterial(source);
  });

  test("renders a concise selected-run trace empty state when no events exist", async () => {
    const { OverviewRunTrace } = await import("../components/overview/overview-run-trace");
    const html = renderToStaticMarkup(
      createElement(OverviewRunTrace, {
        selectedRunTrace: {
          events: [],
          runId: "run_without_events",
        },
      }),
    );

    expect(html).toContain("Selected run trace");
    expect(html).toContain("run_without_events");
    expect(html).toContain("No events recorded.");
    expect(html).toContain("Runner events will appear here after submission.");
    expectNoUnsafeOverviewDisplayMaterial(html);
  });

  test("loads overview only after selected workspace membership is verified", async () => {
    const source = await readAppFile("./(app)/dashboard/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("const verifiedWorkspace");
    expect(source).toMatch(
      /service\s*\.\s*selectWorkspace\(\{ workspaceId: cookieWorkspaceId \}\)/,
    );
    expect(source).toContain("getWorkspaceDashboardOverview");
    expect(source).toMatch(
      /getWorkspaceDashboardOverview\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,\s*selectedRunId/,
    );
    expect(source).not.toMatch(
      /getWorkspaceDashboardOverview\(\{\s*workspaceId: cookieWorkspaceId/,
    );
    expect(source).not.toMatch(
      /listWorkspaceOverview(Runners|Runs|Tasks|RunEvents|ValidationResults)|createDrizzleDashboardOverviewStore/,
    );
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*href="\/workspaces"/);
    expect(source).toContain("<OverviewDashboard");
    expect(source).toContain("overview={overview}");
    expect(source).toContain("workspaceName={verifiedWorkspace.name}");
    expectNoUnsafeOverviewDisplayMaterial(source);
  });

  test("overview components are server-renderable and keep unsafe fields out of source", async () => {
    const componentPaths = [
      "../components/overview/overview-dashboard.tsx",
      "../components/overview/overview-actionability.tsx",
      "../components/overview/repo-readiness-onboarding.tsx",
      "../components/overview/overview-summary-cards.tsx",
      "../components/overview/overview-run-lists.tsx",
      "../components/overview/overview-run-trace.tsx",
      "../components/overview/overview-runner-health.tsx",
      "../components/overview/overview-build-phases.tsx",
    ];

    await Promise.all(componentPaths.map(expectFile));

    const sources = await Promise.all(componentPaths.map(readAppFile));

    sources.forEach((source) => {
      expect(source.trimStart()).not.toMatch(/^"use client";/);
      expect(source).not.toMatch(
        /taskPacket|sourceCode|rawLogs|localPath|validationCommands|JSON\.stringify|\.metadata|\.changedPaths|\.paths|\.path|diff|patch|snippet|credential/i,
      );
    });
    expect(sources.join("\n")).toContain('from "@/components/evidence-summary"');
    expect(sources.join("\n")).toContain('from "@/components/run-status-badge"');
    expect(sources.join("\n")).toContain('from "@/components/ui/badge"');
    expect(sources.join("\n")).toContain('from "@/components/ui/button"');
  });
});

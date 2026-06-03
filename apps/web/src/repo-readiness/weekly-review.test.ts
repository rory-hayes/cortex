import { describe, expect, test, vi } from "vitest";

import type {
  CortexTask,
  Finding,
  RepoExecutionReadiness,
  TaskRecommendation,
  WeeklyEngineeringReview,
} from "@control-plane/shared";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importWeeklyReview = async () => import("./weekly-review");

type ReviewRepository = {
  id: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

type ReviewReport = {
  executionReadiness: RepoExecutionReadiness;
  generatedAt: Date;
  id: string;
  overallScore: number;
  repoId: string;
  scanId: string;
  workspaceId: string;
};

type ReviewFinding = {
  id: string;
  repoId: string;
  severity: Finding["severity"];
  status: Finding["status"];
  updatedAt: Date;
  workspaceId: string;
};

type ReviewTaskRecommendation = {
  id: string;
  repoId: string;
  status: TaskRecommendation["status"];
  updatedAt: Date;
  workspaceId: string;
};

type ReviewCortexTask = {
  approvalStatus: CortexTask["approvalStatus"];
  executionMode: CortexTask["executionMode"];
  id: string;
  latestRunId: string | null;
  prArtifactIds: string[];
  repoId: string;
  status: CortexTask["status"];
  updatedAt: Date;
  workspaceId: string;
};

type WeeklyReviewStore = {
  findWorkspaceMembership: (input: {
    userId: string;
    workspaceId: string;
  }) => Promise<{ id: string; role: string } | null>;
  listWeeklyReviewCortexTasks: (input: { workspaceId: string }) => Promise<ReviewCortexTask[]>;
  listWeeklyReviewFindings: (input: { workspaceId: string }) => Promise<ReviewFinding[]>;
  listWeeklyReviewRepositories: (input: { workspaceId: string }) => Promise<ReviewRepository[]>;
  listWeeklyReviewReports: (input: { workspaceId: string }) => Promise<ReviewReport[]>;
  listWeeklyReviewTaskRecommendations: (input: {
    workspaceId: string;
  }) => Promise<ReviewTaskRecommendation[]>;
};

const periodStart = new Date("2026-05-26T10:00:00.000Z");
const periodEnd = new Date("2026-06-02T10:00:00.000Z");

const repository = (overrides: Partial<ReviewRepository> = {}): ReviewRepository => ({
  id: "github_repository_1",
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
  workspaceId: "workspace_1",
  ...overrides,
});

const report = (overrides: Partial<ReviewReport> = {}): ReviewReport => ({
  executionReadiness: "setup_pr_ready",
  generatedAt: new Date("2026-06-01T10:00:00.000Z"),
  id: "readiness_report_1",
  overallScore: 74,
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  workspaceId: "workspace_1",
  ...overrides,
});

const finding = (overrides: Partial<ReviewFinding> = {}): ReviewFinding => ({
  id: "finding_1",
  repoId: "github_repository_1",
  severity: "medium",
  status: "open",
  updatedAt: new Date("2026-06-01T11:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const recommendation = (
  overrides: Partial<ReviewTaskRecommendation> = {},
): ReviewTaskRecommendation => ({
  id: "task_recommendation_1",
  repoId: "github_repository_1",
  status: "open",
  updatedAt: new Date("2026-06-01T12:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const task = (overrides: Partial<ReviewCortexTask> = {}): ReviewCortexTask => ({
  approvalStatus: "not_requested",
  executionMode: "setup_pr",
  id: "cortex_task_1",
  latestRunId: null,
  prArtifactIds: [],
  repoId: "github_repository_1",
  status: "draft",
  updatedAt: new Date("2026-06-01T13:00:00.000Z"),
  workspaceId: "workspace_1",
  ...overrides,
});

const createStore = (
  overrides: Partial<{
    cortexTasks: ReviewCortexTask[];
    findings: ReviewFinding[];
    recommendations: ReviewTaskRecommendation[];
    repositories: ReviewRepository[];
    reports: ReviewReport[];
  }> = {},
): WeeklyReviewStore & {
  cortexTasks: ReviewCortexTask[];
  findings: ReviewFinding[];
  recommendations: ReviewTaskRecommendation[];
  repositories: ReviewRepository[];
  reports: ReviewReport[];
} => {
  const state = {
    cortexTasks: overrides.cortexTasks ?? [
      task(),
      task({
        approvalStatus: "approved",
        executionMode: "local_runner",
        id: "cortex_task_approved",
      }),
      task({
        id: "cortex_task_pr",
        latestRunId: "run_1",
        prArtifactIds: ["pr_artifact_1"],
        status: "pr_opened",
      }),
      task({
        id: "cortex_task_completed",
        repoId: "github_repository_2",
        status: "completed",
      }),
    ],
    findings: overrides.findings ?? [
      finding({ id: "finding_blocked", severity: "blocked" }),
      finding({ id: "finding_resolved", status: "resolved" }),
      finding({ id: "finding_repo_2", repoId: "github_repository_2" }),
    ],
    recommendations: overrides.recommendations ?? [
      recommendation(),
      recommendation({ id: "task_recommendation_2", status: "approved" }),
      recommendation({ id: "task_recommendation_3", repoId: "github_repository_2" }),
    ],
    repositories: overrides.repositories ?? [
      repository(),
      repository({
        id: "github_repository_2",
        repositoryFullName: "rory/agent-console",
        repositoryName: "agent-console",
      }),
    ],
    reports: overrides.reports ?? [
      report(),
      report({
        generatedAt: new Date("2026-05-20T10:00:00.000Z"),
        id: "readiness_report_previous",
        overallScore: 68,
        scanId: "repo_scan_previous",
      }),
      report({
        executionReadiness: "planning_ready",
        id: "readiness_report_2",
        overallScore: 55,
        repoId: "github_repository_2",
        scanId: "repo_scan_2",
      }),
    ],
  };

  return {
    ...state,
    findWorkspaceMembership: vi.fn(async ({ workspaceId }) =>
      workspaceId === "workspace_1" ? { id: "membership_1", role: "owner" } : null,
    ),
    listWeeklyReviewCortexTasks: vi.fn(async ({ workspaceId }) =>
      state.cortexTasks.filter((row) => row.workspaceId === workspaceId),
    ),
    listWeeklyReviewFindings: vi.fn(async ({ workspaceId }) =>
      state.findings.filter((row) => row.workspaceId === workspaceId),
    ),
    listWeeklyReviewRepositories: vi.fn(async ({ workspaceId }) =>
      state.repositories.filter((row) => row.workspaceId === workspaceId),
    ),
    listWeeklyReviewReports: vi.fn(async ({ workspaceId }) =>
      state.reports.filter((row) => row.workspaceId === workspaceId),
    ),
    listWeeklyReviewTaskRecommendations: vi.fn(async ({ workspaceId }) =>
      state.recommendations.filter((row) => row.workspaceId === workspaceId),
    ),
  };
};

const expectNoUnsafeReviewMaterial = (value: unknown) => {
  expect(JSON.stringify(value)).not.toMatch(
    /rawOutput|sourceCode|fileContent|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory|\.env\.local/i,
  );
};

describe("weekly engineering review generator", () => {
  test("generates a metadata-only weekly review from report, finding, recommendation, and task metadata", async () => {
    const store = createStore();
    const { createWeeklyEngineeringReviewService } = await importWeeklyReview();
    const service = createWeeklyEngineeringReviewService({
      createReviewId: () => "weekly_review_1",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => periodEnd,
      store,
    });

    const review = await service.generateWeeklyEngineeringReview({
      periodStart,
      workspaceId: "workspace_1",
    });

    expect(review).toMatchObject<Partial<WeeklyEngineeringReview>>({
      contractVersion: "2026-05-10.v1",
      delivery: {
        email: "deferred",
        slack: "deferred",
      },
      generatedAt: periodEnd.toISOString(),
      periodEnd: periodEnd.toISOString(),
      periodStart: periodStart.toISOString(),
      reviewId: "weekly_review_1",
      summary:
        "Weekly engineering review covered 2 repositories with 2 current readiness reports, 2 open findings, and 3 task recommendations.",
      totals: {
        approvedLocalRunnerTaskCount: 1,
        averageScore: 65,
        blockedFindingCount: 1,
        completedTaskCount: 1,
        openFindingCount: 2,
        prOpenedTaskCount: 1,
        readyTaskRecommendationCount: 2,
        repositoryCount: 2,
        repositoryWithReportCount: 2,
        resolvedFindingCount: 1,
        runningTaskCount: 0,
        taskRecommendationCount: 3,
      },
      workspaceId: "workspace_1",
    });
    expect(review.repositorySummaries).toEqual([
      expect.objectContaining({
        approvedLocalRunnerTaskCount: 1,
        blockedFindingCount: 1,
        completedTaskCount: 0,
        draftTaskCount: 1,
        executionReadiness: "setup_pr_ready",
        latestReportId: "readiness_report_1",
        latestScanId: "repo_scan_1",
        openFindingCount: 1,
        overallScore: 74,
        previousOverallScore: 68,
        prOpenedTaskCount: 1,
        readyTaskRecommendationCount: 1,
        repoId: "github_repository_1",
        repositoryLabel: "rory/control-plane",
        resolvedFindingCount: 1,
        runningTaskCount: 0,
        scoreDelta: 6,
        taskRecommendationCount: 2,
      }),
      expect.objectContaining({
        executionReadiness: "planning_ready",
        latestReportId: "readiness_report_2",
        overallScore: 55,
        previousOverallScore: null,
        repoId: "github_repository_2",
        scoreDelta: null,
      }),
    ]);
    expect(review.links).toEqual(
      expect.arrayContaining([
        {
          href: "/dashboard/weekly-review",
          label: "Weekly review",
          targetType: "repository",
        },
        {
          href: "/dashboard/reports/readiness_report_1",
          label: "rory/control-plane readiness report",
          targetType: "readiness_report",
        },
        {
          href: "/dashboard/findings?status=open",
          label: "Open findings",
          targetType: "findings",
        },
        {
          href: "/dashboard/tasks",
          label: "Cortex Tasks",
          targetType: "tasks",
        },
      ]),
    );
    expect(review.highlights).toContain("1 repository improved its readiness score this week.");
    expect(review.risks).toContain("1 blocked readiness finding needs review before execution.");
    expect(review.recommendedNextActions).toContain(
      "Approve 2 ready task recommendations or convert them into Cortex Tasks.",
    );
    expectNoUnsafeReviewMaterial(review);
  });

  test("requires workspace membership and scopes every store read to the verified workspace", async () => {
    const store = createStore();
    const { createWeeklyEngineeringReviewService } = await importWeeklyReview();
    const service = createWeeklyEngineeringReviewService({
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => periodEnd,
      store,
    });

    await expect(
      service.generateWeeklyEngineeringReview({ workspaceId: "other_workspace" }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(store.listWeeklyReviewReports).not.toHaveBeenCalled();

    await service.generateWeeklyEngineeringReview({ workspaceId: "workspace_1" });

    expect(store.listWeeklyReviewRepositories).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWeeklyReviewReports).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWeeklyReviewFindings).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
    expect(store.listWeeklyReviewTaskRecommendations).toHaveBeenCalledWith({
      workspaceId: "workspace_1",
    });
    expect(store.listWeeklyReviewCortexTasks).toHaveBeenCalledWith({ workspaceId: "workspace_1" });
  });

  test("falls back to safe repository labels when provider metadata contains unsafe text", async () => {
    const store = createStore({
      repositories: [
        repository({
          repositoryFullName: "diff --git a/private.ts b/private.ts",
        }),
      ],
    });
    const { createWeeklyEngineeringReviewService } = await importWeeklyReview();
    const service = createWeeklyEngineeringReviewService({
      createReviewId: () => "weekly_review_unsafe_label",
      getAuthContext: async () => ({ userId: "user_1" }),
      now: () => periodEnd,
      store,
    });

    const review = await service.generateWeeklyEngineeringReview({
      periodStart,
      workspaceId: "workspace_1",
    });

    expect(review.repositorySummaries[0]?.repositoryLabel).toBe("github_repository_1");
    expect(JSON.stringify(review)).not.toContain("diff --git");
    expectNoUnsafeReviewMaterial(review);
  });
});

import { describe, expect, it } from "vitest";

import { CONTRACT_VERSION } from "./version.js";

const UNSAFE_WEEKLY_REVIEW_KEYS = [
  "sourceCode",
  "rawOutput",
  "patch",
  "secret",
  "stdout",
  "fileContent",
] as const;

const UNSAFE_WEEKLY_REVIEW_VALUES = [
  "diff --git a/src/private.ts b/src/private.ts",
  "*** Begin Patch\n*** Update File: src/private.ts",
  "```ts\nconst leakedSource = true;\n```",
  "raw stdout: private validation output",
  "https://runner:secret@example.test/repo.git",
  "GITHUB_TOKEN=ghp_weeklyreviewsecret1234567890",
  "${GITHUB_TOKEN}",
] as const;

type WeeklyReviewDeliveryStatus = "deferred";
type WeeklyReviewLinkTarget =
  | "findings"
  | "pull_requests"
  | "readiness_report"
  | "repository"
  | "runs"
  | "task_recommendations"
  | "tasks";
type WeeklyReviewRepositorySummary = {
  approvedLocalRunnerTaskCount: number;
  blockedFindingCount: number;
  completedTaskCount: number;
  draftTaskCount: number;
  executionReadiness:
    | "not_ready"
    | "setup_required"
    | "planning_ready"
    | "setup_pr_ready"
    | "local_runner_ready"
    | "blocked"
    | null;
  latestReportId: string | null;
  latestScanId: string | null;
  openFindingCount: number;
  overallScore: number | null;
  previousOverallScore: number | null;
  prOpenedTaskCount: number;
  readyTaskRecommendationCount: number;
  repoId: string;
  repositoryLabel: string;
  resolvedFindingCount: number;
  runningTaskCount: number;
  scoreDelta: number | null;
  taskRecommendationCount: number;
};
type WeeklyEngineeringReview = {
  contractVersion: typeof CONTRACT_VERSION;
  delivery: {
    email: WeeklyReviewDeliveryStatus;
    slack: WeeklyReviewDeliveryStatus;
  };
  generatedAt: string;
  highlights: string[];
  links: Array<{
    href: string;
    label: string;
    targetType: WeeklyReviewLinkTarget;
  }>;
  periodEnd: string;
  periodStart: string;
  recommendedNextActions: string[];
  repositorySummaries: WeeklyReviewRepositorySummary[];
  reviewId: string;
  risks: string[];
  summary: string;
  totals: {
    approvedLocalRunnerTaskCount: number;
    averageScore: number | null;
    blockedFindingCount: number;
    completedTaskCount: number;
    openFindingCount: number;
    prOpenedTaskCount: number;
    readyTaskRecommendationCount: number;
    repositoryCount: number;
    repositoryWithReportCount: number;
    resolvedFindingCount: number;
    runningTaskCount: number;
    taskRecommendationCount: number;
  };
  workspaceId: string;
};

type ZodIssueSummary = {
  path: PropertyKey[];
  message: string;
};

type SchemaLike = {
  safeParse: (value: unknown) =>
    | { success: true; data: unknown }
    | {
        success: false;
        error: {
          issues: ZodIssueSummary[];
        };
      };
};

type WeeklyReviewModule = {
  WeeklyEngineeringReviewLinkTargetSchema: SchemaLike;
  WeeklyEngineeringReviewSchema: SchemaLike;
};

const loadWeeklyReviewModule = async () =>
  (await import("./weekly-engineering-review.js")) as WeeklyReviewModule;

const loadSharedEntrypoint = async () =>
  (await import("@control-plane/shared")) as Partial<WeeklyReviewModule>;

const validReview = (
  overrides: Partial<WeeklyEngineeringReview> = {},
): WeeklyEngineeringReview => ({
  contractVersion: CONTRACT_VERSION,
  delivery: {
    email: "deferred",
    slack: "deferred",
  },
  generatedAt: "2026-06-02T10:00:00.000Z",
  highlights: ["One repository improved its readiness score this week."],
  links: [
    {
      href: "/dashboard/reports/readiness_report_1",
      label: "Latest readiness report",
      targetType: "readiness_report",
    },
    {
      href: "/dashboard/findings?status=open",
      label: "Open findings",
      targetType: "findings",
    },
  ],
  periodEnd: "2026-06-02T10:00:00.000Z",
  periodStart: "2026-05-26T10:00:00.000Z",
  recommendedNextActions: ["Approve ready task recommendations before local runner execution."],
  repositorySummaries: [
    {
      approvedLocalRunnerTaskCount: 1,
      blockedFindingCount: 1,
      completedTaskCount: 1,
      draftTaskCount: 2,
      executionReadiness: "setup_pr_ready",
      latestReportId: "readiness_report_1",
      latestScanId: "repo_scan_1",
      openFindingCount: 3,
      overallScore: 72,
      previousOverallScore: 66,
      prOpenedTaskCount: 1,
      readyTaskRecommendationCount: 2,
      repoId: "github_repository_1",
      repositoryLabel: "rory/control-plane",
      resolvedFindingCount: 1,
      runningTaskCount: 0,
      scoreDelta: 6,
      taskRecommendationCount: 3,
    },
  ],
  reviewId: "weekly_review_1",
  risks: ["One blocked readiness finding still needs human review."],
  summary:
    "Weekly engineering review covered 1 repository with 3 open findings and 3 task recommendations.",
  totals: {
    approvedLocalRunnerTaskCount: 1,
    averageScore: 72,
    blockedFindingCount: 1,
    completedTaskCount: 1,
    openFindingCount: 3,
    prOpenedTaskCount: 1,
    readyTaskRecommendationCount: 2,
    repositoryCount: 1,
    repositoryWithReportCount: 1,
    resolvedFindingCount: 1,
    runningTaskCount: 0,
    taskRecommendationCount: 3,
  },
  workspaceId: "workspace_1",
  ...overrides,
});

const issuePath = (path: PropertyKey[]): string =>
  path.length === 0 ? "<root>" : path.map((segment) => String(segment)).join(".");

describe("WeeklyEngineeringReview", () => {
  it("validates a metadata-only weekly engineering review", async () => {
    const { WeeklyEngineeringReviewSchema } = await loadWeeklyReviewModule();

    expect(WeeklyEngineeringReviewSchema.safeParse(validReview()).success).toBe(true);
  });

  it("accepts only dashboard-safe link targets", async () => {
    const { WeeklyEngineeringReviewLinkTargetSchema, WeeklyEngineeringReviewSchema } =
      await loadWeeklyReviewModule();

    expect(WeeklyEngineeringReviewLinkTargetSchema.safeParse("findings").success).toBe(true);
    expect(WeeklyEngineeringReviewLinkTargetSchema.safeParse("source").success).toBe(false);
    expect(
      WeeklyEngineeringReviewSchema.safeParse(
        validReview({
          links: [
            {
              href: "/dashboard/source",
              label: "Source",
              targetType: "source" as WeeklyReviewLinkTarget,
            },
          ],
        }),
      ).success,
    ).toBe(false);
  });

  it("rejects unsafe payload keys recursively", async () => {
    const { WeeklyEngineeringReviewSchema } = await loadWeeklyReviewModule();

    for (const key of UNSAFE_WEEKLY_REVIEW_KEYS) {
      const result = WeeklyEngineeringReviewSchema.safeParse({
        ...validReview(),
        repositorySummaries: [
          {
            ...validReview().repositorySummaries[0],
            nested: { [key]: "placeholder value" },
          },
        ],
      });

      expect(result.success, `Expected unsafe weekly review key ${key} to be rejected.`).toBe(
        false,
      );

      if (!result.success) {
        expect(result.error.issues.map((issue) => issuePath(issue.path))).toContain(
          `repositorySummaries.0.nested.${key}`,
        );
      }
    }
  });

  it("rejects source-like, raw-log, and secret-like text values", async () => {
    const { WeeklyEngineeringReviewSchema } = await loadWeeklyReviewModule();

    for (const unsafeValue of UNSAFE_WEEKLY_REVIEW_VALUES) {
      expect(
        WeeklyEngineeringReviewSchema.safeParse(
          validReview({
            summary: unsafeValue,
          }),
        ).success,
        `Expected weekly review summary to reject ${unsafeValue}`,
      ).toBe(false);
      expect(
        WeeklyEngineeringReviewSchema.safeParse(
          validReview({
            recommendedNextActions: [unsafeValue],
          }),
        ).success,
        `Expected weekly review action to reject ${unsafeValue}`,
      ).toBe(false);
    }
  });

  it("exports the review contract from the package entrypoint", async () => {
    const shared = await loadSharedEntrypoint();

    expect(shared.WeeklyEngineeringReviewLinkTargetSchema?.safeParse("runs").success).toBe(true);
    expect(shared.WeeklyEngineeringReviewSchema?.safeParse(validReview()).success).toBe(true);
  });
});

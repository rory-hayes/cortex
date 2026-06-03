import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import type { WeeklyEngineeringReview } from "@control-plane/shared";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const review = (overrides: Partial<WeeklyEngineeringReview> = {}): WeeklyEngineeringReview => ({
  contractVersion: "2026-05-10.v1",
  delivery: {
    email: "deferred",
    slack: "deferred",
  },
  generatedAt: "2026-06-02T10:00:00.000Z",
  highlights: ["1 repository improved its readiness score this week."],
  links: [
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
      href: "/dashboard/task-recommendations?status=open",
      label: "Ready task recommendations",
      targetType: "task_recommendations",
    },
    {
      href: "/dashboard/tasks",
      label: "Cortex Tasks",
      targetType: "tasks",
    },
    {
      href: "/dashboard/pull-requests",
      label: "Open pull requests",
      targetType: "pull_requests",
    },
    {
      href: "/dashboard/runs",
      label: "Active runs",
      targetType: "runs",
    },
  ],
  periodEnd: "2026-06-02T10:00:00.000Z",
  periodStart: "2026-05-26T10:00:00.000Z",
  recommendedNextActions: [
    "Approve 2 ready task recommendations or convert them into Cortex Tasks.",
  ],
  repositorySummaries: [
    {
      approvedLocalRunnerTaskCount: 1,
      blockedFindingCount: 1,
      completedTaskCount: 0,
      draftTaskCount: 1,
      executionReadiness: "setup_pr_ready",
      latestReportId: "readiness_report_1",
      latestScanId: "repo_scan_1",
      openFindingCount: 2,
      overallScore: 74,
      previousOverallScore: 68,
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
  risks: ["1 blocked readiness finding needs review before execution."],
  summary:
    "Weekly engineering review covered 1 repository with 1 current readiness report, 2 open findings, and 3 task recommendations.",
  totals: {
    approvedLocalRunnerTaskCount: 1,
    averageScore: 74,
    blockedFindingCount: 1,
    completedTaskCount: 0,
    openFindingCount: 2,
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

const expectNoUnsafeReviewDisplayMaterial = (html: string) => {
  expect(html).not.toMatch(
    /JSON\.stringify|rawOutput|sourceCode|fileContent|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory|\.env\.local/i,
  );
};

describe("weekly review UI", () => {
  test("defines a workspace-scoped weekly review route", async () => {
    await expectFile("./(app)/dashboard/weekly-review/page.tsx");

    const source = await readAppFile("./(app)/dashboard/weekly-review/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createWeeklyEngineeringReviewService");
    expect(source).toContain("createDrizzleWeeklyEngineeringReviewStore");
    expect(source).toMatch(
      /generateWeeklyEngineeringReview\(\{\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toContain("<WeeklyEngineeringReviewSummary");
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expectNoUnsafeReviewDisplayMaterial(source);
  });

  test("adds Weekly Review to the authenticated dashboard navigation", async () => {
    const navSource = await readAppFile("../components/nav.tsx");
    const shellTestSource = await readAppFile("./navigation-shell.test.ts");

    expect(navSource).toContain('label: "Weekly Review"');
    expect(navSource).toContain('href: "/dashboard/weekly-review"');
    expect(shellTestSource).toContain('label: "Weekly Review"');
    expect(shellTestSource).toContain('route: "./(app)/dashboard/weekly-review/page.tsx"');
  });

  test("renders latest review totals, links, trend, and deferred delivery status", async () => {
    const { WeeklyEngineeringReviewSummary } = await import("../components/weekly-review");
    const html = renderToStaticMarkup(
      createElement(WeeklyEngineeringReviewSummary, { review: review() }),
    );

    expect(html).toContain("Weekly engineering review");
    expect(html).toContain("Latest review");
    expect(html).toContain("74 average score");
    expect(html).toContain("2 open findings");
    expect(html).toContain("2 ready recommendations");
    expect(html).toContain("Email deferred");
    expect(html).toContain("Slack deferred");
    expect(html).toContain("Trend from previous review");
    expect(html).toContain("1 improved");
    expect(html).toContain("0 regressed");
    expect(html).toContain("0 without prior score");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("+6");
    expect(html).toContain("Setup PR ready");
    expect(html).toContain('href="/dashboard/reports/readiness_report_1"');
    expect(html).toContain('href="/dashboard/findings?status=open"');
    expect(html).toContain('href="/dashboard/task-recommendations?status=open"');
    expect(html).toContain('href="/dashboard/tasks"');
    expect(html).toContain('href="/dashboard/pull-requests"');
    expect(html).toContain('href="/dashboard/runs"');
    expect(html).toContain("Approve next recommended tasks");
    expectNoUnsafeReviewDisplayMaterial(html);
  });

  test("keeps the approval CTA pointed at task recommendation review when no recommendation is ready", async () => {
    const { WeeklyEngineeringReviewSummary } = await import("../components/weekly-review");
    const baseReview = review();
    const baseRepositorySummary = baseReview.repositorySummaries[0]!;
    const html = renderToStaticMarkup(
      createElement(WeeklyEngineeringReviewSummary, {
        review: review({
          links: [
            {
              href: "/dashboard/task-recommendations",
              label: "Cortex recommendations",
              targetType: "task_recommendations",
            },
          ],
          repositorySummaries: [
            {
              ...baseRepositorySummary,
              readyTaskRecommendationCount: 0,
              scoreDelta: -4,
            },
          ],
          totals: {
            ...baseReview.totals,
            readyTaskRecommendationCount: 0,
          },
        }),
      }),
    );

    expect(html).toContain("0 ready recommendations");
    expect(html).toContain("0 improved");
    expect(html).toContain("1 regressed");
    expect(html).toContain("Review task recommendations");
    expect(html).toContain('href="/dashboard/task-recommendations"');
    expectNoUnsafeReviewDisplayMaterial(html);
  });
});

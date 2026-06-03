import { access, readFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  CONTRACT_VERSION,
  FINDING_CATEGORIES,
  type RepoReadinessReport,
} from "@control-plane/shared";

const readAppFile = (path: string) => readFile(new URL(path, import.meta.url), "utf8");

const expectFile = async (path: string) => {
  await expect(access(new URL(path, import.meta.url))).resolves.toBeUndefined();
};

const categoryScores = (
  overrides: Partial<RepoReadinessReport["categoryScores"]> = {},
): RepoReadinessReport["categoryScores"] =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [category, overrides[category] ?? 82]),
  ) as RepoReadinessReport["categoryScores"];

const createReport = (
  overrides: Partial<RepoReadinessReport> & Record<string, unknown> = {},
): RepoReadinessReport =>
  ({
    blockedReasons: ["Local runner execution requires complete repository policy coverage."],
    categoryScores: categoryScores({
      agent_readiness: 74,
      product_clarity: 91,
      security: 52,
      validation: 65,
    }),
    contractVersion: CONTRACT_VERSION,
    executionReadiness: "setup_pr_ready",
    findingIds: ["finding_1", "finding_2"],
    generatedAt: "2026-05-26T10:00:00.000Z",
    overallScore: 65,
    recommendedNextActions: [
      "Create setup tasks for the open readiness recommendations.",
      "Re-scan after setup PRs merge to confirm local runner readiness.",
    ],
    repoId: "github_repository_1",
    reportId: "readiness_report_1",
    scanId: "repo_scan_1",
    strengths: ["Product clarity metadata is strong enough for onboarding."],
    summary: "The repository is close to setup PR readiness but needs policy coverage.",
    taskRecommendationIds: ["task_recommendation_1", "task_recommendation_2"],
    weaknesses: [
      "Validation score is reduced by missing validation metadata.",
      "Security score is reduced by policy coverage gaps.",
    ],
    workspaceId: "workspace_1",
    ...overrides,
  }) as RepoReadinessReport;

const repository = {
  id: "github_repository_1",
  repositoryFullName: "rory/control-plane",
  repositoryName: "control-plane",
  repositoryOwner: "rory",
};

const expectNoUnsafeReportDisplayMaterial = (html: string) => {
  expect(html).not.toMatch(
    /JSON\.stringify|rawOutput|sourceCode|fileContent|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory|\.env\.local/i,
  );
};

describe("readiness report UI", () => {
  test("defines a workspace-scoped readiness report route", async () => {
    await expectFile("./(app)/dashboard/reports/[reportId]/page.tsx");

    const source = await readAppFile("./(app)/dashboard/reports/[reportId]/page.tsx");

    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).toContain("SELECTED_WORKSPACE_COOKIE_NAME");
    expect(source).toContain("cookieStore.get(SELECTED_WORKSPACE_COOKIE_NAME)");
    expect(source).toContain("createRepoReadinessReportService");
    expect(source).toContain("createDrizzleRepoReadinessReportStore");
    expect(source).toMatch(
      /getReadinessReport\(\{\s*reportId,\s*workspaceId: verifiedWorkspace\.workspaceId,?\s*\}\)/,
    );
    expect(source).toContain("createGitHubRepositoryService");
    expect(source).toContain("<ReadinessReport");
    expect(source).toMatch(/verifiedWorkspace === null[\s\S]*Select a workspace/);
    expectNoUnsafeReportDisplayMaterial(source);
  });

  test("renders score, category cards, blockers, next actions, and safe report links", async () => {
    const { ReadinessReport } = await import("../components/readiness-report");
    const html = renderToStaticMarkup(
      createElement(ReadinessReport, {
        report: createReport(),
        repository,
      }),
    );

    expect(html).toContain("Readiness report");
    expect(html).toContain("rory/control-plane");
    expect(html).toContain("65 / 100");
    expect(html).toContain("Setup PR ready");
    expect(html).toContain("Product clarity");
    expect(html).toContain("Agent readiness");
    expect(html).toContain("Validation");
    expect(html).toContain("Security");
    expect(html).toContain("91");
    expect(html).toContain("74");
    expect(html).toContain("65");
    expect(html).toContain("52");
    expect(html).toContain("Top blockers");
    expect(html).toContain("Local runner execution requires complete repository policy coverage.");
    expect(html).toContain("Recommended next actions");
    expect(html).toContain("Create setup tasks for the open readiness recommendations.");
    expect(html).toContain("Improve this score by resolving open findings");
    expect(html).toContain("Product clarity metadata is strong enough for onboarding.");
    expect(html).toContain("Validation score is reduced by missing validation metadata.");
    expect(html).toContain('href="/dashboard/findings?scan=repo_scan_1"');
    expect(html).toContain('href="/dashboard/findings?scan=repo_scan_1&amp;status=open"');
    expect(html).toContain('href="/dashboard/task-recommendations?scan=repo_scan_1"');
    expect(html).toContain(
      'href="/dashboard/task-recommendations?scan=repo_scan_1&amp;recommendation=task_recommendation_1"',
    );
    expect(html).toContain("task_recommendation_1");
    expectNoUnsafeReportDisplayMaterial(html);
  });

  test("does not render unsafe extra fields or unsafe known-field text", async () => {
    const { ReadinessReport } = await import("../components/readiness-report");
    const html = renderToStaticMarkup(
      createElement(ReadinessReport, {
        report: createReport({
          blockedReasons: ["/Users/rory/private/repo/.env.local leaked"],
          diff: "diff --git a/app.ts b/app.ts",
          patch: "@@ -1 +1 @@",
          rawOutput: "stdout: raw command output",
          sourceCode: "const leaked = true",
          strengths: ["```ts\nconst leaked = true;\n```"],
          summary: "stdout: raw validation output must not render",
          token: "ghp_reportSecretShouldNotRender",
          weaknesses: ["Review https://user:repo-secret-token@example.test/private.git"],
        }),
        repository,
      }),
    );

    expect(html).toContain("Readiness report");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain("raw command output");
    expect(html).not.toContain("raw validation output");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("ghp_reportSecretShouldNotRender");
    expect(html).not.toContain("repo-secret-token");
    expectNoUnsafeReportDisplayMaterial(html);
  });
});

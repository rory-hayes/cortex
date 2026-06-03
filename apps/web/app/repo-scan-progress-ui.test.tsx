import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  type RepoScan,
} from "@control-plane/shared";

const createScan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-25T12:00:00.000Z",
  findingIds: [],
  inventory: {
    agentInstructionSummary: {
      completenessStatus: "complete",
      hasAgentInstructions: true,
      instructionFileCount: 1,
      missingSectionLabels: [],
      readStatus: "read",
    },
    backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
    backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
    validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
    ciPostureSummary: {
      detectedCommandLabels: ["test", "typecheck"],
      hasCi: true,
      missingCommandLabels: [],
      postureStatus: "aligned",
      providerLabels: ["GitHub Actions"],
      requiredCommandLabels: ["test", "typecheck"],
      workflowFileCount: 1,
    },
    ciProviderLabels: ["GitHub Actions"],
    documentationSummaries: [],
    documentSummaries: [],
    languageSummaries: [],
    omittedFileCount: 1,
    packageManagerLabels: ["pnpm"],
    policySummary: {
      dryRunCheckCount: 11,
      hasPolicyFile: true,
      protectedPathCount: 2,
      sensitivePathCount: 3,
      validationCommandCount: 4,
    },
    productClaritySummary: {
      clarityStatus: "missing",
      goalContextStatus: "not_provided",
      hasProductDocs: false,
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
    },
    repoHygieneSummary: {
      contributionDocCount: 0,
      hasContributionDocs: false,
      hasRootGitignore: false,
      hygieneStatus: "unknown",
      issueLabels: [],
      issueTemplateCount: 0,
      jsLockfileCount: 0,
      monorepoSignalCount: 0,
      monorepoStructureStatus: "unknown",
      packageManagerCount: 0,
      packageManagerStatus: "unknown",
      workspaceConfigCount: 0,
    },
    scannedFileCount: 10,
    totalDirectoryCount: 4,
    totalFileCount: 11,
  },
  moduleStatuses: [
    {
      id: "product_clarity",
      label: "Product clarity",
      metadata: {
        productDocCount: 1,
      },
      order: 5,
      required: false,
      status: "passed",
      summary: "Product clarity scan found enough metadata-only product signals.",
      startedAt: "2026-05-25T12:01:00.000Z",
      finishedAt: "2026-05-25T12:01:30.000Z",
    },
    {
      id: "agent_readiness",
      label: "Agent readiness",
      metadata: {
        instructionFileCount: 1,
      },
      order: 10,
      required: false,
      status: "warning",
      summary: "Agent readiness scan generated setup recommendations.",
      startedAt: "2026-05-25T12:02:00.000Z",
      finishedAt: "2026-05-25T12:02:30.000Z",
    },
    {
      id: "architecture",
      label: "Architecture",
      metadata: {},
      order: 15,
      required: false,
      status: "failed",
      summary: "Architecture scan could not run because safe inventory metadata was unavailable.",
      startedAt: "2026-05-25T12:03:00.000Z",
      finishedAt: "2026-05-25T12:03:30.000Z",
    },
    {
      id: "security",
      label: "Security",
      metadata: {},
      order: 20,
      required: false,
      status: "running",
      summary: "Security scan is running.",
      startedAt: "2026-05-25T12:04:00.000Z",
    },
  ],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  startedAt: "2026-05-25T12:00:30.000Z",
  statusSummary: "Repo readiness scan modules finished with warnings.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-25T12:02:30.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const expectNoUnsafeScanProgressMaterial = (html: string) => {
  expect(html).not.toMatch(
    /JSON\.stringify|rawOutput|sourceCode|fileContent|diff --git|@@ -1|patch|snippet|secret|token|stdout|stderr|\/Users\/rory|\.env\.local/i,
  );
};

describe("repo scan progress UI", () => {
  test("renders canonical module labels, statuses, counts, and timestamps", async () => {
    const { RepoScanProgress } = await import("../components/repo-scan-progress");

    const html = renderToStaticMarkup(
      createElement(RepoScanProgress, {
        scans: [createScan()],
      }),
    );

    expect(html).toContain("Scan progress");
    expect(html).toContain("repo_scan_1");
    expect(html).toContain("8 modules");
    expect(html).toContain("1 passed");
    expect(html).toContain("1 warning");
    expect(html).toContain("1 failed");
    expect(html).toContain("1 running");
    expect(html).toContain("4 queued");
    expect(html).toContain("Product Clarity");
    expect(html).toContain("Agent Readiness");
    expect(html).toContain("Architecture");
    expect(html).toContain("Backlog");
    expect(html).toContain("Validation");
    expect(html).toContain("CI/CD");
    expect(html).toContain("Security");
    expect(html).toContain("Repo Hygiene");
    expect(html).not.toContain("GitHub inventory");
    expect(html).not.toContain("Recommendations");
    expect(html).toContain("Passed");
    expect(html).toContain("Warning");
    expect(html).toContain("Failed");
    expect(html).toContain("Running");
    expect(html).toContain("Queued");
    expect(html).toContain("Optional");
    expect(html).toContain("May");
    expect(html).toContain("11 files");
    expect(html).toContain("10 scanned");
    expect(html).toContain("1 omitted");
    expectNoUnsafeScanProgressMaterial(html);
  });

  test("shows missing canonical modules as skipped after terminal scans", async () => {
    const { RepoScanProgress } = await import("../components/repo-scan-progress");
    const html = renderToStaticMarkup(
      createElement(RepoScanProgress, {
        scans: [
          createScan({
            finishedAt: "2026-05-25T12:06:00.000Z",
            moduleStatuses: [],
            readinessReportId: "repo_readiness_report_1",
            status: "completed",
            statusSummary: "Repo readiness scan completed.",
          }),
        ],
      }),
    );

    expect(html).toContain("8 modules");
    expect(html).toContain("8 skipped");
    expect(html).toContain("Skipped");
    expect(html).toContain("Backlog");
    expect(html).toContain("Validation");
    expect(html).toContain("CI/CD");
    expect(html).toContain("Repo Hygiene");
    expect(html).toContain("View report");
    expect(html).toContain('href="/dashboard/reports/repo_readiness_report_1"');
    expectNoUnsafeScanProgressMaterial(html);
  });

  test("renders scan-level failure summaries through safe text guards", async () => {
    const { RepoScanProgress } = await import("../components/repo-scan-progress");
    const html = renderToStaticMarkup(
      createElement(RepoScanProgress, {
        scans: [
          createScan({
            failureSummary: "Required repo scan module failed.",
            finishedAt: "2026-05-25T12:05:00.000Z",
            status: "failed",
            statusSummary: "Repo readiness scan failed.",
          }),
        ],
      }),
    );

    expect(html).toContain("Scan failed");
    expect(html).toContain("Required repo scan module failed.");
    expectNoUnsafeScanProgressMaterial(html);
  });

  test("does not render unsafe summaries, metadata, raw output, or extra fields", async () => {
    const { RepoScanProgress } = await import("../components/repo-scan-progress");
    const html = renderToStaticMarkup(
      createElement(RepoScanProgress, {
        scans: [
          createScan({
            failureSummary:
              "Provider failed at /Users/rory/private/repo/.env.local with rawOutput: secret token",
            finishedAt: "2026-05-25T12:05:00.000Z",
            moduleStatuses: [
              {
                diff: "diff --git a/app.ts b/app.ts",
                id: "product_clarity",
                label: "const leaked = true",
                localPath: "/Users/rory/private/repo",
                metadata: {
                  rawOutput: "stdout: raw command output",
                  sourceCode: "const leaked = true",
                },
                order: 0,
                patch: "@@ -1 +1 @@",
                required: true,
                status: "failed",
                summary: "```ts\nconst leaked = true;\n```",
                token: "ghp_moduleSecretShouldNotRender",
                finishedAt: "2026-05-25T12:02:30.000Z",
              } as unknown as RepoScan["moduleStatuses"][number],
            ],
            status: "failed",
            statusSummary: "Repo readiness scan failed.",
          }),
        ],
      }),
    );

    expect(html).toContain("Product Clarity");
    expect(html).toContain("Scan failed");
    expect(html).toContain("Unavailable");
    expect(html).not.toContain("diff --git");
    expect(html).not.toContain("/Users/rory/private/repo");
    expect(html).not.toContain("raw command output");
    expect(html).not.toContain("const leaked");
    expect(html).not.toContain("@@ -1 +1 @@");
    expect(html).not.toContain("ghp_moduleSecretShouldNotRender");
    expectNoUnsafeScanProgressMaterial(html);
  });

  test("renders an empty state when there are no recent scans", async () => {
    const { RepoScanProgress } = await import("../components/repo-scan-progress");
    const html = renderToStaticMarkup(
      createElement(RepoScanProgress, {
        scans: [],
      }),
    );

    expect(html).toContain("No module progress yet.");
    expectNoUnsafeScanProgressMaterial(html);
  });
});

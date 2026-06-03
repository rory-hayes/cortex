import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScan,
  type RepoScanInventory,
  type RepoScanRepoHygieneSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./repo-hygiene");

const healthyHygieneSummary = (): RepoScanRepoHygieneSummary => ({
  contributionDocCount: 1,
  hasContributionDocs: true,
  hasRootGitignore: true,
  hygieneStatus: "healthy",
  issueLabels: [],
  issueTemplateCount: 1,
  jsLockfileCount: 1,
  monorepoSignalCount: 0,
  monorepoStructureStatus: "single_project",
  packageManagerCount: 1,
  packageManagerStatus: "single",
  workspaceConfigCount: 0,
});

const inventory = (
  repoHygieneSummary: RepoScanRepoHygieneSummary = healthyHygieneSummary(),
): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: ["GitHub Actions"],
  documentationSummaries: [{ kind: "architecture", pathCount: 1, present: true }],
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 0,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 11,
    hasPolicyFile: true,
    protectedPathCount: 2,
    sensitivePathCount: 2,
    validationCommandCount: 3,
  },
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "not_provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
  },
  repoHygieneSummary,
  scannedFileCount: 8,
  totalDirectoryCount: 4,
  totalFileCount: 8,
});

const scan = (
  repoHygieneSummary: RepoScanRepoHygieneSummary = healthyHygieneSummary(),
): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-29T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(repoHygieneSummary),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-29T12:00:00.000Z",
  workspaceId: "workspace_1",
});

const createServices = () => {
  const persistedFindings: Finding[] = [];
  const persistedRecommendations: TaskRecommendation[] = [];
  const findingService = {
    persistFinding: vi.fn<RepoFindingService["persistFinding"]>(async (input) => {
      const finding = FindingSchema.parse(input.finding);
      persistedFindings.push(finding);

      return {
        dedupeKey: finding.deterministicRuleId,
        finding,
        taskIds: [],
      };
    }),
  };
  const taskRecommendationService = {
    persistTaskRecommendation: vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
      async (input) => {
        const recommendation = TaskRecommendationSchema.parse(input.recommendation);
        persistedRecommendations.push(recommendation);

        return {
          recommendation,
        };
      },
    ),
  };

  return {
    findingService,
    persistedFindings,
    persistedRecommendations,
    taskRecommendationService,
  };
};

const expectNoUnsafeRepoHygieneMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);
  const unsafeKeys: string[] = [];

  const collectKeys = (candidate: unknown) => {
    if (typeof candidate !== "object" || candidate === null) {
      return;
    }

    if (Array.isArray(candidate)) {
      candidate.forEach(collectKeys);
      return;
    }

    for (const [key, childValue] of Object.entries(candidate)) {
      const isAllowedFindingSource = key === "source" && childValue === "deterministic_rule";
      const isAllowedEmptyEvidencePaths =
        key === "paths" && Array.isArray(childValue) && childValue.length === 0;

      if (
        !isAllowedFindingSource &&
        !isAllowedEmptyEvidencePaths &&
        /^(?:command|content|contents|diff|filePaths|localPath|patch|path|paths|rawOutput|secret|snippet|source|stderr|stdout|token)$/iu.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(unsafeKeys).toEqual([]);
  expect(serialized).not.toMatch(
    /\.env|raw GitHub|raw provider|diff --git|@@|patch|snippet|export const|process\.env|ghp_|sk-proj-|\/Users\/rory|BEGIN PRIVATE KEY|stdout|stderr/iu,
  );
  expect(serialized).not.toContain('".gitignore"');
  expect(serialized).not.toContain(".github/ISSUE_TEMPLATE");
  expect(serialized).not.toContain("src/index");
};

describe("repo hygiene scan module", () => {
  test("passes without finding or recommendation when repository hygiene is healthy", async () => {
    const { createRepoHygieneScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createRepoHygieneScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "repo_hygiene",
      label: "Repo hygiene",
      order: 25,
      required: false,
    });
    expect(result).toEqual({
      findingIds: [],
      metadata: {
        contributionDocCount: 1,
        findingCount: 0,
        hasContributionDocs: true,
        hasRootGitignore: true,
        hygieneStatus: "healthy",
        issueLabels: [],
        issueTemplateCount: 1,
        jsLockfileCount: 1,
        monorepoSignalCount: 0,
        monorepoStructureStatus: "single_project",
        packageManagerCount: 1,
        packageManagerStatus: "single",
        taskRecommendationCount: 0,
        workspaceConfigCount: 0,
      },
      status: "passed",
      summary: "Repo hygiene scan found healthy structural setup metadata.",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeRepoHygieneMaterial(result);
  });

  test("persists a low finding and setup recommendation for minor setup gaps", async () => {
    const { createRepoHygieneScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createRepoHygieneScanModule({
      findingService,
      now: () => new Date("2026-05-29T12:30:00.000Z"),
      taskRecommendationService,
    });

    const summary: RepoScanRepoHygieneSummary = {
      ...healthyHygieneSummary(),
      hasRootGitignore: false,
      hygieneStatus: "minor_gaps",
      issueLabels: ["missing_gitignore", "missing_issue_templates"],
      issueTemplateCount: 0,
    };
    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(summary),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: ["finding:repo_scan_1:repo_hygiene"],
      metadata: {
        contributionDocCount: 1,
        findingCount: 1,
        hasContributionDocs: true,
        hasRootGitignore: false,
        hygieneStatus: "minor_gaps",
        issueLabels: ["missing_gitignore", "missing_issue_templates"],
        issueTemplateCount: 0,
        jsLockfileCount: 1,
        monorepoSignalCount: 0,
        monorepoStructureStatus: "single_project",
        packageManagerCount: 1,
        packageManagerStatus: "single",
        taskRecommendationCount: 1,
        workspaceConfigCount: 0,
      },
      status: "warning",
      summary: "Repo hygiene scan found minor structural setup gaps.",
      taskRecommendationIds: ["task_recommendation:repo_scan_1:repo_hygiene"],
    });
    expect(persistedFindings[0]).toMatchObject({
      category: "repo_hygiene",
      deterministicRuleId: "repo_hygiene.minor_setup_gaps",
      findingId: "finding:repo_scan_1:repo_hygiene",
      severity: "low",
    });
    expect(persistedFindings[0]?.evidence[0]).toEqual({
      metadata: {
        contributionDocCount: 1,
        findingCount: 0,
        hasContributionDocs: true,
        hasRootGitignore: false,
        hygieneStatus: "minor_gaps",
        issueLabels: ["missing_gitignore", "missing_issue_templates"],
        issueTemplateCount: 0,
        jsLockfileCount: 1,
        monorepoSignalCount: 0,
        monorepoStructureStatus: "single_project",
        packageManagerCount: 1,
        packageManagerStatus: "single",
        taskRecommendationCount: 0,
        workspaceConfigCount: 0,
      },
      paths: [],
      summary: "Repo hygiene was evaluated from metadata-only inventory counts and labels.",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:repo_hygiene"],
      objective: "Improve repository setup hygiene for safer AI-assisted execution.",
      riskLevel: "low",
      taskRecommendationId: "task_recommendation:repo_scan_1:repo_hygiene",
    });
    expectNoUnsafeRepoHygieneMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test.each([
    [
      "mixed lockfiles",
      {
        ...healthyHygieneSummary(),
        hygieneStatus: "needs_attention",
        issueLabels: ["mixed_lockfiles"],
        jsLockfileCount: 2,
        packageManagerCount: 2,
        packageManagerStatus: "mixed",
      } satisfies RepoScanRepoHygieneSummary,
    ],
    [
      "unclear monorepo structure",
      {
        ...healthyHygieneSummary(),
        hygieneStatus: "needs_attention",
        issueLabels: ["unclear_monorepo_structure"],
        monorepoSignalCount: 3,
        monorepoStructureStatus: "unclear",
      } satisfies RepoScanRepoHygieneSummary,
    ],
  ])("persists a medium finding for %s", async (_label, summary) => {
    const { createRepoHygieneScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createRepoHygieneScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(summary),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(result.metadata).toMatchObject({
      findingCount: 1,
      hygieneStatus: "needs_attention",
      issueLabels: summary.issueLabels,
      taskRecommendationCount: 1,
    });
    expect(persistedFindings).toHaveLength(1);
    expect(persistedFindings[0]).toMatchObject({
      category: "repo_hygiene",
      deterministicRuleId: "repo_hygiene.structural_setup_risk",
      severity: "medium",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      riskLevel: "medium",
      taskRecommendationId: "task_recommendation:repo_scan_1:repo_hygiene",
    });
    expectNoUnsafeRepoHygieneMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("returns failed with safe metadata when inventory is missing", async () => {
    const { createRepoHygieneScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createRepoHygieneScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: [],
      metadata: {
        contributionDocCount: 0,
        errorKind: "missing_inventory",
        findingCount: 0,
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
        taskRecommendationCount: 0,
        workspaceConfigCount: 0,
      },
      status: "failed",
      summary: "Repo hygiene scan could not run because inventory metadata was unavailable.",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeRepoHygieneMaterial(result);
  });
});

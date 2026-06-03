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
  type RepoScanPolicySummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./security");

const policySummary = (overrides: Partial<RepoScanPolicySummary> = {}): RepoScanPolicySummary => ({
  dryRunCheckCount: 11,
  hasPolicyFile: true,
  protectedPathCount: 2,
  sensitivePathCount: 2,
  validationCommandCount: 3,
  ...overrides,
});

const inventory = (
  policySummaryValue: RepoScanPolicySummary = policySummary(),
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
  policySummary: policySummaryValue,
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "not_provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
  },
  repoHygieneSummary: {
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
  },
  scannedFileCount: 8,
  totalDirectoryCount: 4,
  totalFileCount: 8,
});

const scan = (policySummaryValue: RepoScanPolicySummary = policySummary()): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-29T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(policySummaryValue),
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

const expectNoUnsafeSecurityMaterial = (value: unknown) => {
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
};

describe("security scan module", () => {
  test("persists a security finding and setup recommendation when repository policy coverage is missing", async () => {
    const { createSecurityScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createSecurityScanModule({
      findingService,
      now: () => new Date("2026-05-29T12:30:00.000Z"),
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(
        policySummary({
          dryRunCheckCount: 0,
          hasPolicyFile: false,
          protectedPathCount: 0,
          sensitivePathCount: 0,
          validationCommandCount: 0,
        }),
      ),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "security",
      label: "Security",
      order: 20,
      required: false,
    });
    expect(result).toEqual({
      findingIds: ["finding:repo_scan_1:security_policy_coverage"],
      metadata: {
        coverageStatus: "missing",
        dryRunCheckCount: 0,
        findingCount: 1,
        hasPolicyFile: false,
        missingCoverageLabels: [
          "repository policy",
          "protected area rules",
          "sensitive area rules",
        ],
        protectedPathCount: 0,
        recommendedRuleLabels: [
          "Create repository policy",
          "Add protected area rules",
          "Add sensitive area rules",
        ],
        sensitivePathCount: 0,
        taskRecommendationCount: 1,
        validationCommandCount: 0,
      },
      status: "warning",
      summary: "Security scan found missing repository policy coverage metadata.",
      taskRecommendationIds: ["task_recommendation:repo_scan_1:security_policy_coverage"],
    });
    expect(persistedFindings[0]).toMatchObject({
      category: "security",
      deterministicRuleId: "security.policy_coverage_missing",
      findingId: "finding:repo_scan_1:security_policy_coverage",
      severity: "high",
    });
    expect(persistedFindings[0]?.evidence[0]).toEqual({
      metadata: {
        coverageStatus: "missing",
        dryRunCheckCount: 0,
        findingCount: 0,
        hasPolicyFile: false,
        missingCoverageLabels: [
          "repository policy",
          "protected area rules",
          "sensitive area rules",
        ],
        protectedPathCount: 0,
        recommendedRuleLabels: [
          "Create repository policy",
          "Add protected area rules",
          "Add sensitive area rules",
        ],
        sensitivePathCount: 0,
        taskRecommendationCount: 0,
        validationCommandCount: 0,
      },
      paths: [],
      summary: "Repository policy coverage was evaluated from metadata-only inventory counts.",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:security_policy_coverage"],
      objective:
        "Add repository policy coverage for protected and sensitive areas before AI execution.",
      taskRecommendationId: "task_recommendation:repo_scan_1:security_policy_coverage",
    });
    expectNoUnsafeSecurityMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test.each([
    [
      "protected",
      policySummary({ protectedPathCount: 0 }),
      ["protected area rules"],
      ["Add protected area rules"],
    ],
    [
      "sensitive",
      policySummary({ sensitivePathCount: 0 }),
      ["sensitive area rules"],
      ["Add sensitive area rules"],
    ],
  ])(
    "persists an incomplete policy coverage finding when %s coverage is missing",
    async (_label, summary, expectedMissingLabels, expectedRecommendations) => {
      const { createSecurityScanModule } = await importModule();
      const {
        findingService,
        persistedFindings,
        persistedRecommendations,
        taskRecommendationService,
      } = createServices();
      const module = createSecurityScanModule({
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
        coverageStatus: "incomplete",
        findingCount: 1,
        missingCoverageLabels: expectedMissingLabels,
        recommendedRuleLabels: expectedRecommendations,
        taskRecommendationCount: 1,
      });
      expect(persistedFindings).toHaveLength(1);
      expect(persistedFindings[0]).toMatchObject({
        category: "security",
        deterministicRuleId: "security.policy_coverage_incomplete",
        findingId: "finding:repo_scan_1:security_policy_coverage",
      });
      expect(persistedRecommendations).toHaveLength(1);
      expect(persistedRecommendations[0]).toMatchObject({
        executionMode: "setup_pr",
        findingIds: ["finding:repo_scan_1:security_policy_coverage"],
      });
      expectNoUnsafeSecurityMaterial({ persistedFindings, persistedRecommendations, result });
    },
  );

  test("passes without finding or recommendation when policy coverage is adequate", async () => {
    const { createSecurityScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createSecurityScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(policySummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: [],
      metadata: {
        coverageStatus: "ready",
        dryRunCheckCount: 11,
        findingCount: 0,
        hasPolicyFile: true,
        missingCoverageLabels: [],
        protectedPathCount: 2,
        recommendedRuleLabels: [],
        sensitivePathCount: 2,
        taskRecommendationCount: 0,
        validationCommandCount: 3,
      },
      status: "passed",
      summary: "Security scan found repository policy coverage metadata.",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeSecurityMaterial(result);
  });

  test("returns failed with safe metadata when inventory is missing", async () => {
    const { createSecurityScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createSecurityScanModule({
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
        coverageStatus: "unknown",
        dryRunCheckCount: 0,
        errorKind: "missing_inventory",
        findingCount: 0,
        hasPolicyFile: false,
        missingCoverageLabels: [],
        protectedPathCount: 0,
        recommendedRuleLabels: [],
        sensitivePathCount: 0,
        taskRecommendationCount: 0,
        validationCommandCount: 0,
      },
      status: "failed",
      summary: "Security scan could not run because inventory metadata was unavailable.",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeSecurityMaterial(result);
  });
});

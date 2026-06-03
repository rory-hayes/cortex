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
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./architecture");

const inventory = (
  documentationSummaries: RepoScanInventory["documentationSummaries"] = [],
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
  documentationSummaries,
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 0,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 11,
    hasPolicyFile: true,
    protectedPathCount: 2,
    sensitivePathCount: 3,
    validationCommandCount: 4,
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

const scan = (
  documentationSummaries: RepoScanInventory["documentationSummaries"] = [],
): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-28T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(documentationSummaries),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-28T12:00:00.000Z",
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

const expectNoUnsafeArchitectureMaterial = (value: unknown) => {
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
      if (
        /^(?:content|contents|diff|filePaths|localPath|patch|rawOutput|secret|snippet|source|stderr|stdout|token)$/iu.test(
          key,
        ) &&
        !(key === "source" && childValue === "deterministic_rule")
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(unsafeKeys).toEqual([]);
  expect(serialized).not.toMatch(
    /raw GitHub|diff --git|@@|patch|snippet|export const|process\.env|ghp_|sk-proj-|\/Users\/rory|BEGIN PRIVATE KEY|stdout|stderr/iu,
  );
};

describe("architecture scan module", () => {
  test("persists an architecture finding and setup recommendation when architecture docs are missing", async () => {
    const { createArchitectureScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createArchitectureScanModule({
      findingService,
      now: () => new Date("2026-05-28T12:30:00.000Z"),
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "architecture",
      label: "Architecture",
      order: 15,
      required: false,
    });
    expect(result).toEqual({
      findingIds: ["finding:repo_scan_1:architecture"],
      metadata: {
        architectureDocCount: 0,
        hasArchitectureDocs: false,
        taskRecommendationCount: 1,
      },
      status: "warning",
      summary: "Architecture scan found no architecture documentation summary.",
      taskRecommendationIds: ["task_recommendation:repo_scan_1:architecture"],
    });
    expect(persistedFindings[0]).toMatchObject({
      category: "architecture",
      deterministicRuleId: "architecture.missing",
      findingId: "finding:repo_scan_1:architecture",
      severity: "high",
    });
    expect(persistedFindings[0]?.evidence[0]).toEqual({
      metadata: {
        architectureDocCount: 0,
        hasArchitectureDocs: false,
        taskRecommendationCount: 0,
      },
      paths: [],
      summary: "Architecture documentation was evaluated from metadata-only inventory summaries.",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      acceptanceCriteria: [
        "Architecture documentation describes the system shape and major runtime boundaries.",
        "The document identifies package or app responsibilities without copying implementation excerpts.",
        "The document records validation and security expectations for safe AI-assisted changes.",
        "The update avoids credentials, environment-specific machine details, and change hunks.",
      ],
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:architecture"],
      objective:
        "Add architecture documentation covering system shape, boundaries, package responsibilities, validation expectations, and security expectations.",
      taskRecommendationId: "task_recommendation:repo_scan_1:architecture",
    });
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeArchitectureMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("passes without finding or recommendation when architecture docs are present", async () => {
    const { createArchitectureScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createArchitectureScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan([{ kind: "architecture", pathCount: 2, present: true }]),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: [],
      metadata: {
        architectureDocCount: 2,
        hasArchitectureDocs: true,
        taskRecommendationCount: 0,
      },
      status: "passed",
      summary: "Architecture scan found architecture documentation metadata.",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeArchitectureMaterial(result);
  });

  test("returns failed with safe metadata when inventory is missing", async () => {
    const { createArchitectureScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createArchitectureScanModule({
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
        architectureDocCount: 0,
        errorKind: "missing_inventory",
        hasArchitectureDocs: false,
        taskRecommendationCount: 0,
      },
      status: "failed",
      summary: "Architecture scan could not run because inventory metadata was unavailable.",
      taskRecommendationIds: [],
    });
    expectNoUnsafeArchitectureMaterial(result);
  });
});

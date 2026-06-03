import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
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

const importModule = async () => import("./backlog-quality");

const backlogSummary = (
  backlogQualitySummary: RepoScanInventory["backlogQualitySummary"],
): RepoScanInventory["backlogSummary"] => ({
  backlogFileCount: backlogQualitySummary.backlogFileCount,
  hasBacklog: backlogQualitySummary.hasBacklog,
  missingStructureLabels: [...backlogQualitySummary.missingSignalLabels],
  readStatus: backlogQualitySummary.readStatus,
  structureStatus:
    backlogQualitySummary.structureStatus === "ai_executable"
      ? "complete"
      : backlogQualitySummary.structureStatus,
});

const inventory = (
  backlogQualitySummary: RepoScanInventory["backlogQualitySummary"],
): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary,
  backlogSummary: backlogSummary(backlogQualitySummary),
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: ["GitHub Actions"],
  documentSummaries: [],
  documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
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
    signalLabels: ["purpose", "target_user", "problem", "scope", "success_criteria"],
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

const scan = (summary: RepoScanInventory["backlogQualitySummary"]): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-28T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(summary),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-28T12:00:00.000Z",
  workspaceId: "workspace_1",
});

const missingSummary = (): RepoScanInventory["backlogQualitySummary"] => ({
  backlogFileCount: 0,
  hasBacklog: false,
  missingSignalLabels: ["backlog"],
  readStatus: "missing",
  signalLabels: [],
  structureStatus: "missing",
});

const weakSummary = (): RepoScanInventory["backlogQualitySummary"] => ({
  backlogFileCount: 1,
  hasBacklog: true,
  missingSignalLabels: ["acceptance criteria", "validation"],
  readStatus: "read",
  signalLabels: ["file-touch hints", "status markers", "task ids"],
  structureStatus: "weak",
});

const completeSummary = (): RepoScanInventory["backlogQualitySummary"] => ({
  backlogFileCount: 1,
  hasBacklog: true,
  missingSignalLabels: [],
  readStatus: "read",
  signalLabels: [
    "acceptance criteria",
    "dependencies",
    "file-touch hints",
    "priority or milestone",
    "security notes",
    "status markers",
    "task ids",
    "validation",
  ],
  structureStatus: "ai_executable",
});

const createServices = () => {
  const persistedFindings: Finding[] = [];
  const persistedRecommendations: TaskRecommendation[] = [];
  const findingService = {
    persistFinding: vi.fn<RepoFindingService["persistFinding"]>(async (input) => {
      persistedFindings.push(input.finding);

      return {
        dedupeKey: "dedupe_backlog_quality",
        finding: input.finding,
        taskIds: [],
      };
    }),
  };
  const taskRecommendationService = {
    persistTaskRecommendation: vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
      async (input) => {
        persistedRecommendations.push(input.recommendation);

        return {
          recommendation: input.recommendation,
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

const expectNoUnsafeBacklogMaterial = (value: unknown) => {
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
        /^(?:content|contents|diff|filePaths|localPath|patch|rawOutput|secret|snippet|source|stderr|stdout|token)$/u.test(
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
  expect(serialized).not.toContain("export const");
  expect(serialized).not.toContain("process.env");
  expect(serialized).not.toContain("ghp_");
  expect(serialized).not.toContain("-----BEGIN");
  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("### RFB-026");
};

describe("backlog quality scan module", () => {
  test("persists a high finding and setup recommendation when backlog is missing", async () => {
    const { createBacklogQualityScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createBacklogQualityScanModule({
      findingService,
      now: () => new Date("2026-05-28T12:30:00.000Z"),
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(missingSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "backlog_quality",
      label: "Backlog quality",
      order: 18,
      required: false,
    });
    expect(result.status).toBe("warning");
    expect(result.findingIds).toEqual(["finding:repo_scan_1:backlog_quality"]);
    expect(result.taskRecommendationIds).toEqual([
      "task_recommendation:repo_scan_1:backlog_quality",
    ]);
    expect(persistedFindings[0]).toMatchObject({
      category: "backlog_quality",
      deterministicRuleId: "backlog_quality.missing",
      severity: "high",
      title: "AI-executable backlog is missing",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:backlog_quality"],
      riskLevel: "medium",
      title: "Improve AI-ready backlog structure",
    });
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeBacklogMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("persists a medium finding when backlog structure is weak", async () => {
    const { createBacklogQualityScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, ...services } = createServices();
    const module = createBacklogQualityScanModule(services);

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(weakSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(persistedFindings[0]).toMatchObject({
      deterministicRuleId: "backlog_quality.weak",
      severity: "medium",
    });
    expect(persistedFindings[0]?.evidence[0]?.metadata).toMatchObject({
      backlogFileCount: 1,
      missingSignalCount: 2,
      missingSignalLabels: ["acceptance criteria", "validation"],
      structureStatus: "weak",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      riskLevel: "low",
    });
    expectNoUnsafeBacklogMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("passes without persisted records when backlog structure is AI-executable", async () => {
    const { createBacklogQualityScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createBacklogQualityScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(completeSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      findingIds: [],
      metadata: {
        backlogFileCount: 1,
        findingCount: 0,
        hasBacklog: true,
        missingSignalCount: 0,
        readStatus: "read",
        structureStatus: "ai_executable",
        taskRecommendationCount: 0,
      },
      status: "passed",
      taskRecommendationIds: [],
    });
    expect(findingService.persistFinding).not.toHaveBeenCalled();
    expect(taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
  });

  test("fails with safe metadata when inventory is missing", async () => {
    const { createBacklogQualityScanModule } = await importModule();
    const module = createBacklogQualityScanModule(createServices());

    const result = await module.run({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      findingIds: [],
      metadata: {
        errorKind: "missing_inventory",
        structureStatus: "missing",
      },
      status: "failed",
      taskRecommendationIds: [],
    });
    expectNoUnsafeBacklogMaterial(result);
  });
});

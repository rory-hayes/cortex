import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
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

const importModule = async () => import("./validation-posture");

const inventory = (
  validationPostureSummary: RepoScanInventory["validationPostureSummary"],
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
  ciProviderLabels: ["GitHub Actions"],
  documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 0,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: validationPostureSummary.dryRunCheckCount,
    hasPolicyFile: validationPostureSummary.hasPolicyFile,
    protectedPathCount: 2,
    sensitivePathCount: 3,
    validationCommandCount: validationPostureSummary.validationCommandCount,
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
  validationPostureSummary,
});

const scan = (summary: RepoScanInventory["validationPostureSummary"]): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-06-01T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(summary),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-06-01T12:00:00.000Z",
  workspaceId: "workspace_1",
});

const missingSummary = (): RepoScanInventory["validationPostureSummary"] => ({
  detectedCommandLabels: [],
  dryRunCheckCount: 0,
  hasPolicyFile: false,
  missingCommandLabels: ["format", "lint", "test", "typecheck"],
  postureStatus: "missing",
  suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
  validationCommandCount: 0,
});

const partialSummary = (): RepoScanInventory["validationPostureSummary"] => ({
  detectedCommandLabels: ["test"],
  dryRunCheckCount: 2,
  hasPolicyFile: true,
  missingCommandLabels: ["format", "lint", "typecheck"],
  postureStatus: "partial",
  suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
  validationCommandCount: 1,
});

const readySummary = (): RepoScanInventory["validationPostureSummary"] => ({
  detectedCommandLabels: ["format", "lint", "test", "typecheck"],
  dryRunCheckCount: 11,
  hasPolicyFile: true,
  missingCommandLabels: [],
  postureStatus: "ready",
  suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
  validationCommandCount: 4,
});

const createServices = (): {
  findingService: Pick<RepoFindingService, "persistFinding">;
  persistedFindings: Finding[];
  persistedRecommendations: TaskRecommendation[];
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
} => {
  const persistedFindings: Finding[] = [];
  const persistedRecommendations: TaskRecommendation[] = [];
  const persistFinding = vi.fn<RepoFindingService["persistFinding"]>(async ({ finding }) => {
    persistedFindings.push(finding);

    return {
      dedupeKey: "dedupe_validation_posture",
      finding,
      taskIds: [],
    };
  });
  const persistTaskRecommendation = vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
    async ({ recommendation }) => {
      persistedRecommendations.push(recommendation);

      return { created: true, recommendation };
    },
  );

  return {
    findingService: {
      persistFinding,
    },
    persistedFindings,
    persistedRecommendations,
    taskRecommendationService: {
      persistTaskRecommendation,
    },
  };
};

const expectNoUnsafeValidationMaterial = (value: unknown) => {
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
        /^(?:command|content|contents|diff|filePaths|localPath|patch|rawOutput|secret|snippet|source|stderr|stdout|token)$/iu.test(
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
    /pnpm run|vitest|eslint|prettier|tsc|diff --git|process\.env|ghp_|sk-proj-|-----BEGIN/iu,
  );
};

describe("validation posture scan module", () => {
  test("persists a high finding and setup recommendation when validation commands are missing", async () => {
    const { createValidationPostureScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createValidationPostureScanModule({
      findingService,
      now: () => new Date("2026-06-01T12:30:00.000Z"),
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(missingSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(module).toMatchObject({
      id: "validation_posture",
      label: "Validation",
      order: 19,
      required: false,
    });
    expect(result.status).toBe("warning");
    expect(result.findingIds).toEqual(["finding:repo_scan_1:validation_posture"]);
    expect(result.taskRecommendationIds).toEqual([
      "task_recommendation:repo_scan_1:validation_posture",
    ]);
    expect(persistedFindings[0]).toMatchObject({
      category: "validation",
      deterministicRuleId: "validation_posture.missing",
      severity: "high",
      title: "Validation commands are missing",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:validation_posture"],
      riskLevel: "medium",
      title: "Add validation command map",
    });
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeValidationMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("persists a medium finding when validation posture is partial", async () => {
    const { createValidationPostureScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, ...services } = createServices();
    const module = createValidationPostureScanModule(services);

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(partialSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(persistedFindings[0]).toMatchObject({
      deterministicRuleId: "validation_posture.partial",
      severity: "medium",
    });
    expect(persistedFindings[0]?.evidence[0]?.metadata).toMatchObject({
      detectedCommandLabels: ["test"],
      missingCommandLabels: ["format", "lint", "typecheck"],
      postureStatus: "partial",
      validationCommandCount: 1,
    });
    expect(persistedRecommendations[0]).toMatchObject({
      riskLevel: "low",
    });
    expectNoUnsafeValidationMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("passes without persisted records when validation posture is ready", async () => {
    const { createValidationPostureScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createValidationPostureScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(readySummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      findingIds: [],
      metadata: {
        detectedCommandLabels: ["format", "lint", "test", "typecheck"],
        findingCount: 0,
        missingCommandLabels: [],
        postureStatus: "ready",
        taskRecommendationCount: 0,
      },
      status: "passed",
      taskRecommendationIds: [],
    });
  });

  test("fails safely when inventory metadata is unavailable", async () => {
    const { createValidationPostureScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createValidationPostureScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      findingIds: [],
      metadata: {
        errorKind: "missing_inventory",
        postureStatus: "unknown",
      },
      status: "failed",
      taskRecommendationIds: [],
    });
  });
});

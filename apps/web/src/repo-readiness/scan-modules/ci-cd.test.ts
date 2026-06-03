import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
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

const importModule = async () => import("./ci-cd");

const inventory = (ciPostureSummary: RepoScanInventory["ciPostureSummary"]): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary,
  ciProviderLabels: ciPostureSummary.providerLabels,
  documentationSummaries: [{ kind: "readme", pathCount: 1, present: true }],
  documentSummaries: [],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 0,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 4,
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
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
});

const scan = (summary: RepoScanInventory["ciPostureSummary"]): RepoScan => ({
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

const missingSummary = (): RepoScanInventory["ciPostureSummary"] => ({
  detectedCommandLabels: [],
  hasCi: false,
  missingCommandLabels: ["test", "typecheck"],
  postureStatus: "missing",
  providerLabels: [],
  requiredCommandLabels: ["test", "typecheck"],
  workflowFileCount: 0,
});

const partialSummary = (): RepoScanInventory["ciPostureSummary"] => ({
  detectedCommandLabels: ["test"],
  hasCi: true,
  missingCommandLabels: ["typecheck"],
  postureStatus: "partial",
  providerLabels: ["GitHub Actions"],
  requiredCommandLabels: ["test", "typecheck"],
  workflowFileCount: 1,
});

const alignedSummary = (): RepoScanInventory["ciPostureSummary"] => ({
  detectedCommandLabels: ["test", "typecheck"],
  hasCi: true,
  missingCommandLabels: [],
  postureStatus: "aligned",
  providerLabels: ["GitHub Actions"],
  requiredCommandLabels: ["test", "typecheck"],
  workflowFileCount: 1,
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
      dedupeKey: "dedupe_ci_cd",
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

const expectNoUnsafeCiCdMaterial = (value: unknown) => {
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
    /pnpm run|vitest|eslint|prettier|tsc|diff --git|process\.env|ghp_|sk-proj-|-----BEGIN|cat src\/index\.ts/iu,
  );
};

describe("CI/CD posture scan module", () => {
  test("persists a finding and setup recommendation when CI is missing for validation commands", async () => {
    const { createCiCdScanModule } = await importModule();
    const {
      findingService,
      persistedFindings,
      persistedRecommendations,
      taskRecommendationService,
    } = createServices();
    const module = createCiCdScanModule({
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
      id: "ci_cd",
      label: "CI/CD",
      order: 20,
      required: false,
    });
    expect(result.status).toBe("warning");
    expect(result.findingIds).toEqual(["finding:repo_scan_1:ci_cd"]);
    expect(result.taskRecommendationIds).toEqual(["task_recommendation:repo_scan_1:ci_cd"]);
    expect(persistedFindings[0]).toMatchObject({
      category: "ci_cd",
      deterministicRuleId: "ci_cd.missing",
      severity: "medium",
      title: "CI validation coverage is missing",
    });
    expect(persistedRecommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      findingIds: ["finding:repo_scan_1:ci_cd"],
      riskLevel: "low",
      title: "Add CI validation workflow",
    });
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeCiCdMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("persists a finding when CI skips detected validation labels", async () => {
    const { createCiCdScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, ...services } = createServices();
    const module = createCiCdScanModule(services);

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(partialSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(persistedFindings[0]).toMatchObject({
      deterministicRuleId: "ci_cd.partial",
      severity: "medium",
    });
    expect(persistedFindings[0]?.evidence[0]?.metadata).toMatchObject({
      detectedCommandLabels: ["test"],
      missingCommandLabels: ["typecheck"],
      postureStatus: "partial",
      workflowFileCount: 1,
    });
    expect(persistedRecommendations[0]).toMatchObject({
      riskLevel: "low",
    });
    expectNoUnsafeCiCdMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("passes without persisted records when CI aligns with detected validation labels", async () => {
    const { createCiCdScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createCiCdScanModule({
      findingService,
      taskRecommendationService,
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(alignedSummary()),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toMatchObject({
      findingIds: [],
      metadata: {
        detectedCommandLabels: ["test", "typecheck"],
        findingCount: 0,
        missingCommandLabels: [],
        postureStatus: "aligned",
        taskRecommendationCount: 0,
      },
      status: "passed",
      taskRecommendationIds: [],
    });
  });

  test("fails safely when inventory metadata is unavailable", async () => {
    const { createCiCdScanModule } = await importModule();
    const { findingService, taskRecommendationService } = createServices();
    const module = createCiCdScanModule({
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

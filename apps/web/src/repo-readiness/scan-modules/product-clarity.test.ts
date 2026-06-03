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
  type RepoScanProductClaritySummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";

vi.mock("server-only", () => ({}));

const importModule = async () => import("./product-clarity");

const productClaritySummary = (
  overrides: Partial<RepoScanProductClaritySummary> = {},
): RepoScanProductClaritySummary => ({
  clarityStatus: "missing",
  goalContextStatus: "not_provided",
  hasProductDocs: false,
  missingSignalLabels: [],
  productDocCount: 0,
  readStatus: "missing",
  signalLabels: [],
  ...overrides,
});

const inventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "missing",
    hasAgentInstructions: false,
    instructionFileCount: 0,
    missingSectionLabels: ["agent instructions"],
    readStatus: "missing",
  },
  backlogQualitySummary: DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  backlogSummary: DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  ciPostureSummary: DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  validationPostureSummary: DEFAULT_REPO_SCAN_VALIDATION_POSTURE_SUMMARY,
  ciProviderLabels: [],
  documentationSummaries: [],
  documentSummaries: [],
  languageSummaries: [],
  omittedFileCount: 0,
  packageManagerLabels: [],
  policySummary: {
    dryRunCheckCount: 0,
    hasPolicyFile: false,
    protectedPathCount: 0,
    sensitivePathCount: 0,
    validationCommandCount: 0,
  },
  productClaritySummary: productClaritySummary(),
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
  scannedFileCount: 0,
  totalDirectoryCount: 0,
  totalFileCount: 0,
  ...overrides,
});

const scan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: "2026-05-28T12:00:00.000Z",
  findingIds: [],
  inventory: inventory(),
  moduleStatuses: [],
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  status: "running",
  statusSummary: "Repo readiness scan is running.",
  taskRecommendationIds: [],
  updatedAt: "2026-05-28T12:00:00.000Z",
  workspaceId: "workspace_1",
  ...overrides,
});

const createServices = () => {
  const persistedFindings: Finding[] = [];
  const persistedRecommendations: TaskRecommendation[] = [];
  const persistFinding = vi.fn<RepoFindingService["persistFinding"]>(async (input) => {
    const parsedFinding = FindingSchema.parse(input.finding);
    persistedFindings.push(parsedFinding);

    return {
      dedupeKey: parsedFinding.deterministicRuleId,
      finding: parsedFinding,
      taskIds: [],
    };
  });
  const persistTaskRecommendation = vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
    async (input) => {
      const parsedRecommendation = TaskRecommendationSchema.parse(input.recommendation);
      persistedRecommendations.push(parsedRecommendation);

      return {
        recommendation: parsedRecommendation,
      };
    },
  );

  return {
    persistedFindings,
    persistedRecommendations,
    services: {
      findingService: {
        persistFinding,
      } satisfies Pick<RepoFindingService, "persistFinding">,
      taskRecommendationService: {
        persistTaskRecommendation,
      } satisfies Pick<TaskRecommendationService, "persistTaskRecommendation">,
    },
  };
};

const expectNoUnsafeProductClarityMaterial = (value: unknown) => {
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
        /^(?:content|contents|diff|localPath|patch|rawOutput|secret|snippet|source|stderr|stdout|token)$/iu.test(
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
    /diff --git|raw GitHub|ghp_productsecret|sk-proj-|\/Users\/rory|process\.env|BEGIN PRIVATE KEY|coordinate safe AI-assisted engineering work/iu,
  );
};

describe("product clarity scan module", () => {
  test("exposes optional product clarity module metadata before agent readiness", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { services } = createServices();
    const module = createProductClarityScanModule({
      ...services,
    });

    expect(module).toMatchObject({
      id: "product_clarity",
      label: "Product clarity",
      order: 5,
      required: false,
    });
  });

  test("returns failed with generic safe metadata when inventory is unavailable", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { services } = createServices();
    const module = createProductClarityScanModule({ ...services });

    const result = await module.run({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: [],
      metadata: {
        clarityStatus: "unknown",
        errorKind: "missing_inventory",
        goalContextStatus: "not_provided",
        missingSignalLabels: [],
        productDocCount: 0,
        readStatus: "missing",
        signalLabels: [],
        taskRecommendationCount: 0,
      },
      status: "failed",
      summary: "Product clarity scan could not run because inventory metadata was unavailable.",
      taskRecommendationIds: [],
    });
    expectNoUnsafeProductClarityMaterial(result);
  });

  test("persists a product clarity finding and setup recommendation for missing product clarity", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, services } = createServices();
    const module = createProductClarityScanModule({
      ...services,
      now: () => new Date("2026-05-28T12:30:00.000Z"),
    });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan(),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(result.findingIds).toEqual(["finding:repo_scan_1:product_clarity"]);
    expect(result.taskRecommendationIds).toEqual([
      "task_recommendation:repo_scan_1:product_clarity",
    ]);
    expect(result.metadata).toEqual({
      clarityStatus: "missing",
      goalContextStatus: "not_provided",
      missingSignalLabels: [],
      productDocCount: 0,
      readStatus: "missing",
      signalLabels: [],
      taskRecommendationCount: 1,
    });
    expect(persistedFindings).toHaveLength(1);
    expect(persistedFindings[0]).toEqual(
      expect.objectContaining({
        category: "product_clarity",
        deterministicRuleId: "product_clarity.missing",
        findingId: "finding:repo_scan_1:product_clarity",
        severity: "high",
      }),
    );
    expect(persistedRecommendations[0]).toEqual(
      expect.objectContaining({
        executionMode: "setup_pr",
        findingIds: ["finding:repo_scan_1:product_clarity"],
        riskLevel: "medium",
        taskRecommendationId: "task_recommendation:repo_scan_1:product_clarity",
      }),
    );
    expect(FindingSchema.safeParse(persistedFindings[0]).success).toBe(true);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeProductClarityMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("persists a medium severity finding and setup recommendation for weak product clarity", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { persistedFindings, persistedRecommendations, services } = createServices();
    const module = createProductClarityScanModule({ ...services });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan({
        inventory: inventory({
          productClaritySummary: productClaritySummary({
            clarityStatus: "weak",
            hasProductDocs: true,
            missingSignalLabels: ["problem", "scope", "success_criteria"],
            productDocCount: 1,
            readStatus: "read",
            signalLabels: ["purpose", "target_user"],
          }),
        }),
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.status).toBe("warning");
    expect(result.metadata).toEqual({
      clarityStatus: "weak",
      goalContextStatus: "not_provided",
      missingSignalLabels: ["problem", "scope", "success_criteria"],
      productDocCount: 1,
      readStatus: "read",
      signalLabels: ["purpose", "target_user"],
      taskRecommendationCount: 1,
    });
    expect(persistedFindings[0]).toEqual(
      expect.objectContaining({
        deterministicRuleId: "product_clarity.weak",
        severity: "medium",
      }),
    );
    expect(persistedRecommendations).toHaveLength(1);
    expect(TaskRecommendationSchema.safeParse(persistedRecommendations[0]).success).toBe(true);
    expectNoUnsafeProductClarityMaterial({ persistedFindings, persistedRecommendations, result });
  });

  test("passes without findings or recommendations when product clarity is sufficient", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { services } = createServices();
    const module = createProductClarityScanModule({ ...services });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan({
        inventory: inventory({
          productClaritySummary: productClaritySummary({
            clarityStatus: "sufficient",
            hasProductDocs: true,
            productDocCount: 1,
            readStatus: "read",
            signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
          }),
        }),
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      findingIds: [],
      metadata: {
        clarityStatus: "sufficient",
        goalContextStatus: "not_provided",
        missingSignalLabels: [],
        productDocCount: 1,
        readStatus: "read",
        signalLabels: ["problem", "purpose", "scope", "success_criteria", "target_user"],
        taskRecommendationCount: 0,
      },
      status: "passed",
      summary: "Product clarity scan found sufficient metadata-only product intent signals.",
      taskRecommendationIds: [],
    });
    expect(services.findingService.persistFinding).not.toHaveBeenCalled();
    expect(services.taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
    expectNoUnsafeProductClarityMaterial(result);
  });

  test("uses optional goal-context status as metadata without inventing product claims", async () => {
    const { createProductClarityScanModule } = await importModule();
    const { persistedFindings, services } = createServices();
    const module = createProductClarityScanModule({ ...services });

    const result = await module.run({
      repoId: "github_repository_1",
      scan: scan({
        inventory: inventory({
          productClaritySummary: productClaritySummary({
            clarityStatus: "weak",
            goalContextStatus: "provided",
            hasProductDocs: true,
            missingSignalLabels: ["scope", "success_criteria"],
            productDocCount: 1,
            readStatus: "read",
            signalLabels: ["purpose", "target_user", "problem"],
          }),
        }),
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.metadata).toEqual({
      clarityStatus: "weak",
      goalContextStatus: "provided",
      missingSignalLabels: ["scope", "success_criteria"],
      productDocCount: 1,
      readStatus: "read",
      signalLabels: ["purpose", "target_user", "problem"],
      taskRecommendationCount: 1,
    });
    expect(persistedFindings[0]?.evidence[0]?.metadata).toEqual({
      clarityStatus: "weak",
      goalContextStatus: "provided",
      missingSignalLabels: ["scope", "success_criteria"],
      productDocCount: 1,
      readStatus: "read",
      signalLabels: ["purpose", "target_user", "problem"],
      taskRecommendationCount: 0,
    });
    expectNoUnsafeProductClarityMaterial({ persistedFindings, result });
  });
});

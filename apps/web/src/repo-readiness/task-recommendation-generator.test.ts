import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  TaskRecommendationSchema,
  type Finding,
  type RepoScan,
  type RepoScanInventory,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "./findings";
import type { RepoScanService } from "./repo-scans";
import type { TaskRecommendationService } from "./task-recommendations";

vi.mock("server-only", () => ({}));

const importGenerator = async () => import("./task-recommendation-generator");

const now = new Date("2026-05-28T11:00:00.000Z");

const readyInventory = (overrides: Partial<RepoScanInventory> = {}): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingSignalLabels: [],
    readStatus: "read",
    signalLabels: ["acceptance criteria", "dependencies", "task ids", "validation"],
    structureStatus: "ai_executable",
  },
  backlogSummary: {
    backlogFileCount: 1,
    hasBacklog: true,
    missingStructureLabels: [],
    readStatus: "read",
    structureStatus: "complete",
  },
  ciPostureSummary: {
    detectedCommandLabels: ["test", "typecheck"],
    hasCi: true,
    missingCommandLabels: [],
    postureStatus: "aligned",
    providerLabels: ["github_actions"],
    requiredCommandLabels: ["test", "typecheck"],
    workflowFileCount: 1,
  },
  ciProviderLabels: ["github_actions"],
  documentationSummaries: [{ kind: "architecture", pathCount: 1, present: true }],
  documentSummaries: [
    {
      documentByteCount: 500,
      inputCharacterCount: 420,
      kind: "product",
      label: "Product brief",
      redactedCharacterCount: 420,
      redactionApplied: false,
      summary: "Product documentation describes scan, approve, validate, and review workflows.",
      topicLabels: ["product_scope", "security", "validation", "workflow"],
    },
  ],
  languageSummaries: [{ fileCount: 8, name: "TypeScript" }],
  omittedFileCount: 2,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    protectedPathCount: 1,
    sensitivePathCount: 1,
    validationCommandCount: 4,
  },
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "provided",
    hasProductDocs: true,
    missingSignalLabels: [],
    productDocCount: 1,
    readStatus: "read",
    signalLabels: ["purpose", "scope", "target_user"],
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
  scannedFileCount: 10,
  totalDirectoryCount: 4,
  totalFileCount: 12,
  validationPostureSummary: {
    detectedCommandLabels: ["format", "test", "typecheck"],
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    missingCommandLabels: ["lint"],
    postureStatus: "partial",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 3,
  },
  ...overrides,
});

const scan = (overrides: Partial<RepoScan> = {}): RepoScan => ({
  contractVersion: CONTRACT_VERSION,
  createdAt: now.toISOString(),
  findingIds: ["finding_1"],
  finishedAt: now.toISOString(),
  inventory: readyInventory(),
  moduleStatuses: [
    {
      finishedAt: now.toISOString(),
      id: "github_inventory",
      label: "GitHub inventory",
      metadata: {},
      order: 0,
      required: true,
      startedAt: now.toISOString(),
      status: "passed",
      summary: "GitHub inventory completed with metadata-only summaries.",
    },
    {
      finishedAt: now.toISOString(),
      id: "validation_posture",
      label: "Validation",
      metadata: {},
      order: 1,
      required: false,
      startedAt: now.toISOString(),
      status: "warning",
      summary: "Validation posture generated setup recommendations.",
    },
  ],
  repoId: "github_repository_1",
  readinessReportId: "readiness_report_1",
  scanId: "repo_scan_1",
  startedAt: now.toISOString(),
  status: "completed",
  statusSummary: "Repo readiness report generated.",
  taskRecommendationIds: [],
  updatedAt: now.toISOString(),
  workspaceId: "workspace_1",
  ...overrides,
});

const finding = (overrides: Partial<Finding> = {}): Finding => ({
  confidence: 0.91,
  contractVersion: CONTRACT_VERSION,
  createdAt: now.toISOString(),
  deterministicRuleId: "validation_posture.partial",
  evidence: [
    {
      metadata: { missingCommandLabels: ["lint"] },
      paths: ["apps/web/src/api/unsafe-route.ts"],
      summary: "Validation metadata is missing the lint command label.",
    },
  ],
  findingId: "finding_1",
  category: "validation",
  recommendation: "Add the missing lint validation metadata before local runner execution.",
  repoId: "github_repository_1",
  scanId: "repo_scan_1",
  severity: "medium",
  source: "deterministic_rule",
  status: "open",
  summary: "The repository has a partial validation command map.",
  title: "Validation command map is partial",
  updatedAt: now.toISOString(),
  workspaceId: "workspace_1",
  ...overrides,
});

const recommendation = (overrides: Partial<TaskRecommendation> = {}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: ["The recommendation remains linked to the readiness finding."],
    contractVersion: CONTRACT_VERSION,
    createdAt: now.toISOString(),
    effort: "small",
    executionMode: "setup_pr",
    findingIds: ["finding_1"],
    metadata: { sourceLabel: "existing_recommendation" },
    objective: "Resolve the validation readiness finding.",
    repoId: "github_repository_1",
    riskLevel: "medium",
    scanId: "repo_scan_1",
    status: "open",
    suggestedValidation: [
      {
        label: "Review validation metadata",
        required: true,
        validationId: "validation-posture:review",
      },
    ],
    taskRecommendationId: "task_recommendation_1",
    title: "Resolve validation finding",
    updatedAt: now.toISOString(),
    workspaceId: "workspace_1",
    ...overrides,
  });

const createServices = (
  input: {
    existingRecommendations?: TaskRecommendation[];
    findings?: Finding[];
    scan?: RepoScan | null;
  } = {},
) => {
  const currentScan = input.scan === undefined ? scan() : input.scan;
  const findings = input.findings ?? [finding()];
  const persistedRecommendations = [...(input.existingRecommendations ?? [])];
  const scanService = {
    getRepoScan: vi.fn<RepoScanService["getRepoScan"]>(async () => currentScan),
  } satisfies Pick<RepoScanService, "getRepoScan">;
  const findingService = {
    listFindings: vi.fn<RepoFindingService["listFindings"]>(async () =>
      findings.map((item) => ({
        dedupeKey: `dedupe_${item.findingId}`,
        finding: item,
        taskIds: [],
      })),
    ),
  } satisfies Pick<RepoFindingService, "listFindings">;
  const taskRecommendationService = {
    listTaskRecommendations: vi.fn<TaskRecommendationService["listTaskRecommendations"]>(async () =>
      persistedRecommendations.map((item) => ({
        recommendation: item,
      })),
    ),
    persistTaskRecommendation: vi.fn<TaskRecommendationService["persistTaskRecommendation"]>(
      async ({ recommendation: candidate }) => {
        const parsed = TaskRecommendationSchema.parse(candidate);

        persistedRecommendations.push(parsed);

        return { recommendation: parsed };
      },
    ),
  } satisfies Pick<
    TaskRecommendationService,
    "listTaskRecommendations" | "persistTaskRecommendation"
  >;

  return {
    findingService,
    persistedRecommendations,
    scanService,
    taskRecommendationService,
  };
};

describe("task recommendation generator service", () => {
  test("applies safe LLM text refinements to deterministic templates without bypassing safety fields", async () => {
    const { generateAndPersistTaskRecommendations } = await importGenerator();
    const services = createServices();
    const llm = {
      generateRecommendations: vi.fn(async ({ safeInput }) => ({
        refinements: [
          {
            acceptanceCriteria: [
              "The validation recommendation remains linked to the readiness finding.",
              "Validation readiness metadata is documented with fixed labels only.",
              "Hosted recommendation metadata avoids command text, source excerpts, and local details.",
            ],
            findingId: safeInput.findingSummaries[0]?.findingId,
            objective: "Create AI-ready validation metadata from safe readiness findings.",
            title: "Add safe validation readiness metadata",
          },
        ],
      })),
    };

    const result = await generateAndPersistTaskRecommendations({
      createRecommendationId: () => "task_recommendation_generated_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      taskRecommendationService: services.taskRecommendationService,
      workspaceId: "workspace_1",
    });

    expect(result.generationSource).toBe("llm");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      acceptanceCriteria: [
        "The validation recommendation remains linked to the readiness finding.",
        "Validation readiness metadata is documented with fixed labels only.",
        "Hosted recommendation metadata avoids command text, source excerpts, and local details.",
      ],
      effort: "small",
      executionMode: "setup_pr",
      findingIds: ["finding_1"],
      objective: "Create AI-ready validation metadata from safe readiness findings.",
      riskLevel: "medium",
      status: "open",
      suggestedValidation: [
        {
          label: "Review validation command map",
          required: true,
          validationId: "validation-posture:review",
        },
      ],
      taskRecommendationId: "task_recommendation_generated_1",
      title: "Add safe validation readiness metadata",
    });
    expect(result.recommendations[0]).not.toHaveProperty("cortexTaskId");
    expect(services.taskRecommendationService.persistTaskRecommendation).toHaveBeenCalledWith({
      recommendation: expect.objectContaining({
        status: "open",
        taskRecommendationId: "task_recommendation_generated_1",
      }),
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    expect(JSON.stringify(llm.generateRecommendations.mock.calls[0]?.[0].safeInput)).not.toContain(
      "apps/web/src/api/unsafe-route.ts",
    );
  });

  test("rejects unsafe LLM payload keys and persists a deterministic fallback recommendation", async () => {
    const { generateAndPersistTaskRecommendations } = await importGenerator();
    const services = createServices();
    const llm = {
      generateRecommendations: vi.fn(async () => ({
        refinements: [
          {
            acceptanceCriteria: ["Use the raw source to patch the missing validation map."],
            findingId: "finding_1",
            objective: "Patch validation.",
            rawSource: "export const unsafe = true;",
            title: "Unsafe candidate",
          },
        ],
      })),
    };

    const result = await generateAndPersistTaskRecommendations({
      createRecommendationId: () => "task_recommendation_generated_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      taskRecommendationService: services.taskRecommendationService,
      workspaceId: "workspace_1",
    });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.recommendations).toHaveLength(1);
    expect(result.recommendations[0]).toMatchObject({
      acceptanceCriteria: [
        "Repository policy includes required validation entries for typecheck, lint, format, and test gates.",
        "Each validation entry has a stable identifier, human-readable label, timeout, and required flag.",
        "Hosted repo-readiness scanning records only fixed validation labels and counts, not command text or output.",
      ],
      executionMode: "setup_pr",
      findingIds: ["finding_1"],
      riskLevel: "medium",
      status: "open",
      suggestedValidation: [
        {
          label: "Review validation command map",
          required: true,
          validationId: "validation-posture:review",
        },
      ],
      taskRecommendationId: "task_recommendation_generated_1",
      title: "Add validation command map",
    });
    expect(JSON.stringify(result.recommendations)).not.toContain("rawSource");
  });

  test("falls back when LLM refinements try to override safety fields", async () => {
    const { generateAndPersistTaskRecommendations } = await importGenerator();
    const services = createServices();
    const llm = {
      generateRecommendations: vi.fn(async () => ({
        refinements: [
          {
            acceptanceCriteria: ["Try to bypass the deterministic execution mode."],
            executionMode: "local_runner",
            findingId: "finding_1",
            objective: "Bypass setup review.",
            riskLevel: "low",
            title: "Unsafe safety-field override",
          },
        ],
      })),
    };

    const result = await generateAndPersistTaskRecommendations({
      createRecommendationId: () => "task_recommendation_generated_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      taskRecommendationService: services.taskRecommendationService,
      workspaceId: "workspace_1",
    });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.recommendations[0]).toMatchObject({
      executionMode: "setup_pr",
      riskLevel: "medium",
      suggestedValidation: [
        {
          label: "Review validation command map",
          required: true,
          validationId: "validation-posture:review",
        },
      ],
      title: "Add validation command map",
    });
  });

  test("does not generate recommendations for non-open or already covered findings", async () => {
    const { generateAndPersistTaskRecommendations } = await importGenerator();
    const services = createServices({
      existingRecommendations: [recommendation()],
      findings: [finding(), finding({ findingId: "finding_2", status: "resolved" })],
      scan: scan({
        findingIds: ["finding_1", "finding_2"],
        taskRecommendationIds: ["task_recommendation_1"],
      }),
    });
    const llm = {
      generateRecommendations: vi.fn(),
    };

    const result = await generateAndPersistTaskRecommendations({
      createRecommendationId: () => "task_recommendation_generated_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      taskRecommendationService: services.taskRecommendationService,
      workspaceId: "workspace_1",
    });

    expect(result).toEqual({
      generationSource: "none",
      recommendations: [],
    });
    expect(llm.generateRecommendations).not.toHaveBeenCalled();
    expect(services.taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
  });

  test("blocks task recommendation generation before LLM or persistence when plan limit is reached", async () => {
    const { generateAndPersistTaskRecommendations } = await importGenerator();
    const services = createServices();
    const llm = {
      generateRecommendations: vi.fn(),
    };
    const usageLimitService = {
      assertUsageAllowed: vi.fn(async () => {
        throw Object.assign(
          new Error("Plan limit reached. Upgrade, request an admin override, or wait for reset."),
          { code: "plan_limit_exceeded" },
        );
      }),
    };

    await expect(
      generateAndPersistTaskRecommendations({
        createRecommendationId: () => "task_recommendation_generated_1",
        findingService: services.findingService,
        llm,
        now: () => now,
        scanId: "repo_scan_1",
        scanService: services.scanService,
        taskRecommendationService: services.taskRecommendationService,
        usageLimitService,
        workspaceId: "workspace_1",
      } as unknown as Parameters<typeof generateAndPersistTaskRecommendations>[0]),
    ).rejects.toMatchObject({
      code: "plan_limit_exceeded",
      message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
    });

    expect(usageLimitService.assertUsageAllowed).toHaveBeenCalledWith({
      quantity: 1,
      usageEventType: "task_recommendation_generation",
      workspaceId: "workspace_1",
    });
    expect(llm.generateRecommendations).not.toHaveBeenCalled();
    expect(services.taskRecommendationService.persistTaskRecommendation).not.toHaveBeenCalled();
  });
});

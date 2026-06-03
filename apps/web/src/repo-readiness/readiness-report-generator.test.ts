import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  type Finding,
  type RepoReadinessReport,
  type RepoScan,
  type RepoScanInventory,
} from "@control-plane/shared";

import type { RepoFindingService } from "./findings";
import type { RepoReadinessReportService } from "./reports";
import type { RepoScanService } from "./repo-scans";

vi.mock("server-only", () => ({}));

const importGenerator = async () => import("./readiness-report-generator");

const now = new Date("2026-05-27T10:00:00.000Z");

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
  scanId: "repo_scan_1",
  startedAt: now.toISOString(),
  status: "running",
  statusSummary: "Deterministic repo scan modules finished.",
  taskRecommendationIds: ["task_recommendation_1"],
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

const persistedReport = (report: RepoReadinessReport): RepoReadinessReport => ({
  ...report,
  reportId: "report_persisted",
});

const createServices = (
  input: {
    findings?: Finding[];
    lifecycleSummary?: Awaited<ReturnType<RepoFindingService["reconcileFindingLifecycle"]>>;
    scan?: RepoScan | null;
  } = {},
) => {
  const currentScan = input.scan === undefined ? scan() : input.scan;
  const findings = input.findings ?? [finding()];
  const lifecycleSummary = input.lifecycleSummary ?? {
    currentFindingIds: findings.map((item) => item.findingId),
    newCount: 0,
    recurringCount: findings.length,
    resolvedCount: 0,
    resolvedFindingIds: [],
    staleCount: 0,
    worsenedCount: 0,
  };
  const scanService = {
    getRepoScan: vi.fn<RepoScanService["getRepoScan"]>(async () => currentScan),
    updateRepoScanStatus: vi.fn<RepoScanService["updateRepoScanStatus"]>(async (update) =>
      scan({
        ...currentScan,
        findingIds: update.findingIds ?? currentScan?.findingIds ?? [],
        finishedAt: now.toISOString(),
        readinessReportId: update.readinessReportId,
        status: update.status,
        statusSummary: update.statusSummary ?? "Repo readiness report generated.",
        taskRecommendationIds:
          update.taskRecommendationIds ?? currentScan?.taskRecommendationIds ?? [],
        updatedAt: now.toISOString(),
      }),
    ),
  } satisfies Pick<RepoScanService, "getRepoScan" | "updateRepoScanStatus">;
  const findingService = {
    listFindings: vi.fn<RepoFindingService["listFindings"]>(async () =>
      findings.map((item) => ({
        dedupeKey: `dedupe_${item.findingId}`,
        finding: item,
        taskIds: [],
      })),
    ),
    reconcileFindingLifecycle: vi.fn<RepoFindingService["reconcileFindingLifecycle"]>(
      async () => lifecycleSummary,
    ),
  } satisfies Pick<RepoFindingService, "listFindings" | "reconcileFindingLifecycle">;
  const reportService = {
    persistReadinessReport: vi.fn<RepoReadinessReportService["persistReadinessReport"]>(
      async (persistInput) => persistedReport(persistInput.report),
    ),
  } satisfies Pick<RepoReadinessReportService, "persistReadinessReport">;

  return {
    findingService,
    reportService,
    scanService,
  };
};

describe("readiness report generator service", () => {
  test("generates a report through the safe LLM prompt contract, persists it, and completes the scan", async () => {
    const { generateAndPersistReadinessReport } = await importGenerator();
    const services = createServices();
    const llm = {
      generateReport: vi.fn(async ({ safeInput }) => ({
        ...safeInput.expectedReport,
        strengths: ["LLM summary preserved the available product and agent-readiness signals."],
        summary: "LLM summary from safe scan metadata and readiness findings.",
        weaknesses: ["LLM summary identified validation metadata as the remaining gap."],
      })),
    };

    const result = await generateAndPersistReadinessReport({
      createReportId: () => "report_draft_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      reportService: services.reportService,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      workspaceId: "workspace_1",
    });

    expect(result.generationSource).toBe("llm");
    expect(result.report).toMatchObject({
      reportId: "report_persisted",
      summary: "LLM summary from safe scan metadata and readiness findings.",
    });
    expect(llm.generateReport).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.any(Array),
        safeInput: expect.objectContaining({
          findingSummaries: [
            expect.objectContaining({
              title: "Validation command map is partial",
            }),
          ],
          scanMetadata: expect.objectContaining({
            statusSummary: "Deterministic repo scan modules finished.",
          }),
        }),
      }),
    );
    expect(JSON.stringify(llm.generateReport.mock.calls[0]?.[0].safeInput)).not.toContain(
      "apps/web/src/api/unsafe-route.ts",
    );
    expect(services.reportService.persistReadinessReport).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      report: expect.objectContaining({
        findingIds: ["finding_1"],
        reportId: "report_draft_1",
        summary: "LLM summary from safe scan metadata and readiness findings.",
        taskRecommendationIds: ["task_recommendation_1"],
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    expect(services.scanService.updateRepoScanStatus).toHaveBeenCalledWith({
      findingIds: ["finding_1"],
      readinessReportId: "report_persisted",
      scanId: "repo_scan_1",
      status: "completed",
      statusSummary: "Repo readiness report generated.",
      taskRecommendationIds: ["task_recommendation_1"],
      workspaceId: "workspace_1",
    });
  });

  test("includes reconciled finding lifecycle drift in deterministic reports", async () => {
    const { generateAndPersistReadinessReport } = await importGenerator();
    const services = createServices({
      lifecycleSummary: {
        currentFindingIds: ["finding_1", "finding_2", "finding_3", "finding_4"],
        newCount: 2,
        recurringCount: 1,
        resolvedCount: 1,
        resolvedFindingIds: ["finding_resolved"],
        staleCount: 1,
        worsenedCount: 1,
      },
    });

    const result = await generateAndPersistReadinessReport({
      createReportId: () => "report_draft_1",
      findingService: services.findingService,
      now: () => now,
      reportService: services.reportService,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      workspaceId: "workspace_1",
    });

    expect(services.findingService.reconcileFindingLifecycle).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    expect(result.report.summary).toContain(
      "Finding drift: 2 new, 1 recurring, 1 worsened, 1 stale, and 1 resolved.",
    );
    expect(result.report.weaknesses).toEqual(
      expect.arrayContaining([
        "1 worsened readiness finding needs review.",
        "1 stale readiness finding reappeared after being deferred or dismissed.",
      ]),
    );
    expect(result.report.strengths).toEqual(
      expect.arrayContaining(["1 previous readiness finding was resolved by this rescan."]),
    );
    expect(result.report.recommendedNextActions).toEqual(
      expect.arrayContaining(["Review the 2 new readiness findings before approving execution."]),
    );
  });

  test("falls back to a deterministic report when the LLM path fails", async () => {
    const { generateAndPersistReadinessReport } = await importGenerator();
    const services = createServices();
    const llm = {
      generateReport: vi.fn(async () => {
        throw new Error("provider unavailable");
      }),
    };

    const result = await generateAndPersistReadinessReport({
      createReportId: () => "report_draft_1",
      findingService: services.findingService,
      llm,
      now: () => now,
      reportService: services.reportService,
      scanId: "repo_scan_1",
      scanService: services.scanService,
      workspaceId: "workspace_1",
    });

    expect(result.generationSource).toBe("deterministic_fallback");
    expect(result.report.summary).toContain("metadata-only repo readiness scan");
    expect(services.reportService.persistReadinessReport).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      report: expect.objectContaining({
        strengths: expect.arrayContaining(["Product clarity score has no active penalties."]),
        summary: expect.stringContaining("metadata-only repo readiness scan"),
        weaknesses: expect.arrayContaining([
          "Validation score reduced by medium readiness finding.",
        ]),
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });
    expect(services.scanService.updateRepoScanStatus).toHaveBeenCalledWith(
      expect.objectContaining({
        readinessReportId: "report_persisted",
        status: "completed",
      }),
    );
  });

  test("does not generate a report before scan modules reach terminal statuses", async () => {
    const { generateAndPersistReadinessReport } = await importGenerator();
    const services = createServices({
      scan: scan({
        moduleStatuses: [
          {
            id: "github_inventory",
            label: "GitHub inventory",
            metadata: {},
            order: 0,
            required: true,
            startedAt: now.toISOString(),
            status: "running",
            summary: "GitHub inventory is running.",
          },
        ],
      }),
    });

    await expect(
      generateAndPersistReadinessReport({
        findingService: services.findingService,
        now: () => now,
        reportService: services.reportService,
        scanId: "repo_scan_1",
        scanService: services.scanService,
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(services.reportService.persistReadinessReport).not.toHaveBeenCalled();
    expect(services.scanService.updateRepoScanStatus).not.toHaveBeenCalled();
  });

  test("blocks readiness report generation before LLM or persistence when plan limit is reached", async () => {
    const { generateAndPersistReadinessReport } = await importGenerator();
    const services = createServices();
    const llm = {
      generateReport: vi.fn(),
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
      generateAndPersistReadinessReport({
        createReportId: () => "report_draft_1",
        findingService: services.findingService,
        llm,
        now: () => now,
        reportService: services.reportService,
        scanId: "repo_scan_1",
        scanService: services.scanService,
        usageLimitService,
        workspaceId: "workspace_1",
      } as unknown as Parameters<typeof generateAndPersistReadinessReport>[0]),
    ).rejects.toMatchObject({
      code: "plan_limit_exceeded",
      message: "Plan limit reached. Upgrade, request an admin override, or wait for reset.",
    });

    expect(usageLimitService.assertUsageAllowed).toHaveBeenCalledWith({
      quantity: 1,
      usageEventType: "readiness_report_generation",
      workspaceId: "workspace_1",
    });
    expect(llm.generateReport).not.toHaveBeenCalled();
    expect(services.reportService.persistReadinessReport).not.toHaveBeenCalled();
    expect(services.scanService.updateRepoScanStatus).not.toHaveBeenCalled();
  });
});

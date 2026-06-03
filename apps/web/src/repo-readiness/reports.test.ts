import { describe, expect, test, vi } from "vitest";

import {
  CONTRACT_VERSION,
  FINDING_CATEGORIES,
  type Finding,
  type RepoReadinessReport,
  type RepoScanInventory,
} from "@control-plane/shared";

import type { RepoReadinessReportStore } from "./reports";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));

const importReports = async () => import("./reports");

type StoredRepoScan = {
  findingIds: string[];
  id: string;
  inventory?: RepoScanInventory;
  readinessReportId: string | null;
  repoId: string;
  taskRecommendationIds: string[];
  workspaceId: string;
};

type StoredFinding = {
  category: Finding["category"];
  deterministicRuleId: string;
  id: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  status: Finding["status"];
  workspaceId: string;
};

type StoredReport = {
  blockedReasons: string[];
  categoryScores: RepoReadinessReport["categoryScores"];
  contractVersion: RepoReadinessReport["contractVersion"];
  createdAt: Date;
  executionReadiness: RepoReadinessReport["executionReadiness"];
  findingIds: string[];
  generatedAt: Date;
  id: string;
  overallScore: number;
  recommendedNextActions: string[];
  repoId: string;
  scanId: string;
  strengths: string[];
  summary: string;
  taskRecommendationIds: string[];
  updatedAt: Date;
  weaknesses: string[];
  workspaceId: string;
};

type StoredAuditEvent = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  workspaceId: string;
};

type ReportStore = RepoReadinessReportStore;
type ReportStoreInsert = Parameters<ReportStore["upsertReportWithAuditAndScanUpdate"]>[0]["report"];

const now = new Date("2026-05-25T10:00:00.000Z");
const later = new Date("2026-05-25T10:05:00.000Z");

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
  documentSummaries: [],
  languageSummaries: [{ fileCount: 6, name: "TypeScript" }],
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
  scannedFileCount: 8,
  totalDirectoryCount: 3,
  totalFileCount: 10,
  validationPostureSummary: {
    detectedCommandLabels: ["format", "lint", "test", "typecheck"],
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    missingCommandLabels: [],
    postureStatus: "ready",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 4,
  },
  ...overrides,
});

const validCategoryScores = (): RepoReadinessReport["categoryScores"] =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [category, 80]),
  ) as RepoReadinessReport["categoryScores"];

const validReport = (overrides: Partial<RepoReadinessReport> = {}): RepoReadinessReport => ({
  blockedReasons: [],
  categoryScores: validCategoryScores(),
  contractVersion: CONTRACT_VERSION,
  executionReadiness: "setup_pr_ready",
  findingIds: ["finding_1"],
  generatedAt: now.toISOString(),
  overallScore: 82,
  recommendedNextActions: ["Create a setup task for validation metadata."],
  repoId: "github_repository_1",
  reportId: "report_client",
  scanId: "repo_scan_1",
  strengths: ["Repository metadata is available for onboarding."],
  summary: "Repository is close to being ready for AI-assisted execution.",
  taskRecommendationIds: ["task_recommendation_1"],
  weaknesses: ["Validation metadata still needs setup."],
  workspaceId: "workspace_1",
  ...overrides,
});

const reportRow = (overrides: Partial<StoredReport> = {}): StoredReport => {
  const report = validReport({
    ...(overrides.id === undefined ? {} : { reportId: overrides.id }),
    ...(overrides.workspaceId === undefined ? {} : { workspaceId: overrides.workspaceId }),
    ...(overrides.repoId === undefined ? {} : { repoId: overrides.repoId }),
    ...(overrides.scanId === undefined ? {} : { scanId: overrides.scanId }),
    ...(overrides.findingIds === undefined ? {} : { findingIds: overrides.findingIds }),
    ...(overrides.taskRecommendationIds === undefined
      ? {}
      : { taskRecommendationIds: overrides.taskRecommendationIds }),
  });

  return {
    blockedReasons: report.blockedReasons,
    categoryScores: report.categoryScores,
    contractVersion: report.contractVersion,
    createdAt: now,
    executionReadiness: report.executionReadiness,
    findingIds: report.findingIds,
    generatedAt: new Date(report.generatedAt),
    id: report.reportId,
    overallScore: report.overallScore,
    recommendedNextActions: report.recommendedNextActions,
    repoId: report.repoId,
    scanId: report.scanId,
    strengths: report.strengths,
    summary: report.summary,
    taskRecommendationIds: report.taskRecommendationIds,
    updatedAt: now,
    weaknesses: report.weaknesses,
    workspaceId: report.workspaceId,
    ...overrides,
  };
};

const reportRowFromInsert = (insert: ReportStoreInsert): StoredReport =>
  reportRow({
    blockedReasons: insert.blockedReasons ?? [],
    categoryScores: insert.categoryScores,
    contractVersion: insert.contractVersion,
    createdAt: insert.createdAt ?? now,
    executionReadiness: insert.executionReadiness,
    findingIds: insert.findingIds ?? [],
    generatedAt: insert.generatedAt,
    id: insert.id,
    overallScore: insert.overallScore,
    recommendedNextActions: insert.recommendedNextActions ?? [],
    repoId: insert.repoId,
    scanId: insert.scanId,
    strengths: insert.strengths ?? [],
    summary: insert.summary,
    taskRecommendationIds: insert.taskRecommendationIds ?? [],
    updatedAt: insert.updatedAt ?? now,
    weaknesses: insert.weaknesses ?? [],
    workspaceId: insert.workspaceId,
  });

const createStore = (
  options: {
    findings?: StoredFinding[];
    memberships?: Array<{ userId: string; workspaceId: string }>;
    reports?: StoredReport[];
    scans?: StoredRepoScan[];
  } = {},
) => {
  const auditEvents: StoredAuditEvent[] = [];
  const findings = [
    ...(options.findings ?? [
      {
        category: "validation",
        deterministicRuleId: "validation_posture.partial",
        id: "finding_1",
        repoId: "github_repository_1",
        scanId: "repo_scan_1",
        severity: "medium",
        status: "open",
        workspaceId: "workspace_1",
      },
    ]),
  ];
  const reports = [...(options.reports ?? [])];
  const scans = [
    ...(options.scans ?? [
      {
        findingIds: [],
        id: "repo_scan_1",
        inventory: readyInventory(),
        readinessReportId: null,
        repoId: "github_repository_1",
        taskRecommendationIds: [],
        workspaceId: "workspace_1",
      },
    ]),
  ];

  const sortReports = (items: StoredReport[]) =>
    [...items].sort((left, right) => {
      const generatedDelta = right.generatedAt.getTime() - left.generatedAt.getTime();

      return generatedDelta === 0
        ? right.createdAt.getTime() - left.createdAt.getTime()
        : generatedDelta;
    });

  const store: ReportStore & {
    auditEvents: StoredAuditEvent[];
    reports: StoredReport[];
    scans: StoredRepoScan[];
  } = {
    auditEvents,
    findFindingsByIds: vi.fn<ReportStore["findFindingsByIds"]>(
      async (input: {
        findingIds: string[];
        repoId: string;
        scanId: string;
        workspaceId: string;
      }) =>
        findings.filter(
          (finding) =>
            input.findingIds.includes(finding.id) &&
            finding.workspaceId === input.workspaceId &&
            finding.repoId === input.repoId &&
            finding.scanId === input.scanId,
        ),
    ),
    findRepoScan: vi.fn<ReportStore["findRepoScan"]>(
      async (input: { scanId: string; workspaceId: string }) => {
        const scan = scans.find(
          (candidate) =>
            candidate.id === input.scanId && candidate.workspaceId === input.workspaceId,
        );

        return scan === undefined
          ? null
          : {
              ...scan,
              inventory: scan.inventory ?? readyInventory(),
            };
      },
    ),
    findWorkspaceMembership: vi.fn<ReportStore["findWorkspaceMembership"]>(
      async (input: { userId: string; workspaceId: string }) =>
        options.memberships?.some(
          (membership) =>
            membership.userId === input.userId && membership.workspaceId === input.workspaceId,
        )
          ? { id: "membership_1", role: "member" }
          : null,
    ),
    getLatestReadinessReport: vi.fn<ReportStore["getLatestReadinessReport"]>(
      async (input: { repoId: string; workspaceId: string }) =>
        sortReports(
          reports.filter(
            (report) => report.workspaceId === input.workspaceId && report.repoId === input.repoId,
          ),
        )[0] ?? null,
    ),
    getReadinessReport: vi.fn<ReportStore["getReadinessReport"]>(
      async (input: { reportId: string; workspaceId: string }) =>
        reports.find(
          (report) => report.workspaceId === input.workspaceId && report.id === input.reportId,
        ) ?? null,
    ),
    listReadinessReports: vi.fn<ReportStore["listReadinessReports"]>(
      async (input: { repoId: string; workspaceId: string }) =>
        sortReports(
          reports.filter(
            (report) => report.workspaceId === input.workspaceId && report.repoId === input.repoId,
          ),
        ),
    ),
    reports,
    scans,
    upsertReportWithAuditAndScanUpdate: vi.fn<ReportStore["upsertReportWithAuditAndScanUpdate"]>(
      async (input) => {
        const nextReport = reportRowFromInsert(input.report);
        const existing = reports.find(
          (report) =>
            report.workspaceId === nextReport.workspaceId && report.scanId === nextReport.scanId,
        );
        const stored = existing ?? nextReport;

        if (existing === undefined) {
          reports.push(stored);
        } else {
          Object.assign(existing, {
            ...nextReport,
            createdAt: existing.createdAt,
            id: existing.id,
          });
        }

        const scan = scans.find(
          (candidate) =>
            candidate.id === stored.scanId && candidate.workspaceId === stored.workspaceId,
        );

        if (scan !== undefined) {
          scan.readinessReportId = stored.id;
          scan.findingIds = [...stored.findingIds];
          scan.taskRecommendationIds = [...stored.taskRecommendationIds];
        }

        auditEvents.push(input.createAuditEvent(stored));

        return stored;
      },
    ),
  };

  return store;
};

const createService = async (input: {
  currentTime?: Date;
  store: ReturnType<typeof createStore>;
  userId?: string | null;
}) => {
  const { createRepoReadinessReportService } = await importReports();

  return createRepoReadinessReportService({
    createAuditEventId: () => `audit_${input.store.auditEvents.length + 1}`,
    createReportId: () => `report_${input.store.reports.length + 1}`,
    getAuthContext: async () => ({
      userId: input.userId === undefined ? "user_1" : input.userId,
    }),
    now: () => input.currentTime ?? now,
    store: input.store,
  });
};

const expectNoUnsafeReportMaterial = (value: unknown) => {
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
        /^(?:code|content|diff|fileContent|localPath|patch|rawOutput|secret|source|sourceCode|stderr|stdout|token)$/u.test(
          key,
        )
      ) {
        unsafeKeys.push(key);
      }

      collectKeys(childValue);
    }
  };

  collectKeys(value);

  expect(serialized).not.toContain("diff --git");
  expect(serialized).not.toContain("const leaked");
  expect(serialized).not.toContain("repo-secret-token");
  expect(serialized).not.toContain("/Users/rory/private/repo");
  expect(unsafeKeys).toEqual([]);
};

describe("repo readiness report service", () => {
  test("persists a valid report only for a workspace member and matching repo scan", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    const result = await service.persistReadinessReport({
      repoId: "github_repository_1",
      report: validReport({ reportId: "client_supplied_id" }),
      scanId: "repo_scan_1",
      workspaceId: " workspace_1 ",
    });

    expect(result).toEqual(
      expect.objectContaining({
        findingIds: ["finding_1"],
        repoId: "github_repository_1",
        reportId: "report_1",
        scanId: "repo_scan_1",
        taskRecommendationIds: ["task_recommendation_1"],
        workspaceId: "workspace_1",
      }),
    );
    expect(store.reports).toHaveLength(1);
    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        actorId: "user_1",
        eventType: "repo_readiness_reports.upserted",
        metadata: {
          blockedReasonCount: 0,
          categoryCount: FINDING_CATEGORIES.length,
          executionReadiness: "setup_pr_ready",
          findingCount: 1,
          generatedAt: now.toISOString(),
          overallScore: 82,
          recommendedNextActionCount: 1,
          repoId: "github_repository_1",
          reportId: "report_1",
          scanId: "repo_scan_1",
          strengthCount: 1,
          summaryLength: 61,
          taskRecommendationCount: 1,
          weaknessCount: 2,
        },
        workspaceId: "workspace_1",
      }),
    ]);
    expectNoUnsafeReportMaterial({ audit: store.auditEvents, result, stored: store.reports });

    const nonMemberStore = createStore();
    const nonMemberService = await createService({ store: nonMemberStore });
    await expect(
      nonMemberService.persistReadinessReport({
        repoId: "github_repository_1",
        report: validReport(),
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();
  });

  test("normalizes execution readiness from scan inventory and scoped findings before persistence", async () => {
    const store = createStore({
      findings: [
        {
          category: "security",
          deterministicRuleId: "security.policy_coverage_missing",
          id: "finding_security",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "high",
          status: "open",
          workspaceId: "workspace_1",
        },
        {
          category: "validation",
          deterministicRuleId: "validation_posture.missing",
          id: "finding_validation",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "high",
          status: "open",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        {
          findingIds: [],
          id: "repo_scan_1",
          inventory: readyInventory({
            policySummary: {
              dryRunCheckCount: 0,
              hasPolicyFile: false,
              protectedPathCount: 0,
              sensitivePathCount: 0,
              validationCommandCount: 0,
            },
            validationPostureSummary: {
              detectedCommandLabels: [],
              dryRunCheckCount: 0,
              hasPolicyFile: false,
              missingCommandLabels: ["format", "lint", "test", "typecheck"],
              postureStatus: "missing",
              suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
              validationCommandCount: 0,
            },
          }),
          readinessReportId: null,
          repoId: "github_repository_1",
          taskRecommendationIds: [],
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService({ store });

    const result = await service.persistReadinessReport({
      repoId: "github_repository_1",
      report: validReport({
        blockedReasons: [],
        executionReadiness: "local_runner_ready",
        findingIds: ["finding_security", "finding_validation"],
        recommendedNextActions: [],
        taskRecommendationIds: [
          "task_recommendation:repo_scan_1:security_policy_coverage",
          "task_recommendation:repo_scan_1:validation_posture",
        ],
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.executionReadiness).toBe("setup_pr_ready");
    expect(result.blockedReasons).toEqual([
      "Local runner execution requires complete repository policy coverage.",
      "Local runner execution requires a complete validation command map.",
      "High-severity readiness findings require setup before local runner execution.",
    ]);
    expect(result.recommendedNextActions).toEqual([
      "Create a setup PR from the open readiness recommendations before enabling local runner execution.",
    ]);
    expect(store.reports[0]).toEqual(
      expect.objectContaining({
        blockedReasons: result.blockedReasons,
        executionReadiness: "setup_pr_ready",
        recommendedNextActions: result.recommendedNextActions,
      }),
    );
    expect(store.auditEvents[0]?.metadata).toEqual(
      expect.objectContaining({
        blockedReasonCount: 3,
        executionReadiness: "setup_pr_ready",
        recommendedNextActionCount: 1,
      }),
    );
  });

  test("recalculates readiness scores from scan inventory and scoped finding status before persistence", async () => {
    const perfectCategoryScores = Object.fromEntries(
      FINDING_CATEGORIES.map((category) => [category, 100]),
    ) as RepoReadinessReport["categoryScores"];
    const store = createStore({
      findings: [
        {
          category: "security",
          deterministicRuleId: "security.blocked_risk",
          id: "finding_blocked_security",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "blocked",
          status: "open",
          workspaceId: "workspace_1",
        },
        {
          category: "validation",
          deterministicRuleId: "validation_posture.partial",
          id: "finding_resolved_validation",
          repoId: "github_repository_1",
          scanId: "repo_scan_1",
          severity: "high",
          status: "resolved",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        {
          findingIds: [],
          id: "repo_scan_1",
          inventory: readyInventory({
            agentInstructionSummary: {
              completenessStatus: "missing",
              hasAgentInstructions: false,
              instructionFileCount: 0,
              missingSectionLabels: ["agent instructions"],
              readStatus: "missing",
            },
            productClaritySummary: {
              clarityStatus: "missing",
              goalContextStatus: "not_provided",
              hasProductDocs: false,
              missingSignalLabels: ["purpose", "scope", "target_user"],
              productDocCount: 0,
              readStatus: "missing",
              signalLabels: [],
            },
          }),
          readinessReportId: null,
          repoId: "github_repository_1",
          taskRecommendationIds: [],
          workspaceId: "workspace_1",
        },
      ],
    });
    const service = await createService({ store });

    const result = await service.persistReadinessReport({
      repoId: "github_repository_1",
      report: validReport({
        categoryScores: perfectCategoryScores,
        findingIds: ["finding_blocked_security", "finding_resolved_validation"],
        overallScore: 100,
        taskRecommendationIds: [],
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(result.overallScore).toBe(30);
    expect(result.categoryScores).toEqual(
      expect.objectContaining({
        agent_readiness: 55,
        product_clarity: 45,
        security: 30,
        validation: 100,
      }),
    );
    expect(result.weaknesses).toEqual(
      expect.arrayContaining([
        "Security score reduced by blocked readiness finding.",
        "Product clarity score reduced because product documentation is missing.",
        "Agent readiness score reduced because root agent instructions are missing.",
      ]),
    );
    expect(store.auditEvents[0]?.metadata).toEqual(
      expect.objectContaining({
        overallScore: 30,
        weaknessCount: result.weaknesses.length,
      }),
    );
  });

  test("updates the repo scan report and ID arrays transactionally after persistence", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await service.persistReadinessReport({
      repoId: "github_repository_1",
      report: validReport({
        findingIds: ["finding_1"],
        taskRecommendationIds: ["task_recommendation_2", "task_recommendation_1"],
      }),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(store.scans[0]).toEqual(
      expect.objectContaining({
        findingIds: ["finding_1"],
        readinessReportId: "report_1",
        taskRecommendationIds: ["task_recommendation_2", "task_recommendation_1"],
      }),
    );
    expect(store.upsertReportWithAuditAndScanUpdate).toHaveBeenCalledTimes(1);
  });

  test("rejects missing, cross-workspace, repo-mismatched scans and out-of-scope finding ids", async () => {
    const baseInput = {
      repoId: "github_repository_1",
      report: validReport(),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    };

    const missingScanStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [],
    });
    const missingScanService = await createService({ store: missingScanStore });

    await expect(missingScanService.persistReadinessReport(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(missingScanStore.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const crossWorkspaceStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        {
          findingIds: [],
          id: "repo_scan_1",
          readinessReportId: null,
          repoId: "github_repository_1",
          taskRecommendationIds: [],
          workspaceId: "workspace_2",
        },
      ],
    });
    const crossWorkspaceService = await createService({ store: crossWorkspaceStore });

    await expect(crossWorkspaceService.persistReadinessReport(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(crossWorkspaceStore.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const repoMismatchStore = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      scans: [
        {
          findingIds: [],
          id: "repo_scan_1",
          readinessReportId: null,
          repoId: "github_repository_2",
          taskRecommendationIds: [],
          workspaceId: "workspace_1",
        },
      ],
    });
    const repoMismatchService = await createService({ store: repoMismatchStore });

    await expect(repoMismatchService.persistReadinessReport(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(repoMismatchStore.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();

    const findingMismatchStore = createStore({
      findings: [
        {
          category: "validation",
          deterministicRuleId: "validation_posture.partial",
          id: "finding_1",
          repoId: "github_repository_1",
          scanId: "repo_scan_2",
          severity: "medium",
          status: "open",
          workspaceId: "workspace_1",
        },
      ],
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const findingMismatchService = await createService({ store: findingMismatchStore });

    await expect(findingMismatchService.persistReadinessReport(baseInput)).rejects.toMatchObject({
      code: "validation_error",
    });
    expect(findingMismatchStore.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();
  });

  test("returns the latest report by generated and created time while preserving history", async () => {
    const older = reportRow({
      createdAt: now,
      generatedAt: new Date("2026-05-25T09:00:00.000Z"),
      id: "report_old",
      scanId: "repo_scan_old",
    });
    const latestByCreatedAt = reportRow({
      createdAt: later,
      generatedAt: new Date("2026-05-25T10:00:00.000Z"),
      id: "report_latest",
      scanId: "repo_scan_latest",
    });
    const sameGeneratedButOlderCreate = reportRow({
      createdAt: now,
      generatedAt: new Date("2026-05-25T10:00:00.000Z"),
      id: "report_same_generated",
      scanId: "repo_scan_same_generated",
    });
    const otherRepo = reportRow({ id: "report_other_repo", repoId: "github_repository_2" });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      reports: [older, sameGeneratedButOlderCreate, latestByCreatedAt, otherRepo],
    });
    const service = await createService({ store });

    await expect(
      service.getLatestReadinessReport({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(expect.objectContaining({ reportId: "report_latest" }));
    await expect(
      service.listReadinessReports({
        repoId: "github_repository_1",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual([
      expect.objectContaining({ reportId: "report_latest" }),
      expect.objectContaining({ reportId: "report_same_generated" }),
      expect.objectContaining({ reportId: "report_old" }),
    ]);
  });

  test("loads an exact readiness report by id for a workspace member", async () => {
    const report = reportRow({
      blockedReasons: ["Local runner execution requires complete repository policy coverage."],
      id: "report_target",
      recommendedNextActions: ["Create a setup PR from the open readiness recommendations."],
      scanId: "repo_scan_target",
    });
    const otherWorkspaceReport = reportRow({
      id: "report_target",
      scanId: "repo_scan_other_workspace",
      workspaceId: "workspace_2",
    });
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
      reports: [otherWorkspaceReport, report],
    });
    const service = await createService({ store });

    await expect(
      service.getReadinessReport({
        reportId: " report_target ",
        workspaceId: "workspace_1",
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        blockedReasons: ["Local runner execution requires complete repository policy coverage."],
        recommendedNextActions: ["Create a setup PR from the open readiness recommendations."],
        reportId: "report_target",
        scanId: "repo_scan_target",
        workspaceId: "workspace_1",
      }),
    );
    expect(store.getReadinessReport).toHaveBeenCalledWith({
      reportId: "report_target",
      workspaceId: "workspace_1",
    });

    await expect(
      service.getReadinessReport({
        reportId: "report_missing",
        workspaceId: "workspace_1",
      }),
    ).resolves.toBeNull();

    const nonMemberStore = createStore({
      reports: [report],
    });
    const nonMemberService = await createService({ store: nonMemberStore });

    await expect(
      nonMemberService.getReadinessReport({
        reportId: "report_target",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(nonMemberStore.getReadinessReport).not.toHaveBeenCalled();
  });

  test.each([
    ["unsafe source key", { source: "local scanner" }],
    ["unsafe diff key", { metadata: { diff: "not allowed" } }],
    ["unsafe patch key", { metadata: { patch: "not allowed" } }],
    ["unsafe snippet key", { metadata: { snippet: "not allowed" } }],
    ["unsafe stdout key", { metadata: { stdout: "not allowed" } }],
    ["unsafe stderr key", { metadata: { stderr: "not allowed" } }],
    ["unsafe raw output key", { metadata: { rawOutput: "not allowed" } }],
    ["secret text", { summary: `Token ${"ghp_"}${"a".repeat(24)}` }],
    ["real env path", { recommendedNextActions: ["Review apps/web/.env.local"] }],
    ["absolute local path", { weaknesses: ["Inspect /Users/rory/private/repo/src/app.ts"] }],
    ["windows absolute local path", { strengths: ["Inspect C:\\Users\\rory\\repo\\src\\app.ts"] }],
    ["traversal path", { blockedReasons: ["Review ../src/app.ts"] }],
    ["raw output label", { summary: "raw stdout: failed command output" }],
  ])("rejects %s before persistence", async (_name, override) => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await expect(
      service.persistReadinessReport({
        repoId: "github_repository_1",
        report: {
          ...validReport(),
          ...override,
        } as RepoReadinessReport,
        scanId: "repo_scan_1",
        workspaceId: "workspace_1",
      }),
    ).rejects.toMatchObject({ code: "validation_error" });
    expect(store.upsertReportWithAuditAndScanUpdate).not.toHaveBeenCalled();
  });

  test("keeps audit metadata to ids, counts, status and score values, and text lengths", async () => {
    const store = createStore({
      memberships: [{ userId: "user_1", workspaceId: "workspace_1" }],
    });
    const service = await createService({ store });

    await service.persistReadinessReport({
      repoId: "github_repository_1",
      report: validReport(),
      scanId: "repo_scan_1",
      workspaceId: "workspace_1",
    });

    expect(store.auditEvents).toEqual([
      expect.objectContaining({
        eventType: "repo_readiness_reports.upserted",
        metadata: {
          blockedReasonCount: 0,
          categoryCount: FINDING_CATEGORIES.length,
          executionReadiness: "setup_pr_ready",
          findingCount: 1,
          generatedAt: now.toISOString(),
          overallScore: 82,
          recommendedNextActionCount: 1,
          repoId: "github_repository_1",
          reportId: "report_1",
          scanId: "repo_scan_1",
          strengthCount: 1,
          summaryLength: 61,
          taskRecommendationCount: 1,
          weaknessCount: 2,
        },
      }),
    ]);
    expect(JSON.stringify(store.auditEvents)).not.toContain(
      "Repository is close to being ready for AI-assisted execution.",
    );
    expect(JSON.stringify(store.auditEvents)).not.toContain(
      "Validation metadata still needs setup",
    );
    expectNoUnsafeReportMaterial(store.auditEvents);
  });
});

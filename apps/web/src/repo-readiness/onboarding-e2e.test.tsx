import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, test, vi } from "vitest";

import {
  DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
  DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
  DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
  type CortexTask,
  type RepoReadinessReport,
  type RepoScanInventory,
} from "@control-plane/shared";

import { CortexTaskQueue } from "../../components/cortex-task-queue";
import { FindingList } from "../../components/finding-list";
import { TaskRecommendationList } from "../../components/task-recommendation-list";
import type {
  CortexTaskRecord,
  FindingRecord,
  RepoScanRecord,
  TaskRecommendationRecord,
} from "../db";
import type {
  GitHubRepositoryInventoryService,
  GitHubRepositoryInventoryServiceResult,
} from "./github-inventory";
import type { RepoFindingStore } from "./findings";
import type { RepoScanStore } from "./repo-scans";
import type { RepoTaskRecommendationStore } from "./task-recommendations";

vi.mock("server-only", () => ({}));
vi.mock("@clerk/nextjs/server", () => ({
  auth: vi.fn(async () => ({ userId: null })),
}));
vi.mock("@/src/server/actions", () => ({
  approveTaskRecommendationAction: vi.fn(),
  approveTaskRecommendationsAction: vi.fn(),
  convertFindingToTaskAction: vi.fn(),
  requestRepairAction: vi.fn(async () => ({ data: { queuedRunId: "run_repair_1" }, ok: true })),
  transitionCortexTaskStatusAction: vi.fn(),
  updateCortexTaskExecutionModeAction: vi.fn(),
  updateFindingStatusAction: vi.fn(),
  updateTaskRecommendationStatusAction: vi.fn(),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({
    refresh: vi.fn(),
  }),
}));

type GitHubRepositoryRow = {
  githubInstallationId: string;
  id: string;
  repositoryExternalId: string;
  repositoryFullName: string;
  repositoryName: string;
  repositoryOwner: string;
  workspaceId: string;
};

type AuditEventRow = {
  actorId?: string;
  createdAt: Date;
  eventType: string;
  id: string;
  message: string;
  metadata: Record<string, unknown>;
  taskId?: string;
  workspaceId: string;
};

const now = new Date("2026-06-02T12:00:00.000Z");
const later = new Date("2026-06-02T12:05:00.000Z");

const readyButIncompleteInventory = (): RepoScanInventory => ({
  agentInstructionSummary: {
    completenessStatus: "complete",
    hasAgentInstructions: true,
    instructionFileCount: 1,
    missingSectionLabels: [],
    readStatus: "read",
  },
  backlogQualitySummary: {
    ...DEFAULT_REPO_SCAN_BACKLOG_QUALITY_SUMMARY,
    backlogFileCount: 1,
    hasBacklog: true,
    missingSignalLabels: [],
    readStatus: "read",
    signalLabels: ["acceptance criteria", "dependencies", "validation"],
    structureStatus: "ai_executable",
  },
  backlogSummary: {
    ...DEFAULT_REPO_SCAN_BACKLOG_SUMMARY,
    backlogFileCount: 1,
    hasBacklog: true,
    missingStructureLabels: [],
    readStatus: "read",
    structureStatus: "complete",
  },
  ciPostureSummary: {
    ...DEFAULT_REPO_SCAN_CI_POSTURE_SUMMARY,
    detectedCommandLabels: ["test", "typecheck"],
    hasCi: true,
    missingCommandLabels: [],
    postureStatus: "aligned",
    providerLabels: ["github_actions"],
    requiredCommandLabels: ["test", "typecheck"],
    workflowFileCount: 1,
  },
  ciProviderLabels: ["github_actions"],
  documentationSummaries: [
    { kind: "readme", pathCount: 1, present: true },
    { kind: "architecture", pathCount: 1, present: true },
  ],
  documentSummaries: [
    {
      documentByteCount: 640,
      inputCharacterCount: 540,
      kind: "product",
      label: "Product brief",
      redactedCharacterCount: 540,
      redactionApplied: false,
      summary: "Product metadata describes scan, review, approve, and local execution gates.",
      topicLabels: ["product_scope", "security", "workflow"],
    },
  ],
  languageSummaries: [{ fileCount: 14, name: "TypeScript" }],
  omittedFileCount: 3,
  packageManagerLabels: ["pnpm"],
  policySummary: {
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    protectedPathCount: 2,
    sensitivePathCount: 3,
    validationCommandCount: 3,
  },
  productClaritySummary: {
    clarityStatus: "sufficient",
    goalContextStatus: "provided",
    goalContextSummary: "Prepare the repository for safe AI-assisted engineering reviews.",
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
  scannedFileCount: 14,
  totalDirectoryCount: 8,
  totalFileCount: 20,
  validationPostureSummary: {
    detectedCommandLabels: ["format", "test", "typecheck"],
    dryRunCheckCount: 4,
    hasPolicyFile: true,
    missingCommandLabels: ["lint"],
    postureStatus: "partial",
    suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
    validationCommandCount: 3,
  },
});

const createOnboardingStore = () => {
  const repositories: GitHubRepositoryRow[] = [
    {
      githubInstallationId: "42",
      id: "github_repository_1",
      repositoryExternalId: "9001",
      repositoryFullName: "acme/control-plane",
      repositoryName: "control-plane",
      repositoryOwner: "acme",
      workspaceId: "workspace_1",
    },
  ];
  const scans: RepoScanRecord[] = [];
  const findings: FindingRecord[] = [];
  const recommendations: TaskRecommendationRecord[] = [];
  const tasks: CortexTaskRecord[] = [];
  const reports: RepoReadinessReport[] = [];
  const auditEvents: AuditEventRow[] = [];

  const store = {
    auditEvents,
    approveTaskRecommendationWithAudit: vi.fn<
      RepoTaskRecommendationStore["approveTaskRecommendationWithAudit"]
    >(async (input) => {
      const recommendation = recommendations.find(
        (candidate) =>
          candidate.id === input.taskRecommendationId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (recommendation === undefined) {
        return null;
      }

      if (recommendation.cortexTaskId !== null) {
        const existingTask = tasks.find(
          (task) =>
            task.id === recommendation.cortexTaskId && task.workspaceId === input.workspaceId,
        );

        return existingTask === undefined ? null : { recommendation, task: existingTask };
      }

      const task = createTaskRow(input.task);

      recommendation.status = "converted";
      recommendation.cortexTaskId = input.taskId;
      recommendation.updatedAt = input.updatedAt;

      for (const finding of findings) {
        if (
          finding.workspaceId === recommendation.workspaceId &&
          finding.repoId === recommendation.repoId &&
          recommendation.findingIds.includes(finding.id) &&
          !finding.taskIds.includes(input.taskId)
        ) {
          finding.taskIds.push(input.taskId);
        }
      }

      tasks.push(task);
      auditEvents.push(...(input.auditEvents as AuditEventRow[]));

      return { recommendation, task };
    }),
    convertFindingToTaskWithAudit: vi.fn<RepoFindingStore["convertFindingToTaskWithAudit"]>(
      async (input) => {
        const finding = findings.find(
          (candidate) =>
            candidate.id === input.findingId && candidate.workspaceId === input.workspaceId,
        );

        if (finding === undefined) {
          return null;
        }

        const task = createTaskRow(input.task);

        finding.taskIds = [...new Set([...finding.taskIds, input.taskId])];
        finding.updatedAt = input.updatedAt;
        tasks.push(task);
        auditEvents.push(...(input.auditEvents as AuditEventRow[]));

        return { finding, task };
      },
    ),
    createRepoScanWithAudit: vi.fn<RepoScanStore["createRepoScanWithAudit"]>(
      async ({ auditEvent, scan }) => {
        const row: RepoScanRecord = {
          contractVersion: scan.contractVersion,
          createdAt: scan.createdAt ?? now,
          failureSummary: scan.failureSummary ?? null,
          findingIds: scan.findingIds ?? [],
          finishedAt: scan.finishedAt ?? null,
          id: scan.id,
          inventory: scan.inventory ?? readyButIncompleteInventory(),
          moduleStatuses: scan.moduleStatuses ?? [],
          readinessReportId: scan.readinessReportId ?? null,
          repoId: scan.repoId,
          startedAt: scan.startedAt ?? null,
          status: scan.status ?? "queued",
          statusSummary: scan.statusSummary ?? "Repo readiness scan queued.",
          taskRecommendationIds: scan.taskRecommendationIds ?? [],
          updatedAt: scan.updatedAt ?? now,
          workspaceId: scan.workspaceId,
        };

        scans.push(row);
        auditEvents.push(auditEvent as AuditEventRow);

        return row;
      },
    ),
    findActiveRepoScanForRepo: vi.fn<RepoScanStore["findActiveRepoScanForRepo"]>(
      async (input) =>
        scans.find(
          (scan) =>
            scan.repoId === input.repoId &&
            scan.workspaceId === input.workspaceId &&
            (scan.status === "queued" || scan.status === "running"),
        ) ?? null,
    ),
    findFindingsByIds: vi.fn<RepoTaskRecommendationStore["findFindingsByIds"]>(async (input) =>
      findings.filter(
        (finding) =>
          input.findingIds.includes(finding.id) &&
          finding.repoId === input.repoId &&
          finding.scanId === input.scanId &&
          finding.workspaceId === input.workspaceId,
      ),
    ),
    findGitHubRepository: vi.fn<RepoScanStore["findGitHubRepository"]>(async (input) => {
      const repository = repositories.find(
        (candidate) => candidate.id === input.repoId && candidate.workspaceId === input.workspaceId,
      );

      return repository === undefined
        ? null
        : { id: repository.id, workspaceId: repository.workspaceId };
    }),
    findGitHubRepositoryForWebhook: vi.fn<RepoScanStore["findGitHubRepositoryForWebhook"]>(
      async () => null,
    ),
    findGithubRepository: vi.fn<RepoTaskRecommendationStore["findGithubRepository"]>(
      async (input) => {
        const repository = repositories.find(
          (candidate) =>
            candidate.id === input.repoId && candidate.workspaceId === input.workspaceId,
        );

        return repository === undefined
          ? null
          : { id: repository.id, workspaceId: repository.workspaceId };
      },
    ),
    findRepoScan: vi.fn<(RepoFindingStore & RepoTaskRecommendationStore)["findRepoScan"]>(
      async (input) => {
        const scan = scans.find(
          (candidate) =>
            candidate.id === input.scanId && candidate.workspaceId === input.workspaceId,
        );

        return scan === undefined
          ? null
          : {
              id: scan.id,
              repoId: scan.repoId,
              taskRecommendationIds: scan.taskRecommendationIds,
              workspaceId: scan.workspaceId,
            };
      },
    ),
    findWorkspaceMembership: vi.fn<RepoScanStore["findWorkspaceMembership"]>(async (input) =>
      input.userId === "user_1" && input.workspaceId === "workspace_1"
        ? { id: "membership_1", role: "admin" }
        : null,
    ),
    getCortexTask: vi.fn<(RepoFindingStore & RepoTaskRecommendationStore)["getCortexTask"]>(
      async (input) =>
        tasks.find((task) => task.id === input.taskId && task.workspaceId === input.workspaceId) ??
        null,
    ),
    getFinding: vi.fn<RepoFindingStore["getFinding"]>(
      async (input) =>
        findings.find(
          (finding) => finding.id === input.findingId && finding.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    getFindingByDedupeKey: vi.fn<RepoFindingStore["getFindingByDedupeKey"]>(
      async (input) =>
        findings.find(
          (finding) =>
            finding.dedupeKey === input.dedupeKey &&
            finding.repoId === input.repoId &&
            finding.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    getRepoScan: vi.fn<RepoScanStore["getRepoScan"]>(
      async (input) =>
        scans.find((scan) => scan.id === input.scanId && scan.workspaceId === input.workspaceId) ??
        null,
    ),
    getRepoScanFindingStatusCounts: vi.fn<RepoScanStore["getRepoScanFindingStatusCounts"]>(
      async (input) => {
        const matchingFindings = findings.filter(
          (finding) =>
            finding.repoId === input.repoId &&
            finding.scanId === input.scanId &&
            finding.workspaceId === input.workspaceId,
        );

        return {
          blockedFindingCount: matchingFindings.filter((finding) => finding.severity === "blocked")
            .length,
          openFindingCount: matchingFindings.filter((finding) => finding.status === "open").length,
        };
      },
    ),
    getTaskRecommendation: vi.fn<RepoTaskRecommendationStore["getTaskRecommendation"]>(
      async (input) =>
        recommendations.find(
          (recommendation) =>
            recommendation.id === input.taskRecommendationId &&
            recommendation.workspaceId === input.workspaceId,
        ) ?? null,
    ),
    listFindings: vi.fn<RepoFindingStore["listFindings"]>(async (input) =>
      findings.filter(
        (finding) =>
          finding.workspaceId === input.workspaceId &&
          (input.repoId === undefined || finding.repoId === input.repoId) &&
          (input.scanId === undefined || finding.scanId === input.scanId) &&
          (input.category === undefined || finding.category === input.category) &&
          (input.severity === undefined || finding.severity === input.severity) &&
          (input.status === undefined || finding.status === input.status),
      ),
    ),
    listRepoScans: vi.fn<RepoScanStore["listRepoScans"]>(async (input) =>
      scans
        .filter(
          (scan) =>
            scan.workspaceId === input.workspaceId &&
            (input.repoId === undefined || scan.repoId === input.repoId),
        )
        .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    listTaskRecommendations: vi.fn<RepoTaskRecommendationStore["listTaskRecommendations"]>(
      async (input) =>
        recommendations
          .filter(
            (recommendation) =>
              recommendation.workspaceId === input.workspaceId &&
              (input.repoId === undefined || recommendation.repoId === input.repoId) &&
              (input.scanId === undefined || recommendation.scanId === input.scanId) &&
              (input.status === undefined || recommendation.status === input.status),
          )
          .toSorted((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime()),
    ),
    reports,
    repositories,
    scans,
    tasks,
    updateFindingStatusWithAudit: vi.fn<RepoFindingStore["updateFindingStatusWithAudit"]>(
      async (input) => {
        const finding = findings.find(
          (candidate) =>
            candidate.id === input.findingId && candidate.workspaceId === input.workspaceId,
        );

        if (finding === undefined) {
          return null;
        }

        finding.status = input.status;
        finding.updatedAt = input.updatedAt;
        auditEvents.push(input.auditEvent as AuditEventRow);

        return finding;
      },
    ),
    updateRepoScanWithAudit: vi.fn<RepoScanStore["updateRepoScanWithAudit"]>(async (input) => {
      const scan = scans.find(
        (candidate) => candidate.id === input.scanId && candidate.workspaceId === input.workspaceId,
      );

      if (scan === undefined) {
        return null;
      }

      Object.assign(scan, input.updates);
      auditEvents.push(input.auditEvent as AuditEventRow);

      return scan;
    }),
    updateTaskRecommendationStatusWithAudit: vi.fn<
      RepoTaskRecommendationStore["updateTaskRecommendationStatusWithAudit"]
    >(async (input) => {
      const recommendation = recommendations.find(
        (candidate) =>
          candidate.id === input.taskRecommendationId &&
          candidate.workspaceId === input.workspaceId,
      );

      if (recommendation === undefined) {
        return null;
      }

      recommendation.status = input.status;
      recommendation.updatedAt = input.updatedAt;
      auditEvents.push(input.auditEvent as AuditEventRow);

      return recommendation;
    }),
    upsertFindingWithAudit: vi.fn<RepoFindingStore["upsertFindingWithAudit"]>(async (input) => {
      const existing = findings.find(
        (finding) =>
          finding.dedupeKey === input.finding.dedupeKey &&
          finding.repoId === input.finding.repoId &&
          finding.workspaceId === input.finding.workspaceId,
      );
      const row: FindingRecord = {
        category: input.finding.category,
        confidence: input.finding.confidence,
        contractVersion: input.finding.contractVersion,
        createdAt: input.finding.createdAt ?? now,
        dedupeKey: input.finding.dedupeKey,
        deterministicRuleId: input.finding.deterministicRuleId,
        evidence: input.finding.evidence ?? [],
        id: existing?.id ?? input.finding.id,
        recommendation: input.finding.recommendation,
        repoId: input.finding.repoId,
        scanId: input.finding.scanId,
        severity: input.finding.severity,
        source: input.finding.source,
        status: input.finding.status ?? "open",
        summary: input.finding.summary,
        taskIds: input.finding.taskIds ?? existing?.taskIds ?? [],
        title: input.finding.title,
        updatedAt: input.finding.updatedAt ?? now,
        workspaceId: input.finding.workspaceId,
      };

      if (existing === undefined) {
        findings.push(row);
      } else {
        Object.assign(existing, row);
      }

      const persisted = existing ?? row;
      auditEvents.push(input.createAuditEvent(persisted) as AuditEventRow);

      return persisted;
    }),
    upsertTaskRecommendationWithAuditAndScanUpdate: vi.fn<
      RepoTaskRecommendationStore["upsertTaskRecommendationWithAuditAndScanUpdate"]
    >(async (input) => {
      const existing = recommendations.find(
        (recommendation) =>
          recommendation.id === input.recommendation.id &&
          recommendation.workspaceId === input.recommendation.workspaceId,
      );
      const row: TaskRecommendationRecord = {
        acceptanceCriteria: input.recommendation.acceptanceCriteria ?? [],
        contractVersion: input.recommendation.contractVersion,
        cortexTaskId: input.recommendation.cortexTaskId ?? null,
        createdAt: input.recommendation.createdAt ?? now,
        effort: input.recommendation.effort,
        executionMode: input.recommendation.executionMode,
        findingIds: input.recommendation.findingIds ?? [],
        id: input.recommendation.id,
        metadata: input.recommendation.metadata ?? {},
        objective: input.recommendation.objective,
        repoId: input.recommendation.repoId,
        riskLevel: input.recommendation.riskLevel,
        scanId: input.recommendation.scanId,
        status: input.recommendation.status ?? "open",
        suggestedValidation: input.recommendation.suggestedValidation ?? [],
        title: input.recommendation.title,
        updatedAt: input.recommendation.updatedAt ?? now,
        workspaceId: input.recommendation.workspaceId,
      };

      if (existing === undefined) {
        recommendations.push(row);
      } else {
        Object.assign(existing, {
          ...row,
          cortexTaskId: existing.cortexTaskId,
          createdAt: existing.createdAt,
          status: existing.status,
        });
      }

      const persisted = existing ?? row;
      const scan = scans.find(
        (candidate) =>
          candidate.id === persisted.scanId && candidate.workspaceId === persisted.workspaceId,
      );

      if (scan !== undefined && !scan.taskRecommendationIds.includes(persisted.id)) {
        scan.taskRecommendationIds.push(persisted.id);
      }

      auditEvents.push(input.createAuditEvent(persisted) as AuditEventRow);

      return persisted;
    }),
  } satisfies RepoScanStore &
    RepoFindingStore &
    RepoTaskRecommendationStore & {
      auditEvents: AuditEventRow[];
      reports: RepoReadinessReport[];
      repositories: GitHubRepositoryRow[];
      scans: RepoScanRecord[];
      tasks: CortexTaskRecord[];
    };

  return store;
};

const createTaskRow = (
  input: Parameters<RepoTaskRecommendationStore["approveTaskRecommendationWithAudit"]>[0]["task"],
): CortexTaskRecord => ({
  acceptanceCriteria: input.acceptanceCriteria ?? [],
  approvalStatus: input.approvalStatus ?? "not_requested",
  contractVersion: input.contractVersion,
  createdAt: input.createdAt ?? now,
  executionMode: input.executionMode,
  externalLinks: input.externalLinks ?? [],
  findingIds: input.findingIds ?? [],
  id: input.id,
  latestRunId: input.latestRunId ?? null,
  metadata: input.metadata ?? {},
  objective: input.objective,
  originExternalId: input.originExternalId ?? null,
  originExternalSystem: input.originExternalSystem ?? null,
  originType: input.originType,
  prArtifactIds: input.prArtifactIds ?? [],
  repoId: input.repoId,
  riskLevel: input.riskLevel,
  runIds: input.runIds ?? [],
  status: input.status ?? "draft",
  suggestedValidation: input.suggestedValidation ?? [],
  taskPacketId: input.taskPacketId ?? null,
  taskRecommendationId: input.taskRecommendationId ?? null,
  title: input.title,
  updatedAt: input.updatedAt ?? now,
  workspaceId: input.workspaceId,
});

const expectNoUnsafeOrRunnerMaterial = (value: unknown) => {
  const serialized = JSON.stringify(value);

  expect(serialized).not.toMatch(
    /diff --git|@@ -|```|rawOutput|sourceCode|patchText|process\.env|PRIVATE KEY|\/Users\/rory|\.env(?:\.|$)|runnerId|taskPacketId|run_e2e/iu,
  );
};

describe("repo-readiness onboarding E2E", () => {
  test("scans a GitHub repo, shows findings, creates AI-ready tasks, and needs no runner", async () => {
    const [
      { createRepoScanService },
      { createRepoFindingService },
      { createTaskRecommendationService },
      { createGitHubInventoryScanModule, createValidationPostureScanModule, runRepoScanModules },
      { generateAndPersistReadinessReport },
    ] = await Promise.all([
      import("./repo-scans"),
      import("./findings"),
      import("./task-recommendations"),
      import("./scan-modules"),
      import("./readiness-report-generator"),
    ]);
    const store = createOnboardingStore();
    const getAuthContext = async () => ({ userId: "user_1" });
    const repoScanService = createRepoScanService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createScanId: () => "repo_scan_1",
      getAuthContext,
      now: () => now,
      store,
    });
    const findingService = createRepoFindingService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createFindingId: () => `finding_${(store.scans[0]?.findingIds.length ?? 0) + 1}`,
      getAuthContext,
      now: () => now,
      store,
    });
    const taskRecommendationService = createTaskRecommendationService({
      createAuditEventId: () => `audit_${store.auditEvents.length + 1}`,
      createTaskId: () => `cortex_task_${store.tasks.length + 1}`,
      getAuthContext,
      now: () => now,
      store,
    });
    const inventoryService: Pick<GitHubRepositoryInventoryService, "buildRepositoryInventory"> = {
      buildRepositoryInventory: vi.fn(
        async (): Promise<GitHubRepositoryInventoryServiceResult> => ({
          repoId: "github_repository_1",
          repository: {
            defaultBranch: "main",
            name: "control-plane",
            owner: "acme",
          },
          repoScanInventory: readyButIncompleteInventory(),
          serviceMetadata: {
            allowlistedFileReadCount: 5,
            githubInstallationId: "42",
            hasTestDirectories: true,
            policyReadStatus: "parsed",
            skippedOversizedFileCount: 0,
            treeTruncated: false,
          },
          workspaceId: "workspace_1",
        }),
      ),
    };

    const triggered = await repoScanService.triggerRepoScan({
      productGoal: "Prepare the repository for safe AI-assisted engineering reviews.",
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });

    expect(triggered).toEqual({
      created: true,
      repoId: "github_repository_1",
      scanId: "repo_scan_1",
      status: "queued",
      workspaceId: "workspace_1",
    });

    await runRepoScanModules({
      modules: [
        createGitHubInventoryScanModule({ inventoryService }),
        createValidationPostureScanModule({
          findingService,
          now: () => later,
          taskRecommendationService,
        }),
      ],
      now: () => later,
      scanId: triggered.scanId,
      service: repoScanService,
      workspaceId: triggered.workspaceId,
    });

    const reportService = {
      persistReadinessReport: vi.fn(async ({ report }: { report: RepoReadinessReport }) => {
        store.reports.push(report);

        return report;
      }),
    };
    const reportResult = await generateAndPersistReadinessReport({
      createReportId: () => "readiness_report_1",
      findingService,
      now: () => later,
      reportService,
      scanId: triggered.scanId,
      scanService: repoScanService,
      workspaceId: triggered.workspaceId,
    });

    const recommendationsBeforeApproval = await taskRecommendationService.listTaskRecommendations({
      scanId: triggered.scanId,
      workspaceId: triggered.workspaceId,
    });
    const approved = await taskRecommendationService.approveTaskRecommendation({
      taskRecommendationId:
        recommendationsBeforeApproval[0]?.recommendation.taskRecommendationId ?? "",
      workspaceId: triggered.workspaceId,
    });
    const findings = await findingService.listFindings({
      scanId: triggered.scanId,
      workspaceId: triggered.workspaceId,
    });
    const recommendationsAfterApproval = await taskRecommendationService.listTaskRecommendations({
      scanId: triggered.scanId,
      workspaceId: triggered.workspaceId,
    });
    const completedScan = await repoScanService.getRepoScan({
      scanId: triggered.scanId,
      workspaceId: triggered.workspaceId,
    });

    expect(reportResult.report).toMatchObject({
      findingIds: ["finding_1"],
      reportId: "readiness_report_1",
      taskRecommendationIds: ["task_recommendation:repo_scan_1:validation_posture"],
    });
    expect(completedScan).toMatchObject({
      readinessReportId: "readiness_report_1",
      status: "completed",
    });
    expect(findings).toHaveLength(1);
    expect(findings[0]?.taskIds).toEqual(["cortex_task_1"]);
    expect(recommendationsAfterApproval[0]?.recommendation.status).toBe("converted");
    expect(approved.task).toMatchObject({
      approvalStatus: "not_requested",
      executionMode: "setup_pr",
      findingIds: ["finding_1"],
      runIds: [],
      status: "draft",
      taskId: "cortex_task_1",
      taskPacketId: undefined,
    } satisfies Partial<CortexTask>);
    expect(inventoryService.buildRepositoryInventory).toHaveBeenCalledWith({
      repoId: "github_repository_1",
      workspaceId: "workspace_1",
    });

    const repositories = [
      {
        id: "github_repository_1",
        repositoryFullName: "acme/control-plane",
        repositoryName: "control-plane",
        repositoryOwner: "acme",
      },
    ];
    const html = [
      renderToStaticMarkup(
        createElement(FindingList, {
          findings,
          repositories,
          workspaceId: "workspace_1",
        }),
      ),
      renderToStaticMarkup(
        createElement(TaskRecommendationList, {
          recommendations: recommendationsAfterApproval,
          repositories,
          workspaceId: "workspace_1",
        }),
      ),
      renderToStaticMarkup(
        createElement(CortexTaskQueue, {
          hasAvailableLocalRunner: false,
          repositories,
          tasks: [approved.task],
          workspaceId: "workspace_1",
        }),
      ),
    ].join("\n");

    expect(html).toContain("Readiness findings");
    expect(html).toContain("Validation command map is incomplete");
    expect(html).toContain("AI-ready setup review");
    expect(html).toContain("converted");
    expect(html).toContain("Cortex Tasks");
    expect(html).toContain("Draft");
    expect(html).toContain("Setup PR");
    expect(html).toContain("Pair an available runner before selecting local runner.");
    expect(store.auditEvents.map((event) => event.eventType)).toEqual(
      expect.arrayContaining([
        "repo_scans.created",
        "repo_readiness_findings.upserted",
        "repo_readiness_task_recommendations.upserted",
        "repo_readiness_cortex_tasks.created_from_recommendation",
        "repo_scans.status_updated",
      ]),
    );
    expectNoUnsafeOrRunnerMaterial({
      auditEvents: store.auditEvents,
      completedScan,
      findings,
      html,
      recommendationsAfterApproval,
      task: approved.task,
    });
  });
});

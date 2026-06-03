import "server-only";

import { randomUUID } from "node:crypto";

import {
  CONTRACT_VERSION,
  RepoReadinessReportSchema,
  type Finding,
  type RepoReadinessReport,
  type RepoScan,
  type RepoScanModuleStatusValue,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";
import type {
  BillingPlanLimitAdminOverride,
  BillingPlanLimitService,
} from "../billing/plan-limits";
import type { FindingLifecycleSummary, RepoFindingService } from "./findings";
import type { RepoReadinessReportService } from "./reports";
import type { RepoScanService } from "./repo-scans";
import { classifyExecutionReadiness } from "./execution-readiness";
import { calculateReadinessScores } from "./readiness-scores";
import {
  buildRepoReadinessSummaryPrompt,
  parseRepoReadinessSummaryOutput,
  type RepoReadinessSummaryPrompt,
} from "./report-summarization-prompt";

export type ReadinessReportLlmAdapter = {
  generateReport: (prompt: RepoReadinessSummaryPrompt) => Promise<unknown>;
};

export type GenerateAndPersistReadinessReportInput = {
  createReportId?: () => string;
  findingService: Pick<RepoFindingService, "listFindings" | "reconcileFindingLifecycle">;
  llm?: ReadinessReportLlmAdapter;
  now?: () => Date;
  reportService: Pick<RepoReadinessReportService, "persistReadinessReport">;
  scanId: string;
  scanService: Pick<RepoScanService, "getRepoScan" | "updateRepoScanStatus">;
  usageLimitAdminOverride?: BillingPlanLimitAdminOverride;
  usageLimitService?: Pick<BillingPlanLimitService, "assertUsageAllowed">;
  workspaceId: string;
};

export type ReadinessReportGenerationSource = "deterministic_fallback" | "llm";

export type GenerateAndPersistReadinessReportResult = {
  generationSource: ReadinessReportGenerationSource;
  report: RepoReadinessReport;
};

const terminalModuleStatuses = new Set<RepoScanModuleStatusValue>([
  "blocked",
  "failed",
  "passed",
  "skipped",
  "warning",
]);

const uniquePreservingOrder = (values: readonly string[]): string[] => {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    if (!seen.has(value)) {
      seen.add(value);
      result.push(value);
    }
  }

  return result;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`): string =>
  count === 1 ? singular : plural;

const assertScanCanGenerateReport = (scan: RepoScan): void => {
  if (scan.status === "failed" || scan.status === "cancelled") {
    throw createActionError("validation_error");
  }

  if (
    scan.moduleStatuses.length === 0 ||
    scan.moduleStatuses.some((moduleStatus) => !terminalModuleStatuses.has(moduleStatus.status))
  ) {
    throw createActionError("validation_error");
  }

  if (
    scan.moduleStatuses.some(
      (moduleStatus) =>
        moduleStatus.required &&
        (moduleStatus.status === "blocked" || moduleStatus.status === "failed"),
    )
  ) {
    throw createActionError("validation_error");
  }
};

const assertMatchingScanScope = (input: {
  scan: RepoScan;
  scanId: string;
  workspaceId: string;
}): void => {
  if (input.scan.workspaceId !== input.workspaceId || input.scan.scanId !== input.scanId) {
    throw createActionError("validation_error");
  }
};

const fallbackStrengths = (scoreStrengths: readonly string[]): string[] =>
  scoreStrengths.length === 0
    ? ["Repository readiness metadata was collected for human review."]
    : uniquePreservingOrder(scoreStrengths).slice(0, 6);

const fallbackWeaknesses = (input: {
  findings: readonly Finding[];
  scoreWeaknesses: readonly string[];
}): string[] => {
  const findingWeaknesses = input.findings
    .filter((finding) => finding.status === "open")
    .map((finding) => `${finding.title}.`);

  return uniquePreservingOrder([...input.scoreWeaknesses, ...findingWeaknesses]).slice(0, 8);
};

const buildFallbackSummary = (input: {
  executionReadiness: RepoReadinessReport["executionReadiness"];
  findingCount: number;
  lifecycleSummary: FindingLifecycleSummary;
  taskRecommendationCount: number;
}): string =>
  [
    "The metadata-only repo readiness scan generated a validated readiness report",
    `with ${input.findingCount} ${pluralize(input.findingCount, "finding")}`,
    `and ${input.taskRecommendationCount} ${pluralize(
      input.taskRecommendationCount,
      "task recommendation",
    )}.`,
    `Execution readiness is ${input.executionReadiness.replace(/_/gu, " ")}.`,
    `Finding drift: ${input.lifecycleSummary.newCount} new, ${input.lifecycleSummary.recurringCount} recurring, ${input.lifecycleSummary.worsenedCount} worsened, ${input.lifecycleSummary.staleCount} stale, and ${input.lifecycleSummary.resolvedCount} resolved.`,
  ].join(" ");

const lifecycleStrengths = (summary: FindingLifecycleSummary): string[] => {
  if (summary.resolvedCount === 0) {
    return [];
  }

  return [
    `${summary.resolvedCount} previous readiness ${pluralize(
      summary.resolvedCount,
      "finding",
    )} ${summary.resolvedCount === 1 ? "was" : "were"} resolved by this rescan.`,
  ];
};

const lifecycleWeaknesses = (summary: FindingLifecycleSummary): string[] => {
  const weaknesses: string[] = [];

  if (summary.worsenedCount > 0) {
    weaknesses.push(
      `${summary.worsenedCount} worsened readiness ${pluralize(
        summary.worsenedCount,
        "finding",
      )} ${summary.worsenedCount === 1 ? "needs" : "need"} review.`,
    );
  }

  if (summary.staleCount > 0) {
    weaknesses.push(
      `${summary.staleCount} stale readiness ${pluralize(
        summary.staleCount,
        "finding",
      )} reappeared after being deferred or dismissed.`,
    );
  }

  return weaknesses;
};

const lifecycleRecommendedActions = (summary: FindingLifecycleSummary): string[] => {
  if (summary.newCount === 0) {
    return [];
  }

  return [
    `Review the ${summary.newCount} new readiness ${pluralize(
      summary.newCount,
      "finding",
    )} before approving execution.`,
  ];
};

const buildDeterministicReport = (input: {
  createReportId: () => string;
  findings: readonly Finding[];
  lifecycleSummary: FindingLifecycleSummary;
  now: Date;
  scan: RepoScan;
}): RepoReadinessReport => {
  const findingIds = uniquePreservingOrder([
    ...input.scan.findingIds,
    ...input.findings.map((finding) => finding.findingId),
  ]);
  const taskRecommendationIds = uniquePreservingOrder(input.scan.taskRecommendationIds);
  const scoreResult = calculateReadinessScores({
    findings: input.findings,
    inventory: input.scan.inventory,
  });
  const executionReadiness = classifyExecutionReadiness({
    findings: input.findings,
    inventory: input.scan.inventory,
    taskRecommendationIds,
  });
  const report: RepoReadinessReport = {
    blockedReasons: executionReadiness.blockedReasons,
    categoryScores: scoreResult.categoryScores,
    contractVersion: CONTRACT_VERSION,
    executionReadiness: executionReadiness.executionReadiness,
    findingIds,
    generatedAt: input.now.toISOString(),
    overallScore: scoreResult.overallScore,
    recommendedNextActions: uniquePreservingOrder([
      ...executionReadiness.recommendedNextActions,
      ...lifecycleRecommendedActions(input.lifecycleSummary),
    ]),
    repoId: input.scan.repoId,
    reportId: input.createReportId(),
    scanId: input.scan.scanId,
    strengths: uniquePreservingOrder([
      ...fallbackStrengths(scoreResult.strengths),
      ...lifecycleStrengths(input.lifecycleSummary),
    ]),
    summary: buildFallbackSummary({
      executionReadiness: executionReadiness.executionReadiness,
      findingCount: findingIds.length,
      lifecycleSummary: input.lifecycleSummary,
      taskRecommendationCount: taskRecommendationIds.length,
    }),
    taskRecommendationIds,
    weaknesses: uniquePreservingOrder([
      ...fallbackWeaknesses({
        findings: input.findings,
        scoreWeaknesses: scoreResult.weaknesses,
      }),
      ...lifecycleWeaknesses(input.lifecycleSummary),
    ]),
    workspaceId: input.scan.workspaceId,
  };

  return RepoReadinessReportSchema.parse(report);
};

const maybeGenerateLlmReport = async (input: {
  fallbackReport: RepoReadinessReport;
  findings: readonly Finding[];
  llm?: ReadinessReportLlmAdapter;
  scan: RepoScan;
}): Promise<{
  generationSource: ReadinessReportGenerationSource;
  report: RepoReadinessReport;
}> => {
  if (input.llm === undefined) {
    return {
      generationSource: "deterministic_fallback",
      report: input.fallbackReport,
    };
  }

  try {
    const prompt = buildRepoReadinessSummaryPrompt({
      findings: [...input.findings],
      report: input.fallbackReport,
      scan: input.scan,
    });
    const generatedReport = await input.llm.generateReport(prompt);

    return {
      generationSource: "llm",
      report: parseRepoReadinessSummaryOutput(generatedReport, {
        expectedReport: input.fallbackReport,
      }),
    };
  } catch {
    return {
      generationSource: "deterministic_fallback",
      report: input.fallbackReport,
    };
  }
};

export const generateAndPersistReadinessReport = async (
  input: GenerateAndPersistReadinessReportInput,
): Promise<GenerateAndPersistReadinessReportResult> => {
  const createReportId = input.createReportId ?? randomUUID;
  const now = input.now ?? (() => new Date());
  const scan = await input.scanService.getRepoScan({
    scanId: input.scanId,
    workspaceId: input.workspaceId,
  });

  if (scan === null) {
    throw createActionError("validation_error");
  }

  assertMatchingScanScope({
    scan,
    scanId: input.scanId,
    workspaceId: input.workspaceId,
  });
  assertScanCanGenerateReport(scan);
  await input.usageLimitService?.assertUsageAllowed({
    quantity: 1,
    usageEventType: "readiness_report_generation",
    workspaceId: scan.workspaceId,
    ...(input.usageLimitAdminOverride === undefined
      ? {}
      : { adminOverride: input.usageLimitAdminOverride }),
  });

  const lifecycleSummary = await input.findingService.reconcileFindingLifecycle({
    repoId: scan.repoId,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });
  const persistedFindings = await input.findingService.listFindings({
    repoId: scan.repoId,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });
  const findings = persistedFindings.map((persistedFinding) => persistedFinding.finding);
  const fallbackReport = buildDeterministicReport({
    createReportId,
    findings,
    lifecycleSummary,
    now: now(),
    scan,
  });
  const generated = await maybeGenerateLlmReport({
    fallbackReport,
    findings,
    ...(input.llm === undefined ? {} : { llm: input.llm }),
    scan,
  });
  const report = await input.reportService.persistReadinessReport({
    repoId: scan.repoId,
    report: generated.report,
    scanId: scan.scanId,
    workspaceId: scan.workspaceId,
  });

  await input.scanService.updateRepoScanStatus({
    findingIds: report.findingIds,
    readinessReportId: report.reportId,
    scanId: scan.scanId,
    status: "completed",
    statusSummary: "Repo readiness report generated.",
    taskRecommendationIds: report.taskRecommendationIds,
    workspaceId: scan.workspaceId,
  });

  return {
    generationSource: generated.generationSource,
    report,
  };
};

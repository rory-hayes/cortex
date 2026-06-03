import "server-only";

import {
  FindingSchema,
  RepoReadinessReportSchema,
  RepoScanSchema,
  type Finding,
  type RepoReadinessReport,
  type RepoScan,
  type RepoScanDocumentSummary,
  type RepoScanInventory,
  type RepoScanModuleStatus,
} from "@control-plane/shared";

import { assertSafeWebBoundPayload } from "../security/payload-guard";

type PromptMessage = {
  content: string;
  role: "system" | "user";
};

type ExpectedReportFields = Pick<
  RepoReadinessReport,
  | "blockedReasons"
  | "categoryScores"
  | "contractVersion"
  | "executionReadiness"
  | "findingIds"
  | "generatedAt"
  | "overallScore"
  | "recommendedNextActions"
  | "repoId"
  | "reportId"
  | "scanId"
  | "taskRecommendationIds"
  | "workspaceId"
>;

type SafeFindingSummary = Pick<
  Finding,
  | "category"
  | "confidence"
  | "deterministicRuleId"
  | "findingId"
  | "recommendation"
  | "severity"
  | "status"
  | "summary"
  | "title"
> & {
  evidenceSummaries: string[];
};

type SafeModuleStatusSummary = Pick<
  RepoScanModuleStatus,
  "finishedAt" | "id" | "label" | "order" | "required" | "startedAt" | "status" | "summary"
>;

type SafeInventorySummary = Pick<
  RepoScanInventory,
  | "agentInstructionSummary"
  | "backlogQualitySummary"
  | "ciPostureSummary"
  | "ciProviderLabels"
  | "documentationSummaries"
  | "languageSummaries"
  | "omittedFileCount"
  | "packageManagerLabels"
  | "policySummary"
  | "productClaritySummary"
  | "repoHygieneSummary"
  | "scannedFileCount"
  | "totalDirectoryCount"
  | "totalFileCount"
  | "validationPostureSummary"
> & {
  documentSummaries: RepoScanDocumentSummary[];
};

export type RepoReadinessSummaryPromptSafeInput = {
  expectedReport: ExpectedReportFields;
  findingSummaries: SafeFindingSummary[];
  inventorySummary: SafeInventorySummary;
  scanMetadata: {
    createdAt: string;
    failureSummary?: string;
    finishedAt?: string;
    moduleStatuses: SafeModuleStatusSummary[];
    readinessReportId?: string;
    repoId: string;
    scanId: string;
    startedAt?: string;
    status: RepoScan["status"];
    statusSummary: string;
    updatedAt: string;
    workspaceId: string;
  };
};

export type BuildRepoReadinessSummaryPromptInput = {
  findings: unknown[];
  report: unknown;
  scan: unknown;
};

export type RepoReadinessSummaryPrompt = {
  messages: PromptMessage[];
  safeInput: RepoReadinessSummaryPromptSafeInput;
};

export class RepoReadinessSummaryPromptContractError extends Error {
  readonly code = "repo_readiness_summary_prompt_contract_error" as const;

  constructor(message: string) {
    super(message);
    this.name = "RepoReadinessSummaryPromptContractError";
  }
}

const sortById = <T extends { id?: string; findingId?: string }>(items: readonly T[]): T[] =>
  [...items].sort((left, right) => {
    const leftId = left.id ?? left.findingId ?? "";
    const rightId = right.id ?? right.findingId ?? "";

    return leftId.localeCompare(rightId);
  });

const toExpectedReportFields = (report: RepoReadinessReport): ExpectedReportFields => ({
  blockedReasons: [...report.blockedReasons],
  categoryScores: report.categoryScores,
  contractVersion: report.contractVersion,
  executionReadiness: report.executionReadiness,
  findingIds: [...report.findingIds],
  generatedAt: report.generatedAt,
  overallScore: report.overallScore,
  recommendedNextActions: [...report.recommendedNextActions],
  repoId: report.repoId,
  reportId: report.reportId,
  scanId: report.scanId,
  taskRecommendationIds: [...report.taskRecommendationIds],
  workspaceId: report.workspaceId,
});

const toModuleStatusSummary = (moduleStatus: RepoScanModuleStatus): SafeModuleStatusSummary => ({
  finishedAt: moduleStatus.finishedAt,
  id: moduleStatus.id,
  label: moduleStatus.label,
  order: moduleStatus.order,
  required: moduleStatus.required,
  startedAt: moduleStatus.startedAt,
  status: moduleStatus.status,
  summary: moduleStatus.summary,
});

const toInventorySummary = (inventory: RepoScanInventory): SafeInventorySummary => ({
  agentInstructionSummary: inventory.agentInstructionSummary,
  backlogQualitySummary: inventory.backlogQualitySummary,
  ciPostureSummary: inventory.ciPostureSummary,
  ciProviderLabels: [...inventory.ciProviderLabels],
  documentationSummaries: inventory.documentationSummaries.map((summary) => ({ ...summary })),
  documentSummaries: inventory.documentSummaries.map((summary) => ({ ...summary })),
  languageSummaries: inventory.languageSummaries.map((summary) => ({ ...summary })),
  omittedFileCount: inventory.omittedFileCount,
  packageManagerLabels: [...inventory.packageManagerLabels],
  policySummary: inventory.policySummary,
  productClaritySummary: inventory.productClaritySummary,
  repoHygieneSummary: inventory.repoHygieneSummary,
  scannedFileCount: inventory.scannedFileCount,
  totalDirectoryCount: inventory.totalDirectoryCount,
  totalFileCount: inventory.totalFileCount,
  validationPostureSummary: inventory.validationPostureSummary,
});

const toFindingSummary = (finding: Finding): SafeFindingSummary => ({
  category: finding.category,
  confidence: finding.confidence,
  deterministicRuleId: finding.deterministicRuleId,
  evidenceSummaries: finding.evidence.map((evidence) => evidence.summary),
  findingId: finding.findingId,
  recommendation: finding.recommendation,
  severity: finding.severity,
  status: finding.status,
  summary: finding.summary,
  title: finding.title,
});

const toSafeInput = (input: {
  findings: Finding[];
  report: RepoReadinessReport;
  scan: RepoScan;
}): RepoReadinessSummaryPromptSafeInput => ({
  expectedReport: toExpectedReportFields(input.report),
  findingSummaries: sortById(input.findings).map(toFindingSummary),
  inventorySummary: toInventorySummary(input.scan.inventory),
  scanMetadata: {
    createdAt: input.scan.createdAt,
    moduleStatuses: input.scan.moduleStatuses.map(toModuleStatusSummary),
    repoId: input.scan.repoId,
    scanId: input.scan.scanId,
    status: input.scan.status,
    statusSummary: input.scan.statusSummary,
    updatedAt: input.scan.updatedAt,
    workspaceId: input.scan.workspaceId,
    ...(input.scan.failureSummary === undefined
      ? {}
      : { failureSummary: input.scan.failureSummary }),
    ...(input.scan.finishedAt === undefined ? {} : { finishedAt: input.scan.finishedAt }),
    ...(input.scan.readinessReportId === undefined
      ? {}
      : { readinessReportId: input.scan.readinessReportId }),
    ...(input.scan.startedAt === undefined ? {} : { startedAt: input.scan.startedAt }),
  },
});

const assertMatchingScope = (input: {
  expectedReport: ExpectedReportFields;
  report: RepoReadinessReport;
}): void => {
  const expected = input.expectedReport;
  const report = input.report;

  if (
    report.reportId !== expected.reportId ||
    report.workspaceId !== expected.workspaceId ||
    report.repoId !== expected.repoId ||
    report.scanId !== expected.scanId
  ) {
    throw new RepoReadinessSummaryPromptContractError(
      "Repo readiness summary output scope mismatch.",
    );
  }
};

const assertStableField = (input: {
  actual: unknown;
  expected: unknown;
  fieldName: string;
}): void => {
  if (JSON.stringify(input.actual) !== JSON.stringify(input.expected)) {
    throw new RepoReadinessSummaryPromptContractError(
      `Repo readiness summary output changed deterministic field "${input.fieldName}".`,
    );
  }
};

const assertStableReportFields = (input: {
  expectedReport: ExpectedReportFields;
  report: RepoReadinessReport;
}): void => {
  const expected = input.expectedReport;
  const report = input.report;

  assertStableField({
    actual: report.contractVersion,
    expected: expected.contractVersion,
    fieldName: "contractVersion",
  });
  assertStableField({
    actual: report.generatedAt,
    expected: expected.generatedAt,
    fieldName: "generatedAt",
  });
  assertStableField({
    actual: report.overallScore,
    expected: expected.overallScore,
    fieldName: "overallScore",
  });
  assertStableField({
    actual: report.categoryScores,
    expected: expected.categoryScores,
    fieldName: "categoryScores",
  });
  assertStableField({
    actual: report.executionReadiness,
    expected: expected.executionReadiness,
    fieldName: "executionReadiness",
  });
  assertStableField({
    actual: report.blockedReasons,
    expected: expected.blockedReasons,
    fieldName: "blockedReasons",
  });
  assertStableField({
    actual: report.recommendedNextActions,
    expected: expected.recommendedNextActions,
    fieldName: "recommendedNextActions",
  });
  assertStableField({
    actual: report.findingIds,
    expected: expected.findingIds,
    fieldName: "findingIds",
  });
  assertStableField({
    actual: report.taskRecommendationIds,
    expected: expected.taskRecommendationIds,
    fieldName: "taskRecommendationIds",
  });
};

export const buildRepoReadinessSummaryPrompt = (
  input: BuildRepoReadinessSummaryPromptInput,
): RepoReadinessSummaryPrompt => {
  const scan = RepoScanSchema.parse(input.scan);
  const report = RepoReadinessReportSchema.parse(input.report);
  const findings = input.findings.map((finding) => FindingSchema.parse(finding));
  const safeInput = toSafeInput({ findings, report, scan });

  assertSafeWebBoundPayload(safeInput);

  return {
    safeInput,
    messages: [
      {
        role: "system",
        content: [
          "You summarize repository readiness scans for an AI engineering control plane.",
          "Use only the supplied metadata, document summaries, and finding summaries.",
          "Write concise, evidence-backed report text.",
          "Do not invent facts or include raw source files, diffs, patches, code snippets, secrets, local paths, command output, stdout, or stderr.",
          "Return only JSON matching the RepoReadinessReport contract.",
          "Preserve every deterministic identifier, score, readiness field, blocked reason, recommended action, finding ID, task recommendation ID, and timestamp exactly as supplied.",
        ].join(" "),
      },
      {
        role: "user",
        content: [
          "Generate the human-facing RepoReadinessReport summary fields from this safe input.",
          "Allowed to write: summary, strengths, and weaknesses.",
          "All other fields must match expectedReport exactly.",
          JSON.stringify(safeInput, null, 2),
        ].join("\n\n"),
      },
    ],
  };
};

export const parseRepoReadinessSummaryOutput = (
  payload: unknown,
  input: { expectedReport: unknown },
): RepoReadinessReport => {
  const expectedReport = toExpectedReportFields(
    RepoReadinessReportSchema.parse(input.expectedReport),
  );
  const report = RepoReadinessReportSchema.parse(payload);

  assertSafeWebBoundPayload(report);
  assertMatchingScope({ expectedReport, report });
  assertStableReportFields({ expectedReport, report });

  return report;
};

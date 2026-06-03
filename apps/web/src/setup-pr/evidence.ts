import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  SetupPrEvidenceSummarySchema,
  type CortexTask,
  type Finding,
  type SetupPrEvidenceFindingSummary,
  type SetupPrEvidenceSummary,
  type SetupPrEvidenceTaskSummary,
  type SetupPrPreview,
} from "@control-plane/shared";

import { createActionError } from "../server/errors";

export type SetupPrEvidenceFindingRow = {
  category: Finding["category"];
  confidence: number;
  contractVersion: Finding["contractVersion"];
  createdAt: Date;
  deterministicRuleId: string;
  evidence: Finding["evidence"];
  id: string;
  recommendation: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  source: Finding["source"];
  status: Finding["status"];
  summary: string;
  taskIds: string[];
  title: string;
  updatedAt: Date;
  workspaceId: string;
};

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

const formatCount = (count: number, singular: string): string =>
  `${count} ${singular}${count === 1 ? "" : "s"}`;

const toGeneratedAtIso = (value: Date | string): string =>
  value instanceof Date ? value.toISOString() : new Date(value).toISOString();

const parseFinding = (value: unknown): Finding => {
  const result = FindingSchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

export const toSetupPrEvidenceFinding = (row: SetupPrEvidenceFindingRow): Finding =>
  parseFinding({
    category: row.category,
    confidence: row.confidence,
    contractVersion: row.contractVersion,
    createdAt: row.createdAt.toISOString(),
    deterministicRuleId: row.deterministicRuleId,
    evidence: row.evidence,
    findingId: row.id,
    recommendation: row.recommendation,
    repoId: row.repoId,
    scanId: row.scanId,
    severity: row.severity,
    source: row.source,
    status: row.status,
    summary: row.summary,
    title: row.title,
    updatedAt: row.updatedAt.toISOString(),
    workspaceId: row.workspaceId,
  });

const summarizeTask = (task: CortexTask): SetupPrEvidenceTaskSummary => ({
  riskLevel: task.riskLevel,
  taskId: task.taskId,
  title: task.title,
  validationLabels: uniquePreservingOrder(
    task.suggestedValidation.map((validation) => validation.label),
  ),
});

const summarizeFinding = (finding: Finding): SetupPrEvidenceFindingSummary => ({
  category: finding.category,
  findingId: finding.findingId,
  severity: finding.severity,
  status: finding.status,
  title: finding.title,
});

const parseEvidenceSummary = (value: unknown): SetupPrEvidenceSummary => {
  const result = SetupPrEvidenceSummarySchema.safeParse(value);

  if (!result.success) {
    throw createActionError("validation_error");
  }

  return result.data;
};

export const buildSetupPrEvidenceSummary = (input: {
  findings: readonly Finding[];
  generatedAt: Date | string;
  preview: SetupPrPreview;
  tasks: readonly CortexTask[];
}): SetupPrEvidenceSummary => {
  const tasksById = new Map(input.tasks.map((task) => [task.taskId, task]));
  const findingsById = new Map(input.findings.map((finding) => [finding.findingId, finding]));
  const taskIds = uniquePreservingOrder(input.tasks.map((task) => task.taskId));
  const findingIds = uniquePreservingOrder(input.tasks.flatMap((task) => task.findingIds));

  return parseEvidenceSummary({
    contractVersion: CONTRACT_VERSION,
    files: input.preview.files.map((file) => {
      const fileTasks = file.sourceTaskIds.map((taskId) => {
        const task = tasksById.get(taskId);

        if (task === undefined) {
          throw createActionError("validation_error");
        }

        return task;
      });
      const fileFindingIds = uniquePreservingOrder(fileTasks.flatMap((task) => task.findingIds));
      const fileFindings = fileFindingIds
        .map((findingId) => findingsById.get(findingId))
        .filter((finding): finding is Finding => finding !== undefined);

      return {
        findingIds: fileFindingIds,
        findings: fileFindings.map(summarizeFinding),
        omittedContent: true,
        path: file.path,
        reviewChecklist: uniquePreservingOrder([
          `Review ${file.path}: ${file.summary}`,
          ...file.reviewInstructions,
        ]),
        sourceTaskIds: file.sourceTaskIds,
        summary: file.summary,
        tasks: fileTasks.map(summarizeTask),
        templateId: file.templateId,
        whyGenerated: `Generated from ${formatCount(
          fileTasks.length,
          "approved setup task",
        )} linked to ${formatCount(fileFindingIds.length, "readiness finding")} for ${
          file.templateId
        }.`,
      };
    }),
    findingIds,
    generatedAt: toGeneratedAtIso(input.generatedAt),
    previewId: input.preview.previewId,
    repoId: input.preview.repoId,
    taskIds,
    workspaceId: input.preview.workspaceId,
  });
};

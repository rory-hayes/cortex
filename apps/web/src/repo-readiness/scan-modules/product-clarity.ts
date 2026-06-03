import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanProductClaritySummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { TaskRecommendationService } from "../task-recommendations";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";

export type ProductClarityScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:product_clarity`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:product_clarity`;

const metadataFor = (
  summary: Pick<
    RepoScanProductClaritySummary,
    | "clarityStatus"
    | "goalContextStatus"
    | "missingSignalLabels"
    | "productDocCount"
    | "readStatus"
    | "signalLabels"
  >,
  taskRecommendationCount: number,
) => ({
  clarityStatus: summary.clarityStatus,
  goalContextStatus: summary.goalContextStatus,
  missingSignalLabels: [...summary.missingSignalLabels],
  productDocCount: summary.productDocCount,
  readStatus: summary.readStatus,
  signalLabels: [...summary.signalLabels],
  taskRecommendationCount,
});

const findingSeverityFor = (summary: RepoScanProductClaritySummary): Finding["severity"] | null => {
  switch (summary.clarityStatus) {
    case "missing":
      return "high";
    case "weak":
    case "unknown":
      return "medium";
    case "sufficient":
      return null;
  }
};

const ruleIdFor = (summary: RepoScanProductClaritySummary): string =>
  summary.clarityStatus === "missing" ? "product_clarity.missing" : "product_clarity.weak";

const titleFor = (summary: RepoScanProductClaritySummary): string =>
  summary.clarityStatus === "missing"
    ? "Product clarity documentation is missing"
    : "Product clarity documentation is weak";

const summaryFor = (summary: RepoScanProductClaritySummary): string => {
  if (summary.clarityStatus === "missing") {
    return "The repository inventory does not show bounded product documentation signals.";
  }

  if (summary.readStatus !== "read") {
    return "Product documentation exists, but the scan could not safely reduce it into clarity signals.";
  }

  return "Product documentation is present but lacks enough fixed product intent signals.";
};

const buildFinding = (input: {
  createdAt: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  summary: RepoScanProductClaritySummary;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "product_clarity",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.summary),
    evidence: [
      {
        metadata: metadataFor(input.summary, 0),
        paths: [],
        summary: "Product clarity was evaluated from metadata-only inventory summaries.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation:
      "Add or improve product documentation with purpose, users, problem, scope, and success criteria.",
    repoId: input.repoId,
    scanId: input.scanId,
    severity: input.severity,
    source: "deterministic_rule",
    status: "open",
    summary: summaryFor(input.summary),
    title: titleFor(input.summary),
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

const buildTaskRecommendation = (input: {
  createdAt: string;
  findingId: string;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  summary: RepoScanProductClaritySummary;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "A bounded product document describes the product purpose and target users.",
      "The document identifies the problem, scope, and success criteria.",
      "The update avoids raw source excerpts, secrets, local paths, diffs, and patches.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: metadataFor(input.summary, 1),
    objective:
      "Add or improve product documentation with purpose, users, problem, scope, and success criteria.",
    repoId: input.repoId,
    riskLevel: input.severity === "high" ? "medium" : "low",
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Add or improve product clarity documentation",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createProductClarityScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: ProductClarityScanModuleInput): RepoScanModuleDefinition => ({
  id: "product_clarity",
  label: "Product clarity",
  order: 5,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const productClaritySummary = context.scan?.inventory.productClaritySummary;

    if (productClaritySummary === undefined) {
      return {
        findingIds: [],
        metadata: {
          ...metadataFor(
            {
              clarityStatus: "unknown",
              goalContextStatus: "not_provided",
              missingSignalLabels: [],
              productDocCount: 0,
              readStatus: "missing",
              signalLabels: [],
            },
            0,
          ),
          errorKind: "missing_inventory",
        },
        status: "failed",
        summary: "Product clarity scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const severity = findingSeverityFor(productClaritySummary);

    if (severity === null) {
      return {
        findingIds: [],
        metadata: metadataFor(productClaritySummary, 0),
        status: "passed",
        summary: "Product clarity scan found sufficient metadata-only product intent signals.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const finding = buildFinding({
      createdAt,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      summary: productClaritySummary,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendation = buildTaskRecommendation({
      createdAt,
      findingId: persistedFinding.finding.findingId,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      summary: productClaritySummary,
      workspaceId: context.workspaceId,
    });
    const persistedRecommendation = await taskRecommendationService.persistTaskRecommendation({
      recommendation,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });

    return {
      findingIds: [persistedFinding.finding.findingId],
      metadata: metadataFor(productClaritySummary, 1),
      status: "warning",
      summary: "Product clarity scan found missing or weak metadata-only product intent signals.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanValidationPostureSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type ValidationPostureScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type ValidationPostureMetadata = RepoScanValidationPostureSummary & {
  findingCount: number;
  taskRecommendationCount: number;
};

type MissingInventoryMetadata = ValidationPostureMetadata & {
  errorKind: "missing_inventory";
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:validation_posture`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:validation_posture`;

const unknownSummary = (): RepoScanValidationPostureSummary => ({
  detectedCommandLabels: [],
  dryRunCheckCount: 0,
  hasPolicyFile: false,
  missingCommandLabels: ["format", "lint", "test", "typecheck"],
  postureStatus: "unknown",
  suggestedCommandLabels: ["format", "lint", "test", "typecheck"],
  validationCommandCount: 0,
});

const metadataFor = (
  summary: RepoScanValidationPostureSummary,
  counts: { findingCount: number; taskRecommendationCount: number },
): ValidationPostureMetadata => ({
  detectedCommandLabels: [...summary.detectedCommandLabels],
  dryRunCheckCount: summary.dryRunCheckCount,
  findingCount: counts.findingCount,
  hasPolicyFile: summary.hasPolicyFile,
  missingCommandLabels: [...summary.missingCommandLabels],
  postureStatus: summary.postureStatus,
  suggestedCommandLabels: [...summary.suggestedCommandLabels],
  taskRecommendationCount: counts.taskRecommendationCount,
  validationCommandCount: summary.validationCommandCount,
});

const missingInventoryMetadata = (): MissingInventoryMetadata => ({
  ...metadataFor(unknownSummary(), {
    findingCount: 0,
    taskRecommendationCount: 0,
  }),
  errorKind: "missing_inventory",
});

const findingSeverityFor = (
  summary: RepoScanValidationPostureSummary,
): Extract<Finding["severity"], "high" | "medium"> | null => {
  switch (summary.postureStatus) {
    case "missing":
      return "high";
    case "partial":
    case "unknown":
      return "medium";
    case "ready":
      return null;
  }
};

const ruleIdFor = (summary: RepoScanValidationPostureSummary): string =>
  summary.postureStatus === "missing" ? "validation_posture.missing" : "validation_posture.partial";

const titleFor = (summary: RepoScanValidationPostureSummary): string =>
  summary.postureStatus === "missing"
    ? "Validation commands are missing"
    : "Validation command map is incomplete";

const summaryFor = (summary: RepoScanValidationPostureSummary): string => {
  if (summary.postureStatus === "missing") {
    return "The repository inventory does not show a validation command map for AI-assisted work.";
  }

  if (summary.postureStatus === "unknown") {
    return "The repository inventory shows validation commands, but they do not map to fixed validation labels.";
  }

  return "The repository inventory shows validation commands but is missing fixed validation labels needed for safe AI-assisted work.";
};

const buildFinding = (input: {
  createdAt: string;
  metadata: ValidationPostureMetadata;
  repoId: string;
  scanId: string;
  severity: Extract<Finding["severity"], "high" | "medium">;
  summary: RepoScanValidationPostureSummary;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "validation",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.summary),
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "Validation posture was evaluated from metadata-only inventory summaries.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation: "Add a clear validation command map before approving AI-assisted execution.",
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
  metadata: ValidationPostureMetadata;
  repoId: string;
  riskLevel: "low" | "medium";
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Repository policy includes required validation entries for typecheck, lint, format, and test gates.",
      "Each validation entry has a stable identifier, human-readable label, timeout, and required flag.",
      "Hosted repo-readiness scanning records only fixed validation labels and counts, not command text or output.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective: "Add a clear validation command map before approving AI-assisted execution.",
    repoId: input.repoId,
    riskLevel: input.riskLevel,
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review validation command map",
        required: true,
        validationId: "validation-posture:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Add validation command map",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createValidationPostureScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: ValidationPostureScanModuleInput): RepoScanModuleDefinition => ({
  id: "validation_posture",
  label: "Validation",
  order: 19,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const validationPostureSummary = context.scan?.inventory.validationPostureSummary;

    if (validationPostureSummary === undefined) {
      return {
        findingIds: [],
        metadata: missingInventoryMetadata(),
        status: "failed",
        summary:
          "Validation posture scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const severity = findingSeverityFor(validationPostureSummary);

    if (severity === null) {
      return {
        findingIds: [],
        metadata: metadataFor(validationPostureSummary, {
          findingCount: 0,
          taskRecommendationCount: 0,
        }),
        status: "passed",
        summary: "Validation posture scan found a complete validation command map.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const findingMetadata = metadataFor(validationPostureSummary, {
      findingCount: 0,
      taskRecommendationCount: 0,
    });
    const finding = buildFinding({
      createdAt,
      metadata: findingMetadata,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      summary: validationPostureSummary,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendationMetadata = metadataFor(validationPostureSummary, {
      findingCount: 1,
      taskRecommendationCount: 1,
    });
    const recommendation = buildTaskRecommendation({
      createdAt,
      findingId: persistedFinding.finding.findingId,
      metadata: recommendationMetadata,
      repoId: context.repoId,
      riskLevel: severity === "high" ? "medium" : "low",
      scanId: context.scanId,
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
      metadata: recommendationMetadata,
      status: "warning",
      summary:
        severity === "high"
          ? "Validation posture scan found missing validation command metadata."
          : "Validation posture scan found partial validation command metadata.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

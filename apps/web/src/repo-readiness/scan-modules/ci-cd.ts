import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanCiPostureSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type CiCdScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type CiCdMetadata = RepoScanCiPostureSummary & {
  findingCount: number;
  taskRecommendationCount: number;
};

type MissingInventoryMetadata = CiCdMetadata & {
  errorKind: "missing_inventory";
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:ci_cd`;
const taskRecommendationIdFor = (scanId: string): string => `task_recommendation:${scanId}:ci_cd`;

const unknownSummary = (): RepoScanCiPostureSummary => ({
  detectedCommandLabels: [],
  hasCi: false,
  missingCommandLabels: [],
  postureStatus: "unknown",
  providerLabels: [],
  requiredCommandLabels: [],
  workflowFileCount: 0,
});

const metadataFor = (
  summary: RepoScanCiPostureSummary,
  counts: { findingCount: number; taskRecommendationCount: number },
): CiCdMetadata => ({
  detectedCommandLabels: [...summary.detectedCommandLabels],
  findingCount: counts.findingCount,
  hasCi: summary.hasCi,
  missingCommandLabels: [...summary.missingCommandLabels],
  postureStatus: summary.postureStatus,
  providerLabels: [...summary.providerLabels],
  requiredCommandLabels: [...summary.requiredCommandLabels],
  taskRecommendationCount: counts.taskRecommendationCount,
  workflowFileCount: summary.workflowFileCount,
});

const missingInventoryMetadata = (): MissingInventoryMetadata => ({
  ...metadataFor(unknownSummary(), {
    findingCount: 0,
    taskRecommendationCount: 0,
  }),
  errorKind: "missing_inventory",
});

const findingSeverityFor = (
  summary: RepoScanCiPostureSummary,
): Extract<Finding["severity"], "medium"> | null => {
  switch (summary.postureStatus) {
    case "missing":
    case "partial":
    case "unknown":
      return "medium";
    case "aligned":
      return null;
  }
};

const ruleIdFor = (summary: RepoScanCiPostureSummary): string =>
  summary.postureStatus === "missing" ? "ci_cd.missing" : "ci_cd.partial";

const titleFor = (summary: RepoScanCiPostureSummary): string =>
  summary.postureStatus === "missing"
    ? "CI validation coverage is missing"
    : "CI validation coverage is incomplete";

const summaryFor = (summary: RepoScanCiPostureSummary): string => {
  if (summary.postureStatus === "missing") {
    return "The repository inventory does not show CI coverage for detected validation labels.";
  }

  if (summary.postureStatus === "unknown") {
    return "The repository inventory shows CI metadata, but alignment with detected validation labels could not be confirmed.";
  }

  return "The repository inventory shows CI metadata, but required validation labels are not covered.";
};

const buildFinding = (input: {
  createdAt: string;
  metadata: CiCdMetadata;
  repoId: string;
  scanId: string;
  severity: Extract<Finding["severity"], "medium">;
  summary: RepoScanCiPostureSummary;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "ci_cd",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.summary),
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "CI/CD posture was evaluated from metadata-only inventory summaries.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation:
      "Add or update CI workflow coverage before approving AI-assisted execution at scale.",
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
  metadata: CiCdMetadata;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "CI workflow coverage exists for detected test, typecheck, and build validation labels where applicable.",
      "Hosted repo-readiness scanning records only fixed CI/CD labels and counts, not workflow file contents or command output.",
      "The CI/CD readiness finding resolves after the metadata-only scan reports aligned coverage.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective: "Add or update CI workflow coverage for detected validation labels.",
    repoId: input.repoId,
    riskLevel: "low",
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review CI validation coverage",
        required: true,
        validationId: "ci-cd:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Add CI validation workflow",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createCiCdScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: CiCdScanModuleInput): RepoScanModuleDefinition => ({
  id: "ci_cd",
  label: "CI/CD",
  order: 20,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const ciPostureSummary = context.scan?.inventory.ciPostureSummary;

    if (ciPostureSummary === undefined) {
      return {
        findingIds: [],
        metadata: missingInventoryMetadata(),
        status: "failed",
        summary: "CI/CD posture scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const severity = findingSeverityFor(ciPostureSummary);

    if (severity === null) {
      return {
        findingIds: [],
        metadata: metadataFor(ciPostureSummary, {
          findingCount: 0,
          taskRecommendationCount: 0,
        }),
        status: "passed",
        summary: "CI/CD posture scan found aligned validation coverage.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const findingMetadata = metadataFor(ciPostureSummary, {
      findingCount: 0,
      taskRecommendationCount: 0,
    });
    const finding = buildFinding({
      createdAt,
      metadata: findingMetadata,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      summary: ciPostureSummary,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendationMetadata = metadataFor(ciPostureSummary, {
      findingCount: 1,
      taskRecommendationCount: 1,
    });
    const recommendation = buildTaskRecommendation({
      createdAt,
      findingId: persistedFinding.finding.findingId,
      metadata: recommendationMetadata,
      repoId: context.repoId,
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
        ciPostureSummary.postureStatus === "missing"
          ? "CI/CD posture scan found missing validation workflow coverage."
          : "CI/CD posture scan found partial validation workflow coverage.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

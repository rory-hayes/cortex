import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanRepoHygieneSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type RepoHygieneScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type RepoHygieneMetadata = RepoScanRepoHygieneSummary & {
  findingCount: number;
  taskRecommendationCount: number;
};

type MissingInventoryMetadata = RepoHygieneMetadata & {
  errorKind: "missing_inventory";
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:repo_hygiene`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:repo_hygiene`;

const unknownSummary = (): RepoScanRepoHygieneSummary => ({
  contributionDocCount: 0,
  hasContributionDocs: false,
  hasRootGitignore: false,
  hygieneStatus: "unknown",
  issueLabels: [],
  issueTemplateCount: 0,
  jsLockfileCount: 0,
  monorepoSignalCount: 0,
  monorepoStructureStatus: "unknown",
  packageManagerCount: 0,
  packageManagerStatus: "unknown",
  workspaceConfigCount: 0,
});

const metadataFor = (
  summary: RepoScanRepoHygieneSummary,
  counts: { findingCount: number; taskRecommendationCount: number },
): RepoHygieneMetadata => ({
  contributionDocCount: summary.contributionDocCount,
  findingCount: counts.findingCount,
  hasContributionDocs: summary.hasContributionDocs,
  hasRootGitignore: summary.hasRootGitignore,
  hygieneStatus: summary.hygieneStatus,
  issueLabels: [...summary.issueLabels],
  issueTemplateCount: summary.issueTemplateCount,
  jsLockfileCount: summary.jsLockfileCount,
  monorepoSignalCount: summary.monorepoSignalCount,
  monorepoStructureStatus: summary.monorepoStructureStatus,
  packageManagerCount: summary.packageManagerCount,
  packageManagerStatus: summary.packageManagerStatus,
  taskRecommendationCount: counts.taskRecommendationCount,
  workspaceConfigCount: summary.workspaceConfigCount,
});

const missingInventoryMetadata = (): MissingInventoryMetadata => ({
  ...metadataFor(unknownSummary(), {
    findingCount: 0,
    taskRecommendationCount: 0,
  }),
  errorKind: "missing_inventory",
});

const findingSeverityFor = (
  summary: RepoScanRepoHygieneSummary,
): Extract<Finding["severity"], "low" | "medium"> | null => {
  if (summary.hygieneStatus === "minor_gaps") {
    return "low";
  }

  if (summary.hygieneStatus === "needs_attention") {
    return "medium";
  }

  return null;
};

const ruleIdFor = (severity: Extract<Finding["severity"], "low" | "medium">): string =>
  severity === "medium" ? "repo_hygiene.structural_setup_risk" : "repo_hygiene.minor_setup_gaps";

const titleFor = (severity: Extract<Finding["severity"], "low" | "medium">): string =>
  severity === "medium"
    ? "Repository hygiene needs structural attention"
    : "Repository hygiene has minor setup gaps";

const summaryFor = (severity: Extract<Finding["severity"], "low" | "medium">): string =>
  severity === "medium"
    ? "The repository inventory shows structural setup metadata that can reduce safe AI execution quality."
    : "The repository inventory shows minor setup gaps that can reduce AI execution quality.";

const buildFinding = (input: {
  createdAt: string;
  metadata: RepoHygieneMetadata;
  repoId: string;
  scanId: string;
  severity: Extract<Finding["severity"], "low" | "medium">;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "repo_hygiene",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.severity),
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "Repo hygiene was evaluated from metadata-only inventory counts and labels.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation: "Improve repository setup hygiene for safer AI-assisted execution.",
    repoId: input.repoId,
    scanId: input.scanId,
    severity: input.severity,
    source: "deterministic_rule",
    status: "open",
    summary: summaryFor(input.severity),
    title: titleFor(input.severity),
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

const buildTaskRecommendation = (input: {
  createdAt: string;
  findingId: string;
  metadata: RepoHygieneMetadata;
  repoId: string;
  riskLevel: "low" | "medium";
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Repository setup uses one package manager lockfile convention.",
      "Root ignore rules, contribution notes, and issue templates are present where appropriate.",
      "Monorepo structure has explicit workspace configuration when multi-package signals are present.",
      "The setup update avoids credentials, implementation excerpts, and local machine details.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective: "Improve repository setup hygiene for safer AI-assisted execution.",
    repoId: input.repoId,
    riskLevel: input.riskLevel,
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review repository hygiene setup",
        required: true,
        validationId: "repo-hygiene:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Improve repository hygiene setup",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createRepoHygieneScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: RepoHygieneScanModuleInput): RepoScanModuleDefinition => ({
  id: "repo_hygiene",
  label: "Repo hygiene",
  order: 25,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const repoHygieneSummary = context.scan?.inventory.repoHygieneSummary;

    if (repoHygieneSummary === undefined) {
      return {
        findingIds: [],
        metadata: missingInventoryMetadata(),
        status: "failed",
        summary: "Repo hygiene scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const severity = findingSeverityFor(repoHygieneSummary);

    if (severity === null) {
      return {
        findingIds: [],
        metadata: metadataFor(repoHygieneSummary, {
          findingCount: 0,
          taskRecommendationCount: 0,
        }),
        status: repoHygieneSummary.hygieneStatus === "healthy" ? "passed" : "failed",
        summary:
          repoHygieneSummary.hygieneStatus === "healthy"
            ? "Repo hygiene scan found healthy structural setup metadata."
            : "Repo hygiene scan could not classify structural setup metadata.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const findingMetadata = metadataFor(repoHygieneSummary, {
      findingCount: 0,
      taskRecommendationCount: 0,
    });
    const finding = buildFinding({
      createdAt,
      metadata: findingMetadata,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendationMetadata = metadataFor(repoHygieneSummary, {
      findingCount: 1,
      taskRecommendationCount: 1,
    });
    const recommendation = buildTaskRecommendation({
      createdAt,
      findingId: persistedFinding.finding.findingId,
      metadata: recommendationMetadata,
      repoId: context.repoId,
      riskLevel: severity,
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
        severity === "medium"
          ? "Repo hygiene scan found structural setup risks."
          : "Repo hygiene scan found minor structural setup gaps.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

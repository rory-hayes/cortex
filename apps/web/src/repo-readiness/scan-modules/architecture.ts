import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanDocumentationSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type ArchitectureScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type ArchitectureMetadata = {
  architectureDocCount: number;
  hasArchitectureDocs: boolean;
  taskRecommendationCount: number;
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:architecture`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:architecture`;

const architectureSummaryFor = (
  documentationSummaries: readonly RepoScanDocumentationSummary[],
): RepoScanDocumentationSummary | undefined =>
  documentationSummaries.find(
    (summary) => summary.kind === "architecture" && summary.present && summary.pathCount > 0,
  );

const metadataFor = (
  documentationSummaries: readonly RepoScanDocumentationSummary[],
  taskRecommendationCount: number,
): ArchitectureMetadata => {
  const architectureSummary = architectureSummaryFor(documentationSummaries);
  const architectureDocCount = architectureSummary?.pathCount ?? 0;

  return {
    architectureDocCount,
    hasArchitectureDocs: architectureDocCount > 0,
    taskRecommendationCount,
  };
};

const buildFinding = (input: {
  createdAt: string;
  metadata: ArchitectureMetadata;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "architecture",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: "architecture.missing",
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "Architecture documentation was evaluated from metadata-only inventory summaries.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation:
      "Add architecture documentation covering system shape, boundaries, package responsibilities, validation expectations, and security expectations.",
    repoId: input.repoId,
    scanId: input.scanId,
    severity: "high",
    source: "deterministic_rule",
    status: "open",
    summary: "The repository inventory does not show architecture-level documentation.",
    title: "Architecture documentation is missing",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

const buildTaskRecommendation = (input: {
  createdAt: string;
  findingId: string;
  metadata: ArchitectureMetadata;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Architecture documentation describes the system shape and major runtime boundaries.",
      "The document identifies package or app responsibilities without copying implementation excerpts.",
      "The document records validation and security expectations for safe AI-assisted changes.",
      "The update avoids credentials, environment-specific machine details, and change hunks.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective:
      "Add architecture documentation covering system shape, boundaries, package responsibilities, validation expectations, and security expectations.",
    repoId: input.repoId,
    riskLevel: "medium",
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review architecture documentation coverage",
        required: true,
        validationId: "architecture-docs:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Add architecture documentation",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createArchitectureScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: ArchitectureScanModuleInput): RepoScanModuleDefinition => ({
  id: "architecture",
  label: "Architecture",
  order: 15,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const documentationSummaries = context.scan?.inventory.documentationSummaries;

    if (documentationSummaries === undefined) {
      return {
        findingIds: [],
        metadata: {
          architectureDocCount: 0,
          errorKind: "missing_inventory",
          hasArchitectureDocs: false,
          taskRecommendationCount: 0,
        },
        status: "failed",
        summary: "Architecture scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const passMetadata = metadataFor(documentationSummaries, 0);

    if (passMetadata.hasArchitectureDocs) {
      return {
        findingIds: [],
        metadata: passMetadata,
        status: "passed",
        summary: "Architecture scan found architecture documentation metadata.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const findingMetadata = metadataFor(documentationSummaries, 0);
    const finding = buildFinding({
      createdAt,
      metadata: findingMetadata,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendationMetadata = metadataFor(documentationSummaries, 1);
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
      summary: "Architecture scan found no architecture documentation summary.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

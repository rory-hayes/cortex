import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanBacklogQualitySummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type BacklogQualityScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type BacklogQualityMetadata = {
  backlogFileCount: number;
  findingCount: number;
  hasBacklog: boolean;
  missingSignalCount: number;
  missingSignalLabels: RepoScanBacklogQualitySummary["missingSignalLabels"];
  readStatus: RepoScanBacklogQualitySummary["readStatus"];
  signalLabels: RepoScanBacklogQualitySummary["signalLabels"];
  structureStatus: RepoScanBacklogQualitySummary["structureStatus"];
  taskRecommendationCount: number;
};

type MissingInventoryMetadata = BacklogQualityMetadata & {
  errorKind: "missing_inventory";
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:backlog_quality`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:backlog_quality`;

const unknownSummary = (): RepoScanBacklogQualitySummary => ({
  backlogFileCount: 0,
  hasBacklog: false,
  missingSignalLabels: ["backlog"],
  readStatus: "missing",
  signalLabels: [],
  structureStatus: "missing",
});

const metadataFor = (
  summary: RepoScanBacklogQualitySummary,
  counts: { findingCount: number; taskRecommendationCount: number },
): BacklogQualityMetadata => ({
  backlogFileCount: summary.backlogFileCount,
  findingCount: counts.findingCount,
  hasBacklog: summary.hasBacklog,
  missingSignalCount: summary.missingSignalLabels.length,
  missingSignalLabels: [...summary.missingSignalLabels],
  readStatus: summary.readStatus,
  signalLabels: [...summary.signalLabels],
  structureStatus: summary.structureStatus,
  taskRecommendationCount: counts.taskRecommendationCount,
});

const missingInventoryMetadata = (): MissingInventoryMetadata => ({
  ...metadataFor(unknownSummary(), {
    findingCount: 0,
    taskRecommendationCount: 0,
  }),
  errorKind: "missing_inventory",
});

const findingSeverityFor = (summary: RepoScanBacklogQualitySummary): Finding["severity"] | null => {
  switch (summary.structureStatus) {
    case "missing":
      return "high";
    case "weak":
    case "unknown":
      return "medium";
    case "ai_executable":
      return null;
  }
};

const ruleIdFor = (summary: RepoScanBacklogQualitySummary): string =>
  summary.structureStatus === "missing" ? "backlog_quality.missing" : "backlog_quality.weak";

const titleFor = (summary: RepoScanBacklogQualitySummary): string =>
  summary.structureStatus === "missing"
    ? "AI-executable backlog is missing"
    : "Backlog needs AI-execution structure";

const summaryFor = (summary: RepoScanBacklogQualitySummary): string => {
  if (summary.structureStatus === "missing") {
    return "The repository inventory does not show a root AI-executable backlog.";
  }

  if (summary.readStatus !== "read") {
    return "A root backlog exists, but the scan could not safely reduce it into execution-structure signals.";
  }

  return "The root backlog is missing fixed execution-structure signals needed for safe AI-assisted work.";
};

const buildFinding = (input: {
  createdAt: string;
  metadata: BacklogQualityMetadata;
  repoId: string;
  scanId: string;
  severity: Finding["severity"];
  summary: RepoScanBacklogQualitySummary;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "backlog_quality",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.summary),
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "Backlog quality was evaluated from metadata-only inventory summaries.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation:
      "Create or improve a root backlog with AI-executable task structure, validation guidance, and execution metadata.",
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
  metadata: BacklogQualityMetadata;
  repoId: string;
  riskLevel: "low" | "medium";
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Root BACKLOG.md exists as the canonical backlog file.",
      "Backlog tasks include task identifiers, status markers, dependencies, acceptance criteria, validation guidance, and file-touch hints.",
      "Backlog metadata avoids secrets, raw private issue text, source excerpts, local machine paths, diffs, and patches.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective:
      "Create or improve a root backlog with AI-executable task structure, validation guidance, and execution metadata.",
    repoId: input.repoId,
    riskLevel: input.riskLevel,
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review backlog task structure",
        required: true,
        validationId: "backlog-quality:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Improve AI-ready backlog structure",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createBacklogQualityScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: BacklogQualityScanModuleInput): RepoScanModuleDefinition => ({
  id: "backlog_quality",
  label: "Backlog quality",
  order: 18,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const backlogQualitySummary = context.scan?.inventory.backlogQualitySummary;

    if (backlogQualitySummary === undefined) {
      return {
        findingIds: [],
        metadata: missingInventoryMetadata(),
        status: "failed",
        summary: "Backlog quality scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const severity = findingSeverityFor(backlogQualitySummary);

    if (severity === null) {
      return {
        findingIds: [],
        metadata: metadataFor(backlogQualitySummary, {
          findingCount: 0,
          taskRecommendationCount: 0,
        }),
        status: "passed",
        summary: "Backlog quality scan found AI-executable backlog structure metadata.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const findingMetadata = metadataFor(backlogQualitySummary, {
      findingCount: 0,
      taskRecommendationCount: 0,
    });
    const finding = buildFinding({
      createdAt,
      metadata: findingMetadata,
      repoId: context.repoId,
      scanId: context.scanId,
      severity,
      summary: backlogQualitySummary,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendationMetadata = metadataFor(backlogQualitySummary, {
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
          ? "Backlog quality scan found no AI-executable backlog."
          : "Backlog quality scan found weak AI-execution structure.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

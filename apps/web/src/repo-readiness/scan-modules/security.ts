import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type TaskRecommendation,
} from "@control-plane/shared";
import {
  assessRepoReadinessPolicyCoverage,
  type RepoReadinessPolicyCoverageAssessment,
  type RepoReadinessPolicyCoverageStatus,
} from "@control-plane/policies";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type SecurityScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  now?: () => Date;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type SecurityMetadata = RepoReadinessPolicyCoverageAssessment & {
  findingCount: number;
  taskRecommendationCount: number;
};

type MissingInventoryMetadata = Omit<SecurityMetadata, "coverageStatus"> & {
  coverageStatus: "unknown";
  errorKind: "missing_inventory";
};

const findingIdFor = (scanId: string): string => `finding:${scanId}:security_policy_coverage`;
const taskRecommendationIdFor = (scanId: string): string =>
  `task_recommendation:${scanId}:security_policy_coverage`;

const metadataFor = (
  assessment: RepoReadinessPolicyCoverageAssessment,
  counts: { findingCount: number; taskRecommendationCount: number },
): SecurityMetadata => ({
  ...assessment,
  findingCount: counts.findingCount,
  taskRecommendationCount: counts.taskRecommendationCount,
});

const missingInventoryMetadata = (): MissingInventoryMetadata => ({
  coverageStatus: "unknown",
  dryRunCheckCount: 0,
  errorKind: "missing_inventory",
  findingCount: 0,
  hasPolicyFile: false,
  missingCoverageLabels: [],
  protectedPathCount: 0,
  recommendedRuleLabels: [],
  sensitivePathCount: 0,
  taskRecommendationCount: 0,
  validationCommandCount: 0,
});

const ruleIdFor = (coverageStatus: Exclude<RepoReadinessPolicyCoverageStatus, "ready">): string =>
  coverageStatus === "missing"
    ? "security.policy_coverage_missing"
    : "security.policy_coverage_incomplete";

const findingTitleFor = (
  coverageStatus: Exclude<RepoReadinessPolicyCoverageStatus, "ready">,
): string =>
  coverageStatus === "missing"
    ? "Repository policy coverage is missing"
    : "Repository policy coverage is incomplete";

const findingSummaryFor = (
  coverageStatus: Exclude<RepoReadinessPolicyCoverageStatus, "ready">,
): string =>
  coverageStatus === "missing"
    ? "The repository inventory does not show policy coverage for AI execution safety."
    : "The repository inventory shows policy coverage but not enough protected or sensitive coverage.";

const buildFinding = (input: {
  assessment: RepoReadinessPolicyCoverageAssessment;
  createdAt: string;
  metadata: SecurityMetadata;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): Finding => {
  if (input.assessment.coverageStatus === "ready") {
    throw new Error("Security findings require missing or incomplete policy coverage.");
  }

  return FindingSchema.parse({
    category: "security",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    deterministicRuleId: ruleIdFor(input.assessment.coverageStatus),
    evidence: [
      {
        metadata: input.metadata,
        paths: [],
        summary: "Repository policy coverage was evaluated from metadata-only inventory counts.",
      },
    ],
    findingId: findingIdFor(input.scanId),
    recommendation:
      "Add repository policy coverage for protected and sensitive areas before AI execution.",
    repoId: input.repoId,
    scanId: input.scanId,
    severity: input.assessment.coverageStatus === "missing" ? "high" : "medium",
    source: "deterministic_rule",
    status: "open",
    summary: findingSummaryFor(input.assessment.coverageStatus),
    title: findingTitleFor(input.assessment.coverageStatus),
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });
};

const buildTaskRecommendation = (input: {
  createdAt: string;
  findingId: string;
  metadata: SecurityMetadata;
  repoId: string;
  scanId: string;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Repository policy exists and is visible to repo-readiness inventory.",
      "Protected area rules cover high-risk directories such as CI, infrastructure, auth, billing, and policy configuration.",
      "Sensitive area rules cover credential-bearing or environment-like files using placeholders only.",
      "The setup update avoids credentials, implementation excerpts, and local machine details.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.createdAt,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: input.metadata,
    objective:
      "Add repository policy coverage for protected and sensitive areas before AI execution.",
    repoId: input.repoId,
    riskLevel: "medium",
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review repository policy coverage",
        required: true,
        validationId: "security-policy-coverage:review",
      },
    ],
    taskRecommendationId: taskRecommendationIdFor(input.scanId),
    title: "Add repository policy coverage",
    updatedAt: input.createdAt,
    workspaceId: input.workspaceId,
  });

export const createSecurityScanModule = ({
  findingService,
  now = () => new Date(),
  taskRecommendationService,
}: SecurityScanModuleInput): RepoScanModuleDefinition => ({
  id: "security",
  label: "Security",
  order: 20,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const policySummary = context.scan?.inventory.policySummary;

    if (policySummary === undefined) {
      return {
        findingIds: [],
        metadata: missingInventoryMetadata(),
        status: "failed",
        summary: "Security scan could not run because inventory metadata was unavailable.",
        taskRecommendationIds: [],
      };
    }

    const assessment = assessRepoReadinessPolicyCoverage(policySummary);
    const passMetadata = metadataFor(assessment, {
      findingCount: 0,
      taskRecommendationCount: 0,
    });

    if (assessment.coverageStatus === "ready") {
      return {
        findingIds: [],
        metadata: passMetadata,
        status: "passed",
        summary: "Security scan found repository policy coverage metadata.",
        taskRecommendationIds: [],
      };
    }

    const createdAt = now().toISOString();
    const finding = buildFinding({
      assessment,
      createdAt,
      metadata: passMetadata,
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
    const recommendationMetadata = metadataFor(assessment, {
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
      summary: "Security scan found missing repository policy coverage metadata.",
      taskRecommendationIds: [persistedRecommendation.recommendation.taskRecommendationId],
    };
  },
});

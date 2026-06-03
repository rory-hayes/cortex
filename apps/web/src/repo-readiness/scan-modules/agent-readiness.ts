import "server-only";

import {
  CONTRACT_VERSION,
  FindingSchema,
  TaskRecommendationSchema,
  type Finding,
  type RepoScanAgentInstructionSummary,
  type TaskRecommendation,
} from "@control-plane/shared";

import type { RepoFindingService } from "../findings";
import type { RepoScanModuleDefinition, RepoScanModuleRunResult } from "../scan-module-runner";
import type { TaskRecommendationService } from "../task-recommendations";

export type AgentReadinessScanModuleInput = {
  findingService: Pick<RepoFindingService, "persistFinding">;
  taskRecommendationService: Pick<TaskRecommendationService, "persistTaskRecommendation">;
};

type AgentReadinessRule = {
  findingTitle: string;
  recommendationTitle: string;
  ruleId: "agent_readiness.incomplete_agents_md" | "agent_readiness.missing_agents_md";
  severity: Finding["severity"];
  taskObjective: string;
};

const ruleForSummary = (summary: RepoScanAgentInstructionSummary): AgentReadinessRule | null => {
  if (summary.completenessStatus === "missing") {
    return {
      findingTitle: "Add root agent instructions",
      recommendationTitle: "Generate root AGENTS.md",
      ruleId: "agent_readiness.missing_agents_md",
      severity: "high",
      taskObjective:
        "Generate a root AGENTS.md with project purpose, architecture boundaries, security rules, and validation expectations.",
    };
  }

  if (
    summary.completenessStatus === "incomplete" ||
    summary.completenessStatus === "conflicting" ||
    summary.completenessStatus === "unknown"
  ) {
    return {
      findingTitle: "Improve root agent instructions",
      recommendationTitle: "Improve root AGENTS.md",
      ruleId: "agent_readiness.incomplete_agents_md",
      severity: summary.completenessStatus === "conflicting" ? "high" : "medium",
      taskObjective:
        "Improve root AGENTS.md so coding agents receive clear project purpose, architecture boundaries, security rules, and validation expectations.",
    };
  }

  return null;
};

const metadataForSummary = (summary: RepoScanAgentInstructionSummary): Record<string, unknown> => ({
  completenessStatus: summary.completenessStatus,
  instructionFileCount: summary.instructionFileCount,
  missingSectionCount: summary.missingSectionLabels.length,
  missingSectionLabels: summary.missingSectionLabels,
  readStatus: summary.readStatus,
});

const buildFinding = (input: {
  currentTime: string;
  repoId: string;
  rule: AgentReadinessRule;
  scanId: string;
  summary: RepoScanAgentInstructionSummary;
  workspaceId: string;
}): Finding =>
  FindingSchema.parse({
    category: "agent_readiness",
    confidence: 1,
    contractVersion: CONTRACT_VERSION,
    createdAt: input.currentTime,
    deterministicRuleId: input.rule.ruleId,
    evidence: [
      {
        metadata: metadataForSummary(input.summary),
        paths: [],
        summary:
          input.summary.completenessStatus === "missing"
            ? "Root agent instructions were not detected."
            : "Root agent instructions need additional setup metadata.",
      },
    ],
    findingId: `finding:${input.scanId}:agent_readiness`,
    recommendation: input.rule.taskObjective,
    repoId: input.repoId,
    scanId: input.scanId,
    severity: input.rule.severity,
    source: "deterministic_rule",
    status: "open",
    summary:
      input.summary.completenessStatus === "missing"
        ? "The repository is missing root AGENTS.md instructions for coding agents."
        : "The repository has agent instructions, but the scan found missing or conflicting setup labels.",
    title: input.rule.findingTitle,
    updatedAt: input.currentTime,
    workspaceId: input.workspaceId,
  });

const buildRecommendation = (input: {
  currentTime: string;
  findingId: string;
  repoId: string;
  rule: AgentReadinessRule;
  scanId: string;
  summary: RepoScanAgentInstructionSummary;
  workspaceId: string;
}): TaskRecommendation =>
  TaskRecommendationSchema.parse({
    acceptanceCriteria: [
      "Root AGENTS.md exists as the canonical coding-agent instruction file.",
      "Instructions cover project purpose, architecture boundaries, security rules, and validation expectations.",
      "Instruction updates do not include secrets, raw source snippets, or local environment details.",
    ],
    contractVersion: CONTRACT_VERSION,
    createdAt: input.currentTime,
    effort: "small",
    executionMode: "setup_pr",
    findingIds: [input.findingId],
    metadata: {
      completenessStatus: input.summary.completenessStatus,
      instructionFileCount: input.summary.instructionFileCount,
      missingSectionCount: input.summary.missingSectionLabels.length,
      readStatus: input.summary.readStatus,
    },
    objective: input.rule.taskObjective,
    repoId: input.repoId,
    riskLevel: input.rule.severity === "high" ? "medium" : "low",
    scanId: input.scanId,
    status: "open",
    suggestedValidation: [
      {
        label: "Review agent instruction coverage",
        required: true,
        validationId: "agent-instructions:review",
      },
    ],
    taskRecommendationId: `task_recommendation:${input.scanId}:agent_readiness`,
    title: input.rule.recommendationTitle,
    updatedAt: input.currentTime,
    workspaceId: input.workspaceId,
  });

const resultMetadataFor = (
  summary: RepoScanAgentInstructionSummary,
  counts: { findingCount: number; taskRecommendationCount: number },
): Record<string, unknown> => ({
  completenessStatus: summary.completenessStatus,
  findingCount: counts.findingCount,
  hasAgentInstructions: summary.hasAgentInstructions,
  instructionFileCount: summary.instructionFileCount,
  missingSectionCount: summary.missingSectionLabels.length,
  readStatus: summary.readStatus,
  taskRecommendationCount: counts.taskRecommendationCount,
});

export const createAgentReadinessScanModule = ({
  findingService,
  taskRecommendationService,
}: AgentReadinessScanModuleInput): RepoScanModuleDefinition => ({
  id: "agent_readiness",
  label: "Agent readiness",
  order: 10,
  required: false,
  run: async (context): Promise<RepoScanModuleRunResult> => {
    const summary = context.scan?.inventory.agentInstructionSummary;

    if (summary === undefined) {
      return {
        metadata: {
          errorKind: "missing_inventory",
        },
        status: "failed",
        summary: "Agent readiness scan requires GitHub inventory metadata.",
      };
    }

    const rule = ruleForSummary(summary);

    if (rule === null) {
      return {
        metadata: resultMetadataFor(summary, {
          findingCount: 0,
          taskRecommendationCount: 0,
        }),
        status: "passed",
        summary: "Agent readiness scan found complete root instructions.",
      };
    }

    const currentTime = new Date().toISOString();
    const finding = buildFinding({
      currentTime,
      repoId: context.repoId,
      rule,
      scanId: context.scanId,
      summary,
      workspaceId: context.workspaceId,
    });
    const persistedFinding = await findingService.persistFinding({
      finding,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });
    const recommendation = buildRecommendation({
      currentTime,
      findingId: persistedFinding.finding.findingId,
      repoId: context.repoId,
      rule,
      scanId: context.scanId,
      summary,
      workspaceId: context.workspaceId,
    });
    const persistedRecommendation = await taskRecommendationService.persistTaskRecommendation({
      recommendation,
      repoId: context.repoId,
      scanId: context.scanId,
      workspaceId: context.workspaceId,
    });

    return {
      findingIds: [...(context.scan?.findingIds ?? []), persistedFinding.finding.findingId],
      metadata: resultMetadataFor(summary, {
        findingCount: 1,
        taskRecommendationCount: 1,
      }),
      status: "warning",
      summary: "Agent readiness scan generated setup recommendations.",
      taskRecommendationIds: [
        ...(context.scan?.taskRecommendationIds ?? []),
        persistedRecommendation.recommendation.taskRecommendationId,
      ],
    };
  },
});

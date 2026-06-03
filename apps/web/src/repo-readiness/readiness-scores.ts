import {
  FINDING_CATEGORIES,
  type Finding,
  type FindingCategory,
  type FindingSeverity,
  type RepoReadinessCategoryScores,
  type RepoScanInventory,
} from "@control-plane/shared";
import { assessRepoReadinessPolicyCoverage } from "@control-plane/policies";

export type ReadinessScoreFinding = Pick<Finding, "category" | "severity" | "status">;

export type ReadinessScoreCalculation = {
  categoryScores: RepoReadinessCategoryScores;
  explanations: Record<FindingCategory, string[]>;
  overallScore: number;
  strengths: string[];
  weaknesses: string[];
};

export type CalculateReadinessScoresInput = {
  findings: readonly ReadinessScoreFinding[];
  inventory: RepoScanInventory;
};

const severityPenalties: Record<FindingSeverity, number> = {
  blocked: 70,
  high: 35,
  info: 2,
  low: 8,
  medium: 18,
};

const categoryLabels: Record<FindingCategory, string> = {
  agent_readiness: "Agent readiness",
  architecture: "Architecture",
  backlog_quality: "Backlog quality",
  ci_cd: "CI/CD",
  execution_risk: "Execution risk",
  integration: "Integration",
  product_clarity: "Product clarity",
  repo_hygiene: "Repo hygiene",
  security: "Security",
  validation: "Validation",
};

const createCategoryScores = (): RepoReadinessCategoryScores =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [category, 100]),
  ) as RepoReadinessCategoryScores;

const createExplanations = (): Record<FindingCategory, string[]> =>
  Object.fromEntries(
    FINDING_CATEGORIES.map((category) => [category, ["Started from 100."]]),
  ) as Record<FindingCategory, string[]>;

const clampScore = (value: number): number => Math.max(0, Math.min(100, Math.round(value)));

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

const findingNoun = (count: number): string => (count === 1 ? "finding" : "findings");

export const calculateReadinessScores = ({
  findings,
  inventory,
}: CalculateReadinessScoresInput): ReadinessScoreCalculation => {
  const categoryScores = createCategoryScores();
  const explanations = createExplanations();
  const weaknesses: string[] = [];
  const strengths: string[] = [];

  const reduceCategory = (
    category: FindingCategory,
    points: number,
    explanation: string,
    weakness: string,
  ): void => {
    categoryScores[category] = clampScore(categoryScores[category] - points);
    explanations[category].push(explanation);
    weaknesses.push(weakness);
  };

  const openFindings = findings.filter((finding) => finding.status === "open");

  for (const category of FINDING_CATEGORIES) {
    const categoryFindings = openFindings.filter((finding) => finding.category === category);

    for (const severity of ["blocked", "high", "medium", "low", "info"] as const) {
      const count = categoryFindings.filter((finding) => finding.severity === severity).length;

      if (count === 0) {
        continue;
      }

      const penalty = severityPenalties[severity] * count;

      reduceCategory(
        category,
        penalty,
        `Reduced by ${penalty} for ${count} open ${severity} ${findingNoun(count)}.`,
        `${categoryLabels[category]} score reduced by ${severity} readiness ${findingNoun(count)}.`,
      );
    }
  }

  if (inventory.productClaritySummary.clarityStatus === "missing") {
    reduceCategory(
      "product_clarity",
      40,
      "Reduced by 40 because product documentation is missing.",
      "Product clarity score reduced because product documentation is missing.",
    );
  } else if (
    inventory.productClaritySummary.clarityStatus === "weak" ||
    inventory.productClaritySummary.clarityStatus === "unknown"
  ) {
    reduceCategory(
      "product_clarity",
      20,
      "Reduced by 20 because product clarity signals are incomplete.",
      "Product clarity score reduced because product scope signals are incomplete.",
    );
  }

  if (inventory.productClaritySummary.goalContextStatus === "not_provided") {
    reduceCategory(
      "product_clarity",
      15,
      "Reduced by 15 because goal context is not provided.",
      "Product clarity score reduced because scan goal context is not provided.",
    );
  }

  if (inventory.agentInstructionSummary.completenessStatus === "missing") {
    reduceCategory(
      "agent_readiness",
      45,
      "Reduced by 45 because root agent instructions are missing.",
      "Agent readiness score reduced because root agent instructions are missing.",
    );
  } else if (inventory.agentInstructionSummary.completenessStatus === "conflicting") {
    reduceCategory(
      "agent_readiness",
      40,
      "Reduced by 40 because root agent instructions conflict.",
      "Agent readiness score reduced because root agent instructions conflict.",
    );
  } else if (
    inventory.agentInstructionSummary.completenessStatus === "incomplete" ||
    inventory.agentInstructionSummary.completenessStatus === "unknown"
  ) {
    reduceCategory(
      "agent_readiness",
      25,
      "Reduced by 25 because root agent instructions are incomplete.",
      "Agent readiness score reduced because root agent instructions are incomplete.",
    );
  }

  const hasArchitectureDocumentation = inventory.documentationSummaries.some(
    (summary) => summary.kind === "architecture" && summary.present && summary.pathCount > 0,
  );

  if (!hasArchitectureDocumentation) {
    reduceCategory(
      "architecture",
      20,
      "Reduced by 20 because architecture documentation is missing.",
      "Architecture score reduced because architecture documentation is missing.",
    );
  }

  if (inventory.backlogQualitySummary.structureStatus === "missing") {
    reduceCategory(
      "backlog_quality",
      35,
      "Reduced by 35 because AI-executable backlog structure is missing.",
      "Backlog quality score reduced because AI-executable backlog structure is missing.",
    );
  } else if (
    inventory.backlogQualitySummary.structureStatus === "weak" ||
    inventory.backlogQualitySummary.structureStatus === "unknown"
  ) {
    reduceCategory(
      "backlog_quality",
      20,
      "Reduced by 20 because AI-executable backlog structure is incomplete.",
      "Backlog quality score reduced because AI-executable backlog structure is incomplete.",
    );
  }

  if (inventory.validationPostureSummary.postureStatus === "missing") {
    reduceCategory(
      "validation",
      45,
      "Reduced by 45 because validation command metadata is missing.",
      "Validation score reduced because validation command metadata is missing.",
    );
  } else if (
    inventory.validationPostureSummary.postureStatus === "partial" ||
    inventory.validationPostureSummary.postureStatus === "unknown"
  ) {
    reduceCategory(
      "validation",
      25,
      "Reduced by 25 because validation command metadata is incomplete.",
      "Validation score reduced because validation command metadata is incomplete.",
    );
  }

  const policyAssessment = assessRepoReadinessPolicyCoverage(inventory.policySummary);

  if (policyAssessment.coverageStatus === "missing") {
    reduceCategory(
      "security",
      45,
      "Reduced by 45 because repository policy coverage is missing.",
      "Security score reduced because repository policy coverage is missing.",
    );
  } else if (policyAssessment.coverageStatus === "incomplete") {
    reduceCategory(
      "security",
      25,
      "Reduced by 25 because repository policy coverage is incomplete.",
      "Security score reduced because repository policy coverage is incomplete.",
    );
  }

  if (inventory.ciPostureSummary.postureStatus === "missing") {
    reduceCategory(
      "ci_cd",
      20,
      "Reduced by 20 because CI validation coverage is missing.",
      "CI/CD score reduced because CI validation coverage is missing.",
    );
  } else if (
    inventory.ciPostureSummary.postureStatus === "partial" ||
    inventory.ciPostureSummary.postureStatus === "unknown"
  ) {
    reduceCategory(
      "ci_cd",
      12,
      "Reduced by 12 because CI validation coverage is incomplete.",
      "CI/CD score reduced because CI validation coverage is incomplete.",
    );
  }

  if (inventory.repoHygieneSummary.hygieneStatus === "needs_attention") {
    reduceCategory(
      "repo_hygiene",
      20,
      "Reduced by 20 because repo hygiene needs attention.",
      "Repo hygiene score reduced because structural hygiene needs attention.",
    );
  } else if (inventory.repoHygieneSummary.hygieneStatus === "minor_gaps") {
    reduceCategory(
      "repo_hygiene",
      10,
      "Reduced by 10 because repo hygiene has minor gaps.",
      "Repo hygiene score reduced because structural hygiene has minor gaps.",
    );
  }

  for (const category of FINDING_CATEGORIES) {
    if (categoryScores[category] === 100) {
      strengths.push(`${categoryLabels[category]} score has no active penalties.`);
    }
  }

  return {
    categoryScores,
    explanations,
    overallScore: Math.min(...FINDING_CATEGORIES.map((category) => categoryScores[category])),
    strengths: uniquePreservingOrder(strengths),
    weaknesses: uniquePreservingOrder(weaknesses),
  };
};

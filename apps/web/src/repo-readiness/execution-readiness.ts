import type { Finding, RepoExecutionReadiness, RepoScanInventory } from "@control-plane/shared";
import { assessRepoReadinessPolicyCoverage } from "@control-plane/policies";

export type ExecutionReadinessFinding = Pick<
  Finding,
  "category" | "deterministicRuleId" | "severity" | "status"
>;

export type ExecutionReadinessClassification = {
  blockedReasons: string[];
  executionReadiness: RepoExecutionReadiness;
  recommendedNextActions: string[];
};

export type ClassifyExecutionReadinessInput = {
  findings: readonly ExecutionReadinessFinding[];
  inventory: RepoScanInventory;
  taskRecommendationIds: readonly string[];
};

const blockedFindingReason =
  "Blocked readiness findings must be resolved before AI execution can continue.";
const highSeverityFindingReason =
  "High-severity readiness findings require setup before local runner execution.";
const policyCoverageReason = "Local runner execution requires complete repository policy coverage.";
const validationPostureReason =
  "Local runner execution requires a complete validation command map.";

const setupPrAction =
  "Create a setup PR from the open readiness recommendations before enabling local runner execution.";

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

const openFindingsFor = (
  findings: readonly ExecutionReadinessFinding[],
): ExecutionReadinessFinding[] => findings.filter((finding) => finding.status === "open");

export const classifyExecutionReadiness = ({
  findings,
  inventory,
  taskRecommendationIds,
}: ClassifyExecutionReadinessInput): ExecutionReadinessClassification => {
  const openFindings = openFindingsFor(findings);
  const hasBlockedFinding = openFindings.some((finding) => finding.severity === "blocked");

  if (hasBlockedFinding) {
    return {
      blockedReasons: [blockedFindingReason],
      executionReadiness: "blocked",
      recommendedNextActions: [
        "Resolve blocked readiness findings before creating setup PRs or local runner tasks.",
      ],
    };
  }

  const policyAssessment = assessRepoReadinessPolicyCoverage(inventory.policySummary);
  const isPolicyReady = policyAssessment.coverageStatus === "ready";
  const isValidationReady = inventory.validationPostureSummary.postureStatus === "ready";
  const hasHighSeverityFinding = openFindings.some((finding) => finding.severity === "high");
  const hasOpenFindings = openFindings.length > 0;
  const hasSetupRecommendationPath = taskRecommendationIds.length > 0;
  const blockedReasons = uniquePreservingOrder([
    ...(isPolicyReady ? [] : [policyCoverageReason]),
    ...(isValidationReady ? [] : [validationPostureReason]),
    ...(hasHighSeverityFinding ? [highSeverityFindingReason] : []),
  ]);

  if (blockedReasons.length > 0) {
    return {
      blockedReasons,
      executionReadiness: hasSetupRecommendationPath ? "setup_pr_ready" : "setup_required",
      recommendedNextActions: [
        hasSetupRecommendationPath
          ? setupPrAction
          : "Create setup recommendations for missing readiness prerequisites before local runner execution.",
      ],
    };
  }

  if (hasSetupRecommendationPath) {
    return {
      blockedReasons: [],
      executionReadiness: "setup_pr_ready",
      recommendedNextActions: [setupPrAction],
    };
  }

  if (hasOpenFindings) {
    return {
      blockedReasons: [],
      executionReadiness: "planning_ready",
      recommendedNextActions: [
        "Review open readiness findings before approving local runner execution.",
      ],
    };
  }

  return {
    blockedReasons: [],
    executionReadiness: "local_runner_ready",
    recommendedNextActions: [
      "Repository is ready for local runner execution after normal human approval.",
    ],
  };
};

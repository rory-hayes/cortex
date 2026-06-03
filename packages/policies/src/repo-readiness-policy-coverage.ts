import type { RepoScanPolicySummary } from "@control-plane/shared";

export type RepoReadinessPolicyCoverageStatus = "incomplete" | "missing" | "ready";

export type RepoReadinessPolicyCoverageAssessment = {
  coverageStatus: RepoReadinessPolicyCoverageStatus;
  dryRunCheckCount: number;
  hasPolicyFile: boolean;
  missingCoverageLabels: string[];
  protectedPathCount: number;
  recommendedRuleLabels: string[];
  sensitivePathCount: number;
  validationCommandCount: number;
};

const missingCoverageLabelsFor = (policySummary: RepoScanPolicySummary): string[] => {
  const labels: string[] = [];

  if (!policySummary.hasPolicyFile) {
    labels.push("repository policy");
  }

  if (policySummary.protectedPathCount === 0) {
    labels.push("protected area rules");
  }

  if (policySummary.sensitivePathCount === 0) {
    labels.push("sensitive area rules");
  }

  return labels;
};

const recommendedRuleLabelsFor = (policySummary: RepoScanPolicySummary): string[] => {
  const labels: string[] = [];

  if (!policySummary.hasPolicyFile) {
    labels.push("Create repository policy");
  }

  if (policySummary.protectedPathCount === 0) {
    labels.push("Add protected area rules");
  }

  if (policySummary.sensitivePathCount === 0) {
    labels.push("Add sensitive area rules");
  }

  return labels;
};

const coverageStatusFor = (
  policySummary: RepoScanPolicySummary,
  missingCoverageLabels: readonly string[],
): RepoReadinessPolicyCoverageStatus => {
  if (!policySummary.hasPolicyFile) {
    return "missing";
  }

  return missingCoverageLabels.length > 0 ? "incomplete" : "ready";
};

export const assessRepoReadinessPolicyCoverage = (
  policySummary: RepoScanPolicySummary,
): RepoReadinessPolicyCoverageAssessment => {
  const missingCoverageLabels = missingCoverageLabelsFor(policySummary);

  return {
    coverageStatus: coverageStatusFor(policySummary, missingCoverageLabels),
    dryRunCheckCount: policySummary.dryRunCheckCount,
    hasPolicyFile: policySummary.hasPolicyFile,
    missingCoverageLabels,
    protectedPathCount: policySummary.protectedPathCount,
    recommendedRuleLabels: recommendedRuleLabelsFor(policySummary),
    sensitivePathCount: policySummary.sensitivePathCount,
    validationCommandCount: policySummary.validationCommandCount,
  };
};

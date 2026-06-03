import type {
  PrArtifactStatus,
  RiskFinding,
  RunState,
  ValidationResultStatus,
} from "@control-plane/shared";

export type ReviewStateBucket =
  | "awaiting_approval"
  | "blocked"
  | "cancelled"
  | "completed"
  | "failed"
  | "pr_ready"
  | "ready"
  | "running";

export type RiskCategoryCount = {
  category: RiskFinding["category"];
  count: number;
};

export type ValidationStatusCount = {
  count: number;
  status: ValidationResultStatus;
};

export type RiskSummary = {
  blockerCount: number;
  categoryCounts: RiskCategoryCount[];
  warningCount: number;
};

const riskCategories = new Set<RiskFinding["category"]>([
  "auth",
  "billing",
  "dirty_repo",
  "duplicate_assignment",
  "generated_files",
  "infrastructure",
  "large_diff",
  "migration",
  "missing_capability",
  "missing_mapping",
  "missing_validation",
  "package_lock",
  "protected_branch",
  "protected_path",
  "secret",
  "sensitive_path",
  "stale_lock",
  "validation_failed",
  "validation_skipped",
]);

const riskSeverities = new Set<RiskFinding["severity"]>(["blocked", "warning"]);

const validationStatuses = ["cancelled", "failed", "passed", "skipped"] as const;

export const countUniquePaths = (...pathLists: Array<readonly string[] | null | undefined>) => {
  const paths = new Set<string>();

  pathLists.forEach((pathList) => {
    pathList?.forEach((pathValue) => {
      const normalizedPath = pathValue.trim();

      if (normalizedPath.length > 0) {
        paths.add(normalizedPath);
      }
    });
  });

  return paths.size;
};

export const summarizeRiskFindings = (
  ...findingLists: Array<readonly RiskFinding[] | null | undefined>
): RiskSummary => {
  const categoryCounts = new Map<RiskFinding["category"], number>();
  let blockerCount = 0;
  let warningCount = 0;

  findingLists.forEach((findingList) => {
    findingList?.forEach((finding) => {
      if (!riskCategories.has(finding.category) || !riskSeverities.has(finding.severity)) {
        return;
      }

      if (finding.severity === "blocked") {
        blockerCount += 1;
      } else {
        warningCount += 1;
      }

      categoryCounts.set(finding.category, (categoryCounts.get(finding.category) ?? 0) + 1);
    });
  });

  return {
    blockerCount,
    categoryCounts: Array.from(categoryCounts.entries())
      .map(([category, count]) => ({ category, count }))
      .toSorted((left, right) => left.category.localeCompare(right.category)),
    warningCount,
  };
};

export const summarizeValidationStatuses = (
  statuses: readonly ValidationResultStatus[],
): ValidationStatusCount[] =>
  validationStatuses
    .map((status) => ({
      count: statuses.filter((candidate) => candidate === status).length,
      status,
    }))
    .filter((entry) => entry.count > 0);

export const deriveReviewStateBucket = (input: {
  prStatus?: PrArtifactStatus | null;
  state: RunState;
}): ReviewStateBucket => {
  if (input.state === "blocked") {
    return "blocked";
  }

  if (input.state === "failed") {
    return "failed";
  }

  if (input.state === "cancelled" || input.state === "cancel_requested" || input.state === "cancelling") {
    return "cancelled";
  }

  if (input.state === "completed") {
    return "completed";
  }

  if (input.state === "awaiting_approval") {
    return input.prStatus === null || input.prStatus === undefined ? "awaiting_approval" : "pr_ready";
  }

  if (input.state === "queued" || input.state === "dry_run_passed") {
    return "ready";
  }

  return "running";
};

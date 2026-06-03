import type { RiskFinding, ValidationResultStatus } from "@control-plane/shared";

import { Badge } from "@/components/ui/badge";
import type {
  ReviewStateBucket,
  RiskCategoryCount,
  ValidationStatusCount,
} from "@/src/runs/review-metadata";

type EvidenceSummaryProps = {
  blockerCount: number;
  changedFileCount: number;
  compact?: boolean;
  riskCategoryCounts: RiskCategoryCount[];
  validationStatusCounts?: ValidationStatusCount[];
  warningCount: number;
};

type ReviewStateBadgeProps = {
  bucket: ReviewStateBucket;
};

const pluralize = (count: number, singular: string, plural = `${singular}s`) =>
  `${count} ${count === 1 ? singular : plural}`;

export const riskCategoryLabels = {
  auth: "Auth",
  billing: "Billing",
  dirty_repo: "Dirty repo",
  duplicate_assignment: "Duplicate assignment",
  generated_files: "Generated files",
  infrastructure: "Infrastructure",
  large_diff: "Large change",
  migration: "Migration",
  missing_capability: "Missing capability",
  missing_mapping: "Missing mapping",
  missing_validation: "Missing validation",
  package_lock: "Package lock",
  protected_branch: "Protected branch",
  protected_path: "Protected path",
  secret: "Secret",
  sensitive_path: "Sensitive path",
  stale_lock: "Stale lock",
  validation_failed: "Validation failed",
  validation_skipped: "Validation skipped",
} satisfies Record<RiskFinding["category"], string>;

const validationStatusLabels = {
  cancelled: "cancelled",
  failed: "failed",
  passed: "passed",
  skipped: "skipped",
} satisfies Record<ValidationResultStatus, string>;

const stateBucketLabels = {
  awaiting_approval: "Awaiting approval",
  blocked: "Blocked",
  cancelled: "Cancelled",
  completed: "Completed",
  failed: "Failed",
  pr_ready: "PR-ready",
  ready: "Ready",
  running: "Running",
} satisfies Record<ReviewStateBucket, string>;

const stateBucketVariant = (bucket: ReviewStateBucket): "destructive" | "outline" | "secondary" => {
  if (bucket === "blocked" || bucket === "failed") {
    return "destructive";
  }

  if (bucket === "ready" || bucket === "awaiting_approval" || bucket === "cancelled") {
    return "outline";
  }

  return "secondary";
};

export function ReviewStateBadge({ bucket }: ReviewStateBadgeProps) {
  return <Badge variant={stateBucketVariant(bucket)}>{stateBucketLabels[bucket]}</Badge>;
}

export function EvidenceSummary({
  blockerCount,
  changedFileCount,
  compact = false,
  riskCategoryCounts,
  validationStatusCounts = [],
  warningCount,
}: EvidenceSummaryProps) {
  return (
    <div className="flex max-w-sm flex-col gap-2 whitespace-normal">
      <div className="flex flex-wrap gap-1">
        <Badge variant="outline">{pluralize(changedFileCount, "file")}</Badge>
        <Badge variant={warningCount > 0 ? "outline" : "secondary"}>
          {pluralize(warningCount, "warning")}
        </Badge>
        <Badge variant={blockerCount > 0 ? "destructive" : "secondary"}>
          {pluralize(blockerCount, "blocker")}
        </Badge>
      </div>

      {validationStatusCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {validationStatusCounts.map((entry) => (
            <Badge
              key={entry.status}
              variant={entry.status === "failed" ? "destructive" : "outline"}
            >
              {entry.count} {validationStatusLabels[entry.status]}
            </Badge>
          ))}
        </div>
      ) : null}

      {riskCategoryCounts.length > 0 ? (
        <div className="flex flex-wrap gap-1">
          {riskCategoryCounts.map((entry) => (
            <Badge key={entry.category} variant="outline">
              {compact
                ? riskCategoryLabels[entry.category]
                : `${riskCategoryLabels[entry.category]} ${entry.count}`}
            </Badge>
          ))}
        </div>
      ) : null}
    </div>
  );
}

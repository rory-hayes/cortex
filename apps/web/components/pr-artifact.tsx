import { ExternalLink, FileText, GitBranch, GitPullRequest, ShieldAlert } from "lucide-react";
import type { RiskFinding } from "@control-plane/shared";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { hasUnsafeArtifactText, hasUnsafePathText } from "@/src/runs/artifact-safety";
import type { RunDetailPr } from "@/src/runs/detail";

type PrArtifactDisplayProps = {
  artifact: RunDetailPr | null;
};

const prStatusLabels = {
  closed: "Closed",
  draft: "Draft",
  merged: "Merged",
  open: "Open",
} satisfies Record<RunDetailPr["status"], string>;

const reviewStateLabels = {
  approved: "Approved",
  changes_requested: "Changes requested",
  review_required: "Review required",
  unknown: "Review unknown",
} satisfies Record<RunDetailPr["reviewState"], string>;

const checksConclusionLabels = {
  failing: "Checks failing",
  passing: "Checks passing",
  pending: "Checks pending",
  unknown: "Checks unknown",
} satisfies Record<RunDetailPr["checks"]["conclusion"], string>;

const riskCategoryLabels = {
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

const severityLabels = {
  blocked: "Blocked",
  warning: "Warning",
} satisfies Record<RiskFinding["severity"], string>;

const statusVariant = (status: RunDetailPr["status"]): "destructive" | "outline" | "secondary" => {
  if (status === "closed") {
    return "destructive";
  }

  if (status === "draft") {
    return "outline";
  }

  return "secondary";
};

const severityVariant = (
  severity: RiskFinding["severity"],
): "destructive" | "outline" | "secondary" => (severity === "blocked" ? "destructive" : "outline");

const formatArtifactDate = (value: Date): string =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(value);

const formatArtifactDateTime = (value: Date): string =>
  new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(value);

const toSafePrUrl = (value: string | null): string | null => {
  if (value === null) {
    return null;
  }

  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)) {
    return null;
  }

  try {
    const url = new URL(normalizedValue);

    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.username.length > 0 ||
      url.password.length > 0
    ) {
      return null;
    }

    return url.toString();
  } catch {
    return null;
  }
};

const toSafeArtifactText = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafeArtifactText(normalizedValue)) {
    return null;
  }

  return normalizedValue;
};

const toSafePath = (value: string): string | null => {
  const normalizedValue = value.trim();

  if (normalizedValue.length === 0 || hasUnsafePathText(normalizedValue)) {
    return null;
  }

  return normalizedValue;
};

const toVisibleRiskFlags = (riskFlags: RiskFinding[]): RiskFinding[] =>
  riskFlags
    .map((riskFinding) => {
      const id = toSafeArtifactText(riskFinding.id);
      const message = toSafeArtifactText(riskFinding.message);
      const paths = riskFinding.paths.map(toSafePath);
      const safePaths = paths.filter((pathValue): pathValue is string => pathValue !== null);

      if (id === null || message === null || safePaths.length !== riskFinding.paths.length) {
        return null;
      }

      return {
        ...riskFinding,
        id,
        message,
        paths: safePaths,
      } satisfies RiskFinding;
    })
    .filter((riskFinding): riskFinding is RiskFinding => riskFinding !== null);

const toVisibleArtifact = (artifact: RunDetailPr): RunDetailPr => {
  const repositoryOwner = toSafeArtifactText(artifact.repository.owner) ?? "Repository unavailable";
  const repositoryName = toSafeArtifactText(artifact.repository.name) ?? "unknown";

  return {
    ...artifact,
    branchName: toSafeArtifactText(artifact.branchName) ?? "Branch unavailable",
    changedFilePaths: artifact.changedFilePaths
      .map(toSafePath)
      .filter((pathValue): pathValue is string => pathValue !== null),
    repository: {
      name: repositoryName,
      owner: repositoryOwner,
    },
    riskFlags: toVisibleRiskFlags(artifact.riskFlags),
    title: toSafeArtifactText(artifact.title) ?? `Pull request #${artifact.number}`,
    url: toSafePrUrl(artifact.url),
  };
};

export function PrArtifactDisplay({ artifact }: PrArtifactDisplayProps) {
  const visibleArtifact = artifact === null ? null : toVisibleArtifact(artifact);

  return (
    <section className="rounded-lg border border-border bg-card p-5" aria-labelledby="pr-artifact">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
            <GitPullRequest aria-hidden="true" className="size-4" />
            <p>Pull request</p>
          </div>
          <h2 id="pr-artifact" className="mt-2 text-base font-semibold">
            {visibleArtifact === null ? "No PR artifact yet." : visibleArtifact.title}
          </h2>
          {visibleArtifact === null ? (
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
              The PR link and metadata will appear after the runner opens a PR.
            </p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Badge variant={statusVariant(visibleArtifact.status)}>
                {prStatusLabels[visibleArtifact.status]}
              </Badge>
              <Badge variant="outline">#{visibleArtifact.number}</Badge>
              <span className="break-all font-mono text-xs text-muted-foreground">
                {visibleArtifact.repository.owner}/{visibleArtifact.repository.name}
              </span>
            </div>
          )}
        </div>

        {visibleArtifact?.url === null ? (
          <Badge variant="outline">Link unavailable</Badge>
        ) : visibleArtifact === null ? null : (
          <Button asChild size="sm" variant="outline">
            <a href={visibleArtifact.url} rel="noreferrer" target="_blank">
              <ExternalLink aria-hidden="true" className="size-4" />
              Open PR
            </a>
          </Button>
        )}
      </div>

      {visibleArtifact === null ? null : (
        <>
          <dl className="mt-5 grid gap-4 md:grid-cols-2">
            <div>
              <dt className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <GitBranch aria-hidden="true" className="size-4" />
                Branch
              </dt>
              <dd className="mt-1 break-all font-mono text-xs text-foreground">
                {visibleArtifact.branchName}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Status</dt>
              <dd className="mt-1 text-sm font-medium">{prStatusLabels[visibleArtifact.status]}</dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Created</dt>
              <dd className="mt-1 text-sm font-medium">
                {formatArtifactDate(visibleArtifact.createdAt)}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Review</dt>
              <dd className="mt-1 text-sm font-medium">
                {reviewStateLabels[visibleArtifact.reviewState]}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Checks</dt>
              <dd className="mt-1 flex flex-wrap items-center gap-2 text-sm font-medium">
                <span>{checksConclusionLabels[visibleArtifact.checks.conclusion]}</span>
                {visibleArtifact.checks.totalCount === 0 ? null : (
                  <span className="text-xs text-muted-foreground">
                    {visibleArtifact.checks.passedCount} passed
                    {visibleArtifact.checks.failedCount > 0
                      ? `, ${visibleArtifact.checks.failedCount} failed`
                      : ""}
                    {visibleArtifact.checks.pendingCount > 0
                      ? `, ${visibleArtifact.checks.pendingCount} pending`
                      : ""}
                    {visibleArtifact.checks.skippedCount > 0
                      ? `, ${visibleArtifact.checks.skippedCount} skipped`
                      : ""}
                  </span>
                )}
              </dd>
            </div>
            <div>
              <dt className="text-sm font-medium text-muted-foreground">Last GitHub sync</dt>
              <dd className="mt-1 text-sm font-medium">
                {visibleArtifact.githubSyncedAt === null
                  ? "Not synced from GitHub yet."
                  : formatArtifactDateTime(visibleArtifact.githubSyncedAt)}
              </dd>
            </div>
          </dl>

          <div className="mt-5 grid gap-5 xl:grid-cols-2">
            <section aria-labelledby="pr-artifact-files">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <FileText aria-hidden="true" className="size-4" />
                <h3 id="pr-artifact-files">Changed files</h3>
              </div>
              {visibleArtifact.changedFilePaths.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No changed files recorded.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-2">
                  {visibleArtifact.changedFilePaths.map((changedFilePath) => (
                    <li
                      className="break-all rounded-md border border-border bg-background px-3 py-2 font-mono text-xs"
                      key={changedFilePath}
                    >
                      {changedFilePath}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section aria-labelledby="pr-artifact-risk">
              <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <ShieldAlert aria-hidden="true" className="size-4" />
                <h3 id="pr-artifact-risk">Risk flags</h3>
              </div>
              {visibleArtifact.riskFlags.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No risk flags recorded.</p>
              ) : (
                <ul className="mt-3 flex flex-col gap-3">
                  {visibleArtifact.riskFlags.map((riskFinding, riskFindingIndex) => (
                    <li
                      className="rounded-md border border-border bg-background px-3 py-3"
                      key={`${riskFinding.id}:${riskFindingIndex}`}
                    >
                      <div className="flex flex-wrap gap-2">
                        <Badge variant={severityVariant(riskFinding.severity)}>
                          {severityLabels[riskFinding.severity]}
                        </Badge>
                        <Badge variant="outline">{riskCategoryLabels[riskFinding.category]}</Badge>
                      </div>
                      <p className="mt-3 text-sm leading-6">{riskFinding.message}</p>
                      {riskFinding.paths.length > 0 ? (
                        <ul className="mt-3 flex flex-col gap-1">
                          {riskFinding.paths.map((pathValue) => (
                            <li
                              className="break-all font-mono text-xs text-muted-foreground"
                              key={pathValue}
                            >
                              {pathValue}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </>
      )}
    </section>
  );
}
